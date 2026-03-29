import { useState, useEffect, useCallback, type FC } from 'react';
import {
  UsersIcon, RefreshCwIcon, Loader2Icon, StopCircleIcon,
  SendIcon, CircleIcon, MessageSquareIcon, BotIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';

interface SubAgentInfo {
  id: string;
  status?: string;
  model?: string;
  parent_id?: string;
  task_id?: string;
  message_count?: number;
  created_at?: string;
  last_activity?: string;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

const STATUS_COLORS: Record<string, string> = {
  running: 'text-emerald-400',
  active: 'text-emerald-400',
  idle: 'text-blue-400',
  completed: 'text-muted-foreground',
  stopped: 'text-red-400',
  error: 'text-red-400',
  failed: 'text-red-400',
};

const AgentCard: FC<{
  agent: SubAgentInfo;
  onStop: () => void;
  onSendMessage: (msg: string) => void;
}> = ({ agent, onStop, onSendMessage }) => {
  const [messageInput, setMessageInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const statusColor = STATUS_COLORS[agent.status || ''] || 'text-muted-foreground';
  const isActive = agent.status === 'running' || agent.status === 'active' || agent.status === 'idle';

  return (
    <div className="rounded-xl border border-border/40 bg-card/60 p-4 transition-colors hover:bg-card/80">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-lg bg-primary/10 p-2">
          <BotIcon className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium font-mono truncate" title={agent.id}>
              {agent.id.slice(0, 12)}...
            </span>
            <span className={`flex items-center gap-1 text-[10px] ${statusColor}`}>
              <CircleIcon className="h-2 w-2 fill-current" />
              {agent.status || 'unknown'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            {agent.model && <span>Model: {agent.model}</span>}
            {agent.message_count != null && <span>{agent.message_count} messages</span>}
            {agent.created_at && <span>Created: {fmtAgo(agent.created_at)}</span>}
            {agent.last_activity && <span>Active: {fmtAgo(agent.last_activity)}</span>}
            {agent.task_id && <span className="font-mono">Task: {agent.task_id.slice(0, 8)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isActive && (
            <>
              <button type="button" onClick={() => setShowInput(!showInput)}
                className="rounded p-1 hover:bg-muted/40 transition-colors" title="Send message">
                <MessageSquareIcon className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
              <button type="button" onClick={onStop}
                className="rounded p-1 hover:bg-red-500/20 transition-colors" title="Stop agent">
                <StopCircleIcon className="h-3.5 w-3.5 text-muted-foreground hover:text-red-400" />
              </button>
            </>
          )}
        </div>
      </div>

      {showInput && isActive && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={messageInput}
            onChange={(e) => setMessageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && messageInput.trim()) {
                onSendMessage(messageInput.trim());
                setMessageInput('');
              }
            }}
            className="flex-1 rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary"
            placeholder="Send a message to this agent..."
            autoFocus
          />
          <button
            type="button"
            onClick={() => { if (messageInput.trim()) { onSendMessage(messageInput.trim()); setMessageInput(''); } }}
            disabled={!messageInput.trim()}
            className="rounded-md bg-primary p-1.5 text-primary-foreground disabled:opacity-50"
          >
            <SendIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

interface Props {
  onClose: () => void;
}

export const SubAgentDashboard: FC<Props> = () => {
  const [loading, setLoading] = useState(true);
  const [agents, setAgents] = useState<SubAgentInfo[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await legion.agent.listSubAgents();
      const ids = res.ids || [];

      // Fetch status for each agent
      const infos: SubAgentInfo[] = [];
      for (const id of ids) {
        try {
          const statusRes = await legion.daemon.subAgentStatus(id);
          if (statusRes.ok && statusRes.data) {
            const d = statusRes.data as Record<string, unknown>;
            infos.push({
              id,
              status: d.status ? String(d.status) : undefined,
              model: d.model ? String(d.model) : undefined,
              parent_id: d.parent_id ? String(d.parent_id) : undefined,
              task_id: d.task_id ? String(d.task_id) : d.id ? String(d.id) : undefined,
              message_count: typeof d.message_count === 'number' ? d.message_count : undefined,
              created_at: d.created_at ? String(d.created_at) : undefined,
              last_activity: d.last_activity ? String(d.last_activity) : d.updated_at ? String(d.updated_at) : undefined,
            });
          } else {
            infos.push({ id, status: 'unknown' });
          }
        } catch {
          infos.push({ id, status: 'unknown' });
        }
      }
      setAgents(infos);
    } catch {
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Auto-refresh every 5s
  useEffect(() => {
    const id = setInterval(() => { void refresh(); }, 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleStop = async (agentId: string) => {
    await legion.agent.stopSubAgent(agentId);
    void refresh();
  };

  const handleSendMessage = async (agentId: string, message: string) => {
    await legion.agent.sendSubAgentMessage(agentId, message);
  };

  const active = agents.filter((a) => a.status === 'running' || a.status === 'active' || a.status === 'idle');
  const inactive = agents.filter((a) => a.status !== 'running' && a.status !== 'active' && a.status !== 'idle');

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
        <div className="flex items-center gap-3">
          <UsersIcon className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Sub-Agents</h1>
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary">
            {agents.length} total &middot; {active.length} active
          </span>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}
          className="rounded-md p-1.5 hover:bg-muted/50 transition-colors disabled:opacity-50">
          <RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && agents.length === 0 ? (
          <div className="flex justify-center py-16">
            <Loader2Icon className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-muted-foreground">
            <BotIcon className="h-10 w-10 opacity-20 mb-3" />
            <p className="text-sm">No sub-agents</p>
            <p className="text-xs opacity-60 mt-1">Sub-agents will appear here when spawned during chat</p>
          </div>
        ) : (
          <div className="space-y-6 max-w-2xl mx-auto">
            {active.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">Active ({active.length})</h2>
                <div className="space-y-2">
                  {active.map((a) => (
                    <AgentCard key={a.id} agent={a} onStop={() => void handleStop(a.id)} onSendMessage={(msg) => void handleSendMessage(a.id, msg)} />
                  ))}
                </div>
              </div>
            )}
            {inactive.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">Completed ({inactive.length})</h2>
                <div className="space-y-2">
                  {inactive.map((a) => (
                    <AgentCard key={a.id} agent={a} onStop={() => {}} onSendMessage={() => {}} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
