import { useState, type FC } from 'react';
import {
  PlusIcon,
  XIcon,
  PencilIcon,
  Trash2Icon,
  ZapIcon,
  LoaderIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  GlobeIcon,
  TerminalIcon,
} from 'lucide-react';
import { app } from '@/lib/ipc-client';
import { EditableInput } from '@/components/EditableInput';
import { Toggle, type SettingsProps } from './shared';

type McpServer = {
  name: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
};

type Transport = 'url' | 'command';

type TestResult = {
  status: 'testing' | 'connected' | 'error';
  toolCount?: number;
  error?: string;
};

const emptyServer = (): McpServer => ({
  name: '',
  url: '',
  enabled: true,
});

export const McpSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const servers = ((config as { mcpServers?: McpServer[] }).mcpServers ?? []) as McpServer[];
  const [showAdd, setShowAdd] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const updateServers = (newServers: McpServer[]) => updateConfig('mcpServers', newServers);

  const addServer = (server: McpServer) => {
    updateServers([...servers, server]);
    setShowAdd(false);
  };

  const updateServer = (index: number, server: McpServer) => {
    const next = [...servers];
    next[index] = server;
    updateServers(next);
    setEditIndex(null);
  };

  const deleteServer = (index: number) => {
    updateServers(servers.filter((_, i) => i !== index));
    if (editIndex === index) setEditIndex(null);
  };

  const toggleServer = (index: number) => {
    const next = [...servers];
    next[index] = { ...next[index], enabled: next[index].enabled === false ? true : false };
    updateServers(next);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">MCP Servers</h3>

      {servers.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground">No MCP servers configured.</p>
      )}

      <div className="space-y-2">
        {servers.map((server, i) =>
          editIndex === i ? (
            <ServerForm
              key={`edit-${i}`}
              initial={server}
              onSave={(s) => updateServer(i, s)}
              onCancel={() => setEditIndex(null)}
              submitLabel="Save"
            />
          ) : (
            <ServerCard
              key={server.name}
              server={server}
              onEdit={() => setEditIndex(i)}
              onDelete={() => deleteServer(i)}
              onToggle={() => toggleServer(i)}
            />
          ),
        )}
      </div>

      {showAdd ? (
        <ServerForm
          initial={emptyServer()}
          onSave={addServer}
          onCancel={() => setShowAdd(false)}
          submitLabel="Add Server"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors w-full"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add MCP Server
        </button>
      )}
    </div>
  );
};

/* ── Server Card (read-only row) ── */

const ServerCard: FC<{
  server: McpServer;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}> = ({ server, onEdit, onDelete, onToggle }) => {
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const isEnabled = server.enabled !== false;
  const transport = server.url ? 'url' : 'command';

  const handleTest = async () => {
    if (!app.mcp?.testConnection) {
      setTestResult({ status: 'error', error: 'MCP bridge not available — restart the app after rebuilding' });
      return;
    }
    setTestResult({ status: 'testing' });
    try {
      const result = await app.mcp.testConnection({
        name: server.name,
        url: server.url,
        command: server.command,
        args: server.args,
        env: server.env,
      });
      setTestResult({
        status: result.status === 'connected' ? 'connected' : 'error',
        toolCount: result.toolCount,
        error: result.error,
      });
    } catch (err) {
      setTestResult({ status: 'error', error: String(err) });
    }
  };

  return (
    <div className={`rounded-lg border p-3 space-y-2 ${!isEnabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full shrink-0 ${isEnabled ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
        <span className="text-xs font-mono font-semibold truncate">{server.name}</span>

        {transport === 'url' ? (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            <GlobeIcon className="h-2.5 w-2.5" /> URL
          </span>
        ) : (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5">
            <TerminalIcon className="h-2.5 w-2.5" /> stdio
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={handleTest} className="p-1 rounded hover:bg-muted transition-colors" title="Test connection">
            <ZapIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button type="button" onClick={onEdit} className="p-1 rounded hover:bg-muted transition-colors" title="Edit">
            <PencilIcon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button type="button" onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 transition-colors" title="Delete">
            <Trash2Icon className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={onToggle}
            className="rounded ml-1"
            title={isEnabled ? 'Disable' : 'Enable'}
          />
        </div>
      </div>

      <div className="text-[10px] text-muted-foreground font-mono truncate">
        {server.url ?? `${server.command ?? ''} ${(server.args ?? []).join(' ')}`.trim()}
      </div>

      {server.env && Object.keys(server.env).length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          Env: {Object.keys(server.env).join(', ')}
        </div>
      )}

      {testResult && <TestResultBadge result={testResult} />}
    </div>
  );
};

/* ── Test result display ── */

const TestResultBadge: FC<{ result: TestResult }> = ({ result }) => {
  if (result.status === 'testing') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-blue-600 dark:text-blue-400">
        <LoaderIcon className="h-3 w-3 animate-spin" />
        Testing connection...
      </div>
    );
  }
  if (result.status === 'connected') {
    return (
      <div className="flex items-center gap-1.5 text-[10px] text-green-600 dark:text-green-400">
        <CheckCircle2Icon className="h-3 w-3" />
        Connected — {result.toolCount} tool{result.toolCount === 1 ? '' : 's'} found
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-destructive">
      <AlertCircleIcon className="h-3 w-3" />
      {result.error ?? 'Connection failed'}
    </div>
  );
};

/* ── Server Form (add / edit) ── */

const ServerForm: FC<{
  initial: McpServer;
  onSave: (server: McpServer) => void;
  onCancel: () => void;
  submitLabel: string;
}> = ({ initial, onSave, onCancel, submitLabel }) => {
  const [name, setName] = useState(initial.name);
  const [transport, setTransport] = useState<Transport>(initial.command ? 'command' : 'url');
  const [url, setUrl] = useState(initial.url ?? '');
  const [command, setCommand] = useState(initial.command ?? '');
  const [args, setArgs] = useState((initial.args ?? []).join(' '));
  const [env, setEnv] = useState<Array<[string, string]>>(
    Object.entries(initial.env ?? {}),
  );
  const [enabled, setEnabled] = useState(initial.enabled !== false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const canSave = name.trim() && (transport === 'url' ? url.trim() : command.trim());
  const canTest = transport === 'url' ? url.trim() : command.trim();

  const handleTest = async () => {
    if (!canTest) return;
    setTestResult({ status: 'testing' });
    try {
      const serverConfig: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> } = {
        name: name.trim() || '__form_test__',
      };
      if (transport === 'url') {
        serverConfig.url = url.trim();
      } else {
        serverConfig.command = command.trim();
        const parsedArgs = args.trim().split(/\s+/).filter(Boolean);
        if (parsedArgs.length > 0) serverConfig.args = parsedArgs;
      }
      if (env.length > 0) {
        serverConfig.env = Object.fromEntries(env.filter(([k]) => k.trim()));
      }
      const result = await app.mcp.testConnection(serverConfig);
      setTestResult({
        status: result.status === 'connected' ? 'connected' : 'error',
        toolCount: result.toolCount,
        error: result.error,
      });
    } catch (err) {
      setTestResult({ status: 'error', error: String(err) });
    }
  };

  const handleSave = () => {
    if (!canSave) return;
    const server: McpServer = {
      name: name.trim(),
      enabled,
    };
    if (transport === 'url') {
      server.url = url.trim();
    } else {
      server.command = command.trim();
      const parsedArgs = args.trim().split(/\s+/).filter(Boolean);
      if (parsedArgs.length > 0) server.args = parsedArgs;
    }
    if (env.length > 0) {
      server.env = Object.fromEntries(env.filter(([k]) => k.trim()));
    }
    onSave(server);
  };

  return (
    <div className="rounded-lg border bg-card p-3 space-y-3">
      {/* Name */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-0.5">Server Name</label>
        <EditableInput
          className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
          value={name}
          onChange={setName}
          placeholder="my-mcp-server"
        />
      </div>

      {/* Transport picker */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Transport</label>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTransport('url')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors ${
              transport === 'url' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            }`}
          >
            <GlobeIcon className="h-3 w-3" /> URL (HTTP/SSE)
          </button>
          <button
            type="button"
            onClick={() => setTransport('command')}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors ${
              transport === 'command' ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'
            }`}
          >
            <TerminalIcon className="h-3 w-3" /> Command (stdio)
          </button>
        </div>
      </div>

      {/* Transport-specific fields */}
      {transport === 'url' ? (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-0.5">Server URL</label>
          <EditableInput
            className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
            value={url}
            onChange={setUrl}
            placeholder="http://localhost:3000"
          />
        </div>
      ) : (
        <>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Command</label>
            <EditableInput
              className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
              value={command}
              onChange={setCommand}
              placeholder="npx"
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Arguments (space-separated)</label>
            <EditableInput
              className="w-full rounded border bg-background px-2 py-1 text-xs font-mono"
              value={args}
              onChange={setArgs}
              placeholder="-y @modelcontextprotocol/server-everything"
            />
          </div>
        </>
      )}

      {/* Env vars */}
      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Environment Variables</label>
        <div className="space-y-1">
          {env.map(([key, value], i) => (
            <div key={i} className="flex items-center gap-1">
              <EditableInput
                className="w-1/3 rounded border bg-background px-2 py-1 text-xs font-mono"
                value={key}
                onChange={(k) => { const next = [...env]; next[i] = [k, value]; setEnv(next); }}
                placeholder="KEY"
              />
              <span className="text-[10px] text-muted-foreground">=</span>
              <EditableInput
                className="flex-1 rounded border bg-background px-2 py-1 text-xs font-mono"
                value={value}
                onChange={(v) => { const next = [...env]; next[i] = [key, v]; setEnv(next); }}
                placeholder="value"
              />
              <button type="button" onClick={() => setEnv(env.filter((_, j) => j !== i))} className="p-0.5 rounded hover:bg-destructive/10">
                <XIcon className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setEnv([...env, ['', '']])}
          className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <PlusIcon className="h-3 w-3" /> Add variable
        </button>
      </div>

      {/* Enabled */}
      <Toggle label="Enabled" checked={enabled} onChange={setEnabled} />

      {/* Test connection */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={!canTest || testResult?.status === 'testing'}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs hover:bg-muted/50 disabled:opacity-40 transition-colors"
        >
          <ZapIcon className="h-3 w-3" />
          Test Connection
        </button>
        {testResult && <TestResultBadge result={testResult} />}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-40 transition-colors hover:bg-primary/90"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md bg-muted px-3 py-1 text-xs hover:bg-muted/80 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
