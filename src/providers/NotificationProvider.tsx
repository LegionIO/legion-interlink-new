import { createContext, useContext, useState, useEffect, useCallback, useRef, type FC, type ReactNode } from 'react';
import { legion } from '@/lib/ipc-client';

export interface LegionNotification {
  id: string;
  type: string;
  severity: 'info' | 'warn' | 'error' | 'success';
  title: string;
  message?: string;
  source?: string;
  timestamp: string;
  read: boolean;
  raw?: unknown;
}

interface Toast {
  id: string;
  notification: LegionNotification;
  dismissing: boolean;
}

interface NotificationContextValue {
  notifications: LegionNotification[];
  unreadCount: number;
  toasts: Toast[];
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearAll: () => void;
  dismissToast: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue>({
  notifications: [],
  unreadCount: 0,
  toasts: [],
  markRead: () => {},
  markAllRead: () => {},
  clearAll: () => {},
  dismissToast: () => {},
});

export const useNotifications = () => useContext(NotificationContext);

const MAX_NOTIFICATIONS = 200;
const TOAST_DURATION = 5000;

const SEVERITY_MAP: Record<string, LegionNotification['severity']> = {
  error: 'error',
  failure: 'error',
  failed: 'error',
  warning: 'warn',
  warn: 'warn',
  degraded: 'warn',
  success: 'success',
  completed: 'success',
  healthy: 'success',
};

// Events worth showing as toasts (high signal)
const TOAST_TYPES = new Set([
  'task.completed', 'task.failed', 'task.error',
  'worker.error', 'worker.degraded', 'worker.offline',
  'extension.error', 'extension.installed', 'extension.uninstalled',
  'gaia.phase_change', 'gaia.alert',
  'mesh.peer_joined', 'mesh.peer_lost',
  'governance.approval_required',
  'health.degraded', 'health.recovered',
  'alert', 'error',
]);

function classifyEvent(raw: unknown): LegionNotification {
  const evt = raw as Record<string, unknown>;
  const type = String(evt.type || evt.event || evt.kind || 'event');
  const severityHint = String(evt.severity || evt.level || evt.status || '');
  const severity = SEVERITY_MAP[severityHint.toLowerCase()] || (type.includes('error') || type.includes('fail') ? 'error' : type.includes('warn') || type.includes('degrad') ? 'warn' : type.includes('success') || type.includes('complet') ? 'success' : 'info');

  const title = String(evt.title || evt.summary || type.replace(/[._]/g, ' '));
  const message = evt.message ? String(evt.message) : evt.description ? String(evt.description) : evt.details ? String(evt.details) : undefined;
  const source = evt.source ? String(evt.source) : evt.extension ? String(evt.extension) : evt.worker_id ? String(evt.worker_id) : undefined;
  const timestamp = evt.timestamp ? String(evt.timestamp) : evt.created_at ? String(evt.created_at) : new Date().toISOString();

  return {
    id: String(evt.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    type,
    severity,
    title,
    message,
    source,
    timestamp,
    read: false,
    raw,
  };
}

export const NotificationProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<LegionNotification[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const subscribedRef = useRef(false);

  // Subscribe to SSE events on mount
  useEffect(() => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;

    void legion.daemon.eventsSubscribe().catch(() => {});

    // Load recent events as initial notifications
    void legion.daemon.eventsRecent(50).then((res) => {
      if (res.ok && res.data) {
        const arr = Array.isArray(res.data) ? res.data : (res.data as { events?: unknown[] }).events || [];
        const initial = (arr as unknown[]).map(classifyEvent).map((n) => ({ ...n, read: true }));
        setNotifications(initial.slice(0, MAX_NOTIFICATIONS));
      }
    }).catch(() => {});

    const unsub = legion.daemon.onEvent((event) => {
      const notification = classifyEvent(event);
      setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));

      // Show toast for high-signal events
      if (TOAST_TYPES.has(notification.type) || notification.severity === 'error') {
        const toast: Toast = { id: notification.id, notification, dismissing: false };
        setToasts((prev) => [toast, ...prev].slice(0, 5));

        setTimeout(() => {
          setToasts((prev) => prev.map((t) => t.id === toast.id ? { ...t, dismissing: true } : t));
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== toast.id));
          }, 300);
        }, TOAST_DURATION);
      }
    });

    return () => {
      unsub();
      void legion.daemon.eventsUnsubscribe().catch(() => {});
      subscribedRef.current = false;
    };
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, dismissing: true } : t));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 300);
  }, []);

  return (
    <NotificationContext.Provider value={{ notifications, unreadCount, toasts, markRead, markAllRead, clearAll, dismissToast }}>
      {children}
    </NotificationContext.Provider>
  );
};
