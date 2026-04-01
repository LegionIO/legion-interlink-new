import { useEffect, useRef, useState, type FC } from 'react';
import {
  GithubIcon,
  HashIcon,
  MessageSquareIcon,
  LoaderIcon,
  CheckCircleIcon,
  XCircleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ZapIcon,
} from 'lucide-react';
import { app } from '@/lib/ipc-client';

export type WorkflowStatus = 'triaging' | 'working' | 'needs-input' | 'resolved' | 'failed';
export type WorkflowSource = 'github' | 'linear' | 'slack';

export interface TriggerWorkflow {
  id: string;
  source: WorkflowSource;
  eventType: string;
  title: string;
  status: WorkflowStatus;
  conversationId: string;
  createdAt: string;
}

const MAX_VISIBLE = 5;
const POLL_INTERVAL_MS = 5_000;
const AUTO_DISMISS_MS = 30_000;

const SourceIcon: FC<{ source: WorkflowSource; className?: string }> = ({ source, className = 'h-3 w-3' }) => {
  switch (source) {
    case 'github':
      return <GithubIcon className={className} />;
    case 'linear':
      return <HashIcon className={className} />;
    case 'slack':
      return <MessageSquareIcon className={className} />;
  }
};

const StatusIndicator: FC<{ status: WorkflowStatus }> = ({ status }) => {
  switch (status) {
    case 'triaging':
    case 'working':
      return <LoaderIcon className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />;
    case 'needs-input':
      return (
        <span className="relative flex h-2.5 w-2.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
        </span>
      );
    case 'resolved':
      return <CheckCircleIcon className="h-3 w-3 text-emerald-500 shrink-0" />;
    case 'failed':
      return <XCircleIcon className="h-3 w-3 text-destructive shrink-0" />;
  }
};

const WorkflowEntry: FC<{
  workflow: TriggerWorkflow;
  onClick: () => void;
}> = ({ workflow, onClick }) => {
  const isNeedsInput = workflow.status === 'needs-input';
  const title = workflow.title.length > 48 ? workflow.title.slice(0, 45).trimEnd() + '...' : workflow.title;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={`
        flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs cursor-pointer transition-all group
        ${isNeedsInput
          ? 'bg-amber-500/10 hover:bg-amber-500/20 animate-pulse'
          : 'hover:bg-sidebar-accent/50'
        }
      `}
    >
      <SourceIcon
        source={workflow.source}
        className={`h-3 w-3 shrink-0 ${isNeedsInput ? 'text-amber-500' : 'text-muted-foreground'}`}
      />
      <span className={`flex-1 min-w-0 truncate text-[11px] ${isNeedsInput ? 'text-amber-200 font-medium' : 'text-sidebar-foreground/90'}`}>
        {title}
      </span>
      <StatusIndicator status={workflow.status} />
    </div>
  );
};

export const TriggerWorkflows: FC<{
  onSelectConversation: (id: string) => void;
}> = ({ onSelectConversation }) => {
  const [workflows, setWorkflows] = useState<TriggerWorkflow[]>([]);
  const [expanded, setExpanded] = useState(true);
  const dismissTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const scheduleDismiss = (workflow: TriggerWorkflow) => {
    if (dismissTimers.current.has(workflow.id)) return;
    const timer = setTimeout(() => {
      setWorkflows((prev) => prev.filter((w) => w.id !== workflow.id));
      dismissTimers.current.delete(workflow.id);
    }, AUTO_DISMISS_MS);
    dismissTimers.current.set(workflow.id, timer);
  };

  const mergeWorkflows = (incoming: TriggerWorkflow[]) => {
    setWorkflows((prev) => {
      const byId = new Map(prev.map((w) => [w.id, w]));
      for (const w of incoming) {
        byId.set(w.id, w);
      }
      // Schedule auto-dismiss for terminal statuses
      for (const w of byId.values()) {
        if (w.status === 'resolved' || w.status === 'failed') {
          scheduleDismiss(w);
        } else {
          // Clear any pending dismiss timer if status changed back (edge case)
          const existing = dismissTimers.current.get(w.id);
          if (existing) {
            clearTimeout(existing);
            dismissTimers.current.delete(w.id);
          }
        }
      }
      return Array.from(byId.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    });
  };

  useEffect(() => {
    let cancelled = false;

    const fetchWorkflows = async () => {
      try {
        const result = await (app as unknown as Record<string, Record<string, () => Promise<TriggerWorkflow[]>>>)
          ?.triggerDispatch?.activeWorkflows?.();
        if (!cancelled && Array.isArray(result)) {
          mergeWorkflows(result);
        }
      } catch {
        // IPC not yet registered — degrade gracefully
      }
    };

    void fetchWorkflows();
    const interval = setInterval(() => { void fetchWorkflows(); }, POLL_INTERVAL_MS);

    // Subscribe to real-time push updates
    let unsubscribe: (() => void) | undefined;
    try {
      const api = app as unknown as Record<string, Record<string, (cb: (w: TriggerWorkflow) => void) => () => void>>;
      unsubscribe = api?.triggerDispatch?.onWorkflowUpdate?.((workflow: TriggerWorkflow) => {
        if (!cancelled) mergeWorkflows([workflow]);
      });
    } catch {
      // IPC not yet registered
    }

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe?.();
      for (const timer of dismissTimers.current.values()) clearTimeout(timer);
      dismissTimers.current.clear();
    };
  }, []);

  // Filter to non-dismissed active workflows
  const activeWorkflows = workflows.filter(
    (w) => w.status !== 'resolved' && w.status !== 'failed'
      || dismissTimers.current.has(w.id),
  );

  if (activeWorkflows.length === 0) return null;

  const visible = activeWorkflows.slice(0, MAX_VISIBLE);
  const overflow = activeWorkflows.length - MAX_VISIBLE;

  return (
    <div className="border-b border-sidebar-border/50 shrink-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-[10px] uppercase text-muted-foreground font-medium hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
        <ZapIcon className="h-3 w-3" />
        Workflows ({activeWorkflows.length})
      </button>

      {expanded && (
        <div className="space-y-0.5 px-2 pb-2">
          {visible.map((workflow) => (
            <WorkflowEntry
              key={workflow.id}
              workflow={workflow}
              onClick={() => onSelectConversation(workflow.conversationId)}
            />
          ))}
          {overflow > 0 && (
            <p className="px-2.5 py-1 text-[10px] text-muted-foreground">
              +{overflow} more
            </p>
          )}
        </div>
      )}
    </div>
  );
};
