import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { AppConfig } from '../config/schema.js';
import { readEffectiveConfig, writeDesktopConfig } from '../ipc/config.js';

type McpServer = AppConfig['mcpServers'][number];

function readConfig(appHome: string): AppConfig {
  return readEffectiveConfig(appHome);
}

export function createMcpManageTool(appHome: string): ToolDefinition {
  return {
    name: 'mcp_servers',
    description: [
      'Manage MCP (Model Context Protocol) servers. Use this tool to give yourself new capabilities by connecting to MCP servers.',
      'Actions: "list" shows all configured servers. "add" registers a new server (URL or command-based). "edit" updates an existing server. "delete" removes one. "enable"/"disable" toggles a server.',
      'Changes take effect immediately — new tools from added/enabled servers will be available on your next response turn.',
    ].join(' '),
    inputSchema: z.object({
      action: z.enum(['list', 'add', 'edit', 'delete', 'enable', 'disable']).describe('The action to perform'),
      name: z.string().optional().describe('Server name (required for add/edit/delete/enable/disable)'),
      url: z.string().optional().describe('Server URL for HTTP/SSE transport (for add/edit)'),
      command: z.string().optional().describe('Command to spawn for stdio transport (for add/edit)'),
      args: z.array(z.string()).optional().describe('Arguments for the stdio command (for add/edit)'),
      env: z.record(z.string()).optional().describe('Environment variables for the server process (for add/edit)'),
      enabled: z.boolean().optional().describe('Whether the server is enabled (for add/edit, defaults to true)'),
    }),
    execute: async (input) => {
      const { action, name, url, command, args, env, enabled } = input as {
        action: string;
        name?: string;
        url?: string;
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        enabled?: boolean;
      };

      const config = readConfig(appHome);
      const servers: McpServer[] = config.mcpServers ?? [];

      switch (action) {
        case 'list': {
          if (servers.length === 0) return { servers: [], message: 'No MCP servers configured.' };
          return {
            servers: servers.map((s) => ({
              name: s.name,
              transport: s.url ? 'url' : 'command',
              url: s.url,
              command: s.command,
              args: s.args,
              enabled: s.enabled !== false,
            })),
          };
        }

        case 'add': {
          if (!name) return { error: 'Server name is required.' };
          if (!url && !command) return { error: 'Either url or command is required.' };
          if (servers.some((s) => s.name === name)) return { error: `Server "${name}" already exists. Use "edit" to update it.` };

          const newServer: McpServer = { name, enabled: enabled ?? true };
          if (url) newServer.url = url;
          if (command) newServer.command = command;
          if (args?.length) newServer.args = args;
          if (env && Object.keys(env).length > 0) newServer.env = env;

          config.mcpServers = [...servers, newServer];
          writeDesktopConfig(appHome, config);
          return { success: true, added: newServer, note: 'Tools from this server will be available on your next turn.' };
        }

        case 'edit': {
          if (!name) return { error: 'Server name is required.' };
          const idx = servers.findIndex((s) => s.name === name);
          if (idx === -1) return { error: `Server "${name}" not found.` };

          const previous = { ...servers[idx] };
          const updated = { ...servers[idx] };
          if (url !== undefined) updated.url = url;
          if (command !== undefined) updated.command = command;
          if (args !== undefined) updated.args = args;
          if (env !== undefined) updated.env = env;
          if (enabled !== undefined) updated.enabled = enabled;

          config.mcpServers = [...servers];
          config.mcpServers[idx] = updated;
          writeDesktopConfig(appHome, config);
          return { success: true, changed: { previous, new: updated }, note: 'Changes take effect on your next turn.' };
        }

        case 'delete': {
          if (!name) return { error: 'Server name is required.' };
          const found = servers.some((s) => s.name === name);
          if (!found) return { error: `Server "${name}" not found.` };

          const deleted = servers.find((s) => s.name === name);
          config.mcpServers = servers.filter((s) => s.name !== name);
          writeDesktopConfig(appHome, config);
          return { success: true, deleted, note: 'Server tools removed. Changes take effect on your next turn.' };
        }

        case 'enable':
        case 'disable': {
          if (!name) return { error: 'Server name is required.' };
          const i = servers.findIndex((s) => s.name === name);
          if (i === -1) return { error: `Server "${name}" not found.` };

          const wasEnabled = servers[i].enabled !== false;
          const nowEnabled = action === 'enable';
          config.mcpServers = [...servers];
          config.mcpServers[i] = { ...servers[i], enabled: nowEnabled };
          writeDesktopConfig(appHome, config);
          return { success: true, changed: { server: name, previous: { enabled: wasEnabled }, new: { enabled: nowEnabled } }, note: 'Changes take effect on your next turn.' };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    },
  };
}
