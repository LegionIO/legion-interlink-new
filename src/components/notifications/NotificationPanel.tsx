import { useState, type FC } from 'react';
import {
  BellIcon, CheckCheckIcon, Trash2Icon, FilterIcon,
  AlertCircleIcon, AlertTriangleIcon, InfoIcon, CheckCircle2Icon,
  ChevronDownIcon, ExternalLinkIcon,
} from 'lucide-react';
import { useNotifications, type LegionNotification } from '@/providers/NotificationProvider';

type SeverityFilter = 'all' | 'error' | 'warn' | 'success' | 'info';

const SEVERITY_CONFIG: Record<string, { icon: FC<{ className?: string }>; color: string; label: string }> = {
  error: { icon: AlertCircleIcon, color: 'text-red-400', label: 'Error' },
  warn: { icon: AlertTriangleIcon, color: 'text-amber-400', label: 'Warning' },
  success: { icon: CheckCircle2Icon, color: 'text-emerald-400', label: 'Success' },
  info: { icon: InfoIcon, color: 'text-blue-400', label: 'Info' },
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60_000) return 'just now';
    if (diffMs < 3600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86400_000) return `${Math.floor(diffMs / 3600_000)}h ago`;
    if (diffMs < 604800_000) return `${Math.floor(diffMs / 86400_000)}d ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

const NotificationRow: FC<{
  notification: LegionNotification;
  onRead: () => void;
  expanded: boolean;
  onToggle: () => void;
}> = ({ notification, onRead, expanded, onToggle }) => {
  const cfg = SEVERITY_CONFIG[notification.severity] || SEVERITY_CONFIG.info;
  const Icon = cfg.icon;

  return (
    <div
      className={`border-b border-border/20 transition-colors ${
        notification.read ? 'opacity-60' : 'bg-primary/[0.03]'
      }`}
    >
      <button
        type="button"
        onClick={() => { if (!notification.read) onRead(); onToggle(); }}
        className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
      >
        {/* Unread dot */}
        <div className="mt-1.5 h-2 w-2 shrink-0">
          {!notification.read && <div className="h-2 w-2 rounded-full bg-primary" />}
        </div>
        <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${cfg.color}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium truncate">{notification.title}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground/60">{fmtTime(notification.timestamp)}</span>
          </div>
          {notification.message && !expanded && (
            <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{notification.message}</p>
          )}
          {notification.source && (
            <span className="mt-0.5 inline-block rounded bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground">{notification.source}</span>
          )}
        </div>
        <ChevronDownIcon className={`mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="px-4 pb-3 pl-[52px]">
          {notification.message && (
            <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">{notification.message}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground/60">
            <span>Type: <span className="font-mono">{notification.type}</span></span>
            <span>Severity: <span className={cfg.color}>{cfg.label}</span></span>
            <span>Time: {new Date(notification.timestamp).toLocaleString()}</span>
            {notification.source && <span>Source: {notification.source}</span>}
          </div>
          {notification.raw != null && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] text-muted-foreground/50 flex items-center gap-1 hover:text-muted-foreground">
                <ExternalLinkIcon className="h-2.5 w-2.5" /> Raw event
              </summary>
              <pre className="mt-1 max-h-32 overflow-auto rounded bg-muted/20 p-2 text-[9px] font-mono text-muted-foreground">
                {JSON.stringify(notification.raw, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

export const NotificationPanel: FC<{ onClose: () => void }> = ({ onClose }) => {
  const { notifications, unreadCount, markRead, markAllRead, clearAll } = useNotifications();
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = filter === 'all' ? notifications : notifications.filter((n) => n.severity === filter);

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <BellIcon className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Notifications</h2>
          {unreadCount > 0 && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">{unreadCount}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
            title="Mark all read"
          >
            <CheckCheckIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={clearAll}
            disabled={notifications.length === 0}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 transition-colors disabled:opacity-30"
            title="Clear all"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Severity filter tabs */}
      <div className="flex items-center gap-1 border-b border-border/30 px-4 py-2">
        <FilterIcon className="h-3 w-3 text-muted-foreground/50 mr-1" />
        {(['all', 'error', 'warn', 'success', 'info'] as const).map((sev) => {
          const count = sev === 'all' ? notifications.length : notifications.filter((n) => n.severity === sev).length;
          return (
            <button
              key={sev}
              type="button"
              onClick={() => setFilter(sev)}
              className={`rounded-md px-2 py-1 text-[10px] font-medium transition-colors ${
                filter === sev ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/40'
              }`}
            >
              {sev === 'all' ? 'All' : SEVERITY_CONFIG[sev]?.label || sev}
              {count > 0 && <span className="ml-1 opacity-60">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BellIcon className="h-8 w-8 opacity-20 mb-3" />
            <p className="text-xs">No notifications yet</p>
            <p className="text-[10px] opacity-60 mt-1">Events from the daemon will appear here</p>
          </div>
        ) : (
          filtered.map((n) => (
            <NotificationRow
              key={n.id}
              notification={n}
              onRead={() => markRead(n.id)}
              expanded={expandedId === n.id}
              onToggle={() => setExpandedId(expandedId === n.id ? null : n.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-border/30 px-4 py-2 text-[10px] text-muted-foreground/50">
        {notifications.length} events &middot; {unreadCount} unread &middot; Live via daemon SSE
      </div>
    </div>
  );
};
