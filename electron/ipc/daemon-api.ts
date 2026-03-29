import type { IpcMain, BrowserWindow } from 'electron';
import type { LegionConfig } from '../config/schema.js';
import {
  DAEMON_TIMEOUT_MS,
  resolveDaemonUrl,
  resolveAuthToken,
  withTimeout,
  daemonGet,
  daemonPost,
  daemonPatch,
  daemonPut,
  daemonDelete,
} from '../lib/daemon-client.js';

export function registerDaemonApiHandlers(
  ipcMain: IpcMain,
  legionHome: string,
  getConfig: () => LegionConfig,
  getWindows: () => BrowserWindow[],
): void {
  const cfg = () => getConfig();

  // ── Extensions / Catalog ──
  ipcMain.handle('daemon:catalog', async () =>
    daemonGet(cfg(), legionHome, '/api/catalog'));

  ipcMain.handle('daemon:extensions', async () =>
    daemonGet(cfg(), legionHome, '/api/extensions'));

  ipcMain.handle('daemon:extension', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/extensions/${id}`));

  ipcMain.handle('daemon:extension-runners', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/extensions/${id}/runners`));

  // ── Tasks ──
  ipcMain.handle('daemon:tasks', async (_e, filters?: { status?: string; limit?: string }) =>
    daemonGet(cfg(), legionHome, '/api/tasks', filters));

  ipcMain.handle('daemon:task', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/tasks/${id}`));

  ipcMain.handle('daemon:task-logs', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/tasks/${id}/logs`));

  ipcMain.handle('daemon:task-create', async (_e, body: unknown) =>
    daemonPost(cfg(), legionHome, '/api/tasks', body));

  ipcMain.handle('daemon:task-delete', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/tasks/${id}`));

  ipcMain.handle('daemon:task-graph', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/tasks/graph', filters));

  // ── Workers ──
  ipcMain.handle('daemon:workers', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/workers', filters));

  ipcMain.handle('daemon:worker', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/workers/${id}`));

  ipcMain.handle('daemon:worker-health', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/workers/${id}/health`));

  ipcMain.handle('daemon:worker-costs', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/workers/${id}/costs`));

  ipcMain.handle('daemon:worker-lifecycle', async (_e, id: string, body: unknown) =>
    daemonPatch(cfg(), legionHome, `/api/workers/${id}/lifecycle`, body));

  // ── Schedules ──
  ipcMain.handle('daemon:schedules', async () =>
    daemonGet(cfg(), legionHome, '/api/schedules'));

  ipcMain.handle('daemon:schedule', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/schedules/${id}`));

  ipcMain.handle('daemon:schedule-create', async (_e, body: unknown) =>
    daemonPost(cfg(), legionHome, '/api/schedules', body));

  ipcMain.handle('daemon:schedule-update', async (_e, id: string, body: unknown) =>
    daemonPut(cfg(), legionHome, `/api/schedules/${id}`, body));

  ipcMain.handle('daemon:schedule-delete', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/schedules/${id}`));

  // ── Audit ──
  ipcMain.handle('daemon:audit', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/audit', filters));

  ipcMain.handle('daemon:audit-verify', async () =>
    daemonGet(cfg(), legionHome, '/api/audit/verify'));

  // ── Transport ──
  ipcMain.handle('daemon:transport', async () =>
    daemonGet(cfg(), legionHome, '/api/transport'));

  ipcMain.handle('daemon:transport-exchanges', async () =>
    daemonGet(cfg(), legionHome, '/api/transport/exchanges'));

  ipcMain.handle('daemon:transport-queues', async () =>
    daemonGet(cfg(), legionHome, '/api/transport/queues'));

  ipcMain.handle('daemon:transport-publish', async (_e, body: unknown) =>
    daemonPost(cfg(), legionHome, '/api/transport/publish', body));

  // ── Prompts ──
  ipcMain.handle('daemon:prompts', async () =>
    daemonGet(cfg(), legionHome, '/api/prompts'));

  ipcMain.handle('daemon:prompt', async (_e, name: string) =>
    daemonGet(cfg(), legionHome, `/api/prompts/${name}`));

  ipcMain.handle('daemon:prompt-run', async (_e, name: string, body: unknown) =>
    daemonPost(cfg(), legionHome, `/api/prompts/${name}/run`, body));

  // ── Webhooks ──
  ipcMain.handle('daemon:webhooks', async () =>
    daemonGet(cfg(), legionHome, '/api/webhooks'));

  ipcMain.handle('daemon:webhook-create', async (_e, body: unknown) =>
    daemonPost(cfg(), legionHome, '/api/webhooks', body));

  ipcMain.handle('daemon:webhook-delete', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/webhooks/${id}`));

  // ── Tenants ──
  ipcMain.handle('daemon:tenants', async () =>
    daemonGet(cfg(), legionHome, '/api/tenants'));

  ipcMain.handle('daemon:tenant', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/tenants/${id}`));

  // ── Capacity ──
  ipcMain.handle('daemon:capacity', async () =>
    daemonGet(cfg(), legionHome, '/api/capacity'));

  ipcMain.handle('daemon:capacity-forecast', async (_e, params?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/capacity/forecast', params));

  // ── Governance ──
  ipcMain.handle('daemon:governance-approvals', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/governance/approvals', filters));

  ipcMain.handle('daemon:governance-approve', async (_e, id: string, body: unknown) =>
    daemonPut(cfg(), legionHome, `/api/governance/approvals/${id}/approve`, body));

  ipcMain.handle('daemon:governance-reject', async (_e, id: string, body: unknown) =>
    daemonPut(cfg(), legionHome, `/api/governance/approvals/${id}/reject`, body));

  // ── RBAC (extended) ──
  ipcMain.handle('daemon:rbac-roles', async () =>
    daemonGet(cfg(), legionHome, '/api/rbac/roles'));

  ipcMain.handle('daemon:rbac-assignments', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/rbac/assignments', filters));

  ipcMain.handle('daemon:rbac-check', async (_e, body: unknown) =>
    daemonPost(cfg(), legionHome, '/api/rbac/check', body));

  // ── Nodes ──
  ipcMain.handle('daemon:nodes', async () =>
    daemonGet(cfg(), legionHome, '/api/nodes'));

  // ── Events (SSE) ──
  // SSE is handled specially — we open a persistent connection and forward events to renderer
  let eventsAbort: AbortController | null = null;

  ipcMain.handle('daemon:events-subscribe', async () => {
    if (eventsAbort) eventsAbort.abort();
    eventsAbort = new AbortController();
    const base = resolveDaemonUrl(cfg());
    const url = new URL('/api/events', base).toString();
    const token = resolveAuthToken(cfg(), legionHome);

    try {
      // Use a short connection timeout, then hand off to the persistent abort controller
      const connectTimeout = AbortSignal.timeout(DAEMON_TIMEOUT_MS);
      const combined = AbortSignal.any([connectTimeout, eventsAbort.signal]);
      const resp = await fetch(url, {
        headers: {
          'accept': 'text/event-stream',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: combined,
      });

      if (!resp.ok || !resp.body) {
        return { ok: false, error: `HTTP ${resp.status}` };
      }

      // Stream SSE events to all renderer windows
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data:')) {
                const data = line.slice(5).trim();
                if (data) {
                  try {
                    const event = JSON.parse(data);
                    for (const win of getWindows()) {
                      win.webContents.send('daemon:event', event);
                    }
                  } catch {
                    // non-JSON SSE data, forward as-is
                    for (const win of getWindows()) {
                      win.webContents.send('daemon:event', { raw: data });
                    }
                  }
                }
              }
            }
          }
        } catch {
          // Stream ended (abort or disconnect)
        }
      })();

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('daemon:events-unsubscribe', async () => {
    if (eventsAbort) {
      eventsAbort.abort();
      eventsAbort = null;
    }
    return { ok: true };
  });

  ipcMain.handle('daemon:events-recent', async (_e, count?: number) =>
    daemonGet(cfg(), legionHome, '/api/events/recent', count ? { count: String(count) } : undefined));

  // ── Sub-agents (daemon mode) ──
  ipcMain.handle('daemon:sub-agent-create', async (_e, body: { message: string; model?: string; parent_conversation_id?: string }) =>
    daemonPost(cfg(), legionHome, '/api/llm/inference', {
      messages: [{ role: 'user', content: body.message }],
      ...(body.model ? { model: body.model } : {}),
      sub_agent: true,
      parent_id: body.parent_conversation_id,
    }));

  ipcMain.handle('daemon:sub-agent-status', async (_e, taskId: string) =>
    daemonGet(cfg(), legionHome, `/api/tasks/${taskId}`));

  // ── Natural Language Routing ──
  ipcMain.handle('daemon:do', async (_e, input: string) =>
    daemonPost(cfg(), legionHome, '/api/do', { input }));

  ipcMain.handle('daemon:capabilities', async () =>
    daemonGet(cfg(), legionHome, '/api/capabilities'));

  // ── Memory Inspector ──
  ipcMain.handle('daemon:memory-entries', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/memory/entries', filters));

  ipcMain.handle('daemon:memory-entry', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/memory/entries/${id}`));

  ipcMain.handle('daemon:memory-entry-update', async (_e, id: string, body: unknown) =>
    daemonPut(cfg(), legionHome, `/api/memory/entries/${id}`, body));

  ipcMain.handle('daemon:memory-entry-delete', async (_e, id: string) =>
    daemonDelete(cfg(), legionHome, `/api/memory/entries/${id}`));

  ipcMain.handle('daemon:memory-stats', async () =>
    daemonGet(cfg(), legionHome, '/api/memory/stats'));

  // ── Marketplace ──
  ipcMain.handle('daemon:marketplace', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/extensions/available', filters));

  ipcMain.handle('daemon:extension-install', async (_e, id: string) =>
    daemonPost(cfg(), legionHome, `/api/extensions/${id}/install`, {}));

  ipcMain.handle('daemon:extension-uninstall', async (_e, id: string) =>
    daemonPost(cfg(), legionHome, `/api/extensions/${id}/uninstall`, {}));

  ipcMain.handle('daemon:extension-enable', async (_e, id: string) =>
    daemonPost(cfg(), legionHome, `/api/extensions/${id}/enable`, {}));

  ipcMain.handle('daemon:extension-disable', async (_e, id: string) =>
    daemonPost(cfg(), legionHome, `/api/extensions/${id}/disable`, {}));

  ipcMain.handle('daemon:extension-config', async (_e, id: string) =>
    daemonGet(cfg(), legionHome, `/api/extensions/${id}/config`));

  ipcMain.handle('daemon:extension-config-update', async (_e, id: string, body: unknown) =>
    daemonPut(cfg(), legionHome, `/api/extensions/${id}/config`, body));

  // ── GitHub ──
  ipcMain.handle('daemon:github-status', async () =>
    daemonGet(cfg(), legionHome, '/api/github/status'));

  ipcMain.handle('daemon:github-repos', async () =>
    daemonGet(cfg(), legionHome, '/api/github/repos'));

  ipcMain.handle('daemon:github-pulls', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/github/pulls', filters));

  ipcMain.handle('daemon:github-pull', async (_e, repo: string, number: number) =>
    daemonGet(cfg(), legionHome, `/api/github/pulls/${number}`, { repo }));

  ipcMain.handle('daemon:github-issues', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/github/issues', filters));

  ipcMain.handle('daemon:github-commits', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/github/commits', filters));

  // ── GAIA ──
  ipcMain.handle('daemon:gaia-status', async () =>
    daemonGet(cfg(), legionHome, '/api/gaia/status'));

  ipcMain.handle('daemon:gaia-events', async (_e, filters?: { limit?: string }) =>
    daemonGet(cfg(), legionHome, '/api/gaia/buffer', filters));

  // ── Cost / Metering ──
  ipcMain.handle('daemon:metering', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/metering', filters));

  ipcMain.handle('daemon:metering-rollup', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/metering/rollup', filters));

  ipcMain.handle('daemon:metering-by-model', async (_e, filters?: Record<string, string>) =>
    daemonGet(cfg(), legionHome, '/api/metering/by_model', filters));

  // ── Mesh / Nodes ──
  ipcMain.handle('daemon:mesh-status', async () =>
    daemonGet(cfg(), legionHome, '/api/mesh/status'));

  ipcMain.handle('daemon:mesh-peers', async () =>
    daemonGet(cfg(), legionHome, '/api/mesh/peers'));

  // ── Absorbers ──
  ipcMain.handle('daemon:absorbers', async () =>
    daemonGet(cfg(), legionHome, '/api/absorbers'));

  ipcMain.handle('daemon:absorber-resolve', async (_e, input: string) =>
    daemonPost(cfg(), legionHome, '/api/absorbers/resolve', { input }));

  ipcMain.handle('daemon:absorber-dispatch', async (_e, input: string, scope?: string) =>
    daemonPost(cfg(), legionHome, '/api/absorbers/dispatch', { input, scope }));

  ipcMain.handle('daemon:absorber-job', async (_e, jobId: string) =>
    daemonGet(cfg(), legionHome, `/api/absorbers/jobs/${jobId}`));

  // ── Health / Doctor / Metrics ──
  ipcMain.handle('daemon:health', async () =>
    daemonGet(cfg(), legionHome, '/api/health'));

  ipcMain.handle('daemon:ready', async () =>
    daemonGet(cfg(), legionHome, '/api/ready'));

  ipcMain.handle('daemon:metrics', async () => {
    const base = resolveDaemonUrl(cfg());
    const url = new URL('/api/metrics', base).toString();
    const token = resolveAuthToken(cfg(), legionHome);
    try {
      const resp = await fetch(url, {
        headers: {
          'accept': 'application/json, text/plain',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...withTimeout(),
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const contentType = resp.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = await resp.json() as { data?: unknown };
        return { ok: true, data: body.data ?? body };
      }
      // Prometheus text format
      const text = await resp.text();
      return { ok: true, data: text };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('daemon:doctor', async () => {
    const results: Array<{ name: string; status: string; message: string; duration: number }> = [];
    const runCheck = async (name: string, fn: () => Promise<{ status: string; message: string }>) => {
      const start = Date.now();
      try {
        const { status, message } = await fn();
        results.push({ name, status, message, duration: Date.now() - start });
      } catch (err) {
        results.push({ name, status: 'fail', message: err instanceof Error ? err.message : String(err), duration: Date.now() - start });
      }
    };

    await runCheck('Daemon Reachable', async () => {
      const r = await daemonGet(cfg(), legionHome, '/api/ready');
      return r.ok ? { status: 'pass', message: 'Daemon is running and ready' } : { status: 'fail', message: r.error || 'Not ready' };
    });
    await runCheck('Health Status', async () => {
      const r = await daemonGet(cfg(), legionHome, '/api/health');
      return r.ok ? { status: 'pass', message: 'Health check passed' } : { status: 'warn', message: r.error || 'Health check returned issues' };
    });
    await runCheck('Extensions Loaded', async () => {
      const r = await daemonGet<unknown[]>(cfg(), legionHome, '/api/catalog');
      if (!r.ok) return { status: 'fail', message: r.error || 'Cannot fetch catalog' };
      const count = Array.isArray(r.data) ? r.data.length : 0;
      return count > 0 ? { status: 'pass', message: `${count} extensions loaded` } : { status: 'warn', message: 'No extensions loaded' };
    });
    await runCheck('Transport Connected', async () => {
      const r = await daemonGet(cfg(), legionHome, '/api/transport');
      return r.ok ? { status: 'pass', message: 'Transport layer connected' } : { status: 'fail', message: r.error || 'Transport unavailable' };
    });
    await runCheck('Workers Available', async () => {
      const r = await daemonGet<unknown[]>(cfg(), legionHome, '/api/workers');
      if (!r.ok) return { status: 'warn', message: r.error || 'Cannot fetch workers' };
      const count = Array.isArray(r.data) ? r.data.length : 0;
      return count > 0 ? { status: 'pass', message: `${count} workers registered` } : { status: 'warn', message: 'No workers registered' };
    });
    await runCheck('Schedules Active', async () => {
      const r = await daemonGet<unknown[]>(cfg(), legionHome, '/api/schedules');
      if (!r.ok) return { status: 'warn', message: r.error || 'Cannot fetch schedules' };
      const count = Array.isArray(r.data) ? r.data.length : 0;
      return { status: 'pass', message: `${count} schedules configured` };
    });
    await runCheck('Audit Chain', async () => {
      const r = await daemonGet<{ valid?: boolean }>(cfg(), legionHome, '/api/audit/verify');
      if (!r.ok) return { status: 'warn', message: r.error || 'Cannot verify audit chain' };
      const valid = (r.data as { valid?: boolean } | undefined)?.valid;
      return valid ? { status: 'pass', message: 'Audit hash chain is valid' } : { status: 'warn', message: 'Audit chain verification returned invalid' };
    });

    return { ok: true, data: results };
  });
}
