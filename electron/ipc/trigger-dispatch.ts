import { randomUUID } from 'crypto';
import type { IpcMain, BrowserWindow } from 'electron';
import type { AppConfig } from '../config/schema.js';
import { daemonPost } from '../lib/daemon-client.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type WorkflowStatus = 'pending' | 'running' | 'needs-input' | 'resolved' | 'failed';

export interface ActiveWorkflow {
  id: string;
  source: string;
  eventType: string;
  action: 'observe' | 'act';
  status: WorkflowStatus;
  startedAt: string;
  taskId?: string;
  payload: unknown;
}

interface TriggerEnvelope {
  type: string;
  source: string;
  event_type: string;
  payload: unknown;
}

type TriageAction = 'ignore' | 'observe' | 'act';

// ── Internal state ───────────────────────────────────────────────────────────

const activeWorkflows = new Map<string, ActiveWorkflow>();

// ── Glob-style pattern matching ──────────────────────────────────────────────

function matchesGlob(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

// ── Triage logic ─────────────────────────────────────────────────────────────

function triageEvent(
  envelope: TriggerEnvelope,
  config: AppConfig,
): TriageAction {
  const triggers = config.triggers;
  if (!triggers?.enabled) return 'ignore';

  const { source, event_type: eventType, payload } = envelope;

  for (const rule of triggers.rules ?? []) {
    if (!matchesGlob(rule.source, source)) continue;
    if (!matchesGlob(rule.eventType, eventType)) continue;
    if (rule.filter) {
      try {
        const re = new RegExp(rule.filter);
        const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (!re.test(payloadStr)) continue;
      } catch {
        // Malformed regex — skip this rule
        continue;
      }
    }
    return rule.action;
  }

  // No rule matched — fall back to autoTriage default
  return triggers.autoTriage ? 'observe' : 'ignore';
}

// ── Broadcast helpers ────────────────────────────────────────────────────────

function broadcast(getWindows: () => BrowserWindow[], channel: string, data: unknown): void {
  for (const win of getWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}

function broadcastWorkflowUpdate(
  getWindows: () => BrowserWindow[],
  workflow: ActiveWorkflow,
): void {
  broadcast(getWindows, 'trigger-dispatch:workflow-update', workflow);
}

// ── Workflow lifecycle ────────────────────────────────────────────────────────

function upsertWorkflow(
  workflow: ActiveWorkflow,
  getWindows: () => BrowserWindow[],
): void {
  activeWorkflows.set(workflow.id, workflow);
  broadcastWorkflowUpdate(getWindows, workflow);
}

function updateWorkflowStatus(
  id: string,
  status: WorkflowStatus,
  getWindows: () => BrowserWindow[],
  taskId?: string,
): void {
  const wf = activeWorkflows.get(id);
  if (!wf) return;
  const updated: ActiveWorkflow = { ...wf, status, ...(taskId ? { taskId } : {}) };
  activeWorkflows.set(id, updated);
  broadcastWorkflowUpdate(getWindows, updated);
}

// ── Route: observe ───────────────────────────────────────────────────────────

async function routeObserve(
  id: string,
  envelope: TriggerEnvelope,
  appHome: string,
  getConfig: () => AppConfig,
  getWindows: () => BrowserWindow[],
): Promise<void> {
  const observation = {
    type: 'trigger_observation',
    source: envelope.source,
    event_type: envelope.event_type,
    payload: envelope.payload,
    observed_at: new Date().toISOString(),
  };

  // POST to daemon GAIA buffer as an observation entry
  const result = await daemonPost(
    getConfig(),
    appHome,
    '/api/gaia/buffer',
    observation,
  );

  const status: WorkflowStatus = result.ok ? 'resolved' : 'failed';
  updateWorkflowStatus(id, status, getWindows);
  if (!result.ok) {
    console.warn(`[TriggerDispatch] GAIA observe failed for ${id}: ${result.error}`);
  }
}

// ── Route: act ───────────────────────────────────────────────────────────────

async function routeAct(
  id: string,
  envelope: TriggerEnvelope,
  appHome: string,
  getConfig: () => AppConfig,
  getWindows: () => BrowserWindow[],
): Promise<void> {
  const config = getConfig();
  const triageModel = config.triggers?.triageModel;

  const message = [
    `A trigger event has fired and requires action.`,
    `Source: ${envelope.source}`,
    `Event type: ${envelope.event_type}`,
    `Payload:\n\`\`\`json\n${JSON.stringify(envelope.payload, null, 2)}\n\`\`\``,
    `Please assess the situation and take appropriate action.`,
  ].join('\n');

  const body: { message: string; model?: string } = { message };
  if (triageModel) body.model = triageModel;

  const result = await daemonPost<{ id?: string; task_id?: string }>(
    config,
    appHome,
    '/api/llm/inference',
    {
      messages: [{ role: 'user', content: message }],
      ...(triageModel ? { model: triageModel } : {}),
      sub_agent: true,
    },
  );

  if (!result.ok) {
    console.warn(`[TriggerDispatch] Sub-agent creation failed for ${id}: ${result.error}`);
    updateWorkflowStatus(id, 'failed', getWindows);
    return;
  }

  const taskId = (result.data as { id?: string; task_id?: string } | undefined)?.id
    ?? (result.data as { id?: string; task_id?: string } | undefined)?.task_id;
  updateWorkflowStatus(id, 'running', getWindows, taskId);
}

// ── SSE event handler ─────────────────────────────────────────────────────────

export function handleSseEvent(
  event: unknown,
  appHome: string,
  getConfig: () => AppConfig,
  getWindows: () => BrowserWindow[],
): void {
  if (!event || typeof event !== 'object') return;
  const ev = event as Record<string, unknown>;
  if (typeof ev.type !== 'string' || !ev.type.startsWith('trigger.')) return;

  const config = getConfig();
  if (!config.triggers?.enabled) return;

  const envelope: TriggerEnvelope = {
    type: ev.type,
    source: typeof ev.source === 'string' ? ev.source : 'unknown',
    event_type: typeof ev.event_type === 'string' ? ev.event_type : ev.type.replace(/^trigger\./, ''),
    payload: ev.payload ?? ev.data ?? {},
  };

  const action = triageEvent(envelope, config);

  if (action === 'ignore') {
    console.info(`[TriggerDispatch] Ignoring trigger event: ${envelope.type} from ${envelope.source}`);
    return;
  }

  const maxConcurrent = config.triggers?.maxConcurrentWorkflows ?? 5;
  const runningCount = [...activeWorkflows.values()].filter(
    (wf) => wf.status === 'pending' || wf.status === 'running',
  ).length;

  if (runningCount >= maxConcurrent) {
    console.warn(
      `[TriggerDispatch] Max concurrent workflows (${maxConcurrent}) reached — dropping trigger ${envelope.type}`,
    );
    return;
  }

  const id = randomUUID();
  const workflow: ActiveWorkflow = {
    id,
    source: envelope.source,
    eventType: envelope.event_type,
    action,
    status: 'pending',
    startedAt: new Date().toISOString(),
    payload: envelope.payload,
  };

  upsertWorkflow(workflow, getWindows);
  console.info(`[TriggerDispatch] Dispatching workflow ${id} (action=${action}) for ${envelope.type}`);

  if (action === 'observe') {
    routeObserve(id, envelope, appHome, getConfig, getWindows).catch((err) => {
      console.error(`[TriggerDispatch] Observe error for ${id}:`, err);
      updateWorkflowStatus(id, 'failed', getWindows);
    });
  } else {
    routeAct(id, envelope, appHome, getConfig, getWindows).catch((err) => {
      console.error(`[TriggerDispatch] Act error for ${id}:`, err);
      updateWorkflowStatus(id, 'failed', getWindows);
    });
  }
}

// ── IPC handler registration ──────────────────────────────────────────────────

export function registerTriggerDispatchHandlers(
  ipcMain: IpcMain,
): void {
  ipcMain.handle('trigger-dispatch:active-workflows', () => {
    return [...activeWorkflows.values()];
  });

  ipcMain.handle('trigger-dispatch:workflow-status', (_e, id: string) => {
    return activeWorkflows.get(id) ?? null;
  });
}
