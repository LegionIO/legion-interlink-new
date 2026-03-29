import { useState, useEffect, useCallback, type FC } from 'react';
import {
  CalendarIcon, PlusIcon, Trash2Icon, PlayIcon, PauseIcon,
  RefreshCwIcon, Loader2Icon, AlertTriangleIcon, ClockIcon, EditIcon, CheckIcon, XIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import type { SettingsProps } from './shared';

interface Schedule {
  id: string;
  name: string;
  description?: string;
  cron?: string;
  interval_seconds?: number;
  enabled: boolean;
  last_run?: string;
  next_run?: string;
  run_count?: number;
  task_type?: string;
  payload?: unknown;
}

const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every 6 hours', cron: '0 */6 * * *' },
  { label: 'Daily at midnight', cron: '0 0 * * *' },
  { label: 'Daily at 9 AM', cron: '0 9 * * *' },
  { label: 'Weekly (Mon 9 AM)', cron: '0 9 * * 1' },
  { label: 'Monthly (1st at midnight)', cron: '0 0 1 * *' },
];

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return fmtUntil(iso);
  if (ms < 60_000) return 'just now';
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  return `${Math.floor(ms / 86400_000)}d ago`;
}

function fmtUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return 'overdue';
  if (ms < 60_000) return 'in <1m';
  if (ms < 3600_000) return `in ${Math.floor(ms / 60_000)}m`;
  if (ms < 86400_000) return `in ${Math.floor(ms / 3600_000)}h`;
  return `in ${Math.floor(ms / 86400_000)}d`;
}

function intervalLabel(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const ScheduleRow: FC<{
  schedule: Schedule;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
}> = ({ schedule, onToggle, onDelete, onEdit }) => (
  <div className="flex items-center gap-3 rounded-lg px-3 py-3 hover:bg-muted/20 transition-colors">
    <button type="button" onClick={onToggle} className="shrink-0" title={schedule.enabled ? 'Pause' : 'Resume'}>
      {schedule.enabled
        ? <PlayIcon className="h-3.5 w-3.5 text-emerald-400" />
        : <PauseIcon className="h-3.5 w-3.5 text-muted-foreground" />
      }
    </button>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium ${schedule.enabled ? '' : 'opacity-50'}`}>{schedule.name}</span>
        {schedule.cron && <code className="rounded bg-muted/40 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">{schedule.cron}</code>}
        {schedule.interval_seconds && !schedule.cron && (
          <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[9px] text-muted-foreground">every {intervalLabel(schedule.interval_seconds)}</span>
        )}
      </div>
      <div className="mt-0.5 flex gap-3 text-[10px] text-muted-foreground">
        {schedule.description && <span className="truncate max-w-[200px]">{schedule.description}</span>}
        {schedule.last_run && <span>Last: {fmtAgo(schedule.last_run)}</span>}
        {schedule.next_run && <span>Next: {fmtUntil(schedule.next_run)}</span>}
        {schedule.run_count != null && <span>{schedule.run_count} runs</span>}
      </div>
    </div>
    <button type="button" onClick={onEdit} className="rounded p-1 hover:bg-muted/40 transition-colors" title="Edit">
      <EditIcon className="h-3 w-3 text-muted-foreground" />
    </button>
    <button type="button" onClick={onDelete} className="rounded p-1 hover:bg-red-500/20 transition-colors" title="Delete">
      <Trash2Icon className="h-3 w-3 text-muted-foreground hover:text-red-400" />
    </button>
  </div>
);

interface FormState {
  name: string;
  description: string;
  mode: 'cron' | 'interval';
  cron: string;
  interval: string;
  task_type: string;
}

const EMPTY_FORM: FormState = { name: '', description: '', mode: 'cron', cron: '0 * * * *', interval: '300', task_type: '' };

const ScheduleForm: FC<{
  initial?: FormState;
  onSubmit: (form: FormState) => void;
  onCancel: () => void;
  submitLabel: string;
}> = ({ initial, onSubmit, onCancel, submitLabel }) => {
  const [form, setForm] = useState<FormState>(initial || EMPTY_FORM);
  const set = (k: keyof FormState, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3 rounded-xl border border-border/40 bg-card/60 p-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Name *</label>
          <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
            className="w-full rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary" placeholder="my-schedule" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Task Type</label>
          <input type="text" value={form.task_type} onChange={(e) => set('task_type', e.target.value)}
            className="w-full rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary" placeholder="runner.name" />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-muted-foreground block mb-1">Description</label>
        <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)}
          className="w-full rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-primary" placeholder="Optional description" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => set('mode', 'cron')}
          className={`rounded-md px-3 py-1 text-[10px] font-medium transition-colors ${form.mode === 'cron' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/40'}`}>
          Cron
        </button>
        <button type="button" onClick={() => set('mode', 'interval')}
          className={`rounded-md px-3 py-1 text-[10px] font-medium transition-colors ${form.mode === 'interval' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted/40'}`}>
          Interval
        </button>
      </div>
      {form.mode === 'cron' ? (
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-muted-foreground block mb-1">Cron Expression</label>
            <input type="text" value={form.cron} onChange={(e) => set('cron', e.target.value)}
              className="w-full rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-primary" placeholder="* * * * *" />
          </div>
          <div className="flex flex-wrap gap-1">
            {CRON_PRESETS.map((p) => (
              <button key={p.cron} type="button" onClick={() => set('cron', p.cron)}
                className={`rounded border border-border/30 px-2 py-0.5 text-[9px] transition-colors ${form.cron === p.cron ? 'bg-primary/15 text-primary border-primary/30' : 'text-muted-foreground hover:bg-muted/30'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">Interval (seconds)</label>
          <input type="number" min={1} value={form.interval} onChange={(e) => set('interval', e.target.value)}
            className="w-full rounded-md border border-border/40 bg-background px-2.5 py-1.5 text-xs font-mono outline-none focus:ring-1 focus:ring-primary" />
          <div className="mt-1 flex gap-2">
            {[60, 300, 900, 3600, 21600, 86400].map((s) => (
              <button key={s} type="button" onClick={() => set('interval', String(s))}
                className={`rounded border border-border/30 px-2 py-0.5 text-[9px] transition-colors ${form.interval === String(s) ? 'bg-primary/15 text-primary border-primary/30' : 'text-muted-foreground hover:bg-muted/30'}`}>
                {intervalLabel(s)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button type="button" onClick={() => { if (form.name.trim()) onSubmit(form); }}
          disabled={!form.name.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          <CheckIcon className="h-3 w-3" />{submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 rounded-lg border border-border/40 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 transition-colors">
          <XIcon className="h-3 w-3" />Cancel
        </button>
      </div>
    </div>
  );
};

export const DaemonScheduleBuilder: FC<SettingsProps> = () => {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await legion.daemon.schedules();
      if (res.ok && res.data) {
        const arr = Array.isArray(res.data) ? res.data : (res.data as { schedules?: Schedule[] }).schedules || [];
        setSchedules(arr as Schedule[]);
      } else {
        setError(res.error || 'Failed to load schedules');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleCreate = async (form: FormState) => {
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      enabled: true,
      task_type: form.task_type || undefined,
    };
    if (form.mode === 'cron') body.cron = form.cron;
    else body.interval_seconds = parseInt(form.interval, 10) || 300;

    await legion.daemon.scheduleCreate(body);
    setShowCreate(false);
    void refresh();
  };

  const handleUpdate = async (id: string, form: FormState) => {
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      task_type: form.task_type || undefined,
    };
    if (form.mode === 'cron') { body.cron = form.cron; body.interval_seconds = null; }
    else { body.interval_seconds = parseInt(form.interval, 10) || 300; body.cron = null; }

    await legion.daemon.scheduleUpdate(id, body);
    setEditId(null);
    void refresh();
  };

  const handleToggle = async (s: Schedule) => {
    await legion.daemon.scheduleUpdate(s.id, { enabled: !s.enabled });
    void refresh();
  };

  const handleDelete = async (id: string) => {
    await legion.daemon.scheduleDelete(id);
    void refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Schedule Builder</h3>
          <span className="text-[10px] text-muted-foreground">({schedules.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => { setShowCreate(true); setEditId(null); }}
            className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
            <PlusIcon className="h-3 w-3" />New
          </button>
          <button type="button" onClick={() => void refresh()} disabled={loading}
            className="rounded-md p-1.5 hover:bg-muted/60 disabled:opacity-50 transition-colors">
            <RefreshCwIcon className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-400">
          <AlertTriangleIcon className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      {showCreate && (
        <ScheduleForm onSubmit={(f) => void handleCreate(f)} onCancel={() => setShowCreate(false)} submitLabel="Create" />
      )}

      {loading && schedules.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2Icon className="h-5 w-5 animate-spin text-primary" /></div>
      ) : schedules.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center py-12 text-muted-foreground">
          <ClockIcon className="h-8 w-8 opacity-20 mb-3" />
          <p className="text-xs">No schedules configured</p>
          <p className="text-[10px] opacity-60 mt-1">Create one to run tasks on a timer</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border/40 bg-card/40 divide-y divide-border/20">
          {schedules.map((s) => (
            editId === s.id ? (
              <div key={s.id} className="p-3">
                <ScheduleForm
                  initial={{
                    name: s.name,
                    description: s.description || '',
                    mode: s.cron ? 'cron' : 'interval',
                    cron: s.cron || '0 * * * *',
                    interval: String(s.interval_seconds || 300),
                    task_type: s.task_type || '',
                  }}
                  onSubmit={(f) => void handleUpdate(s.id, f)}
                  onCancel={() => setEditId(null)}
                  submitLabel="Save"
                />
              </div>
            ) : (
              <ScheduleRow
                key={s.id}
                schedule={s}
                onToggle={() => void handleToggle(s)}
                onDelete={() => void handleDelete(s.id)}
                onEdit={() => { setEditId(s.id); setShowCreate(false); }}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
};
