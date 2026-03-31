import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { z as Z } from 'zod';
import type { ToolDefinition } from './types.js';
import { buildScopedToolName } from './naming.js';
import type { AppConfig } from '../config/schema.js';

type McpServerConfig = AppConfig['mcpServers'][number];

type McpConnection = {
  name: string;
  client: Client;
  transport: Transport;
  tools: ToolDefinition[];
  status: 'connected' | 'error' | 'disconnected';
  error?: string;
  fingerprint: string;
};

const connections = new Map<string, McpConnection>();

/** Convert a JSON Schema object to a Zod schema. Covers common MCP tool patterns. */
function jsonSchemaToZod(schema: Record<string, unknown>): Z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.object({}).passthrough();

  const type = schema.type as string | undefined;

  if (type === 'string') {
    let s = z.string();
    if (typeof schema.minLength === 'number') s = s.min(schema.minLength);
    if (typeof schema.maxLength === 'number') s = s.max(schema.maxLength);
    if (schema.enum && Array.isArray(schema.enum)) return z.enum(schema.enum as [string, ...string[]]);
    return s;
  }
  if (type === 'number' || type === 'integer') {
    let n = z.number();
    if (type === 'integer') n = n.int();
    if (typeof schema.minimum === 'number') n = n.min(schema.minimum);
    if (typeof schema.maximum === 'number') n = n.max(schema.maximum);
    return n;
  }
  if (type === 'boolean') return z.boolean();
  if (type === 'array') {
    const items = schema.items as Record<string, unknown> | undefined;
    let arr = z.array(items ? jsonSchemaToZod(items) : z.unknown());
    if (typeof schema.minItems === 'number') arr = arr.min(schema.minItems);
    if (typeof schema.maxItems === 'number') arr = arr.max(schema.maxItems);
    return arr;
  }
  if (type === 'object' || schema.properties) {
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = new Set((schema.required as string[]) ?? []);
    const shape: Record<string, Z.ZodTypeAny> = {};
    for (const [key, propSchema] of Object.entries(props)) {
      const field = jsonSchemaToZod(propSchema);
      shape[key] = required.has(key) ? field : field.optional();
    }
    const obj = z.object(shape);
    return schema.additionalProperties === false ? obj : obj.passthrough();
  }

  // Fallback: accept anything but still serialize as type: "object"
  return z.object({}).passthrough();
}

async function createTransport(server: McpServerConfig): Promise<Transport> {
  if (server.command) {
    return new StdioClientTransport({
      command: server.command,
      args: server.args,
      env: server.env ? { ...process.env, ...server.env } as Record<string, string> : undefined,
    });
  }

  if (server.url) {
    // Try Streamable HTTP first (MCP 2025+), fall back to SSE
    try {
      const transport = new StreamableHTTPClientTransport(new URL(server.url));
      return transport;
    } catch {
      return new SSEClientTransport(new URL(server.url));
    }
  }

  throw new Error('Server must have either a "url" or "command" configured');
}

export async function connectMcpServer(server: McpServerConfig): Promise<McpConnection> {
  const existing = connections.get(server.name);
  if (existing && existing.status === 'connected') return existing;

  try {
    const transport = await createTransport(server);
    const client = new Client({ name: __BRAND_MCP_CLIENT_NAME, version: '1.0.0' });

    await client.connect(transport);

    // Discover tools
    const { tools: mcpTools } = await client.listTools();
    const tools: ToolDefinition[] = mcpTools.map((t) => ({
      name: buildScopedToolName('mcp', server.name, t.name),
      description: `[MCP: ${server.name}] ${t.description ?? t.name}`,
      inputSchema: t.inputSchema ? jsonSchemaToZod(t.inputSchema as Record<string, unknown>) : z.object({}),
      source: 'mcp',
      sourceId: server.name,
      originalName: t.name,
      aliases: [`${server.name}:${t.name}`],
      execute: async (input: unknown) => {
        const result = await client.callTool({ name: t.name, arguments: input as Record<string, unknown> });
        if (result.isError) throw new Error(JSON.stringify(result.content));
        // Extract text from content array
        const content = result.content as Array<{ type: string; text?: string }>;
        if (content.length === 1 && content[0].type === 'text') return content[0].text;
        return result.content;
      },
    }));

    const connection: McpConnection = {
      name: server.name,
      client,
      transport,
      tools,
      status: 'connected',
      fingerprint: serverFingerprint(server),
    };

    connections.set(server.name, connection);
    return connection;
  } catch (error) {
    const conn: McpConnection = {
      name: server.name,
      client: null as unknown as Client,
      transport: null as unknown as Transport,
      tools: [],
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      fingerprint: serverFingerprint(server),
    };
    connections.set(server.name, conn);
    return conn;
  }
}

export async function connectAllMcpServers(config: AppConfig): Promise<ToolDefinition[]> {
  const allTools: ToolDefinition[] = [];

  for (const server of config.mcpServers) {
    if (server.enabled === false) continue;
    const conn = await connectMcpServer(server);
    allTools.push(...conn.tools);
  }

  return allTools;
}

export async function disconnectMcpServer(name: string): Promise<void> {
  const conn = connections.get(name);
  if (conn?.client) {
    try { await conn.client.close(); } catch { /* ignore */ }
  }
  connections.delete(name);
}

/** Fingerprint a server config for change detection */
function serverFingerprint(s: McpServerConfig): string {
  return JSON.stringify({
    url: s.url, command: s.command, args: s.args, env: s.env, enabled: s.enabled,
  });
}

/**
 * Reconcile MCP connections with the current config.
 * Disconnects removed/changed/disabled servers, connects new/changed ones.
 * Returns the full set of MCP tools after reconciliation.
 */
export async function rebuildMcpTools(servers: McpServerConfig[]): Promise<ToolDefinition[]> {
  const desired = new Map<string, McpServerConfig>();
  for (const s of servers) {
    if (s.enabled !== false) desired.set(s.name, s);
  }

  // Disconnect servers that were removed, disabled, or changed
  for (const [name, conn] of connections) {
    if (name.startsWith('__test__')) continue;
    const cfg = desired.get(name);
    if (!cfg) {
      await disconnectMcpServer(name);
    } else if (serverFingerprint(cfg) !== conn.fingerprint) {
      await disconnectMcpServer(name);
    }
  }

  // Connect all desired servers (connectMcpServer skips already-connected ones)
  const allTools: ToolDefinition[] = [];
  for (const server of desired.values()) {
    const conn = await connectMcpServer(server);
    allTools.push(...conn.tools);
  }

  return allTools;
}

export function getMcpStatus(): Array<{ name: string; status: string; toolCount: number; error?: string }> {
  return Array.from(connections.values()).map((c) => ({
    name: c.name,
    status: c.status,
    toolCount: c.tools.length,
    error: c.error,
  }));
}
