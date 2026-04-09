import { createHmac, randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';

const SETTINGS_COMPONENT = 'LegionSettings';
const PANEL_COMPONENT = 'LegionWorkspace';
const BACKEND_KEY = 'legion';
const BANNER_ID = 'legion-status';
const THREAD_STATUS_ID = 'legion-runtime-status';
const PROACTIVE_THREAD_ID = '__legion_proactive__';
const STATUS_POLL_MIN_MS = 15_000;
const STATUS_POLL_MAX_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const EVENT_RECONNECT_MIN_MS = 2_000;
const EVENT_RECONNECT_MAX_MS = 60_000;
const MAX_NOTIFICATIONS = 200;
const MAX_WORKFLOWS = 100;
const MAX_PROACTIVE_MESSAGES = 50;

const PANEL_DEFINITIONS = [
  {
    id: 'dashboard',
    navId: 'legion-dashboard',
    title: 'Mission Control',
    icon: 'gauge',
    priority: 20,
    width: 'full',
    view: 'dashboard',
  },
  {
    id: 'notifications',
    navId: 'legion-notifications',
    title: 'Notifications',
    icon: 'bell',
    priority: 21,
    width: 'wide',
    view: 'notifications',
  },
  {
    id: 'operations',
    navId: 'legion-operations',
    title: 'Operations',
    icon: 'terminal',
    priority: 22,
    width: 'wide',
    view: 'operations',
  },
  {
    id: 'knowledge',
    navId: 'legion-knowledge',
    title: 'Knowledge',
    icon: 'database',
    priority: 23,
    width: 'full',
    view: 'knowledge',
  },
  {
    id: 'github',
    navId: 'legion-github',
    title: 'GitHub',
    icon: 'git',
    priority: 24,
    width: 'full',
    view: 'github',
  },
  {
    id: 'marketplace',
    navId: 'legion-marketplace',
    title: 'Marketplace',
    icon: 'puzzle',
    priority: 25,
    width: 'full',
    view: 'marketplace',
  },
  {
    id: 'workflows',
    navId: 'legion-workflows',
    title: 'Workflows',
    icon: 'activity',
    priority: 26,
    width: 'full',
    view: 'workflows',
  },
];

const DEFAULTS = {
  enabled: true,
  daemonUrl: 'http://127.0.0.1:4567',
  configDir: '',
  apiKey: '',
  readyPath: '/api/ready',
  healthPath: '/api/health',
  streamPath: '/api/llm/inference',
  eventsPath: '/api/events',
  backendEnabled: true,
  daemonStreaming: true,
  notificationsEnabled: true,
  nativeNotifications: true,
  autoConnectEvents: true,
  openProactiveThread: false,
  healthPollMs: 60_000,
  eventsRecentCount: 50,
  sseReconnectMs: 5_000,
  workspaceThreadTitle: 'Legion Workspace',
  proactiveThreadTitle: 'GAIA Activity',
  bootstrapPrompt: 'Legion workspace ready. Use this thread for background coordination, backend-specific workflows, or plugin-triggered tasks.',
  proactivePromptPrefix: 'Proactive daemon activity',
  knowledgeRagEnabled: true,
  knowledgeCaptureEnabled: true,
  knowledgeScope: 'all',
  triggersEnabled: true,
  autoTriage: true,
  triageModel: '',
  maxConcurrentWorkflows: 3,
  triggerRules: [],
};

const TOAST_TYPES = new Set([
  'task.completed',
  'task.failed',
  'task.error',
  'worker.error',
  'worker.degraded',
  'worker.offline',
  'extension.error',
  'extension.installed',
  'extension.uninstalled',
  'gaia.phase_change',
  'gaia.alert',
  'mesh.peer_joined',
  'mesh.peer_lost',
  'governance.approval_required',
  'health.degraded',
  'health.recovered',
  'alert',
  'error',
  'proactive.message',
  'proactive.insight',
  'proactive.check_in',
  'trigger.needs_input',
  'trigger.resolved',
]);

const SEVERITY_MAP = {
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

const workflowStore = new Map();
const managedConversationIds = new Set();

let currentApi = null;
let statusPollTimer = null;
let backendRegistered = false;
let lastHealthStatus = 'unknown';
let eventsController = null;
let eventsReconnectTimer = null;
let zodToJsonSchemaModule = null;
let zodToJsonSchemaPromise = null;

export async function activate(api) {
  currentApi = api;
  api.log.info('Activating Legion plugin');

  registerUi(api);
  registerTools(api);
  registerActionHandlers(api);
  hydrateManagedConversations(api);
  hydrateWorkflowStore(api);
  await ensureProactiveConversation(api);

  await syncRuntime(api, { reason: 'activate', notify: false, recordHistory: false });
  await loadRecentEvents(api, { initial: true, count: getPluginConfig(api).eventsRecentCount });
  ensureEventStream(api);
  scheduleStatusPoll(api);

  api.config.onChanged(() => {
    scheduleStatusPoll(api);
    ensureEventStream(api);
    void syncRuntime(api, { reason: 'config-changed', notify: false, recordHistory: false });
  });
}

export async function deactivate() {
  clearStatusPoll();
  stopEventStream();

  if (backendRegistered && currentApi) {
    try {
      currentApi.agent.unregisterBackend(BACKEND_KEY);
    } catch {
      // Ignore unload-time cleanup failures.
    }
  }

  backendRegistered = false;
  currentApi = null;
}

function registerUi(api) {
  api.ui.registerSettingsSection({
    id: 'legion',
    label: 'Legion',
    component: SETTINGS_COMPONENT,
    priority: -4,
  });

  for (const panel of PANEL_DEFINITIONS) {
    api.ui.registerPanel({
      id: panel.id,
      component: PANEL_COMPONENT,
      title: panel.title,
      visible: true,
      width: panel.width,
      props: {
        view: panel.view,
      },
    });
  }

  api.ui.registerCommand({
    id: 'legion-command-center',
    label: 'Legion Command Center',
    shortcut: 'mod+k',
    visible: true,
    priority: 20,
    target: { type: 'panel', panelId: 'operations' },
  });

  updateNavigationItems(api, api.state.get() || {});
}

function registerTools(api) {
  api.tools.register([
    {
      name: 'refresh_status',
      description: 'Refresh Legion daemon health, dashboard state, workflows, and plugin status.',
      inputSchema: {
        type: 'object',
        properties: {
          notify: { type: 'boolean', default: false },
        },
      },
      execute: async ({ notify = false }) => {
        const state = await syncRuntime(api, {
          reason: 'tool-refresh',
          notify,
          recordHistory: true,
        });
        return { ok: true, state };
      },
    },
    {
      name: 'create_thread',
      description: 'Create a Legion-managed conversation, optionally opening it immediately.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          prompt: { type: 'string' },
          open: { type: 'boolean', default: true },
        },
      },
      execute: async ({ title, prompt, open = true }) => createManagedConversation(api, {
        title,
        prompt,
        open,
        kind: 'workspace',
      }),
    },
    {
      name: 'open_panel',
      description: 'Open a Legion control panel in Kai.',
      inputSchema: {
        type: 'object',
        properties: {
          panelId: {
            type: 'string',
            default: PANEL_DEFINITIONS[0].id,
          },
        },
      },
      execute: async ({ panelId = PANEL_DEFINITIONS[0].id }) => {
        api.navigation.open({ type: 'panel', panelId });
        return { ok: true, panelId };
      },
    },
    {
      name: 'execute_command',
      description: 'Send a natural language command to the Legion daemon router.',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      },
      execute: async ({ input }) => {
        const result = await executeDaemonCommand(api, input);
        return result;
      },
    },
    {
      name: 'knowledge_query',
      description: 'Query Legion knowledge / Apollo for relevant entries.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', default: 10 },
        },
        required: ['query'],
      },
      execute: async ({ query, limit = 10 }) => {
        return knowledgeQuery(api, query, limit);
      },
    },
  ]);
}

function registerActionHandlers(api) {
  const handleAction = async (action, data) => {
    switch (action) {
      case 'refresh-status':
        return syncRuntime(api, { reason: 'manual-refresh', notify: false, recordHistory: true });

      case 'refresh-dashboard':
        return refreshDashboardSnapshot(api, { persist: true });

      case 'run-doctor':
        return runDoctorChecks(api);

      case 'open-panel':
        api.navigation.open({
          type: 'panel',
          panelId: cleanText(data?.panelId) || PANEL_DEFINITIONS[0].id,
        });
        return { ok: true };

      case 'create-thread':
        return createManagedConversation(api, {
          title: data?.title,
          prompt: data?.prompt,
          open: data?.open !== false,
          kind: cleanText(data?.kind) || 'workspace',
        });

      case 'open-proactive-thread':
        return openProactiveConversation(api);

      case 'load-recent-events':
        return loadRecentEvents(api, {
          count: clampNumber(data?.count, 1, MAX_NOTIFICATIONS, getPluginConfig(api).eventsRecentCount),
        });

      case 'notification-mark-read':
        return setNotificationReadState(api, cleanText(data?.id), true);

      case 'notification-mark-all-read':
        return markAllNotificationsRead(api);

      case 'notification-clear':
        return clearNotifications(api);

      case 'execute-command':
        return executeDaemonCommand(api, cleanText(data?.input));

      case 'create-subagent':
        return createDaemonSubAgent(api, {
          message: cleanText(data?.message),
          model: cleanText(data?.model) || undefined,
          parentConversationId: cleanText(data?.parentConversationId) || undefined,
        });

      case 'refresh-workflows':
        return refreshWorkflowTasks(api);

      case 'open-external':
        if (!cleanText(data?.url)) {
          return { ok: false, error: 'A URL is required.' };
        }
        await api.shell.openExternal(String(data.url));
        return { ok: true };

      case 'daemon-call':
        return daemonAction(api, data);

      case 'knowledge-query':
        return knowledgeQuery(api, cleanText(data?.query), clampNumber(data?.limit, 1, 100, 10));

      case 'knowledge-browse':
        return knowledgeBrowse(api, data?.filters || {});

      case 'knowledge-ingest-content':
        return knowledgeIngestContent(api, cleanText(data?.content), data?.metadata || {});

      case 'knowledge-ingest-file':
        return knowledgeIngestFile(api, cleanText(data?.filePath));

      case 'knowledge-delete':
        return knowledgeDelete(api, cleanText(data?.id));

      case 'knowledge-monitors-list':
        return knowledgeMonitorsList(api);

      case 'knowledge-monitor-add':
        return knowledgeMonitorAdd(api, cleanText(data?.path));

      case 'knowledge-monitor-remove':
        return knowledgeMonitorRemove(api, cleanText(data?.id));

      case 'knowledge-monitor-scan':
        return knowledgeMonitorScan(api, cleanText(data?.id));

      case 'knowledge-health':
        return daemonJson(api, '/api/apollo/stats');

      case 'knowledge-status':
        return daemonJson(api, '/api/apollo/status');

      case 'knowledge-maintain':
        return daemonJson(api, '/api/apollo/maintenance', {
          method: 'POST',
          body: { action: 'decay_cycle' },
        });

      case 'absorber-resolve':
        return daemonJson(api, '/api/absorbers/resolve', {
          method: 'POST',
          body: { input: cleanText(data?.input) },
        });

      case 'absorber-dispatch':
        return daemonJson(api, '/api/absorbers/dispatch', {
          method: 'POST',
          body: {
            input: cleanText(data?.input),
            scope: cleanText(data?.scope) || undefined,
          },
        });

      case 'absorber-job':
        return daemonJson(api, `/api/absorbers/jobs/${encodeURIComponent(cleanText(data?.jobId))}`);

      default:
        api.log.warn('Unknown Legion action', action, data);
        return { ok: false, error: `Unknown action: ${action}` };
    }
  };

  api.onAction(`settings:${SETTINGS_COMPONENT}`, handleAction);
  for (const panel of PANEL_DEFINITIONS) {
    api.onAction(`panel:${panel.id}`, handleAction);
  }
}

function hydrateManagedConversations(api) {
  managedConversationIds.clear();
  const conversations = api.conversations.list();

  for (const conversation of conversations) {
    const metadata = conversation?.metadata || {};
    if (metadata.pluginName !== 'legion') continue;

    managedConversationIds.add(conversation.id);
    registerConversationDecoration(api, conversation.id, metadata.legionKind === 'proactive' ? 'GAIA' : 'Legion');
  }
}

function hydrateWorkflowStore(api) {
  workflowStore.clear();
  const state = api.state.get() || {};
  const workflows = Array.isArray(state.workflows) ? state.workflows : [];
  for (const workflow of workflows) {
    if (workflow && typeof workflow.id === 'string') {
      workflowStore.set(workflow.id, workflow);
    }
  }
}

function getPluginConfig(api) {
  const data = api.config.getPluginData() || {};
  return {
    ...DEFAULTS,
    ...data,
    enabled: data.enabled !== false,
    daemonUrl: cleanText(data.daemonUrl) || DEFAULTS.daemonUrl,
    configDir: typeof data.configDir === 'string' ? data.configDir.trim() : '',
    apiKey: typeof data.apiKey === 'string' ? data.apiKey : '',
    readyPath: cleanText(data.readyPath) || DEFAULTS.readyPath,
    healthPath: cleanText(data.healthPath) || DEFAULTS.healthPath,
    streamPath: cleanText(data.streamPath) || DEFAULTS.streamPath,
    eventsPath: cleanText(data.eventsPath) || DEFAULTS.eventsPath,
    backendEnabled: data.backendEnabled !== false,
    daemonStreaming: data.daemonStreaming !== false,
    notificationsEnabled: data.notificationsEnabled !== false,
    nativeNotifications: data.nativeNotifications !== false,
    autoConnectEvents: data.autoConnectEvents !== false,
    openProactiveThread: Boolean(data.openProactiveThread),
    healthPollMs: clampNumber(data.healthPollMs, STATUS_POLL_MIN_MS, STATUS_POLL_MAX_MS, DEFAULTS.healthPollMs),
    eventsRecentCount: clampNumber(data.eventsRecentCount, 1, MAX_NOTIFICATIONS, DEFAULTS.eventsRecentCount),
    sseReconnectMs: clampNumber(data.sseReconnectMs, EVENT_RECONNECT_MIN_MS, EVENT_RECONNECT_MAX_MS, DEFAULTS.sseReconnectMs),
    workspaceThreadTitle: cleanText(data.workspaceThreadTitle) || DEFAULTS.workspaceThreadTitle,
    proactiveThreadTitle: cleanText(data.proactiveThreadTitle) || DEFAULTS.proactiveThreadTitle,
    bootstrapPrompt: typeof data.bootstrapPrompt === 'string' ? data.bootstrapPrompt : DEFAULTS.bootstrapPrompt,
    proactivePromptPrefix: cleanText(data.proactivePromptPrefix) || DEFAULTS.proactivePromptPrefix,
    knowledgeRagEnabled: data.knowledgeRagEnabled !== false,
    knowledgeCaptureEnabled: data.knowledgeCaptureEnabled !== false,
    knowledgeScope: ['global', 'local', 'all'].includes(cleanText(data.knowledgeScope))
      ? cleanText(data.knowledgeScope)
      : DEFAULTS.knowledgeScope,
    triggersEnabled: data.triggersEnabled !== false,
    autoTriage: data.autoTriage !== false,
    triageModel: cleanText(data.triageModel),
    maxConcurrentWorkflows: clampNumber(data.maxConcurrentWorkflows, 1, 10, DEFAULTS.maxConcurrentWorkflows),
    triggerRules: Array.isArray(data.triggerRules) ? data.triggerRules.filter((rule) => rule && typeof rule === 'object') : [],
  };
}

function getResolvedConfigDir(config) {
  const candidates = [];
  if (cleanText(config.configDir)) candidates.push(cleanText(config.configDir));
  candidates.push(join(homedir(), '.kai', 'settings'));
  candidates.push(join(homedir(), '.legion', 'settings'));
  candidates.push(join(homedir(), '.config', 'legion', 'settings'));

  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function getCurrentState(api) {
  return api.state.get() || {};
}

function replaceState(api, nextState, options = {}) {
  const previous = getCurrentState(api);
  const next = {
    ...previous,
    ...nextState,
  };

  next.notifications = normalizeNotifications(next.notifications);
  next.unreadNotificationCount = next.notifications.filter((item) => !item.read).length;
  next.recentEvents = next.notifications.slice(0, 12).map((notification) => ({
    id: notification.id,
    timestamp: notification.timestamp,
    reason: notification.type,
    status: notification.severity,
    summary: notification.title,
  }));
  next.workflows = normalizeWorkflows(next.workflows);
  next.workflowCounts = summarizeWorkflows(next.workflows);
  next.proactiveMessages = normalizeProactiveMessages(next.proactiveMessages);
  next.managedConversationIds = [...new Set(Array.isArray(next.managedConversationIds) ? next.managedConversationIds : [])];
  next.backendRegistered = backendRegistered;
  next.backendKey = BACKEND_KEY;
  next.lastUpdatedAt = new Date().toISOString();

  api.state.replace(next);
  if (options.reason) {
    api.state.emitEvent('runtime-updated', {
      reason: options.reason,
      state: next,
    });
  }
  updateNavigationItems(api, next);
  return next;
}

function updateState(api, updater, options = {}) {
  const previous = getCurrentState(api);
  const next = updater(previous);
  return replaceState(api, next, options);
}

function normalizeNotifications(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const next = [];

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' && entry.id
      ? entry.id
      : `${entry.type || 'event'}-${entry.timestamp || Date.now()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({
      id,
      type: cleanText(entry.type) || 'event',
      severity: ['error', 'warn', 'success', 'info'].includes(cleanText(entry.severity)) ? cleanText(entry.severity) : 'info',
      title: cleanText(entry.title) || cleanText(entry.type) || 'Event',
      message: typeof entry.message === 'string' ? entry.message : '',
      source: cleanText(entry.source) || '',
      timestamp: cleanText(entry.timestamp) || new Date().toISOString(),
      read: Boolean(entry.read),
      raw: entry.raw ?? null,
    });
    if (next.length >= MAX_NOTIFICATIONS) break;
  }

  return next;
}

function normalizeWorkflows(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const next = [];

  for (const entry of items) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    next.push({
      id: entry.id,
      source: cleanText(entry.source) || 'unknown',
      eventType: cleanText(entry.eventType) || 'event',
      action: cleanText(entry.action) || 'observe',
      status: cleanText(entry.status) || 'pending',
      startedAt: cleanText(entry.startedAt) || new Date().toISOString(),
      updatedAt: cleanText(entry.updatedAt) || cleanText(entry.startedAt) || new Date().toISOString(),
      taskId: cleanText(entry.taskId) || '',
      payload: entry.payload ?? null,
      summary: cleanText(entry.summary),
      error: cleanText(entry.error),
    });
    if (next.length >= MAX_WORKFLOWS) break;
  }

  return next.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

function normalizeProactiveMessages(value) {
  const items = Array.isArray(value) ? value : [];
  const seen = new Set();
  const next = [];

  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' && entry.id
      ? entry.id
      : `${entry.timestamp || Date.now()}-${entry.intent || 'proactive'}`;
    if (seen.has(id)) continue;
    seen.add(id);
    next.push({
      id,
      intent: cleanText(entry.intent) || 'insight',
      content: typeof entry.content === 'string' ? entry.content : '',
      source: cleanText(entry.source) || 'daemon',
      timestamp: cleanText(entry.timestamp) || new Date().toISOString(),
      metadata: entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {},
    });
    if (next.length >= MAX_PROACTIVE_MESSAGES) break;
  }

  return next;
}

function summarizeWorkflows(workflows) {
  const summary = { total: 0, active: 0, needsInput: 0, failed: 0, resolved: 0 };
  for (const workflow of workflows) {
    summary.total += 1;
    if (workflow.status === 'pending' || workflow.status === 'running') summary.active += 1;
    if (workflow.status === 'needs-input') summary.needsInput += 1;
    if (workflow.status === 'failed') summary.failed += 1;
    if (workflow.status === 'resolved') summary.resolved += 1;
  }
  return summary;
}

function scheduleStatusPoll(api) {
  clearStatusPoll();
  const config = getPluginConfig(api);
  if (!config.enabled) return;

  statusPollTimer = setInterval(() => {
    void syncRuntime(api, {
      reason: 'poll',
      notify: false,
      recordHistory: false,
    });
  }, config.healthPollMs);
}

function clearStatusPoll() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
}

async function syncRuntime(api, options = {}) {
  const config = getPluginConfig(api);
  ensureBackendRegistration(api, config);

  if (!config.enabled) {
    stopEventStream();
    const state = replaceState(api, {
      status: 'disabled',
      configured: false,
      serviceUrl: config.daemonUrl,
      resolvedConfigDir: getResolvedConfigDir(config),
      authSource: resolveAuthSource(config),
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      dashboard: null,
      eventsConnected: false,
      managedConversationIds: [...managedConversationIds],
    }, options);
    updateBanner(api, config, state);
    updateThreadDecoration(api, state, config);
    return state;
  }

  if (!config.daemonUrl) {
    stopEventStream();
    const state = replaceState(api, {
      status: 'unconfigured',
      configured: false,
      serviceUrl: '',
      resolvedConfigDir: getResolvedConfigDir(config),
      authSource: resolveAuthSource(config),
      lastCheckedAt: new Date().toISOString(),
      lastError: 'Legion daemon URL is not configured.',
      dashboard: null,
      eventsConnected: false,
      managedConversationIds: [...managedConversationIds],
    }, options);
    updateBanner(api, config, state);
    updateThreadDecoration(api, state, config);
    return state;
  }

  replaceState(api, {
    status: 'checking',
    configured: true,
    serviceUrl: config.daemonUrl,
    resolvedConfigDir: getResolvedConfigDir(config),
    authSource: resolveAuthSource(config),
    managedConversationIds: [...managedConversationIds],
  }, {
    reason: options.reason,
    recordHistory: false,
  });

  const dashboardResult = await refreshDashboardSnapshot(api, { persist: false });
  const workflowsResult = await refreshWorkflowTasks(api, { quiet: true });
  const isOnline = Boolean(dashboardResult.ok && dashboardResult.snapshot && (dashboardResult.snapshot.readyOk || dashboardResult.snapshot.healthOk));

  const nextState = replaceState(api, {
    status: isOnline ? 'online' : 'offline',
    configured: true,
    serviceUrl: config.daemonUrl,
    resolvedConfigDir: getResolvedConfigDir(config),
    authSource: resolveAuthSource(config),
    lastCheckedAt: new Date().toISOString(),
    lastError: dashboardResult.ok ? null : dashboardResult.error,
    dashboard: dashboardResult.snapshot || null,
    managedConversationIds: [...managedConversationIds],
    workflowRefreshAt: workflowsResult.ok ? new Date().toISOString() : getCurrentState(api).workflowRefreshAt ?? null,
  }, options);

  if (
    options.notify !== false
    && config.notificationsEnabled
    && lastHealthStatus !== 'unknown'
    && lastHealthStatus !== nextState.status
  ) {
    api.notifications.show({
      id: `daemon-health-${Date.now()}`,
      title: nextState.status === 'online' ? 'Legion daemon is online' : 'Legion daemon is offline',
      body: nextState.status === 'online'
        ? 'The Legion daemon responded successfully.'
        : (nextState.lastError || 'The Legion daemon health check failed.'),
      level: nextState.status === 'online' ? 'success' : 'warning',
      native: config.nativeNotifications,
      autoDismissMs: 5_000,
      target: { type: 'panel', panelId: 'dashboard' },
    });
  }

  lastHealthStatus = nextState.status;
  updateBanner(api, config, nextState);
  updateThreadDecoration(api, nextState, config);
  ensureEventStream(api);
  return nextState;
}

function updateBanner(api, config, state) {
  if (!config.enabled) {
    api.ui.hideBanner(BANNER_ID);
    return;
  }

  if (state.status === 'unconfigured') {
    api.ui.showBanner({
      id: BANNER_ID,
      text: 'Legion is installed but not configured yet. Add the daemon URL and auth settings in Settings to enable health checks, events, and the optional backend.',
      variant: 'info',
      dismissible: true,
      visible: true,
    });
    return;
  }

  if (state.status === 'offline') {
    api.ui.showBanner({
      id: BANNER_ID,
      text: `Legion daemon is offline${state.lastError ? `: ${state.lastError}` : '.'}`,
      variant: 'warning',
      dismissible: true,
      visible: true,
    });
    return;
  }

  api.ui.hideBanner(BANNER_ID);
}

function updateThreadDecoration(api, state, config) {
  if (!config.enabled) {
    api.ui.hideThreadDecoration(THREAD_STATUS_ID);
    return;
  }

  let label = 'Legion status unknown';
  let variant = 'info';

  if (!config.backendEnabled) {
    label = 'Legion backend disabled';
    variant = 'warning';
  } else if (state.status === 'online') {
    label = 'Legion backend online';
    variant = 'success';
  } else if (state.status === 'offline') {
    label = 'Legion backend offline';
    variant = 'warning';
  } else if (state.status === 'checking') {
    label = 'Checking Legion backend';
  } else if (state.status === 'unconfigured') {
    label = 'Configure Legion to enable backend';
  }

  api.ui.showThreadDecoration({
    id: THREAD_STATUS_ID,
    label,
    variant,
    visible: true,
  });
}

function updateNavigationItems(api, state) {
  const unreadNotifications = Number(state.unreadNotificationCount || 0);
  const workflowCounts = state.workflowCounts || { active: 0, needsInput: 0 };

  for (const panel of PANEL_DEFINITIONS) {
    let badge = undefined;
    if (panel.id === 'notifications' && unreadNotifications > 0) {
      badge = unreadNotifications;
    }
    if (panel.id === 'workflows') {
      const activeCount = Number(workflowCounts.active || 0) + Number(workflowCounts.needsInput || 0);
      if (activeCount > 0) badge = activeCount;
    }

    api.ui.registerNavigationItem({
      id: panel.navId,
      label: panel.title,
      icon: panel.icon,
      visible: true,
      priority: panel.priority,
      badge,
      target: { type: 'panel', panelId: panel.id },
    });
  }
}

function registerConversationDecoration(api, conversationId, label = 'Legion') {
  api.ui.showConversationDecoration({
    id: `conversation:${conversationId}`,
    conversationId,
    label,
    variant: label === 'GAIA' ? 'success' : 'info',
    visible: true,
  });
}

async function createManagedConversation(api, options = {}) {
  const config = getPluginConfig(api);
  const kind = cleanText(options.kind) || 'workspace';
  const conversationId = kind === 'proactive' ? PROACTIVE_THREAD_ID : randomUUID();
  const now = new Date().toISOString();
  const title = cleanText(options.title) || (kind === 'proactive' ? config.proactiveThreadTitle : config.workspaceThreadTitle);
  const initialPrompt = cleanText(options.prompt) || (kind === 'proactive' ? `${config.proactivePromptPrefix}.` : config.bootstrapPrompt);
  const selectedBackendKey = kind === 'proactive' ? null : (config.backendEnabled ? BACKEND_KEY : null);

  const existing = api.conversations.get(conversationId);
  api.conversations.upsert({
    id: conversationId,
    title,
    fallbackTitle: title,
    messages: existing?.messages || [],
    messageTree: existing?.messageTree || [],
    headId: existing?.headId || null,
    conversationCompaction: null,
    lastContextUsage: null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastMessageAt: existing?.lastMessageAt || null,
    titleStatus: 'ready',
    titleUpdatedAt: now,
    messageCount: existing?.messageCount || 0,
    userMessageCount: existing?.userMessageCount || 0,
    runStatus: 'idle',
    hasUnread: existing?.hasUnread || false,
    lastAssistantUpdateAt: existing?.lastAssistantUpdateAt || null,
    selectedModelKey: existing?.selectedModelKey || null,
    selectedProfileKey: existing?.selectedProfileKey || null,
    fallbackEnabled: existing?.fallbackEnabled || false,
    profilePrimaryModelKey: existing?.profilePrimaryModelKey || null,
    currentWorkingDirectory: existing?.currentWorkingDirectory || null,
    selectedBackendKey,
    metadata: {
      ...(existing?.metadata || {}),
      pluginName: 'legion',
      source: 'legion-plugin',
      legionKind: kind,
      serviceUrl: config.daemonUrl || null,
    },
  });

  managedConversationIds.add(conversationId);
  registerConversationDecoration(api, conversationId, kind === 'proactive' ? 'GAIA' : 'Legion');

  if (initialPrompt && (!existing || (existing.messageCount || 0) === 0)) {
    api.conversations.appendMessage(conversationId, {
      role: 'assistant',
      content: [{ type: 'text', text: initialPrompt }],
      metadata: {
        pluginName: 'legion',
        kind: `${kind}-bootstrap`,
      },
      createdAt: now,
    });
  }

  if (options.open !== false) {
    api.conversations.setActive(conversationId);
  }

  const nextState = replaceState(api, {
    managedConversationIds: [...managedConversationIds],
    lastConversationId: conversationId,
    lastConversationTitle: title,
    proactiveConversationId: kind === 'proactive'
      ? conversationId
      : getCurrentState(api).proactiveConversationId ?? null,
  }, {
    reason: 'conversation-created',
    recordHistory: true,
  });

  api.state.emitEvent('conversation-created', {
    conversationId,
    title,
    selectedBackendKey,
    kind,
  });

  if (config.notificationsEnabled && kind !== 'proactive') {
    api.notifications.show({
      id: `conversation-${conversationId}`,
      title: 'Legion thread created',
      body: `${title}${selectedBackendKey ? ' using Legion backend' : ''}`,
      level: 'info',
      native: false,
      autoDismissMs: 4_000,
      target: { type: 'conversation', conversationId },
    });
  }

  return {
    ok: true,
    conversationId,
    title,
    selectedBackendKey,
    state: nextState,
  };
}

async function ensureProactiveConversation(api) {
  const existing = api.conversations.get(PROACTIVE_THREAD_ID);
  if (existing) {
    managedConversationIds.add(existing.id);
    registerConversationDecoration(api, existing.id, 'GAIA');
    replaceState(api, {
      proactiveConversationId: existing.id,
      managedConversationIds: [...managedConversationIds],
    });
    return existing.id;
  }

  const created = await createManagedConversation(api, {
    kind: 'proactive',
    open: false,
  });
  return created.conversationId;
}

async function openProactiveConversation(api) {
  const conversationId = await ensureProactiveConversation(api);
  api.conversations.setActive(conversationId);
  return { ok: true, conversationId };
}

async function appendProactiveMessage(api, proactiveMessage) {
  const conversationId = await ensureProactiveConversation(api);
  const conversation = api.conversations.get(conversationId);
  const messageTree = Array.isArray(conversation?.messageTree) ? conversation.messageTree : [];

  if (messageTree.some((entry) => entry?.metadata?.eventId === proactiveMessage.id)) {
    return { ok: true, duplicate: true, conversationId };
  }

  api.conversations.appendMessage(conversationId, {
    role: 'assistant',
    content: [{ type: 'text', text: proactiveMessage.content }],
    metadata: {
      pluginName: 'legion',
      legionKind: 'proactive',
      eventId: proactiveMessage.id,
      intent: proactiveMessage.intent,
      source: proactiveMessage.source,
      ...proactiveMessage.metadata,
    },
    createdAt: proactiveMessage.timestamp,
  });
  api.conversations.markUnread(conversationId, true);

  const state = updateState(api, (previous) => ({
    ...previous,
    proactiveConversationId: conversationId,
    proactiveMessages: [
      proactiveMessage,
      ...(Array.isArray(previous.proactiveMessages) ? previous.proactiveMessages : []),
    ],
  }), {
    reason: 'proactive-message',
    recordHistory: false,
  });

  const config = getPluginConfig(api);
  if (config.openProactiveThread) {
    api.navigation.open({ type: 'conversation', conversationId });
  }

  return { ok: true, conversationId, state };
}

async function refreshDashboardSnapshot(api, options = {}) {
  const config = getPluginConfig(api);
  const [
    readyResult,
    healthResult,
    tasksResult,
    workersResult,
    extensionsResult,
    gaiaResult,
    meteringResult,
    capabilitiesResult,
    githubStatusResult,
    knowledgeStatusResult,
  ] = await Promise.all([
    daemonJson(api, config.readyPath, { quiet: true }),
    daemonJson(api, config.healthPath, { quiet: true }),
    daemonJson(api, '/api/tasks', { quiet: true }),
    daemonJson(api, '/api/workers', { quiet: true }),
    daemonJson(api, '/api/extensions', { quiet: true }),
    daemonJson(api, '/api/gaia/status', { quiet: true }),
    daemonJson(api, '/api/metering', { quiet: true }),
    daemonJson(api, '/api/capabilities', { quiet: true }),
    daemonJson(api, '/api/github/status', { quiet: true }),
    daemonJson(api, '/api/apollo/status', { quiet: true }),
  ]);

  const snapshot = {
    updatedAt: new Date().toISOString(),
    readyOk: Boolean(readyResult.ok),
    healthOk: Boolean(healthResult.ok),
    ready: readyResult.data ?? null,
    health: healthResult.data ?? null,
    tasksSummary: summarizeTasks(tasksResult.data),
    workersSummary: summarizeWorkers(workersResult.data),
    extensionsCount: Array.isArray(extensionsResult.data) ? extensionsResult.data.length : 0,
    gaia: gaiaResult.data ?? null,
    metering: meteringResult.data ?? null,
    capabilities: extractCapabilities(capabilitiesResult.data),
    githubStatus: githubStatusResult.data ?? null,
    knowledgeStatus: knowledgeStatusResult.data ?? null,
  };

  const ok = snapshot.readyOk || snapshot.healthOk;
  const error = readyResult.error || healthResult.error || tasksResult.error || workersResult.error || null;

  if (options.persist !== false) {
    replaceState(api, { dashboard: snapshot });
  }

  return { ok, error, snapshot };
}

function summarizeTasks(data) {
  const items = Array.isArray(data) ? data : [];
  return {
    total: items.length,
    running: items.filter((item) => matchesAnyStatus(item?.status, ['running', 'active', 'queued'])).length,
    completed: items.filter((item) => matchesAnyStatus(item?.status, ['completed', 'done', 'resolved'])).length,
    failed: items.filter((item) => matchesAnyStatus(item?.status, ['failed', 'error'])).length,
  };
}

function summarizeWorkers(data) {
  const items = Array.isArray(data) ? data : [];
  return {
    total: items.length,
    healthy: items.filter((item) => matchesAnyStatus(item?.status, ['healthy', 'active', 'running'])).length,
    degraded: items.filter((item) => matchesAnyStatus(item?.status, ['degraded', 'unhealthy', 'warning'])).length,
  };
}

function extractCapabilities(data) {
  const items = Array.isArray(data)
    ? data
    : Array.isArray(data?.capabilities)
      ? data.capabilities
      : [];
  return items.slice(0, 20);
}

function matchesAnyStatus(status, expected) {
  const normalized = cleanText(status).toLowerCase();
  return expected.includes(normalized);
}

async function loadRecentEvents(api, options = {}) {
  const config = getPluginConfig(api);
  const count = clampNumber(options.count, 1, MAX_NOTIFICATIONS, config.eventsRecentCount);
  const result = await daemonJson(api, '/api/events/recent', {
    quiet: options.initial === true,
    query: { count: String(count) },
  });
  if (!result.ok) return result;

  const rawItems = Array.isArray(result.data)
    ? result.data
    : Array.isArray(result.data?.events)
      ? result.data.events
      : [];

  const incoming = rawItems.map((event) => ({
    ...classifyDaemonEvent(event),
    read: options.initial === true,
  }));

  const state = updateState(api, (previous) => ({
    ...previous,
    notifications: mergeNotifications(previous.notifications, incoming),
  }), {
    reason: options.initial === true ? 'events-hydrated' : 'events-refreshed',
    recordHistory: false,
  });

  return { ok: true, data: state.notifications };
}

function mergeNotifications(existingValue, incomingValue) {
  const combined = [
    ...(Array.isArray(incomingValue) ? incomingValue : []),
    ...(Array.isArray(existingValue) ? existingValue : []),
  ];
  return normalizeNotifications(combined);
}

function stopEventStream() {
  if (eventsReconnectTimer) {
    clearTimeout(eventsReconnectTimer);
    eventsReconnectTimer = null;
  }
  if (eventsController) {
    eventsController.abort();
    eventsController = null;
  }
}

function ensureEventStream(api) {
  const config = getPluginConfig(api);
  const state = getCurrentState(api);
  const shouldConnect = Boolean(config.enabled && config.autoConnectEvents && config.daemonUrl && state.status !== 'disabled' && state.status !== 'unconfigured');

  if (!shouldConnect) {
    stopEventStream();
    replaceState(api, { eventsConnected: false });
    return;
  }

  if (eventsController || eventsReconnectTimer) return;

  const controller = new AbortController();
  eventsController = controller;
  void connectEventStream(api, controller);
}

async function connectEventStream(api, controller) {
  const config = getPluginConfig(api);
  const url = joinUrl(config.daemonUrl, config.eventsPath);

  try {
    const response = await fetchWithTimeout(api, url, {
      method: 'GET',
      headers: buildDaemonHeaders(config, { accept: 'text/event-stream' }),
      signal: controller.signal,
    }, DEFAULT_TIMEOUT_MS);

    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }

    replaceState(api, {
      eventsConnected: true,
      eventsConnectedAt: new Date().toISOString(),
      eventsLastError: null,
    });

    await consumeServerSentEvents(api, response.body, controller.signal);
    if (!controller.signal.aborted) {
      throw new Error('Event stream ended.');
    }
  } catch (error) {
    if (controller.signal.aborted) return;

    const message = error instanceof Error ? error.message : String(error);
    replaceState(api, {
      eventsConnected: false,
      eventsLastError: message,
      eventsLastDisconnectedAt: new Date().toISOString(),
    });
    scheduleEventReconnect(api);
  } finally {
    if (eventsController === controller) {
      eventsController = null;
    }
  }
}

function scheduleEventReconnect(api) {
  if (eventsReconnectTimer) return;

  const delay = clampNumber(getPluginConfig(api).sseReconnectMs, EVENT_RECONNECT_MIN_MS, EVENT_RECONNECT_MAX_MS, DEFAULTS.sseReconnectMs);
  eventsReconnectTimer = setTimeout(() => {
    eventsReconnectTimer = null;
    ensureEventStream(api);
  }, delay);
}

async function consumeServerSentEvents(api, body, abortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines = [];

  const flush = async () => {
    const rawData = dataLines.join('\n').trim();
    const explicitEventName = eventName;
    eventName = '';
    dataLines = [];

    if (!rawData || rawData === '[DONE]') return;

    let payload = rawData;
    try {
      payload = JSON.parse(rawData);
    } catch {
      // Plain text SSE payloads are valid.
    }

    const normalized = normalizeDaemonSsePayload(explicitEventName, payload);
    for (const entry of normalized) {
      await onDaemonEvent(api, entry);
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, '');
        if (!trimmed) {
          await flush();
          continue;
        }
        if (trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('event:')) {
          eventName = trimmed.slice(6).trim();
          continue;
        }
        if (trimmed.startsWith('data:')) {
          dataLines.push(trimmed.slice(5).trimStart());
        }
      }
    }

    if (buffer.trim()) {
      const trailing = buffer.replace(/\r$/, '');
      if (trailing.startsWith('event:')) {
        eventName = trailing.slice(6).trim();
      } else if (trailing.startsWith('data:')) {
        dataLines.push(trailing.slice(5).trimStart());
      }
      await flush();
    }
  } finally {
    reader.releaseLock();
    if (!abortSignal.aborted) {
      replaceState(api, {
        eventsConnected: false,
        eventsLastDisconnectedAt: new Date().toISOString(),
      });
    }
  }
}

function normalizeDaemonSsePayload(eventName, payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object' && Array.isArray(payload.events)) {
    return payload.events;
  }
  if (payload && typeof payload === 'object') {
    return [{ ...(eventName ? { __eventName: eventName } : {}), ...payload }];
  }
  return [{ type: eventName || 'event', message: String(payload) }];
}

async function onDaemonEvent(api, rawEvent) {
  const notification = classifyDaemonEvent(rawEvent);

  updateState(api, (previous) => ({
    ...previous,
    notifications: mergeNotifications(previous.notifications, [notification]),
    eventsConnected: true,
    eventsLastEventAt: notification.timestamp,
  }), {
    reason: 'daemon-event',
    recordHistory: false,
  });

  const proactiveMessage = buildProactiveMessage(rawEvent, notification);
  if (proactiveMessage) {
    await appendProactiveMessage(api, proactiveMessage);
  }

  await maybeHandleTriggerEvent(api, rawEvent);

  const config = getPluginConfig(api);
  if (config.notificationsEnabled && (notification.severity === 'error' || TOAST_TYPES.has(notification.type))) {
    api.notifications.show({
      id: `event-${notification.id}`,
      title: notification.title,
      body: notification.message,
      level: toNotificationLevel(notification.severity),
      native: config.nativeNotifications,
      autoDismissMs: 6_000,
      target: proactiveMessage
        ? { type: 'conversation', conversationId: PROACTIVE_THREAD_ID }
        : { type: 'panel', panelId: 'notifications' },
    });
  }

  api.state.emitEvent('daemon-event', {
    event: rawEvent,
    notification,
  });
}

function classifyDaemonEvent(raw) {
  const event = raw && typeof raw === 'object' ? raw : {};
  const type = cleanText(event.type || event.event || event.kind || event.__eventName) || 'event';
  const severityHint = cleanText(event.severity || event.level || event.status).toLowerCase();
  const severity = SEVERITY_MAP[severityHint]
    || (type.includes('error') || type.includes('fail') ? 'error' : type.includes('warn') || type.includes('degrad') ? 'warn' : type.includes('success') || type.includes('complet') ? 'success' : 'info');

  return {
    id: cleanText(event.id) || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    severity,
    title: cleanText(event.title || event.summary) || type.replace(/[._]/g, ' '),
    message: typeof event.message === 'string'
      ? event.message
      : typeof event.description === 'string'
        ? event.description
        : typeof event.details === 'string'
          ? event.details
          : typeof event.content === 'string'
            ? event.content
            : '',
    source: cleanText(event.source || event.extension || event.worker_id) || '',
    timestamp: cleanText(event.timestamp || event.created_at) || new Date().toISOString(),
    read: false,
    raw,
  };
}

function buildProactiveMessage(rawEvent, notification) {
  const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};
  const eventType = cleanText(event.type || event.event || event.kind || event.__eventName);
  if (!eventType.startsWith('proactive.') && eventType !== 'gaia.proactive') {
    return null;
  }

  const content = cleanText(event.content || event.message || event.text || notification.message || notification.title);
  if (!content) return null;

  return {
    id: notification.id,
    intent: cleanText(event.intent || eventType) || 'insight',
    content,
    source: cleanText(event.source) || 'gaia',
    metadata: event.metadata && typeof event.metadata === 'object' ? event.metadata : {},
    timestamp: notification.timestamp,
  };
}

async function maybeHandleTriggerEvent(api, rawEvent) {
  const event = rawEvent && typeof rawEvent === 'object' ? rawEvent : {};
  const type = cleanText(event.type || event.event || event.kind || event.__eventName);
  if (!type.startsWith('trigger.')) return;

  const config = getPluginConfig(api);
  if (!config.triggersEnabled) return;

  const envelope = {
    type,
    source: cleanText(event.source) || 'unknown',
    eventType: cleanText(event.event_type) || type.replace(/^trigger\./, ''),
    payload: event.payload ?? event.data ?? {},
  };

  const action = triageEvent(envelope, config);
  if (action === 'ignore') return;

  const currentWorkflows = [...workflowStore.values()];
  const activeCount = currentWorkflows.filter((workflow) => workflow.status === 'pending' || workflow.status === 'running').length;
  if (activeCount >= config.maxConcurrentWorkflows) {
    return;
  }

  const workflow = {
    id: randomUUID(),
    source: envelope.source,
    eventType: envelope.eventType,
    action,
    status: 'pending',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payload: envelope.payload,
    summary: `${action} ${envelope.source}:${envelope.eventType}`,
    taskId: '',
    error: '',
  };

  persistWorkflow(api, workflow);

  if (action === 'observe') {
    await routeObservedTrigger(api, workflow, envelope);
    return;
  }

  await routeActionTrigger(api, workflow, envelope);
}

function triageEvent(envelope, config) {
  for (const rule of config.triggerRules) {
    if (!matchesGlob(cleanText(rule.source) || '*', envelope.source)) continue;
    if (!matchesGlob(cleanText(rule.eventType) || '*', envelope.eventType)) continue;
    if (cleanText(rule.filter)) {
      try {
        const regex = new RegExp(rule.filter);
        const serializedPayload = typeof envelope.payload === 'string' ? envelope.payload : JSON.stringify(envelope.payload);
        if (!regex.test(serializedPayload)) continue;
      } catch {
        continue;
      }
    }
    return cleanText(rule.action) || 'observe';
  }

  return config.autoTriage ? 'observe' : 'ignore';
}

function matchesGlob(pattern, value) {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

async function routeObservedTrigger(api, workflow, envelope) {
  const result = await daemonJson(api, '/api/gaia/buffer', {
    method: 'POST',
    body: {
      type: 'trigger_observation',
      source: envelope.source,
      event_type: envelope.eventType,
      payload: envelope.payload,
      observed_at: new Date().toISOString(),
    },
  });

  updateWorkflow(api, workflow.id, {
    status: result.ok ? 'resolved' : 'failed',
    updatedAt: new Date().toISOString(),
    error: result.ok ? '' : (result.error || 'Observation failed'),
  });
}

async function routeActionTrigger(api, workflow, envelope) {
  const config = getPluginConfig(api);
  const message = [
    'A trigger event has fired and requires action.',
    `Source: ${envelope.source}`,
    `Event type: ${envelope.eventType}`,
    `Payload:\n\`\`\`json\n${safeStringify(envelope.payload, 2)}\n\`\`\``,
    'Please assess the situation and take appropriate action.',
  ].join('\n');

  const result = await daemonJson(api, config.streamPath, {
    method: 'POST',
    body: {
      messages: [{ role: 'user', content: message }],
      ...(config.triageModel ? { model: config.triageModel } : {}),
      sub_agent: true,
    },
    timeoutMs: 30_000,
  });

  const taskId = cleanText(result.data?.id || result.data?.task_id);
  updateWorkflow(api, workflow.id, {
    status: result.ok ? 'running' : 'failed',
    updatedAt: new Date().toISOString(),
    taskId,
    error: result.ok ? '' : (result.error || 'Failed to create sub-agent workflow'),
  });
}

function persistWorkflow(api, workflow) {
  workflowStore.set(workflow.id, workflow);
  replaceState(api, {
    workflows: [...workflowStore.values()],
  }, {
    reason: 'workflow-updated',
    recordHistory: false,
  });
}

function updateWorkflow(api, workflowId, patch) {
  const existing = workflowStore.get(workflowId);
  if (!existing) return null;
  const next = {
    ...existing,
    ...patch,
  };
  workflowStore.set(workflowId, next);
  replaceState(api, {
    workflows: [...workflowStore.values()],
  }, {
    reason: 'workflow-updated',
    recordHistory: false,
  });
  return next;
}

async function refreshWorkflowTasks(api, options = {}) {
  const activeWorkflows = [...workflowStore.values()].filter((workflow) => workflow.taskId && ['pending', 'running', 'needs-input'].includes(workflow.status));
  if (activeWorkflows.length === 0) {
    if (!options.quiet) {
      replaceState(api, { workflows: [...workflowStore.values()] });
    }
    return { ok: true, data: [...workflowStore.values()] };
  }

  for (const workflow of activeWorkflows) {
    const taskResult = await daemonJson(api, `/api/tasks/${encodeURIComponent(workflow.taskId)}`, { quiet: true });
    if (!taskResult.ok) continue;

    const nextStatus = normalizeWorkflowStatus(taskResult.data);
    updateWorkflow(api, workflow.id, {
      status: nextStatus.status,
      updatedAt: new Date().toISOString(),
      summary: nextStatus.summary || workflow.summary,
      error: nextStatus.error || '',
    });
  }

  return { ok: true, data: [...workflowStore.values()] };
}

function normalizeWorkflowStatus(taskData) {
  const status = cleanText(taskData?.status).toLowerCase();
  if (['needs_input', 'awaiting_input', 'awaiting-response'].includes(status)) {
    return {
      status: 'needs-input',
      summary: cleanText(taskData?.message || taskData?.summary) || 'Awaiting input',
      error: '',
    };
  }
  if (['completed', 'done', 'resolved'].includes(status)) {
    return {
      status: 'resolved',
      summary: cleanText(taskData?.summary || taskData?.message) || 'Workflow resolved',
      error: '',
    };
  }
  if (['failed', 'error'].includes(status)) {
    return {
      status: 'failed',
      summary: cleanText(taskData?.summary || taskData?.message) || 'Workflow failed',
      error: cleanText(taskData?.error || taskData?.message),
    };
  }
  return {
    status: 'running',
    summary: cleanText(taskData?.summary || taskData?.message) || 'Workflow running',
    error: '',
  };
}

async function markAllNotificationsRead(api) {
  const state = replaceState(api, {
    notifications: normalizeNotifications(getCurrentState(api).notifications).map((notification) => ({
      ...notification,
      read: true,
    })),
  }, {
    reason: 'notifications-read',
    recordHistory: false,
  });
  return { ok: true, data: state.notifications };
}

async function clearNotifications(api) {
  const state = replaceState(api, {
    notifications: [],
  }, {
    reason: 'notifications-cleared',
    recordHistory: false,
  });
  return { ok: true, data: state.notifications };
}

async function setNotificationReadState(api, id, read) {
  if (!id) return { ok: false, error: 'Notification id is required.' };
  const state = replaceState(api, {
    notifications: normalizeNotifications(getCurrentState(api).notifications).map((notification) => (
      notification.id === id ? { ...notification, read } : notification
    )),
  }, {
    reason: 'notification-updated',
    recordHistory: false,
  });
  return { ok: true, data: state.notifications };
}

async function executeDaemonCommand(api, input) {
  if (!input) return { ok: false, error: 'Command text is required.' };
  const result = await daemonJson(api, '/api/do', {
    method: 'POST',
    body: { input },
  });

  replaceState(api, {
    lastCommandResult: {
      input,
      result: result.data ?? null,
      error: result.error || null,
      completedAt: new Date().toISOString(),
    },
  });

  return result;
}

async function createDaemonSubAgent(api, options) {
  if (!options.message) return { ok: false, error: 'A message is required.' };
  return daemonJson(api, '/api/llm/inference', {
    method: 'POST',
    body: {
      messages: [{ role: 'user', content: options.message }],
      ...(options.model ? { model: options.model } : {}),
      sub_agent: true,
      parent_id: options.parentConversationId || undefined,
    },
    timeoutMs: 30_000,
  });
}

async function runDoctorChecks(api) {
  const checks = [];

  const runCheck = async (name, task) => {
    const startedAt = Date.now();
    try {
      const result = await task();
      checks.push({
        name,
        status: result.ok ? 'pass' : 'warn',
        message: result.ok ? (result.message || 'OK') : (result.error || 'Failed'),
        duration: Date.now() - startedAt,
      });
    } catch (error) {
      checks.push({
        name,
        status: 'fail',
        message: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startedAt,
      });
    }
  };

  await runCheck('Daemon Reachable', async () => {
    const result = await daemonJson(api, getPluginConfig(api).readyPath, { quiet: true });
    return {
      ok: result.ok,
      message: result.ok ? 'Daemon is running and ready' : result.error,
    };
  });

  await runCheck('Health Status', async () => {
    const result = await daemonJson(api, getPluginConfig(api).healthPath, { quiet: true });
    return {
      ok: result.ok,
      message: result.ok ? 'Health check passed' : result.error,
    };
  });

  await runCheck('Extensions Loaded', async () => {
    const result = await daemonJson(api, '/api/catalog', { quiet: true });
    const count = Array.isArray(result.data) ? result.data.length : 0;
    return {
      ok: result.ok,
      message: result.ok ? `${count} extensions loaded` : result.error,
    };
  });

  await runCheck('Transport Connected', async () => {
    const result = await daemonJson(api, '/api/transport', { quiet: true });
    return {
      ok: result.ok,
      message: result.ok ? 'Transport layer connected' : result.error,
    };
  });

  await runCheck('Workers Available', async () => {
    const result = await daemonJson(api, '/api/workers', { quiet: true });
    const count = Array.isArray(result.data) ? result.data.length : 0;
    return {
      ok: result.ok,
      message: result.ok ? `${count} workers registered` : result.error,
    };
  });

  await runCheck('Schedules Active', async () => {
    const result = await daemonJson(api, '/api/schedules', { quiet: true });
    const count = Array.isArray(result.data) ? result.data.length : 0;
    return {
      ok: result.ok,
      message: result.ok ? `${count} schedules configured` : result.error,
    };
  });

  await runCheck('Audit Chain', async () => {
    const result = await daemonJson(api, '/api/audit/verify', { quiet: true });
    const valid = Boolean(result.data?.valid);
    return {
      ok: result.ok && valid,
      message: result.ok ? (valid ? 'Audit hash chain is valid' : 'Audit chain verification returned invalid') : result.error,
    };
  });

  replaceState(api, {
    doctorResults: checks,
    doctorCheckedAt: new Date().toISOString(),
  });

  return { ok: true, data: checks };
}

async function daemonAction(api, data) {
  const path = cleanText(data?.path);
  if (!path) return { ok: false, error: 'A daemon path is required.' };

  const result = await daemonJson(api, path, {
    method: cleanText(data?.method).toUpperCase() || 'GET',
    query: data?.query && typeof data.query === 'object' ? data.query : undefined,
    body: data?.body,
    fallbackPath: cleanText(data?.fallbackPath) || undefined,
    timeoutMs: clampNumber(data?.timeoutMs, 1_000, 120_000, DEFAULT_TIMEOUT_MS),
    expectText: Boolean(data?.expectText),
    quiet: Boolean(data?.quiet),
  });

  if (result.ok && data?.refreshRuntime) {
    void syncRuntime(api, { reason: 'daemon-call-refresh', notify: false, recordHistory: false });
  }
  return result;
}

async function knowledgeQuery(api, query, limit = 10) {
  if (!query) return { ok: false, error: 'A knowledge query is required.' };
  return daemonJson(api, '/api/apollo/query', {
    method: 'POST',
    body: {
      query,
      limit,
      agent_id: 'kai-legion-plugin',
    },
    timeoutMs: 30_000,
  });
}

async function knowledgeBrowse(api, filters = {}) {
  const body = {
    query: cleanText(filters.tag || filters.source) || '*',
    limit: clampNumber(filters.per_page, 1, 200, 50),
    agent_id: 'kai-legion-plugin',
  };
  if (cleanText(filters.tag)) body.tags = [cleanText(filters.tag)];
  return daemonJson(api, '/api/apollo/query', {
    method: 'POST',
    body,
    timeoutMs: 30_000,
  });
}

async function knowledgeDelete(api, id) {
  if (!id) return { ok: false, error: 'An entry id is required.' };
  return daemonJson(api, `/api/apollo/entries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

async function knowledgeIngestContent(api, content, metadata = {}) {
  if (!content) return { ok: false, error: 'Knowledge content is required.' };
  return daemonJson(api, '/api/apollo/ingest', {
    method: 'POST',
    body: {
      content,
      ...(metadata && typeof metadata === 'object' ? metadata : {}),
    },
    timeoutMs: 30_000,
  });
}

async function knowledgeIngestFile(api, filePath) {
  if (!filePath) return { ok: false, error: 'A file path is required.' };
  const extension = filePath.split('.').pop()?.toLowerCase() || '';
  const binaryTypes = ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'zip', 'gz', 'tar', 'png', 'jpg', 'jpeg', 'gif', 'webp'];
  if (binaryTypes.includes(extension)) {
    return { ok: false, error: `Binary file type .${extension} requires daemon-side extraction. Use the absorber pipeline for this file type.` };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return daemonJson(api, '/api/apollo/ingest', {
      method: 'POST',
      body: {
        content,
        source_channel: 'desktop',
        source_agent: 'kai-legion-plugin',
        source_provider: filePath.split('/').pop() || filePath,
        tags: ['uploaded-file'],
      },
      timeoutMs: 30_000,
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function knowledgeMonitorsList(api) {
  return daemonJson(api, '/api/extensions/knowledge/runners/monitors/list', {
    fallbackPath: '/api/lex/knowledge/monitors',
  });
}

async function knowledgeMonitorAdd(api, path) {
  if (!path) return { ok: false, error: 'A monitor path is required.' };
  return daemonJson(api, '/api/extensions/knowledge/runners/monitors/create', {
    method: 'POST',
    body: { path },
    fallbackPath: '/api/lex/knowledge/monitors',
  });
}

async function knowledgeMonitorRemove(api, id) {
  if (!id) return { ok: false, error: 'A monitor id is required.' };
  return daemonJson(api, `/api/extensions/knowledge/runners/monitors/delete?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    fallbackPath: `/api/lex/knowledge/monitors/${encodeURIComponent(id)}`,
  });
}

async function knowledgeMonitorScan(api, id) {
  if (!id) return { ok: false, error: 'A monitor id is required.' };
  return daemonJson(api, `/api/extensions/knowledge/runners/monitors/scan?id=${encodeURIComponent(id)}`, {
    method: 'POST',
    body: {},
    fallbackPath: `/api/lex/knowledge/monitors/${encodeURIComponent(id)}/scan`,
  });
}

function ensureBackendRegistration(api, config) {
  const shouldRegister = Boolean(config.enabled && config.backendEnabled && config.daemonUrl);
  if (shouldRegister && !backendRegistered) {
    api.agent.registerBackend({
      key: BACKEND_KEY,
      displayName: 'Legion',
      isAvailable: () => {
        const currentConfig = getPluginConfig(api);
        return Boolean(currentConfig.enabled && currentConfig.backendEnabled && currentConfig.daemonUrl);
      },
      stream: async function* (options) {
        yield* streamFromDaemon(api, options);
      },
    });
    backendRegistered = true;
    api.state.emitEvent('backend-registered', { key: BACKEND_KEY });
    return;
  }

  if (!shouldRegister && backendRegistered) {
    api.agent.unregisterBackend(BACKEND_KEY);
    backendRegistered = false;
    api.state.emitEvent('backend-unregistered', { key: BACKEND_KEY });
  }
}

async function* streamFromDaemon(api, options) {
  const config = getPluginConfig(api);
  if (!config.daemonUrl) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: 'Legion daemon URL is not configured.',
    };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  const readyResult = await daemonJson(api, config.readyPath, {
    quiet: true,
    signal: options.abortSignal,
  });
  if (!readyResult.ok) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: `Legion daemon is not ready at ${config.daemonUrl}: ${readyResult.error || 'unknown error'}`,
    };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  const normalizedMessages = normalizeMessages(options.messages);
  if (!normalizedMessages.some((message) => message.role === 'user')) {
    yield {
      conversationId: options.conversationId,
      type: 'error',
      error: 'No user message was provided to the Legion backend.',
    };
    yield { conversationId: options.conversationId, type: 'done' };
    return;
  }

  const requestBody = {
    messages: normalizedMessages,
    ...(options.tools?.length ? {
      tools: await Promise.all(options.tools.map(async (tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: await zodSchemaToJson(tool.inputSchema),
      }))),
    } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.conversationId ? { conversation_id: options.conversationId } : {}),
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
    rag_enabled: config.knowledgeRagEnabled,
    capture_enabled: config.knowledgeCaptureEnabled,
    knowledge_scope: config.knowledgeScope,
  };

  if (config.daemonStreaming !== false) {
    let response;
    try {
      response = await fetchWithTimeout(api, joinUrl(config.daemonUrl, config.streamPath), {
        method: 'POST',
        headers: buildDaemonHeaders(config, {
          accept: 'text/event-stream',
          'content-type': 'application/json',
        }),
        body: JSON.stringify({ ...requestBody, stream: true }),
        signal: options.abortSignal,
      }, 60_000);
    } catch (error) {
      yield {
        conversationId: options.conversationId,
        type: 'error',
        error: `Legion daemon streaming request failed: ${error instanceof Error ? error.message : String(error)}`,
      };
      yield { conversationId: options.conversationId, type: 'done' };
      return;
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (response.ok && contentType.includes('text/event-stream') && response.body) {
      yield* consumeDaemonInferenceSse(options.conversationId, response.body, options.abortSignal);
      return;
    }

    yield* handleDaemonSyncResponse(api, options.conversationId, response, options.abortSignal);
    return;
  }

  const response = await fetchWithTimeout(api, joinUrl(config.daemonUrl, config.streamPath), {
    method: 'POST',
    headers: buildDaemonHeaders(config, {
      'content-type': 'application/json',
      'x-kai-sync': 'true',
    }),
    body: JSON.stringify(requestBody),
    signal: options.abortSignal,
  }, 60_000);

  yield* handleDaemonSyncResponse(api, options.conversationId, response, options.abortSignal);
}

async function loadZodToJsonSchema() {
  if (zodToJsonSchemaModule) return zodToJsonSchemaModule;
  if (zodToJsonSchemaPromise) return zodToJsonSchemaPromise;

  const candidatePaths = [
    join(process.cwd(), 'node_modules', 'zod-to-json-schema', 'dist/esm/index.js'),
    process.resourcesPath
      ? join(process.resourcesPath, 'app.asar', 'node_modules', 'zod-to-json-schema', 'dist/esm/index.js')
      : '',
    process.resourcesPath
      ? join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'zod-to-json-schema', 'dist/esm/index.js')
      : '',
    process.resourcesPath
      ? join(process.resourcesPath, 'node_modules', 'zod-to-json-schema', 'dist/esm/index.js')
      : '',
  ].filter(Boolean);

  zodToJsonSchemaPromise = (async () => {
    for (const candidatePath of candidatePaths) {
      if (!existsSync(candidatePath)) continue;
      try {
        const module = await import(pathToFileURL(candidatePath).href);
        zodToJsonSchemaModule = module.default || module;
        return zodToJsonSchemaModule;
      } catch {
        // Try the next candidate path.
      }
    }
    return null;
  })().finally(() => {
    zodToJsonSchemaPromise = null;
  });

  return zodToJsonSchemaPromise;
}

async function zodSchemaToJson(schema) {
  if (!schema || typeof schema !== 'object') return {};
  if (typeof schema.safeParse === 'function') {
    try {
      const converter = await loadZodToJsonSchema();
      if (typeof converter !== 'function') return {};
      return converter(schema, {
        $refStrategy: 'none',
        target: 'jsonSchema7',
      });
    } catch {
      return {};
    }
  }
  return schema;
}

function normalizeMessages(messages) {
  const items = Array.isArray(messages) ? messages : [];
  return items
    .map((message) => {
      if (!message || typeof message !== 'object') return null;
      const role = message.role === 'assistant' ? 'assistant' : message.role === 'user' ? 'user' : '';
      if (!role) return null;
      const text = extractMessageText(message.content);
      if (!text) return null;
      return { role, content: [{ type: 'text', text }] };
    })
    .filter(Boolean);
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    if (!part || typeof part !== 'object') return '';
    switch (part.type) {
      case 'text':
        return part.text || '';
      case 'image':
        return '[Image]';
      case 'file':
        return part.filename ? `[File: ${part.filename}]` : '[File]';
      case 'tool-call': {
        const lines = [`[Tool call: ${part.toolName || 'unknown'}]`];
        if (part.args !== undefined) lines.push(`Args: ${stringifyValue(part.args, 1_000)}`);
        if (part.result !== undefined) lines.push(`Result: ${stringifyValue(part.result, 1_500)}`);
        return lines.join('\n');
      }
      default:
        return '';
    }
  }).filter(Boolean).join('\n').trim();
}

function stringifyValue(value, maxLength = 2_000) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof text !== 'string') return String(value);
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  } catch {
    return String(value);
  }
}

async function* consumeDaemonInferenceSse(conversationId, body, abortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let emittedAny = false;
  let currentEventName = '';
  let currentDataLines = [];

  const flush = async () => {
    if (!currentEventName && currentDataLines.length === 0) return [];
    const rawData = currentDataLines.join('\n').trim();
    const explicitEventName = currentEventName;
    currentEventName = '';
    currentDataLines = [];
    if (!rawData || rawData === '[DONE]') return [];

    let payload;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return [{ conversationId, type: 'text-delta', text: rawData }];
    }

    return normalizeInferenceEvent(explicitEventName, payload, conversationId);
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.replace(/\r$/, '');
        if (!trimmed) {
          const events = await flush();
          for (const event of events) {
            emittedAny = true;
            yield event;
          }
          continue;
        }
        if (trimmed.startsWith(':')) continue;
        if (trimmed.startsWith('event:')) {
          currentEventName = trimmed.slice(6).trim();
          continue;
        }
        if (trimmed.startsWith('data:')) {
          currentDataLines.push(trimmed.slice(5).trimStart());
        }
      }
    }

    if (buffer.trim()) {
      const trailing = buffer.replace(/\r$/, '');
      if (trailing.startsWith('event:')) currentEventName = trailing.slice(6).trim();
      if (trailing.startsWith('data:')) currentDataLines.push(trailing.slice(5).trimStart());
    }

    const trailingEvents = await flush();
    for (const event of trailingEvents) {
      emittedAny = true;
      yield event;
    }
  } catch (error) {
    if (!abortSignal?.aborted) {
      yield {
        conversationId,
        type: 'error',
        error: `SSE stream error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } finally {
    reader.releaseLock();
  }

  if (!emittedAny && !abortSignal?.aborted) {
    yield {
      conversationId,
      type: 'error',
      error: 'Legion daemon SSE stream ended without producing any output.',
    };
  }
  yield { conversationId, type: 'done' };
}

function normalizeInferenceEvent(eventName, payload, conversationId) {
  const normalizedName = normalizeDaemonEventName(eventName, payload);
  if (!normalizedName) return [];

  if (['text-delta', 'text_delta', 'delta'].includes(normalizedName)) {
    const text = payload.text || payload.delta || '';
    return text ? [{ conversationId, type: 'text-delta', text }] : [];
  }

  if (['tool-call', 'tool_call'].includes(normalizedName)) {
    return [{
      conversationId,
      type: 'tool-call',
      toolCallId: payload.toolCallId || payload.tool_call_id,
      toolName: payload.toolName || payload.tool_name,
      args: payload.args || payload.parameters || {},
      startedAt: toIsoTimestamp(payload.startedAt || payload.started_at || payload.timestamp) || new Date().toISOString(),
      messageMeta: extractMessageMeta(payload),
    }];
  }

  if (['tool-result', 'tool_result'].includes(normalizedName)) {
    return [{
      conversationId,
      type: 'tool-result',
      toolCallId: payload.toolCallId || payload.tool_call_id,
      toolName: payload.toolName || payload.tool_name,
      result: payload.result ?? payload.content,
      startedAt: toIsoTimestamp(payload.startedAt || payload.started_at) || undefined,
      finishedAt: toIsoTimestamp(payload.finishedAt || payload.finished_at || payload.timestamp) || new Date().toISOString(),
      durationMs: numberOrUndefined(payload.durationMs ?? payload.duration_ms),
      messageMeta: extractMessageMeta(payload),
    }];
  }

  if (['tool-error', 'tool_error'].includes(normalizedName)) {
    return [{
      conversationId,
      type: 'tool-result',
      toolCallId: payload.toolCallId || payload.tool_call_id,
      toolName: payload.toolName || payload.tool_name,
      result: { isError: true, error: payload.error || payload.message || 'Tool execution failed' },
      startedAt: toIsoTimestamp(payload.startedAt || payload.started_at) || undefined,
      finishedAt: toIsoTimestamp(payload.finishedAt || payload.finished_at || payload.timestamp) || new Date().toISOString(),
      messageMeta: extractMessageMeta(payload),
    }];
  }

  if (['tool-progress', 'tool_progress'].includes(normalizedName)) {
    return [{
      conversationId,
      type: 'tool-progress',
      toolCallId: payload.toolCallId || payload.tool_call_id,
      toolName: payload.toolName || payload.tool_name,
      data: payload,
      messageMeta: extractMessageMeta(payload),
    }];
  }

  if (normalizedName === 'error') {
    return [{
      conversationId,
      type: 'error',
      error: payload.error || payload.message || 'Daemon stream error',
    }];
  }

  if (['enrichment', 'enrichments'].includes(normalizedName)) {
    return [{ conversationId, type: 'enrichment', data: payload }];
  }

  if (normalizedName === 'done') {
    const events = [];
    const enrichments = payload.enrichments || payload.pipeline_enrichments;
    if (enrichments && typeof enrichments === 'object' && !Array.isArray(enrichments)) {
      events.push({ conversationId, type: 'enrichment', data: enrichments });
    }
    const inputTokens = numberOrUndefined(payload.input_tokens ?? payload.inputTokens);
    const outputTokens = numberOrUndefined(payload.output_tokens ?? payload.outputTokens);
    const cacheReadTokens = numberOrUndefined(payload.cache_read_tokens ?? payload.cacheReadTokens);
    const cacheWriteTokens = numberOrUndefined(payload.cache_write_tokens ?? payload.cacheWriteTokens);
    if (inputTokens !== undefined || outputTokens !== undefined) {
      events.push({
        conversationId,
        type: 'context-usage',
        data: {
          inputTokens: inputTokens ?? 0,
          outputTokens: outputTokens ?? 0,
          cacheReadTokens: cacheReadTokens ?? 0,
          cacheWriteTokens: cacheWriteTokens ?? 0,
          totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
        },
      });
    }
    events.push({ conversationId, type: 'done', data: payload });
    return events;
  }

  if (['context_usage', 'context-usage'].includes(normalizedName)) {
    return [{ conversationId, type: 'context-usage', data: payload }];
  }

  if (['model-fallback', 'model_fallback'].includes(normalizedName)) {
    return [{ conversationId, type: 'model-fallback', data: payload }];
  }

  if (
    normalizedName === 'conversation_compaction'
    || normalizedName === 'compaction_start'
    || normalizedName === 'compaction_complete'
    || normalizedName === 'compaction_error'
    || normalizedName === 'memory_processor_start'
    || normalizedName === 'memory_processor_complete'
    || normalizedName === 'memory_processor_error'
  ) {
    return [{ conversationId, type: 'compaction', data: { event: normalizedName, ...payload } }];
  }

  if (typeof payload.response === 'string') {
    return [{
      conversationId,
      type: 'text-delta',
      text: payload.response,
      messageMeta: extractMessageMeta(payload),
    }];
  }

  return [];
}

function normalizeDaemonEventName(eventName, payload) {
  if (cleanText(eventName)) return cleanText(eventName);
  return cleanText(payload.type);
}

function extractMessageMeta(payload) {
  const messageMeta = {};
  if (payload.parent_id != null) messageMeta.parentId = payload.parent_id;
  if (payload.sidechain != null) messageMeta.sidechain = payload.sidechain;
  if (payload.message_group_id != null) messageMeta.messageGroupId = payload.message_group_id;
  if (payload.agent_id != null) messageMeta.agentId = payload.agent_id;
  return Object.keys(messageMeta).length > 0 ? messageMeta : undefined;
}

async function* handleDaemonSyncResponse(api, conversationId, response, abortSignal) {
  const body = await parseResponseBody(response);

  if (response.status === 202) {
    const taskId = cleanText(body?.task_id || body?.data?.task_id || body?.id);
    if (taskId) {
      yield* pollDaemonTask(api, conversationId, taskId, abortSignal);
      return;
    }
    yield {
      conversationId,
      type: 'error',
      error: 'Legion daemon accepted the request asynchronously but returned no task id for polling.',
    };
    yield { conversationId, type: 'done' };
    return;
  }

  if (!response.ok) {
    yield {
      conversationId,
      type: 'error',
      error: extractErrorMessage(body)
        || (response.status === 401 || response.status === 403
          ? 'Legion daemon rejected the desktop request. Make sure daemon auth is configured or the cluster secret is readable from your config dir.'
          : `Legion daemon request failed with HTTP ${response.status}.`),
    };
    yield { conversationId, type: 'done' };
    return;
  }

  const text = typeof body?.data?.content === 'string'
    ? body.data.content
    : typeof body?.data?.response === 'string'
      ? body.data.response
      : typeof body?.response === 'string'
        ? body.response
        : '';

  if (text) {
    yield { conversationId, type: 'text-delta', text };
  } else {
    yield {
      conversationId,
      type: 'error',
      error: 'Legion daemon returned an unexpected response payload.',
    };
  }

  yield { conversationId, type: 'done' };
}

async function* pollDaemonTask(api, conversationId, taskId, abortSignal) {
  const maxAttempts = 120;
  let attempt = 0;

  yield {
    conversationId,
    type: 'text-delta',
    text: '_Waiting for Legion daemon to process request..._\n\n',
  };

  while (attempt < maxAttempts) {
    if (abortSignal?.aborted) {
      yield { conversationId, type: 'done' };
      return;
    }

    await sleep(1_000);
    attempt += 1;

    const response = await daemonJson(api, `/api/tasks/${encodeURIComponent(taskId)}`, {
      quiet: true,
      signal: abortSignal,
    });
    if (!response.ok) continue;

    const status = cleanText(response.data?.status).toLowerCase();
    if (['completed', 'done', 'resolved'].includes(status)) {
      const responseText = response.data?.result?.response;
      if (typeof responseText === 'string' && responseText) {
        yield { conversationId, type: 'text-delta', text: responseText };
      }
      yield { conversationId, type: 'done' };
      return;
    }

    if (['failed', 'error'].includes(status)) {
      yield {
        conversationId,
        type: 'error',
        error: response.data?.error || `Legion daemon task ${taskId} failed.`,
      };
      yield { conversationId, type: 'done' };
      return;
    }
  }

  yield {
    conversationId,
    type: 'error',
    error: `Legion daemon task ${taskId} did not complete within ${maxAttempts} seconds.`,
  };
  yield { conversationId, type: 'done' };
}

async function daemonJson(api, path, options = {}) {
  const config = getPluginConfig(api);
  return daemonRequest(api, config, path, options);
}

async function daemonRequest(api, config, path, options = {}) {
  const primaryPath = path;
  const method = cleanText(options.method).toUpperCase() || 'GET';
  const accept = options.expectText ? 'application/json, text/plain' : 'application/json';

  let response = await daemonRequestOnce(api, config, primaryPath, {
    ...options,
    method,
    accept,
  });

  if (!response.ok && response.status === 404 && cleanText(options.fallbackPath)) {
    response = await daemonRequestOnce(api, config, options.fallbackPath, {
      ...options,
      method,
      accept,
      fallbackPath: undefined,
    });
  }

  if (!response.ok && !options.quiet) {
    replaceState(api, {
      lastError: response.error || `Request failed for ${primaryPath}`,
    });
  }

  return response;
}

async function daemonRequestOnce(api, config, path, options = {}) {
  const url = new URL(joinUrl(config.daemonUrl, path));
  const query = options.query && typeof options.query === 'object' ? options.query : {};
  for (const [key, value] of Object.entries(query)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }

  const init = {
    method: options.method || 'GET',
    headers: buildDaemonHeaders(config, {
      accept: options.accept || 'application/json',
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.headers && typeof options.headers === 'object' ? options.headers : {}),
    }),
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  };

  try {
    const response = await fetchWithTimeout(api, url.toString(), init, clampNumber(options.timeoutMs, 1_000, 120_000, DEFAULT_TIMEOUT_MS));
    const data = await parseResponseBody(response, options.expectText);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: extractErrorMessage(data) || `HTTP ${response.status}`,
        data,
      };
    }

    return {
      ok: true,
      status: response.status,
      data: unwrapResultData(data),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
      data: null,
    };
  }
}

function buildDaemonHeaders(config, extraHeaders = {}) {
  const headers = {
    ...extraHeaders,
  };
  const token = resolveAuthToken(config);
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function resolveAuthSource(config) {
  if (cleanText(config.apiKey)) return 'api-key';
  return resolveAuthToken(config) ? 'crypt.json' : 'none';
}

function resolveAuthToken(config) {
  if (cleanText(config.apiKey)) return cleanText(config.apiKey);

  const configDir = getResolvedConfigDir(config);
  const cryptPath = join(configDir, 'crypt.json');
  if (!existsSync(cryptPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(cryptPath, 'utf-8'));
    const secret = cleanText(raw?.crypt?.cluster_secret);
    if (!secret) return null;

    const now = Math.floor(Date.now() / 1_000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: process.env.USER || process.env.USERNAME || 'kai',
      name: 'Kai Legion Plugin',
      roles: ['desktop'],
      scope: 'human',
      iss: 'kai-plugin',
      iat: now,
      exp: now + 3_600,
      jti: randomUUID(),
    })).toString('base64url');
    const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
    return `${header}.${payload}.${signature}`;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(api, url, init, timeoutMs) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const signal = mergeAbortSignals(init.signal, timeoutController.signal);
    return await api.fetch(url, {
      ...init,
      signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function mergeAbortSignals(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const controller = new AbortController();
  const abort = () => controller.abort();

  if (primary.aborted || secondary.aborted) {
    controller.abort();
    return controller.signal;
  }

  primary.addEventListener('abort', abort, { once: true });
  secondary.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

function joinUrl(baseUrl, relativePath) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = String(relativePath || '').startsWith('/')
    ? String(relativePath || '')
    : `/${String(relativePath || '')}`;
  return `${normalizedBase}${normalizedPath}`;
}

async function parseResponseBody(response, expectText = false) {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (expectText && !contentType.includes('application/json')) {
    return response.text();
  }

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapResultData(data) {
  if (data && typeof data === 'object' && 'data' in data) {
    return data.data;
  }
  return data;
}

function extractErrorMessage(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error === 'object' && typeof payload.error.message === 'string') {
    return payload.error.message;
  }
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.text === 'string') return payload.text;
  return null;
}

function toNotificationLevel(severity) {
  return severity === 'warn' ? 'warning' : severity;
}

function toIsoTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return new Date(numeric).toISOString();
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return undefined;
}

function numberOrUndefined(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeStringify(value, spacing = 0) {
  try {
    return JSON.stringify(value, null, spacing);
  } catch {
    return String(value);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
