import { useState, useEffect, useCallback, type FC } from 'react';
import { PlusIcon, Trash2Icon, ZapIcon } from 'lucide-react';
import { Toggle, NumberField, TextField, settingsSelectClass, type SettingsProps } from './shared';

type TriggerSource = 'github' | 'linear' | 'slack';
type TriggerAction = 'ignore' | 'observe' | 'act';

interface TriggerRule {
  source: TriggerSource;
  eventType: string;
  action: TriggerAction;
  filter?: string;
}

interface TriggersConfig {
  enabled: boolean;
  autoTriage: boolean;
  triageModel: string;
  rules: TriggerRule[];
  maxConcurrentWorkflows: number;
  requireApprovalForActions: boolean;
}

interface ActiveWorkflow {
  source: string;
  title: string;
  status: string;
  startedAt: number;
}

const SOURCE_LABELS: Record<TriggerSource, string> = {
  github: 'GitHub',
  linear: 'Linear',
  slack: 'Slack',
};

const ACTION_LABELS: Record<TriggerAction, string> = {
  ignore: 'Ignore',
  observe: 'Observe',
  act: 'Act',
};

const sourceBadgeClass = (source: TriggerSource): string => {
  if (source === 'github') return 'bg-neutral-500/10 text-neutral-700 dark:text-neutral-300 border-neutral-500/20';
  if (source === 'linear') return 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20';
  return 'bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-500/20';
};

const actionBadgeClass = (action: TriggerAction): string => {
  if (action === 'act') return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20';
  if (action === 'observe') return 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';
  return 'bg-muted/50 text-muted-foreground border-border/40';
};

function elapsedLabel(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const EMPTY_RULE: TriggerRule = {
  source: 'github',
  eventType: '*',
  action: 'observe',
  filter: '',
};

export const TriggerSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const raw = (config as { triggers?: Partial<TriggersConfig> }).triggers ?? {};

  const triggers: TriggersConfig = {
    enabled: raw.enabled ?? true,
    autoTriage: raw.autoTriage ?? true,
    triageModel: raw.triageModel ?? '',
    rules: raw.rules ?? [],
    maxConcurrentWorkflows: raw.maxConcurrentWorkflows ?? 3,
    requireApprovalForActions: raw.requireApprovalForActions ?? false,
  };

  const [showAddForm, setShowAddForm] = useState(false);
  const [draftRule, setDraftRule] = useState<TriggerRule>({ ...EMPTY_RULE });

  const [activeWorkflows, setActiveWorkflows] = useState<ActiveWorkflow[]>([]);

  /* ── Poll active workflows every 5s ── */
  const fetchActiveWorkflows = useCallback(() => {
    try {
      const dispatch = (window as unknown as Record<string, unknown>).triggerDispatch as
        | { activeWorkflows?: () => ActiveWorkflow[] }
        | undefined;
      const flows = dispatch?.activeWorkflows?.() ?? [];
      setActiveWorkflows(flows);
    } catch {
      setActiveWorkflows([]);
    }
  }, []);

  useEffect(() => {
    fetchActiveWorkflows();
    const interval = setInterval(fetchActiveWorkflows, 5000);
    return () => clearInterval(interval);
  }, [fetchActiveWorkflows]);

  /* ── Rule CRUD helpers ── */
  const deleteRule = useCallback((index: number) => {
    const next = triggers.rules.filter((_, i) => i !== index);
    updateConfig('triggers.rules', next);
  }, [triggers.rules, updateConfig]);

  const addRule = useCallback(() => {
    const next = [
      ...triggers.rules,
      { ...draftRule, filter: draftRule.filter?.trim() || undefined },
    ];
    updateConfig('triggers.rules', next);
    setDraftRule({ ...EMPTY_RULE });
    setShowAddForm(false);
  }, [triggers.rules, draftRule, updateConfig]);

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">Triggers</h3>

      {/* ── General ── */}
      <fieldset className="rounded-lg border p-3 space-y-2">
        <legend className="text-xs font-semibold px-1">General</legend>

        <Toggle
          label="Enable trigger system"
          checked={triggers.enabled}
          onChange={(v) => updateConfig('triggers.enabled', v)}
        />
        <Toggle
          label="Auto-triage incoming events"
          checked={triggers.autoTriage}
          onChange={(v) => updateConfig('triggers.autoTriage', v)}
        />
        <Toggle
          label="Require approval before executing actions"
          checked={triggers.requireApprovalForActions}
          onChange={(v) => updateConfig('triggers.requireApprovalForActions', v)}
        />
      </fieldset>

      {/* ── Triage Model (only when autoTriage is on) ── */}
      {triggers.autoTriage && (
        <fieldset className="rounded-lg border p-3 space-y-2">
          <legend className="text-xs font-semibold px-1">Triage Model</legend>
          <TextField
            label="Model name"
            value={triggers.triageModel}
            onChange={(v) => updateConfig('triggers.triageModel', v)}
            placeholder="Leave blank to use default model"
            hint="Leave blank to use default model"
          />
        </fieldset>
      )}

      {/* ── Concurrency ── */}
      <fieldset className="rounded-lg border p-3 space-y-2">
        <legend className="text-xs font-semibold px-1">Concurrency</legend>
        <NumberField
          label="Max concurrent workflows"
          value={triggers.maxConcurrentWorkflows}
          min={1}
          max={10}
          onChange={(v) => {
            const clamped = Math.min(10, Math.max(1, v));
            updateConfig('triggers.maxConcurrentWorkflows', clamped);
          }}
        />
        <span className="text-[10px] text-muted-foreground/60 block">1–10</span>
      </fieldset>

      {/* ── Rules ── */}
      <fieldset className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <legend className="text-xs font-semibold px-1">Rules</legend>
          {!showAddForm && (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors"
            >
              <PlusIcon className="h-3 w-3" />
              Add Rule
            </button>
          )}
        </div>

        {/* Rule list */}
        {triggers.rules.length === 0 && !showAddForm ? (
          <p className="text-xs text-muted-foreground italic">No rules configured. All events will be ignored.</p>
        ) : (
          <div className="space-y-2">
            {triggers.rules.map((rule, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border p-2.5">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${sourceBadgeClass(rule.source)}`}>
                      {SOURCE_LABELS[rule.source]}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">{rule.eventType || '*'}</span>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${actionBadgeClass(rule.action)}`}>
                      {ACTION_LABELS[rule.action]}
                    </span>
                  </div>
                  {rule.filter && (
                    <p className="text-[10px] text-muted-foreground font-mono truncate">
                      filter: {rule.filter}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => deleteRule(i)}
                  className="shrink-0 rounded-md border border-destructive/30 p-1.5 text-destructive hover:bg-destructive/10 transition-colors"
                  title="Delete rule"
                >
                  <Trash2Icon className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add rule inline form */}
        {showAddForm && (
          <fieldset className="rounded-lg border border-dashed border-border/60 p-3 space-y-3">
            <legend className="text-[10px] font-semibold px-1">New Rule</legend>

            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Source</label>
              <select
                className={settingsSelectClass}
                value={draftRule.source}
                onChange={(e) => setDraftRule((prev) => ({ ...prev, source: e.target.value as TriggerSource }))}
              >
                <option value="github">GitHub</option>
                <option value="linear">Linear</option>
                <option value="slack">Slack</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Event Type</label>
              <input
                type="text"
                value={draftRule.eventType}
                onChange={(e) => setDraftRule((prev) => ({ ...prev, eventType: e.target.value }))}
                placeholder="* for all"
                className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs outline-none"
              />
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Action</label>
              <select
                className={settingsSelectClass}
                value={draftRule.action}
                onChange={(e) => setDraftRule((prev) => ({ ...prev, action: e.target.value as TriggerAction }))}
              >
                <option value="ignore">Ignore</option>
                <option value="observe">Observe</option>
                <option value="act">Act</option>
              </select>
            </div>

            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Filter (optional)</label>
              <input
                type="text"
                value={draftRule.filter ?? ''}
                onChange={(e) => setDraftRule((prev) => ({ ...prev, filter: e.target.value }))}
                placeholder="regex filter on payload"
                className="w-full rounded-xl border border-border/70 bg-card/80 px-3 py-2 text-xs font-mono outline-none"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={addRule}
                className="flex items-center gap-1.5 rounded-md border bg-primary/10 border-primary/30 px-3 py-1.5 text-xs text-primary hover:bg-primary/20 transition-colors"
              >
                <PlusIcon className="h-3 w-3" />
                Add
              </button>
              <button
                type="button"
                onClick={() => { setShowAddForm(false); setDraftRule({ ...EMPTY_RULE }); }}
                className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
              >
                Cancel
              </button>
            </div>
          </fieldset>
        )}
      </fieldset>

      {/* ── Active Workflows ── */}
      <fieldset className="rounded-lg border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <legend className="text-xs font-semibold px-1">Active Workflows</legend>
          <span className="text-[10px] text-muted-foreground">auto-refreshes every 5s</span>
        </div>

        {activeWorkflows.length === 0 ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <ZapIcon className="h-3.5 w-3.5 shrink-0 opacity-40" />
            No active workflows
          </div>
        ) : (
          <div className="space-y-2">
            {activeWorkflows.map((wf, i) => (
              <div key={i} className="flex items-center gap-3 rounded-lg border p-2.5">
                <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${sourceBadgeClass(wf.source as TriggerSource)}`}>
                  {SOURCE_LABELS[wf.source as TriggerSource] ?? wf.source}
                </span>
                <span className="flex-1 min-w-0 text-xs truncate">{wf.title}</span>
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{wf.status}</span>
                <span className="text-[10px] text-muted-foreground font-mono shrink-0">{elapsedLabel(wf.startedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
};
