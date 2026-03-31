export const DAEMON_BRIDGE_SCRIPT = String.raw`# frozen_string_literal: true

require 'json'
require 'time'
require 'stringio'

def emit(type, payload = {})
  STDOUT.write(JSON.generate({ type: type }.merge(payload)) + "\n")
  STDOUT.flush
end

def stringify(value, limit: 4000)
  text = case value
         when nil
           ''
         when String
           value
         else
           JSON.generate(value)
         end
  text.length > limit ? "#{text[0, limit]}..." : text
rescue StandardError
  value.to_s
end

def hashish(value)
  value.is_a?(Hash) ? value : {}
end

def fetch_field(obj, *keys)
  keys.each do |key|
    return obj[key] if obj.is_a?(Hash) && obj.key?(key)
    sym = key.is_a?(String) ? key.to_sym : key
    str = key.to_s
    return obj.public_send(sym) if obj.respond_to?(sym)
    return obj.public_send(str) if obj.respond_to?(str)
  end
  nil
end

def extract_text(content)
  case content
  when String
    content
  when Array
    content.filter_map do |part|
      next unless part.is_a?(Hash)

      part_type = fetch_field(part, 'type', :type).to_s
      case part_type
      when 'text'
        fetch_field(part, 'text', :text).to_s
      when 'image'
        '[Image]'
      when 'file'
        filename = fetch_field(part, 'filename', :filename).to_s
        filename.empty? ? '[File]' : "[File: #{filename}]"
      when 'tool-call'
        name = fetch_field(part, 'toolName', :toolName, 'tool_name', :tool_name).to_s
        args = fetch_field(part, 'args', :args)
        result = fetch_field(part, 'result', :result)
        pieces = []
        pieces << "[Tool call: #{name}]" unless name.empty?
        pieces << "Args: #{stringify(args, limit: 1200)}" unless args.nil?
        pieces << "Result: #{stringify(result, limit: 1600)}" unless result.nil?
        pieces.join("\n")
      else
        nil
      end
    end.compact.join("\n")
  else
    content.to_s
  end
end

def seed_history(chat, history)
  Array(history).each do |message|
    next unless message.is_a?(Hash)

    role = fetch_field(message, 'role', :role).to_s
    text = extract_text(fetch_field(message, 'content', :content)).strip
    next if role.empty? || text.empty?

    chat.add_message(role: role.to_sym, content: text)
  end
end

def serialize_tool_call(tool_call)
  {
    toolCallId: fetch_field(tool_call, 'tool_call_id', :tool_call_id, 'id', :id),
    toolName: fetch_field(tool_call, 'name', :name, 'tool_name', :tool_name),
    args: fetch_field(tool_call, 'args', :args, 'arguments', :arguments, 'params', :params)
  }.compact
end

def serialize_tool_result(tool_result)
  {
    toolCallId: fetch_field(tool_result, 'tool_call_id', :tool_call_id, 'id', :id),
    toolName: fetch_field(tool_result, 'name', :name, 'tool_name', :tool_name),
    result: fetch_field(tool_result, 'result', :result, 'output', :output, 'content', :content)
  }.compact
end

def load_legion!(payload)
  root_path = payload['rootPath'].to_s
  unless root_path.empty?
    lib_path = File.expand_path('lib', root_path)
    $LOAD_PATH.unshift(lib_path) if Dir.exist?(lib_path) && !$LOAD_PATH.include?(lib_path)
  end

  require 'legion/cli/connection'
  require 'legion/cli/chat/session'
  require 'legion/cli/chat/context'
  require 'legion/cli/chat/tool_registry'
  require 'legion/cli/chat/permissions'
end

def configure_connection!(payload)
  Legion::CLI::Connection.config_dir = payload['configDir'] unless payload['configDir'].to_s.empty?
  Legion::CLI::Connection.log_level = payload['verbose'] ? 'debug' : 'error'
end

begin
  payload = JSON.parse(STDIN.read)
  load_legion!(payload)
  configure_connection!(payload)

  at_exit do
    Legion::CLI::Connection.shutdown if defined?(Legion::CLI::Connection)
  end

  if payload['type'] == 'health'
    begin
      Legion::CLI::Connection.ensure_settings
      Legion::CLI::Connection.ensure_llm
      emit('health', {
        ok: true,
        status: 'llm_ready'
      })
    rescue StandardError => e
      emit('health', {
        ok: false,
        status: e.message.to_s.downcase.include?('llm') ? 'llm_unavailable' : 'settings_error',
        error: e.message
      })
    end
    exit 0
  end

  Legion::CLI::Connection.ensure_llm
  Legion::CLI::Chat::Permissions.mode = (payload['permissionMode'] || 'headless').to_sym

  opts = {}
  opts[:model] = payload['model'] unless payload['model'].to_s.empty?
  provider = payload['provider'].to_s
  opts[:provider] = provider.to_sym unless provider.empty?

  chat = Legion::LLM.chat(**opts)
  chat.with_tools(*Legion::CLI::Chat::ToolRegistry.builtin_tools)

  cwd = payload['cwd'].to_s
  extra_dirs = Array(payload['extraDirs']).map(&:to_s).reject(&:empty?)
  base_prompt = if cwd.empty?
                  ''
                else
                  Legion::CLI::Chat::Context.to_system_prompt(cwd, extra_dirs: extra_dirs)
                end
  custom_prompt = payload['systemPrompt'].to_s
  prompt_parts = [base_prompt, custom_prompt].reject(&:empty?)

  session = Legion::CLI::Chat::Session.new(
    chat: chat,
    system_prompt: prompt_parts.empty? ? nil : prompt_parts.join("\n\n")
  )

  all_messages = Array(payload['messages'])
  prompt_message = all_messages.last
  raise 'No user message was provided to Legion.' unless prompt_message.is_a?(Hash)

  seed_history(chat, all_messages[0...-1])
  prompt = extract_text(fetch_field(prompt_message, 'content', :content)).strip
  raise 'No user message was provided to Legion.' if prompt.strip.empty?

  session.send_message(
    prompt,
    on_tool_call: lambda { |tool_call|
      emit('tool-call', serialize_tool_call(tool_call))
    },
    on_tool_result: lambda { |tool_result|
      emit('tool-result', serialize_tool_result(tool_result))
    }
  ) do |chunk|
    text = fetch_field(chunk, 'content', :content).to_s
    emit('text-delta', { text: text }) unless text.empty?
  end

  emit('done')
rescue StandardError => e
  emit('error', { error: e.message })
  emit('done')
  exit 1
rescue LoadError => e
  hints = []
  hints << "Ruby #{RUBY_VERSION} is too old for LegionIO; use Ruby 3.4+." if Gem::Version.new(RUBY_VERSION) < Gem::Version.new('3.4.0')
  hints << 'Run bundle install inside your LegionIO repo.' if e.message.include?('thor') || e.message.include?('legion/')
  hints << 'If ffi is broken, run gem pristine ffi --version 1.15.5 in the same Ruby environment.' if e.message.include?('ffi')
  message = ([e.message] + hints).join(' ')
  emit('error', { error: message })
  emit('done')
  exit 1
end
`;
