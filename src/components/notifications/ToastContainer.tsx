import type { FC } from 'react';
import { XIcon, AlertCircleIcon, AlertTriangleIcon, InfoIcon, CheckCircle2Icon } from 'lucide-react';
import { useNotifications } from '@/providers/NotificationProvider';

const SEVERITY_STYLES: Record<string, { icon: FC<{ className?: string }>; bg: string; border: string; iconColor: string }> = {
  error: { icon: AlertCircleIcon, bg: 'bg-red-500/10', border: 'border-red-500/30', iconColor: 'text-red-400' },
  warn: { icon: AlertTriangleIcon, bg: 'bg-amber-500/10', border: 'border-amber-500/30', iconColor: 'text-amber-400' },
  success: { icon: CheckCircle2Icon, bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', iconColor: 'text-emerald-400' },
  info: { icon: InfoIcon, bg: 'bg-blue-500/10', border: 'border-blue-500/30', iconColor: 'text-blue-400' },
};

export const ToastContainer: FC = () => {
  const { toasts, dismissToast } = useNotifications();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col-reverse gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const style = SEVERITY_STYLES[toast.notification.severity] || SEVERITY_STYLES.info;
        const Icon = style.icon;
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto w-80 rounded-xl border ${style.border} ${style.bg} p-3 shadow-lg backdrop-blur-xl transition-all duration-300 ${
              toast.dismissing ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.iconColor}`} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{toast.notification.title}</p>
                {toast.notification.message && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{toast.notification.message}</p>
                )}
                {toast.notification.source && (
                  <p className="mt-1 text-[10px] text-muted-foreground/70">{toast.notification.source}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="shrink-0 rounded p-0.5 hover:bg-muted/40 transition-colors"
              >
                <XIcon className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
