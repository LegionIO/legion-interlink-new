import { useState, useCallback, type FC } from 'react';
import {
  LoaderIcon,
  CheckCircle2Icon,
  XCircleIcon,
  AlertTriangleIcon,
  StethoscopeIcon,
  PlayIcon,
} from 'lucide-react';
import { type SettingsProps } from './shared';
import { legion } from '@/lib/ipc-client';

type CheckStatus = 'pass' | 'warn' | 'fail' | 'running' | 'pending';

type CheckResult = {
  name: string;
  status: CheckStatus;
  message: string;
  duration?: number;
};

const StatusIcon: FC<{ status: CheckStatus }> = ({ status }) => {
  switch (status) {
    case 'pass':
      return <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />;
    case 'warn':
      return <AlertTriangleIcon className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />;
    case 'fail':
      return <XCircleIcon className="h-3.5 w-3.5 shrink-0 text-destructive" />;
    case 'running':
      return <LoaderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin" />;
    case 'pending':
      return <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-border/60 bg-muted/40 inline-block" />;
  }
};

const statusRowClass = (status: CheckStatus): string => {
  switch (status) {
    case 'pass':
      return 'border-green-500/20 bg-green-500/5';
    case 'warn':
      return 'border-amber-500/20 bg-amber-500/5';
    case 'fail':
      return 'border-destructive/20 bg-destructive/5';
    case 'running':
      return 'border-border/50 bg-muted/20';
    case 'pending':
      return 'border-border/40 bg-transparent';
  }
};

const statusLabelClass = (status: CheckStatus): string => {
  switch (status) {
    case 'pass':
      return 'text-green-700 dark:text-green-400';
    case 'warn':
      return 'text-amber-700 dark:text-amber-400';
    case 'fail':
      return 'text-destructive';
    case 'running':
      return 'text-muted-foreground';
    case 'pending':
      return 'text-muted-foreground';
  }
};

const INITIAL_CHECKS: CheckResult[] = [
  { name: 'Daemon Reachable',    status: 'pending', message: 'Waiting...' },
  { name: 'Health Status',       status: 'pending', message: 'Waiting...' },
  { name: 'Extensions Loaded',   status: 'pending', message: 'Waiting...' },
  { name: 'Transport Connected', status: 'pending', message: 'Waiting...' },
  { name: 'Workers Available',   status: 'pending', message: 'Waiting...' },
  { name: 'Schedules Active',    status: 'pending', message: 'Waiting...' },
  { name: 'Audit Chain',         status: 'pending', message: 'Waiting...' },
];

type RunState = 'idle' | 'running' | 'done';

export const DaemonDoctor: FC<SettingsProps> = () => {
  const [checks, setChecks] = useState<CheckResult[]>(INITIAL_CHECKS);
  const [runState, setRunState] = useState<RunState>('idle');

  const setCheck = (index: number, patch: Partial<CheckResult>) => {
    setChecks((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  };

  const runDiagnostics = useCallback(async () => {
    setRunState('running');
    setChecks(INITIAL_CHECKS.map((c) => ({ ...c })));

    type DiagMethod = 'ready' | 'health' | 'catalog' | 'transport' | 'workers' | 'schedules' | 'auditVerify';
    const run = async (
      index: number,
      method: DiagMethod,
      evaluate: (result: { ok: boolean; data?: unknown; error?: string }) => { status: CheckStatus; message: string },
    ) => {
      setCheck(index, { status: 'running', message: 'Running...' });
      const start = Date.now();
      try {
        const result = await (legion.daemon[method] as () => Promise<{ ok: boolean; data?: unknown; error?: string }>)();
        const duration = Date.now() - start;
        const { status, message } = evaluate(result);
        setCheck(index, { status, message, duration });
      } catch (err) {
        const duration = Date.now() - start;
        setCheck(index, { status: 'fail', message: String(err), duration });
      }
    };

    // 1. Daemon Reachable
    await run(0, 'ready', (r) =>
      r.ok
        ? { status: 'pass', message: 'Daemon is reachable.' }
        : { status: 'fail', message: r.error ?? 'Daemon did not respond.' },
    );

    // 2. Health Status
    await run(1, 'health', (r) => {
      if (!r.ok) return { status: 'fail', message: r.error ?? 'Health check failed.' };
      const data = r.data as Record<string, unknown> | undefined;
      const hasIssues = data && typeof data === 'object' && Object.values(data).some((v) => v === false || v === 'degraded' || v === 'unhealthy');
      return hasIssues
        ? { status: 'warn', message: 'Health reported with issues.' }
        : { status: 'pass', message: 'All health indicators nominal.' };
    });

    // 3. Extensions Loaded
    await run(2, 'catalog', (r) => {
      if (!r.ok) return { status: 'fail', message: r.error ?? 'Could not fetch extension catalog.' };
      if (!Array.isArray(r.data) || r.data.length === 0)
        return { status: 'warn', message: 'No extensions loaded.' };
      return { status: 'pass', message: `${r.data.length} extension${r.data.length === 1 ? '' : 's'} loaded.` };
    });

    // 4. Transport Connected
    await run(3, 'transport', (r) =>
      r.ok
        ? { status: 'pass', message: 'Transport layer connected.' }
        : { status: 'fail', message: r.error ?? 'Transport is not connected.' },
    );

    // 5. Workers Available
    await run(4, 'workers', (r) => {
      if (!r.ok) return { status: 'fail', message: r.error ?? 'Could not fetch workers.' };
      if (!Array.isArray(r.data) || r.data.length === 0)
        return { status: 'warn', message: 'No workers registered.' };
      return { status: 'pass', message: `${r.data.length} worker${r.data.length === 1 ? '' : 's'} available.` };
    });

    // 6. Schedules Active
    await run(5, 'schedules', (r) => {
      if (!r.ok) return { status: 'fail', message: r.error ?? 'Could not fetch schedules.' };
      const count = Array.isArray(r.data) ? r.data.length : 0;
      const active = Array.isArray(r.data)
        ? (r.data as Array<{ active?: boolean }>).filter((s) => s.active).length
        : 0;
      return { status: 'pass', message: `${active} active schedule${active === 1 ? '' : 's'} (${count} total).` };
    });

    // 7. Audit Chain
    await run(6, 'auditVerify', (r) => {
      if (!r.ok) return { status: 'warn', message: r.error ?? 'Audit chain verification failed.' };
      const data = r.data as { valid?: boolean } | undefined;
      return data?.valid === false
        ? { status: 'warn', message: 'Audit chain integrity could not be confirmed.' }
        : { status: 'pass', message: 'Audit chain integrity verified.' };
    });

    setRunState('done');
  }, []);

  const passed  = checks.filter((c) => c.status === 'pass').length;
  const warned  = checks.filter((c) => c.status === 'warn').length;
  const failed  = checks.filter((c) => c.status === 'fail').length;
  const pending = checks.filter((c) => c.status === 'pending' || c.status === 'running').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Diagnostics</h3>
        <button
          type="button"
          onClick={runDiagnostics}
          disabled={runState === 'running'}
          className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] hover:bg-muted transition-colors disabled:opacity-50"
        >
          {runState === 'running' ? (
            <LoaderIcon className="h-3 w-3 animate-spin" />
          ) : (
            <PlayIcon className="h-3 w-3" />
          )}
          {runState === 'running' ? 'Running...' : runState === 'done' ? 'Run Again' : 'Run Diagnostics'}
        </button>
      </div>

      {runState === 'idle' && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <StethoscopeIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">
            Run diagnostics to check daemon health and connectivity.
          </p>
        </div>
      )}

      {runState !== 'idle' && (
        <>
          {runState === 'running' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
              Running checks sequentially...
            </div>
          )}

          <div className="space-y-1.5">
            {checks.map((check) => (
              <div
                key={check.name}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${statusRowClass(check.status)}`}
              >
                <StatusIcon status={check.status} />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">{check.name}</span>
                  {check.status !== 'pending' && check.status !== 'running' && (
                    <p className={`text-[10px] mt-0.5 ${statusLabelClass(check.status)}`}>
                      {check.message}
                    </p>
                  )}
                </div>
                {check.duration !== undefined && (
                  <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                    {check.duration}ms
                  </span>
                )}
              </div>
            ))}
          </div>

          {runState === 'done' && pending === 0 && (
            <div className="rounded-lg border border-border/50 px-3 py-2 flex items-center gap-4 text-[10px]">
              <span className="text-green-700 dark:text-green-400 font-medium">
                {passed} passed
              </span>
              {warned > 0 && (
                <span className="text-amber-700 dark:text-amber-400 font-medium">
                  {warned} warning{warned === 1 ? '' : 's'}
                </span>
              )}
              {failed > 0 && (
                <span className="text-destructive font-medium">
                  {failed} failed
                </span>
              )}
              {warned === 0 && failed === 0 && (
                <span className="text-muted-foreground">All checks passed.</span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
