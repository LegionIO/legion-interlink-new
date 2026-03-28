import { useState, useCallback, useRef, useEffect, type FC } from 'react';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  LoaderIcon,
  StopCircleIcon,
  SendHorizontalIcon,
  ExternalLinkIcon,
  BotIcon,
  UserIcon,
  MonitorIcon,
  InfoIcon,
} from 'lucide-react';
import { useSubAgents, type SubAgentThreadState } from '@/providers/RuntimeProvider';
import { MarkdownText } from './MarkdownText';
import { ToolCallDisplay } from './ToolGroup';

type SubAgentInlineProps = {
  toolCallId: string;
  args: unknown;
  result?: unknown;
  isError?: boolean;
  liveOutput?: {
    stdout?: string;
    stderr?: string;
    truncated?: boolean;
    stopped?: boolean;
    subAgentConversationId?: string;
  };
};

export const SubAgentInline: FC<SubAgentInlineProps> = ({ toolCallId, args, result, isError, liveOutput }) => {
  const [expanded, setExpanded] = useState(true);
  const [messageInput, setMessageInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const { threads, sendMessage, stop, navigateTo } = useSubAgents();

  const [showArgs, setShowArgs] = useState(false);
  const taskArgs = args as { task?: string; model?: string; context?: string } | undefined;
  const task = taskArgs?.task ?? 'Sub-agent task';
  const modelOverride = taskArgs?.model;
  const contextArg = taskArgs?.context;

  const resultData = result as { subAgentConversationId?: string; response?: string; status?: string; toolsUsed?: string[] } | undefined;
  const subAgentId = resultData?.subAgentConversationId
    ?? liveOutput?.subAgentConversationId
    ?? findSubAgentByToolCall(threads, toolCallId);
  const thread = subAgentId ? threads.get(subAgentId) : null;

  const hasResult = result !== undefined;
  const isRunning = !hasResult && (thread?.status === 'running' || thread?.status === 'awaiting-input');
  const isStopped = resultData?.status === 'stopped' || thread?.status === 'stopped';
  const hasError = isError || resultData?.status === 'error' || thread?.status === 'error';

  // Auto-scroll to bottom of inline thread
  useEffect(() => {
    if (expanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [expanded, thread?.messages.length]);

  const handleSendMessage = useCallback(async () => {
    if (!subAgentId || !messageInput.trim()) return;
    await sendMessage(subAgentId, messageInput.trim());
    setMessageInput('');
  }, [subAgentId, messageInput, sendMessage]);

  const handleStop = useCallback(async () => {
    if (!subAgentId) return;
    await stop(subAgentId);
  }, [subAgentId, stop]);

  const handleNavigate = useCallback(() => {
    if (!subAgentId) return;
    navigateTo(subAgentId);
  }, [subAgentId, navigateTo]);

  // Status display
  const StatusIcon = hasError ? AlertCircleIcon : isStopped ? StopCircleIcon : hasResult ? CheckCircle2Icon : LoaderIcon;
  const statusColor = hasError ? 'text-destructive' : isStopped ? 'text-orange-400' : hasResult ? 'text-green-500' : 'text-blue-400';
  const statusLabel = hasError ? 'Error' : isStopped ? 'Stopped' : hasResult ? 'Completed' : thread?.status === 'awaiting-input' ? 'Awaiting input' : 'Running';

  return (
    <div className="rounded-lg border-l-4 border-l-blue-500/60 border border-border bg-card text-sm overflow-hidden">
      {/* Header — always visible */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-80 transition-opacity"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <BotIcon className="h-4 w-4 text-blue-400 shrink-0" />
          <span className="text-xs font-medium truncate text-left">
            Sub-agent: {task.length > 70 ? task.slice(0, 67) + '...' : task}
          </span>
        </button>

        {modelOverride && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">{modelOverride}</span>}
        <StatusIcon className={`h-3.5 w-3.5 shrink-0 ${statusColor} ${isRunning ? 'animate-spin' : ''}`} />
        <span className={`text-[10px] shrink-0 ${statusColor}`}>{statusLabel}</span>

        {isRunning && subAgentId && (
          <button type="button" onClick={(e) => { e.stopPropagation(); handleStop(); }} className="p-1 rounded hover:bg-destructive/10 shrink-0" title="Stop">
            <StopCircleIcon className="h-3.5 w-3.5 text-destructive" />
          </button>
        )}
        {subAgentId && (
          <button type="button" onClick={(e) => { e.stopPropagation(); handleNavigate(); }} className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 px-1.5 py-0.5 rounded transition-colors shrink-0" title="Open full thread">
            <ExternalLinkIcon className="h-3 w-3" />
            <span>Open</span>
          </button>
        )}
      </div>

      {/* Tool args detail — collapsible */}
      {(contextArg || modelOverride) && (
        <div className="border-t">
          <button
            type="button"
            onClick={() => setShowArgs(!showArgs)}
            className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <InfoIcon className="h-3 w-3" />
            <span>Tool args</span>
            {showArgs ? <ChevronDownIcon className="h-3 w-3 ml-auto" /> : <ChevronRightIcon className="h-3 w-3 ml-auto" />}
          </button>
          {showArgs && (
            <div className="px-3 pb-2 space-y-1">
              <div className="text-[10px]"><span className="text-muted-foreground">Task:</span> <span className="text-foreground">{task}</span></div>
              {modelOverride && <div className="text-[10px]"><span className="text-muted-foreground">Model:</span> <span className="text-foreground">{modelOverride}</span></div>}
              {contextArg && (
                <div className="text-[10px]">
                  <span className="text-muted-foreground">Context:</span>
                  <pre className="mt-0.5 text-foreground text-[10px] font-mono whitespace-pre-wrap bg-muted/50 rounded p-1.5 max-h-[100px] overflow-y-auto">{contextArg}</pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collapsed: compact single-line preview */}
      {!expanded && (
        <div className="border-t px-3 py-1.5">
          <CompactPreview thread={thread} liveOutput={liveOutput} isRunning={isRunning} />
        </div>
      )}

      {/* Expanded: full nested thread display */}
      {expanded && (
        <div className="border-t">
          {/* Mini chat thread */}
          <div ref={scrollRef} className="overflow-y-auto px-3 py-2 space-y-2 max-h-[450px]">
            {thread && thread.messages.length > 0 ? (
              thread.messages.map((msg, i) => {
                const content = Array.isArray(msg.content) ? msg.content : [];
                const role = msg.role as string;
                return <MiniChatBubble key={(msg as { id?: string }).id ?? i} role={role} content={content} />;
              })
            ) : liveOutput?.stdout ? (
              <pre className="text-[11px] font-mono text-muted-foreground whitespace-pre-wrap">{liveOutput.stdout.slice(-2000)}</pre>
            ) : isRunning ? (
              <div className="text-xs text-muted-foreground italic py-2">Waiting for sub-agent response...</div>
            ) : null}

            {/* Typing indicator */}
            {isRunning && thread && thread.messages.length > 0 && (
              <div className="flex items-center gap-2 pl-6 py-1">
                <BotIcon className="h-3 w-3 text-blue-400" />
                <div className="flex items-center gap-1">
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
                  <div className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
          </div>

          {/* Inline composer — visible when running or awaiting input */}
          {(isRunning || thread?.status === 'awaiting-input') && subAgentId && (
            <div className="border-t px-3 py-2">
              <div className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5">
                <input
                  type="text"
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  placeholder="Message sub-agent..."
                  className="flex-1 text-xs bg-transparent outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={!messageInput.trim()}
                  className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-30 transition-colors shrink-0"
                >
                  <SendHorizontalIcon className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Final result summary (after completion) */}
          {resultData?.toolsUsed && resultData.toolsUsed.length > 0 && (
            <div className="border-t px-3 py-1.5 flex flex-wrap gap-1">
              <span className="text-[10px] text-muted-foreground mr-1">Tools used:</span>
              {resultData.toolsUsed.map((t) => (
                <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// --- Mini chat bubble for inline thread ---

type ContentPart = {
  type: string;
  text?: string;
  source?: string;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  startedAt?: string;
  finishedAt?: string;
  liveOutput?: { stdout?: string; stderr?: string; truncated?: boolean; stopped?: boolean };
};

const MiniChatBubble: FC<{ role: string; content: ContentPart[] }> = ({ role, content }) => {
  const isAssistant = role === 'assistant';

  // Determine user message source (task, parent, or user)
  const firstTextPart = content.find((p) => p.type === 'text');
  const source = (firstTextPart as { source?: string } | undefined)?.source;

  let label: string;
  let Icon: typeof BotIcon;
  let iconColor: string;
  let bubbleBg: string;
  let align: string;

  if (isAssistant) {
    label = 'Sub-agent';
    Icon = BotIcon;
    iconColor = 'text-blue-400';
    bubbleBg = 'bg-muted/80';
    align = 'justify-start';
  } else if (source === 'task') {
    label = 'Task (from parent)';
    Icon = MonitorIcon;
    iconColor = 'text-purple-400';
    bubbleBg = 'bg-purple-500/10 border border-purple-500/20';
    align = 'justify-start';
  } else if (source === 'user') {
    label = 'You';
    Icon = UserIcon;
    iconColor = 'text-primary';
    bubbleBg = 'bg-primary/10 border border-primary/20';
    align = 'justify-end';
  } else {
    // Generic user message (e.g. from parent agent follow-up)
    label = 'Parent agent';
    Icon = MonitorIcon;
    iconColor = 'text-orange-400';
    bubbleBg = 'bg-orange-500/10 border border-orange-500/20';
    align = 'justify-start';
  }

  const hasText = content.some((p) => p.type === 'text' && p.text?.trim());
  const hasToolCalls = content.some((p) => p.type === 'tool-call');

  if (!hasText && !hasToolCalls) return null;

  return (
    <div className={`flex gap-2 ${align}`}>
      {align === 'justify-start' && <Icon className={`h-3.5 w-3.5 mt-1.5 shrink-0 ${iconColor}`} />}
      <div className={`max-w-[90%] rounded-xl px-3 py-1.5 ${bubbleBg}`}>
        <span className="text-[9px] uppercase text-muted-foreground/70 font-medium">{label}</span>
        <div className="mt-0.5 space-y-1">
          {content.map((part, i) => {
            if (part.type === 'text' && part.text?.trim()) {
              return <div key={i} className="text-xs"><MarkdownText text={part.text} /></div>;
            }
            if (part.type === 'tool-call') {
              return (
                <div key={part.toolCallId ?? i} className="my-1">
                  <ToolCallDisplay
                    part={{
                      type: 'tool-call',
                      toolCallId: part.toolCallId ?? `tc-${i}`,
                      toolName: part.toolName ?? 'unknown',
                      args: part.args ?? {},
                      argsText: part.argsText ?? JSON.stringify(part.args, null, 2),
                      result: part.result,
                      isError: part.isError,
                      startedAt: part.startedAt,
                      finishedAt: part.finishedAt,
                      liveOutput: part.liveOutput,
                    }}
                  />
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
      {align === 'justify-end' && <Icon className={`h-3.5 w-3.5 mt-1.5 shrink-0 ${iconColor}`} />}
    </div>
  );
};

// --- Compact preview for collapsed state ---

const CompactPreview: FC<{
  thread: SubAgentThreadState | null | undefined;
  liveOutput: SubAgentInlineProps['liveOutput'];
  isRunning: boolean;
}> = ({ thread, liveOutput, isRunning }) => {
  // Show last assistant message snippet
  if (thread?.messages.length) {
    const lastAssistant = [...thread.messages].reverse().find((m) => m.role === 'assistant');
    if (lastAssistant) {
      const content = Array.isArray(lastAssistant.content) ? lastAssistant.content : [];
      const text = content
        .filter((p: unknown) => (p as { type: string }).type === 'text')
        .map((p: unknown) => (p as { text: string }).text ?? '')
        .join(' ').trim();
      const toolCount = content.filter((p: unknown) => (p as { type: string }).type === 'tool-call').length;
      return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BotIcon className="h-3 w-3 text-blue-400 shrink-0" />
          <span className="truncate">{text ? text.slice(0, 120) : `${toolCount} tool call${toolCount !== 1 ? 's' : ''}`}</span>
          {isRunning && (
            <div className="flex items-center gap-0.5 shrink-0">
              <div className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
              <div className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
              <div className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
            </div>
          )}
        </div>
      );
    }
  }

  if (liveOutput?.stdout) {
    const lastLine = liveOutput.stdout.trim().split('\n').pop() ?? '';
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <BotIcon className="h-3 w-3 text-blue-400 shrink-0" />
        <span className="truncate font-mono text-[11px]">{lastLine.slice(0, 120)}</span>
      </div>
    );
  }

  if (isRunning) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground italic">
        <div className="flex items-center gap-0.5">
          <div className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:0ms]" />
          <div className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:150ms]" />
          <div className="h-1 w-1 rounded-full bg-blue-400 animate-bounce [animation-delay:300ms]" />
        </div>
        <span>Working...</span>
      </div>
    );
  }

  return null;
};

// --- Helpers ---

function findSubAgentByToolCall(threads: Map<string, SubAgentThreadState>, toolCallId: string): string | undefined {
  for (const [id, thread] of threads) {
    if (thread.parentToolCallId === toolCallId) return id;
  }
  return undefined;
}
