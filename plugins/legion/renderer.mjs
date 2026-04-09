/** @param {{ React: typeof import('react'), registerComponents: (name: string, components: Record<string, any>) => void }} api */
export function register(api) {
  const { React, registerComponents } = api;
  const h = React.createElement;
  const { useEffect, useMemo, useState } = React;

  function getBridge() {
    return window.app ?? null;
  }

  function cx(...parts) {
    return parts.filter(Boolean).join(' ');
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  function parseJson(text, fallback) {
    try {
      return text.trim() ? JSON.parse(text) : fallback;
    } catch {
      return null;
    }
  }

  function asArray(value, nestedKey) {
    if (Array.isArray(value)) return value;
    if (nestedKey && value && typeof value === 'object' && Array.isArray(value[nestedKey])) {
      return value[nestedKey];
    }
    if (value && typeof value === 'object') {
      for (const key of ['items', 'results', 'data', 'entries', 'records', 'repos', 'pulls', 'issues', 'commits', 'monitors']) {
        if (Array.isArray(value[key])) return value[key];
      }
    }
    return [];
  }

  function fmtAgo(iso) {
    if (!iso) return 'never';
    const diffMs = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diffMs)) return iso;
    if (diffMs < 60_000) return 'now';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h`;
    return `${Math.floor(diffMs / 86_400_000)}d`;
  }

  function fmtTime(iso) {
    if (!iso) return 'never';
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  function fmtUptime(seconds) {
    if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return 'n/a';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3_600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ${Math.floor((seconds % 3_600) / 60)}m`;
    return `${Math.floor(seconds / 86_400)}d ${Math.floor((seconds % 86_400) / 3_600)}h`;
  }

  function fmtNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(1)}K`;
    return String(number);
  }

  function fmtCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return `$${number.toFixed(2)}`;
  }

  function Badge({ status }) {
    const palette = {
      online: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      offline: 'bg-red-500/10 text-red-700 dark:text-red-300',
      checking: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
      unconfigured: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      disabled: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
      success: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      info: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
      warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      error: 'bg-red-500/10 text-red-700 dark:text-red-300',
      pending: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
      running: 'bg-blue-500/10 text-blue-700 dark:text-blue-300',
      'needs-input': 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
      resolved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      failed: 'bg-red-500/10 text-red-700 dark:text-red-300',
      unknown: 'bg-slate-500/10 text-slate-700 dark:text-slate-300',
    };
    const label = status || 'unknown';
    return h(
      'span',
      {
        className: cx(
          'inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize',
          palette[label] || palette.unknown,
        ),
      },
      label,
    );
  }

  function Section({ title, subtitle, actions, children }) {
    return h(
      'section',
      { className: 'rounded-3xl border border-border/70 bg-card/70 p-5 shadow-sm' },
      h(
        'div',
        { className: 'mb-4 flex flex-wrap items-start justify-between gap-3' },
        h(
          'div',
          null,
          h('h3', { className: 'text-sm font-semibold' }, title),
          subtitle ? h('p', { className: 'mt-1 text-xs text-muted-foreground' }, subtitle) : null,
        ),
        actions ? h('div', { className: 'flex flex-wrap gap-2' }, actions) : null,
      ),
      children,
    );
  }

  function ActionButton({ label, onClick, disabled, variant = 'default' }) {
    const classes = variant === 'secondary'
      ? 'border border-border/70 bg-card/60 text-foreground hover:bg-muted/50'
      : variant === 'danger'
        ? 'bg-red-600 text-white hover:bg-red-600/90'
        : 'bg-primary text-primary-foreground hover:bg-primary/90';
    return h(
      'button',
      {
        type: 'button',
        onClick,
        disabled,
        className: cx(
          'rounded-2xl px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
          classes,
        ),
      },
      label,
    );
  }

  function Field({ label, value, onChange, placeholder, type = 'text' }) {
    return h(
      'label',
      { className: 'grid gap-1.5' },
      h('span', { className: 'text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground' }, label),
      h('input', {
        type,
        value,
        onChange: (event) => onChange(event.target.value),
        placeholder,
        className: 'w-full rounded-2xl border border-border/70 bg-background/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60',
      }),
    );
  }

  function TextAreaField({ label, value, onChange, placeholder, rows = 5 }) {
    return h(
      'label',
      { className: 'grid gap-1.5' },
      h('span', { className: 'text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground' }, label),
      h('textarea', {
        value,
        onChange: (event) => onChange(event.target.value),
        placeholder,
        rows,
        className: 'min-h-[120px] w-full rounded-2xl border border-border/70 bg-background/60 px-3 py-2 text-sm outline-none transition focus:border-primary/60',
      }),
    );
  }

  function Toggle({ label, description, checked, onChange }) {
    return h(
      'label',
      { className: 'flex items-start justify-between gap-4 rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
      h(
        'div',
        { className: 'min-w-0' },
        h('div', { className: 'text-sm font-medium' }, label),
        h('p', { className: 'mt-1 text-xs text-muted-foreground' }, description),
      ),
      h('input', {
        type: 'checkbox',
        checked,
        onChange: (event) => onChange(event.target.checked),
        className: 'mt-1 h-4 w-4 rounded border-border',
      }),
    );
  }

  function StatCard({ label, value, subvalue }) {
    return h(
      'div',
      { className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
      h('div', { className: 'text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground' }, label),
      h('div', { className: 'mt-1 text-xl font-semibold tracking-tight' }, value),
      subvalue ? h('div', { className: 'mt-1 text-xs text-muted-foreground' }, subvalue) : null,
    );
  }

  function JsonBox({ value, emptyLabel = 'No data yet.' }) {
    const text = useMemo(() => {
      if (value == null || value === '') return '';
      return safeJson(value);
    }, [value]);

    if (!text) {
      return h('p', { className: 'text-sm text-muted-foreground' }, emptyLabel);
    }

    return h(
      'pre',
      {
        className: 'max-h-[420px] overflow-auto rounded-2xl border border-border/60 bg-background/55 p-4 text-xs text-foreground/90',
      },
      text,
    );
  }

  function EmptyState({ title, body }) {
    return h(
      'div',
      { className: 'rounded-3xl border border-dashed border-border/70 bg-card/25 px-6 py-12 text-center' },
      h('div', { className: 'text-sm font-medium' }, title),
      h('p', { className: 'mt-2 text-sm text-muted-foreground' }, body),
    );
  }

  function KeyValueGrid({ items }) {
    return h(
      'div',
      { className: 'grid gap-3 md:grid-cols-2 xl:grid-cols-3' },
      items.map(([label, value]) => h(
        'div',
        {
          key: label,
          className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3',
        },
        h('div', { className: 'text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground' }, label),
        h('div', { className: 'mt-1 break-all text-sm font-medium' }, value),
      )),
    );
  }

  function SegmentTabs({ tabs, active, onChange }) {
    return h(
      'div',
      { className: 'flex flex-wrap gap-2' },
      tabs.map((tab) => h(
        'button',
        {
          key: tab.key,
          type: 'button',
          onClick: () => onChange(tab.key),
          className: cx(
            'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
            active === tab.key
              ? 'bg-primary text-primary-foreground'
              : 'border border-border/70 bg-card/40 text-muted-foreground hover:text-foreground',
          ),
        },
        tab.label,
      )),
    );
  }

  function NotificationRow({ notification, expanded, onToggle, onRead }) {
    return h(
      'div',
      {
        className: cx(
          'rounded-2xl border border-border/60 bg-background/45 transition-colors',
          !notification.read && 'ring-1 ring-primary/30',
        ),
      },
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            if (!notification.read) onRead();
            onToggle();
          },
          className: 'flex w-full items-start justify-between gap-3 px-4 py-3 text-left',
        },
        h(
          'div',
          { className: 'min-w-0 flex-1' },
          h(
            'div',
            { className: 'flex flex-wrap items-center gap-2' },
            !notification.read ? h('span', { className: 'h-2 w-2 rounded-full bg-primary' }) : null,
            h('span', { className: 'text-sm font-medium' }, notification.title),
            h(Badge, { status: notification.severity }),
          ),
          h('p', { className: 'mt-1 text-xs text-muted-foreground' }, `${notification.type} • ${fmtAgo(notification.timestamp)}${notification.source ? ` • ${notification.source}` : ''}`),
          notification.message && !expanded
            ? h('p', { className: 'mt-2 truncate text-sm text-muted-foreground' }, notification.message)
            : null,
        ),
        h('span', { className: 'text-xs text-muted-foreground' }, expanded ? 'Hide' : 'Show'),
      ),
      expanded ? h(
        'div',
        { className: 'border-t border-border/50 px-4 py-3' },
        notification.message ? h('p', { className: 'whitespace-pre-wrap text-sm text-muted-foreground' }, notification.message) : null,
        h('div', { className: 'mt-3 text-[11px] text-muted-foreground' }, fmtTime(notification.timestamp)),
        h('details', { className: 'mt-3' },
          h('summary', { className: 'cursor-pointer text-xs text-muted-foreground' }, 'Raw event'),
          h(JsonBox, { value: notification.raw, emptyLabel: 'No raw payload.' }),
        ),
      ) : null,
    );
  }

  function useDraftConfig(pluginConfig) {
    const [draft, setDraft] = useState(() => buildDraft(pluginConfig));

    useEffect(() => {
      setDraft(buildDraft(pluginConfig));
    }, [
      pluginConfig?.enabled,
      pluginConfig?.daemonUrl,
      pluginConfig?.configDir,
      pluginConfig?.apiKey,
      pluginConfig?.readyPath,
      pluginConfig?.healthPath,
      pluginConfig?.streamPath,
      pluginConfig?.eventsPath,
      pluginConfig?.backendEnabled,
      pluginConfig?.daemonStreaming,
      pluginConfig?.notificationsEnabled,
      pluginConfig?.nativeNotifications,
      pluginConfig?.autoConnectEvents,
      pluginConfig?.openProactiveThread,
      pluginConfig?.healthPollMs,
      pluginConfig?.eventsRecentCount,
      pluginConfig?.sseReconnectMs,
      pluginConfig?.workspaceThreadTitle,
      pluginConfig?.proactiveThreadTitle,
      pluginConfig?.bootstrapPrompt,
      pluginConfig?.proactivePromptPrefix,
      pluginConfig?.knowledgeRagEnabled,
      pluginConfig?.knowledgeCaptureEnabled,
      pluginConfig?.knowledgeScope,
      pluginConfig?.triggersEnabled,
      pluginConfig?.autoTriage,
      pluginConfig?.triageModel,
      pluginConfig?.maxConcurrentWorkflows,
      safeJson(pluginConfig?.triggerRules || []),
    ]);

    return [draft, setDraft];
  }

  function buildDraft(pluginConfig) {
    return {
      enabled: pluginConfig?.enabled !== false,
      daemonUrl: pluginConfig?.daemonUrl || 'http://127.0.0.1:4567',
      configDir: pluginConfig?.configDir || '',
      apiKey: pluginConfig?.apiKey || '',
      readyPath: pluginConfig?.readyPath || '/api/ready',
      healthPath: pluginConfig?.healthPath || '/api/health',
      streamPath: pluginConfig?.streamPath || '/api/llm/inference',
      eventsPath: pluginConfig?.eventsPath || '/api/events',
      backendEnabled: pluginConfig?.backendEnabled !== false,
      daemonStreaming: pluginConfig?.daemonStreaming !== false,
      notificationsEnabled: pluginConfig?.notificationsEnabled !== false,
      nativeNotifications: pluginConfig?.nativeNotifications !== false,
      autoConnectEvents: pluginConfig?.autoConnectEvents !== false,
      openProactiveThread: Boolean(pluginConfig?.openProactiveThread),
      healthPollMs: String(pluginConfig?.healthPollMs || 60000),
      eventsRecentCount: String(pluginConfig?.eventsRecentCount || 50),
      sseReconnectMs: String(pluginConfig?.sseReconnectMs || 5000),
      workspaceThreadTitle: pluginConfig?.workspaceThreadTitle || 'Legion Workspace',
      proactiveThreadTitle: pluginConfig?.proactiveThreadTitle || 'GAIA Activity',
      bootstrapPrompt: pluginConfig?.bootstrapPrompt || '',
      proactivePromptPrefix: pluginConfig?.proactivePromptPrefix || 'Proactive daemon activity',
      knowledgeRagEnabled: pluginConfig?.knowledgeRagEnabled !== false,
      knowledgeCaptureEnabled: pluginConfig?.knowledgeCaptureEnabled !== false,
      knowledgeScope: pluginConfig?.knowledgeScope || 'all',
      triggersEnabled: pluginConfig?.triggersEnabled !== false,
      autoTriage: pluginConfig?.autoTriage !== false,
      triageModel: pluginConfig?.triageModel || '',
      maxConcurrentWorkflows: String(pluginConfig?.maxConcurrentWorkflows || 3),
      triggerRules: safeJson(pluginConfig?.triggerRules || []),
    };
  }

  function LegionSettings({ pluginState, pluginConfig, setPluginConfig, onAction }) {
    const [draft, setDraft] = useDraftConfig(pluginConfig);
    const [saving, setSaving] = useState(false);
    const [working, setWorking] = useState(false);
    const [note, setNote] = useState('');

    const runAction = async (action, data) => {
      setWorking(true);
      setNote('');
      try {
        const result = await Promise.resolve(onAction?.(action, data));
        if (result?.ok === false && result?.error) {
          setNote(result.error);
        } else {
          setNote('Action completed.');
        }
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      } finally {
        setWorking(false);
      }
    };

    const saveDraft = async () => {
      if (!setPluginConfig) return;
      const parsedRules = parseJson(draft.triggerRules, []);
      if (parsedRules == null || !Array.isArray(parsedRules)) {
        setNote('Trigger rules must be valid JSON array data.');
        return;
      }

      setSaving(true);
      setNote('');
      try {
        await setPluginConfig('enabled', draft.enabled);
        await setPluginConfig('daemonUrl', draft.daemonUrl.trim());
        await setPluginConfig('configDir', draft.configDir.trim());
        await setPluginConfig('apiKey', draft.apiKey);
        await setPluginConfig('readyPath', draft.readyPath.trim() || '/api/ready');
        await setPluginConfig('healthPath', draft.healthPath.trim() || '/api/health');
        await setPluginConfig('streamPath', draft.streamPath.trim() || '/api/llm/inference');
        await setPluginConfig('eventsPath', draft.eventsPath.trim() || '/api/events');
        await setPluginConfig('backendEnabled', draft.backendEnabled);
        await setPluginConfig('daemonStreaming', draft.daemonStreaming);
        await setPluginConfig('notificationsEnabled', draft.notificationsEnabled);
        await setPluginConfig('nativeNotifications', draft.nativeNotifications);
        await setPluginConfig('autoConnectEvents', draft.autoConnectEvents);
        await setPluginConfig('openProactiveThread', draft.openProactiveThread);
        await setPluginConfig('healthPollMs', Math.max(Number(draft.healthPollMs) || 60000, 15000));
        await setPluginConfig('eventsRecentCount', Math.max(Number(draft.eventsRecentCount) || 50, 1));
        await setPluginConfig('sseReconnectMs', Math.max(Number(draft.sseReconnectMs) || 5000, 2000));
        await setPluginConfig('workspaceThreadTitle', draft.workspaceThreadTitle.trim() || 'Legion Workspace');
        await setPluginConfig('proactiveThreadTitle', draft.proactiveThreadTitle.trim() || 'GAIA Activity');
        await setPluginConfig('bootstrapPrompt', draft.bootstrapPrompt);
        await setPluginConfig('proactivePromptPrefix', draft.proactivePromptPrefix.trim() || 'Proactive daemon activity');
        await setPluginConfig('knowledgeRagEnabled', draft.knowledgeRagEnabled);
        await setPluginConfig('knowledgeCaptureEnabled', draft.knowledgeCaptureEnabled);
        await setPluginConfig('knowledgeScope', draft.knowledgeScope);
        await setPluginConfig('triggersEnabled', draft.triggersEnabled);
        await setPluginConfig('autoTriage', draft.autoTriage);
        await setPluginConfig('triageModel', draft.triageModel.trim());
        await setPluginConfig('maxConcurrentWorkflows', Math.max(Number(draft.maxConcurrentWorkflows) || 3, 1));
        await setPluginConfig('triggerRules', parsedRules);
        setNote('Legion config saved.');
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      } finally {
        setSaving(false);
      }
    };

    const summaryItems = [
      ['Status', pluginState?.status || 'unknown'],
      ['Daemon URL', pluginState?.serviceUrl || draft.daemonUrl || 'not set'],
      ['Auth Source', pluginState?.authSource || 'none'],
      ['Config Dir', pluginState?.resolvedConfigDir || draft.configDir || 'auto-detect'],
      ['Events', pluginState?.eventsConnected ? 'connected' : 'disconnected'],
      ['Unread Notifications', String(pluginState?.unreadNotificationCount || 0)],
      ['Managed Threads', String((pluginState?.managedConversationIds || []).length)],
      ['Workflows', String(pluginState?.workflowCounts?.total || 0)],
    ];

    return h(
      'div',
      { className: 'space-y-5' },
      h('div', { className: 'flex items-center gap-3' },
        h('h2', { className: 'text-lg font-semibold' }, 'Legion'),
        h(Badge, { status: pluginState?.status }),
      ),
      note ? h('div', { className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3 text-sm' }, note) : null,
      h(Section, {
        title: 'Connection',
        subtitle: 'Configure the Legion daemon, auth source, and event transport.',
      },
      h('div', { className: 'grid gap-4 md:grid-cols-2' },
        h(Field, { label: 'Daemon URL', value: draft.daemonUrl, onChange: (value) => setDraft((current) => ({ ...current, daemonUrl: value })), placeholder: 'http://127.0.0.1:4567' }),
        h(Field, { label: 'Config Dir', value: draft.configDir, onChange: (value) => setDraft((current) => ({ ...current, configDir: value })), placeholder: '~/.kai/settings' }),
        h(Field, { label: 'API Key', value: draft.apiKey, onChange: (value) => setDraft((current) => ({ ...current, apiKey: value })), type: 'password', placeholder: 'Optional manual bearer token' }),
        h(Field, { label: 'Ready Path', value: draft.readyPath, onChange: (value) => setDraft((current) => ({ ...current, readyPath: value })), placeholder: '/api/ready' }),
        h(Field, { label: 'Health Path', value: draft.healthPath, onChange: (value) => setDraft((current) => ({ ...current, healthPath: value })), placeholder: '/api/health' }),
        h(Field, { label: 'Stream Path', value: draft.streamPath, onChange: (value) => setDraft((current) => ({ ...current, streamPath: value })), placeholder: '/api/llm/inference' }),
        h(Field, { label: 'Events Path', value: draft.eventsPath, onChange: (value) => setDraft((current) => ({ ...current, eventsPath: value })), placeholder: '/api/events' }),
        h(Field, { label: 'Health Poll (ms)', value: draft.healthPollMs, onChange: (value) => setDraft((current) => ({ ...current, healthPollMs: value })), placeholder: '60000' }),
        h(Field, { label: 'Recent Events Count', value: draft.eventsRecentCount, onChange: (value) => setDraft((current) => ({ ...current, eventsRecentCount: value })), placeholder: '50' }),
        h(Field, { label: 'Reconnect Delay (ms)', value: draft.sseReconnectMs, onChange: (value) => setDraft((current) => ({ ...current, sseReconnectMs: value })), placeholder: '5000' }),
      )),
      h(Section, {
        title: 'Behavior',
        subtitle: 'Control backend registration, notifications, proactive thread behavior, and workflow routing.',
      },
      h('div', { className: 'grid gap-3' },
        h(Toggle, { label: 'Plugin Enabled', description: 'Turn Legion runtime features on or off without removing the plugin.', checked: draft.enabled, onChange: (checked) => setDraft((current) => ({ ...current, enabled: checked })) }),
        h(Toggle, { label: 'Legion Backend', description: 'Register the plugin-provided daemon backend for Legion-managed conversations.', checked: draft.backendEnabled, onChange: (checked) => setDraft((current) => ({ ...current, backendEnabled: checked })) }),
        h(Toggle, { label: 'Daemon Streaming', description: 'Prefer daemon SSE streaming for chat requests, with sync and task fallback when needed.', checked: draft.daemonStreaming, onChange: (checked) => setDraft((current) => ({ ...current, daemonStreaming: checked })) }),
        h(Toggle, { label: 'Notifications', description: 'Allow Legion to surface toast and native notifications for daemon events.', checked: draft.notificationsEnabled, onChange: (checked) => setDraft((current) => ({ ...current, notificationsEnabled: checked })) }),
        h(Toggle, { label: 'Native Notifications', description: 'Send native OS notifications for high-signal daemon events when Legion fires alerts.', checked: draft.nativeNotifications, onChange: (checked) => setDraft((current) => ({ ...current, nativeNotifications: checked })) }),
        h(Toggle, { label: 'Event Stream', description: 'Keep a live SSE connection open for daemon notifications, trigger routing, and proactive activity.', checked: draft.autoConnectEvents, onChange: (checked) => setDraft((current) => ({ ...current, autoConnectEvents: checked })) }),
        h(Toggle, { label: 'Auto-open Proactive Thread', description: 'Bring the GAIA/proactive conversation to the foreground when new proactive events arrive.', checked: draft.openProactiveThread, onChange: (checked) => setDraft((current) => ({ ...current, openProactiveThread: checked })) }),
        h(Toggle, { label: 'Knowledge RAG', description: 'Forward daemon knowledge retrieval flags through the Legion backend adapter.', checked: draft.knowledgeRagEnabled, onChange: (checked) => setDraft((current) => ({ ...current, knowledgeRagEnabled: checked })) }),
        h(Toggle, { label: 'Knowledge Capture', description: 'Allow the Legion backend adapter to request knowledge capture during daemon inference.', checked: draft.knowledgeCaptureEnabled, onChange: (checked) => setDraft((current) => ({ ...current, knowledgeCaptureEnabled: checked })) }),
        h(Toggle, { label: 'Trigger Routing', description: 'Route trigger.* daemon events into observe/act workflow handling inside the plugin.', checked: draft.triggersEnabled, onChange: (checked) => setDraft((current) => ({ ...current, triggersEnabled: checked })) }),
        h(Toggle, { label: 'Auto Triage', description: 'Default unmatched trigger events to observe unless a rule says otherwise.', checked: draft.autoTriage, onChange: (checked) => setDraft((current) => ({ ...current, autoTriage: checked })) }),
      )),
      h(Section, {
        title: 'Threads And Rules',
        subtitle: 'Adjust workflow policy, conversation defaults, and proactive thread copy.',
      },
      h('div', { className: 'grid gap-4 md:grid-cols-2' },
        h(Field, { label: 'Workspace Title', value: draft.workspaceThreadTitle, onChange: (value) => setDraft((current) => ({ ...current, workspaceThreadTitle: value })), placeholder: 'Legion Workspace' }),
        h(Field, { label: 'Proactive Title', value: draft.proactiveThreadTitle, onChange: (value) => setDraft((current) => ({ ...current, proactiveThreadTitle: value })), placeholder: 'GAIA Activity' }),
        h(Field, { label: 'Knowledge Scope', value: draft.knowledgeScope, onChange: (value) => setDraft((current) => ({ ...current, knowledgeScope: value })), placeholder: 'all' }),
        h(Field, { label: 'Triage Model', value: draft.triageModel, onChange: (value) => setDraft((current) => ({ ...current, triageModel: value })), placeholder: 'Optional model override' }),
        h(Field, { label: 'Max Concurrent Workflows', value: draft.maxConcurrentWorkflows, onChange: (value) => setDraft((current) => ({ ...current, maxConcurrentWorkflows: value })), placeholder: '3' }),
      ),
      h(TextAreaField, { label: 'Bootstrap Prompt', value: draft.bootstrapPrompt, onChange: (value) => setDraft((current) => ({ ...current, bootstrapPrompt: value })), placeholder: 'Assistant bootstrap message for new Legion threads', rows: 5 }),
      h(TextAreaField, { label: 'Proactive Prompt Prefix', value: draft.proactivePromptPrefix, onChange: (value) => setDraft((current) => ({ ...current, proactivePromptPrefix: value })), placeholder: 'Prefix text for proactive messages', rows: 3 }),
      h(TextAreaField, { label: 'Trigger Rules JSON', value: draft.triggerRules, onChange: (value) => setDraft((current) => ({ ...current, triggerRules: value })), placeholder: '[{\"source\":\"github\",\"eventType\":\"*\",\"action\":\"observe\"}]', rows: 8 }),
      h('div', { className: 'mt-4 flex flex-wrap gap-2' },
        h(ActionButton, { label: saving ? 'Saving...' : 'Save Config', onClick: saveDraft, disabled: saving }),
        h(ActionButton, { label: working ? 'Working...' : 'Refresh Status', onClick: () => runAction('refresh-status'), disabled: working, variant: 'secondary' }),
        h(ActionButton, { label: 'Run Doctor', onClick: () => runAction('run-doctor'), disabled: working, variant: 'secondary' }),
        h(ActionButton, { label: 'Open Proactive Thread', onClick: () => runAction('open-proactive-thread'), disabled: working, variant: 'secondary' }),
      )),
      h(Section, {
        title: 'Runtime Snapshot',
        subtitle: 'Live Legion plugin state published from the host process.',
      },
      h(KeyValueGrid, { items: summaryItems })),
      h(Section, {
        title: 'Doctor Results',
        subtitle: 'Most recent daemon diagnostics collected from the plugin.',
      },
      Array.isArray(pluginState?.doctorResults) && pluginState.doctorResults.length > 0
        ? h(
          'div',
          { className: 'space-y-2' },
          pluginState.doctorResults.map((entry) => h(
            'div',
            { key: `${entry.name}-${entry.duration}`, className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
            h('div', { className: 'flex items-center justify-between gap-3' },
              h('span', { className: 'text-sm font-medium' }, entry.name),
              h(Badge, { status: entry.status === 'pass' ? 'success' : entry.status }),
            ),
            h('p', { className: 'mt-1 text-xs text-muted-foreground' }, entry.message),
            h('p', { className: 'mt-2 text-[11px] text-muted-foreground' }, `${entry.duration}ms`),
          )),
        )
        : h('p', { className: 'text-sm text-muted-foreground' }, 'Run the doctor from settings or Mission Control to populate these checks.')),
    );
  }

  function DashboardView({ pluginState, onAction }) {
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState('');
    const dashboard = pluginState?.dashboard || null;
    const health = dashboard?.health || {};
    const taskSummary = dashboard?.tasksSummary || {};
    const workerSummary = dashboard?.workersSummary || {};
    const workflows = pluginState?.workflowCounts || {};
    const recentNotifications = Array.isArray(pluginState?.notifications) ? pluginState.notifications.slice(0, 8) : [];

    const runAction = async (action, data) => {
      setBusy(true);
      setNote('');
      try {
        const result = await Promise.resolve(onAction?.(action, data));
        if (result?.ok === false && result?.error) {
          setNote(result.error);
        } else {
          setNote(action === 'run-doctor' ? 'Doctor checks refreshed.' : 'Refresh completed.');
        }
      } catch (error) {
        setNote(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    };

    return h(
      'div',
      { className: 'space-y-5' },
      note ? h('div', { className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3 text-sm' }, note) : null,
      h(Section, {
        title: 'Cluster Snapshot',
        subtitle: 'A high-level runtime summary pulled from the daemon, event stream, and plugin workflow state.',
        actions: [
          h(ActionButton, { key: 'refresh', label: busy ? 'Refreshing...' : 'Refresh Status', onClick: () => runAction('refresh-status'), disabled: busy }),
          h(ActionButton, { key: 'doctor', label: 'Run Doctor', onClick: () => runAction('run-doctor'), disabled: busy, variant: 'secondary' }),
          h(ActionButton, { key: 'events', label: 'Load Recent Events', onClick: () => runAction('load-recent-events'), disabled: busy, variant: 'secondary' }),
          h(ActionButton, { key: 'gaia', label: 'Open Proactive Thread', onClick: () => runAction('open-proactive-thread'), disabled: busy, variant: 'secondary' }),
        ],
      },
      dashboard ? h(
        'div',
        { className: 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4' },
        h(StatCard, { label: 'Status', value: pluginState?.status || 'unknown', subvalue: dashboard?.updatedAt ? `Updated ${fmtAgo(dashboard.updatedAt)} ago` : '' }),
        h(StatCard, { label: 'Uptime', value: fmtUptime(health?.uptime_seconds ?? health?.uptime), subvalue: health?.version ? `v${health.version}` : '' }),
        h(StatCard, { label: 'Tasks', value: fmtNumber(taskSummary.total), subvalue: `${fmtNumber(taskSummary.running)} running • ${fmtNumber(taskSummary.failed)} failed` }),
        h(StatCard, { label: 'Workers', value: fmtNumber(workerSummary.total), subvalue: `${fmtNumber(workerSummary.healthy)} healthy • ${fmtNumber(workerSummary.degraded)} degraded` }),
        h(StatCard, { label: 'Extensions', value: fmtNumber(dashboard?.extensionsCount || 0), subvalue: 'Loaded daemon extensions' }),
        h(StatCard, { label: 'Capabilities', value: fmtNumber((dashboard?.capabilities || []).length), subvalue: 'Natural-language router suggestions' }),
        h(StatCard, { label: 'Notifications', value: fmtNumber(pluginState?.unreadNotificationCount || 0), subvalue: `${fmtNumber((pluginState?.notifications || []).length)} retained` }),
        h(StatCard, { label: 'Workflows', value: fmtNumber(workflows.total || 0), subvalue: `${fmtNumber(workflows.active || 0)} active • ${fmtNumber(workflows.needsInput || 0)} needs input` }),
      ) : h(EmptyState, { title: 'No dashboard snapshot yet', body: 'Refresh status to load the current daemon summary.' })),
      h(Section, {
        title: 'Live Details',
        subtitle: 'Recent health and service summaries preserved in plugin state.',
      },
      h('div', { className: 'grid gap-4 xl:grid-cols-2' },
        h(JsonBox, { value: dashboard?.health, emptyLabel: 'No health payload recorded yet.' }),
        h(JsonBox, { value: { gaia: dashboard?.gaia, metering: dashboard?.metering, github: dashboard?.githubStatus, knowledge: dashboard?.knowledgeStatus }, emptyLabel: 'No auxiliary service data yet.' }),
      )),
      h(Section, {
        title: 'Recent Activity',
        subtitle: 'Newest daemon notifications retained by the plugin event log.',
      },
      recentNotifications.length === 0
        ? h('p', { className: 'text-sm text-muted-foreground' }, 'No Legion events have been captured yet.')
        : h(
          'div',
          { className: 'space-y-2' },
          recentNotifications.map((notification) => h(
            'div',
            { key: notification.id, className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
            h('div', { className: 'flex flex-wrap items-center gap-2' },
              h('span', { className: 'text-sm font-medium' }, notification.title),
              h(Badge, { status: notification.severity }),
            ),
            h('div', { className: 'mt-1 text-xs text-muted-foreground' }, `${notification.type} • ${fmtAgo(notification.timestamp)}${notification.source ? ` • ${notification.source}` : ''}`),
            notification.message ? h('div', { className: 'mt-2 text-sm text-muted-foreground' }, notification.message) : null,
          )),
        )),
    );
  }

  function NotificationsView({ pluginState, onAction }) {
    const [filter, setFilter] = useState('all');
    const [expandedId, setExpandedId] = useState('');
    const notifications = Array.isArray(pluginState?.notifications) ? pluginState.notifications : [];
    const filtered = filter === 'all' ? notifications : notifications.filter((item) => item.severity === filter);

    const markRead = async (id) => {
      await Promise.resolve(onAction?.('notification-mark-read', { id }));
    };

    return h(
      'div',
      { className: 'space-y-5' },
      h(Section, {
        title: 'Notification Feed',
        subtitle: 'Legion SSE activity, proactive events, and workflow alerts stored inside plugin state.',
        actions: [
          h(ActionButton, { key: 'recent', label: 'Load Recent Events', onClick: () => onAction?.('load-recent-events'), variant: 'secondary' }),
          h(ActionButton, { key: 'read', label: 'Mark All Read', onClick: () => onAction?.('notification-mark-all-read'), variant: 'secondary' }),
          h(ActionButton, { key: 'clear', label: 'Clear', onClick: () => onAction?.('notification-clear'), variant: 'secondary' }),
        ],
      },
      h('div', { className: 'flex flex-wrap gap-2' },
        ['all', 'error', 'warn', 'success', 'info'].map((severity) => h(ActionButton, {
          key: severity,
          label: severity === 'all' ? `All (${notifications.length})` : `${severity} (${notifications.filter((item) => item.severity === severity).length})`,
          onClick: () => setFilter(severity),
          variant: filter === severity ? 'default' : 'secondary',
        })),
      ),
      filtered.length === 0
        ? h(EmptyState, { title: 'No notifications', body: 'Daemon events, proactive messages, and workflow alerts will appear here.' })
        : h(
          'div',
          { className: 'space-y-2' },
          filtered.map((notification) => h(NotificationRow, {
            key: notification.id,
            notification,
            expanded: expandedId === notification.id,
            onToggle: () => setExpandedId(expandedId === notification.id ? '' : notification.id),
            onRead: () => { void markRead(notification.id); },
          })),
        )),
    );
  }

  function OperationsView({ pluginState, onAction }) {
    const [input, setInput] = useState('');
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState(null);
    const [apiPath, setApiPath] = useState('/api/settings');
    const [apiMethod, setApiMethod] = useState('GET');
    const [apiQuery, setApiQuery] = useState('{}');
    const [apiBody, setApiBody] = useState('{}');
    const [apiExpectText, setApiExpectText] = useState(false);
    const [apiBusy, setApiBusy] = useState(false);
    const [apiResult, setApiResult] = useState(null);
    const capabilities = Array.isArray(pluginState?.dashboard?.capabilities) ? pluginState.dashboard.capabilities : [];
    const filtered = input.trim()
      ? capabilities.filter((capability) => String(capability?.name || '').toLowerCase().includes(input.toLowerCase()) || String(capability?.description || '').toLowerCase().includes(input.toLowerCase())).slice(0, 8)
      : capabilities.slice(0, 8);

    const runCommand = async () => {
      if (!input.trim() || running) return;
      setRunning(true);
      try {
        const response = await Promise.resolve(onAction?.('execute-command', { input: input.trim() }));
        setResult(response);
      } catch (error) {
        setResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        setRunning(false);
      }
    };

    const runApiRequest = async () => {
      if (!apiPath.trim()) return;
      const parsedQuery = parseJson(apiQuery, {});
      const parsedBody = parseJson(apiBody, {});
      if (parsedQuery == null || !parsedQuery || Array.isArray(parsedQuery)) {
        setApiResult({ ok: false, error: 'Query JSON must be an object.' });
        return;
      }
      if (apiMethod !== 'GET' && apiMethod !== 'DELETE' && (parsedBody == null || Array.isArray(parsedBody))) {
        setApiResult({ ok: false, error: 'Body JSON must be an object for write requests.' });
        return;
      }

      setApiBusy(true);
      try {
        const response = await Promise.resolve(onAction?.('daemon-call', {
          path: apiPath.trim(),
          method: apiMethod,
          query: parsedQuery,
          body: apiMethod === 'GET' || apiMethod === 'DELETE' ? undefined : parsedBody,
          expectText: apiExpectText,
        }));
        setApiResult(response);
      } catch (error) {
        setApiResult({ ok: false, error: error instanceof Error ? error.message : String(error) });
      } finally {
        setApiBusy(false);
      }
    };

    const applyPreset = (path, method = 'GET', query = '{}', body = '{}', expectText = false) => {
      setApiPath(path);
      setApiMethod(method);
      setApiQuery(query);
      setApiBody(body);
      setApiExpectText(expectText);
    };

    return h(
      'div',
      { className: 'space-y-5' },
      h(Section, {
        title: 'Command Router',
        subtitle: 'Natural-language daemon commands backed by `/api/do`, plus quick access to workspace thread helpers.',
      },
      h('div', { className: 'grid gap-4 lg:grid-cols-[1.1fr_0.9fr]' },
        h(
          'div',
          { className: 'grid gap-4' },
          h(TextAreaField, {
            label: 'Command',
            value: input,
            onChange: setInput,
            placeholder: 'What would you like Legion to do?',
            rows: 4,
          }),
          h('div', { className: 'flex flex-wrap gap-2' },
            h(ActionButton, { label: running ? 'Running...' : 'Run Command', onClick: runCommand, disabled: running || !input.trim() }),
            h(ActionButton, { label: 'Create Workspace Thread', onClick: () => onAction?.('create-thread', { open: true }), variant: 'secondary' }),
            h(ActionButton, { label: 'Open Proactive Thread', onClick: () => onAction?.('open-proactive-thread'), variant: 'secondary' }),
          ),
        ),
        h(
          'div',
          { className: 'rounded-2xl border border-border/60 bg-background/45 p-4' },
          h('div', { className: 'text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground' }, 'Suggestions'),
          filtered.length === 0
            ? h('p', { className: 'mt-3 text-sm text-muted-foreground' }, 'No daemon capabilities available yet.')
            : h(
              'div',
              { className: 'mt-3 space-y-2' },
              filtered.map((capability, index) => h(
                'button',
                {
                  key: capability?.name || index,
                  type: 'button',
                  onClick: () => setInput(capability?.description || capability?.name || ''),
                  className: 'w-full rounded-2xl border border-border/60 bg-card/50 px-3 py-2 text-left transition-colors hover:bg-muted/50',
                },
                h('div', { className: 'text-sm font-medium' }, capability?.name || 'Capability'),
                capability?.description ? h('div', { className: 'mt-1 text-xs text-muted-foreground' }, capability.description) : null,
              )),
            ),
        ),
      )),
      h(Section, {
        title: 'Command Result',
        subtitle: 'Latest daemon routing response stored by the plugin.',
      },
      h(JsonBox, {
        value: result || pluginState?.lastCommandResult || null,
        emptyLabel: 'Run a command to populate this result pane.',
      })),
      h(Section, {
        title: 'Raw Daemon Explorer',
        subtitle: 'A direct route to the broader daemon API surface so settings, schedules, audit, transport, metrics, memory, triggers, and other endpoints remain reachable.',
      },
      h('div', { className: 'grid gap-4 lg:grid-cols-[0.65fr_0.35fr]' },
        h('div', { className: 'grid gap-4' },
          h('div', { className: 'grid gap-4 md:grid-cols-[1fr_140px]' },
            h(Field, { label: 'Path', value: apiPath, onChange: setApiPath, placeholder: '/api/settings' }),
            h(Field, { label: 'Method', value: apiMethod, onChange: (value) => setApiMethod(value.toUpperCase()), placeholder: 'GET' }),
          ),
          h(TextAreaField, { label: 'Query JSON', value: apiQuery, onChange: setApiQuery, placeholder: '{"count":"25"}', rows: 4 }),
          h(TextAreaField, { label: 'Body JSON', value: apiBody, onChange: setApiBody, placeholder: '{"key":"value"}', rows: 6 }),
          h(Toggle, { label: 'Expect Text Response', description: 'Enable this for endpoints like `/api/metrics` that return plain text instead of JSON.', checked: apiExpectText, onChange: setApiExpectText }),
          h('div', { className: 'flex flex-wrap gap-2' },
            h(ActionButton, { label: apiBusy ? 'Sending...' : 'Send Request', onClick: runApiRequest, disabled: apiBusy || !apiPath.trim() }),
            h(ActionButton, { label: 'Settings', onClick: () => applyPreset('/api/settings'), variant: 'secondary' }),
            h(ActionButton, { label: 'Schedules', onClick: () => applyPreset('/api/schedules'), variant: 'secondary' }),
            h(ActionButton, { label: 'Triggers', onClick: () => applyPreset('/api/triggers'), variant: 'secondary' }),
            h(ActionButton, { label: 'Memory Stats', onClick: () => applyPreset('/api/memory/stats'), variant: 'secondary' }),
            h(ActionButton, { label: 'Metrics', onClick: () => applyPreset('/api/metrics', 'GET', '{}', '{}', true), variant: 'secondary' }),
          ),
        ),
        h('div', { className: 'rounded-2xl border border-border/60 bg-background/45 p-4' },
          h('div', { className: 'text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground' }, 'Common Surfaces'),
          h('div', { className: 'mt-3 space-y-2 text-sm text-muted-foreground' },
            ['catalog', 'extensions', 'tasks', 'workers', 'schedules', 'audit', 'transport', 'prompts', 'webhooks', 'tenants', 'capacity', 'governance', 'rbac', 'nodes', 'memory', 'marketplace', 'github', 'gaia', 'metering', 'mesh', 'absorbers', 'structural_index', 'tool_audit', 'state_diff', 'sessions/search', 'triggers', 'llm/token_budget', 'llm/providers', 'llm/provider_layer', 'llm/context_curation/status'].map((label) => h('div', { key: label, className: 'rounded-xl border border-border/50 bg-card/50 px-3 py-2' }, `/api/${label}`)),
          ),
        ),
      ),
      h('div', null, h(JsonBox, { value: apiResult, emptyLabel: 'Send a daemon request to inspect the raw response here.' }))),
    );
  }

  function GitHubView({ onAction }) {
    const [tab, setTab] = useState('pulls');
    const [repoFilter, setRepoFilter] = useState('');
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState(null);
    const [repos, setRepos] = useState([]);
    const [items, setItems] = useState([]);
    const [error, setError] = useState('');

    const loadStatus = async () => {
      try {
        const [statusResult, repoResult] = await Promise.all([
          Promise.resolve(onAction?.('daemon-call', { path: '/api/github/status', quiet: true })),
          Promise.resolve(onAction?.('daemon-call', { path: '/api/github/repos', quiet: true })),
        ]);
        setStatus(statusResult?.data || null);
        setRepos(asArray(repoResult?.data).map((entry) => typeof entry === 'string' ? entry : entry?.full_name || entry?.name).filter(Boolean));
      } catch (errorValue) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        setStatus(null);
        setRepos([]);
      }
    };

    const loadItems = async () => {
      setLoading(true);
      setError('');
      try {
        const path = tab === 'pulls' ? '/api/github/pulls' : tab === 'issues' ? '/api/github/issues' : '/api/github/commits';
        const result = await Promise.resolve(onAction?.('daemon-call', {
          path,
          query: repoFilter ? { repo: repoFilter } : undefined,
          quiet: true,
        }));
        if (result?.ok === false) {
          setError(result.error || 'Request failed.');
          setItems([]);
        } else {
          setItems(asArray(result?.data));
        }
      } catch (errorValue) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        setItems([]);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      void loadStatus();
    }, []);

    useEffect(() => {
      void loadItems();
    }, [tab, repoFilter]);

    const openExternal = (url) => {
      if (!url) return;
      void onAction?.('open-external', { url });
    };

    return h(
      'div',
      { className: 'space-y-5' },
      h(Section, {
        title: 'GitHub',
        subtitle: 'Daemon-backed GitHub status, pull requests, issues, and commits.',
        actions: [
          h(ActionButton, { key: 'refresh', label: loading ? 'Refreshing...' : 'Refresh', onClick: () => { void loadStatus(); void loadItems(); }, disabled: loading, variant: 'secondary' }),
        ],
      },
      h('div', { className: 'grid gap-4 md:grid-cols-[0.9fr_1.1fr]' },
        h(JsonBox, { value: status, emptyLabel: 'No GitHub status loaded yet.' }),
        h('div', { className: 'space-y-3' },
          h(SegmentTabs, {
            tabs: [
              { key: 'pulls', label: 'Pull Requests' },
              { key: 'issues', label: 'Issues' },
              { key: 'commits', label: 'Commits' },
            ],
            active: tab,
            onChange: setTab,
          }),
          h(Field, { label: 'Repo Filter', value: repoFilter, onChange: setRepoFilter, placeholder: repos.length > 0 ? repos[0] : 'owner/repo' }),
          repos.length > 0 ? h('div', { className: 'flex flex-wrap gap-2' },
            repos.slice(0, 12).map((repo) => h(ActionButton, {
              key: repo,
              label: repo,
              onClick: () => setRepoFilter(repoFilter === repo ? '' : repo),
              variant: repoFilter === repo ? 'default' : 'secondary',
            })),
          ) : null,
        ),
      )),
      error ? h('div', { className: 'rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-300' }, error) : null,
      loading ? h('p', { className: 'text-sm text-muted-foreground' }, 'Loading GitHub data...') : null,
      !loading && items.length === 0 ? h(EmptyState, { title: 'No GitHub records', body: 'Refresh the panel or adjust the repo filter to load daemon-backed GitHub data.' }) : null,
      !loading && items.length > 0 ? h(
        'div',
        { className: 'space-y-2' },
        items.map((item, index) => {
          const repo = item?.repo || item?.repository || item?.full_name || item?.name || '';
          const title = item?.title || item?.message || item?.sha || item?.head_sha || `${tab} record ${index + 1}`;
          const stateValue = item?.state || item?.status || '';
          const url = item?.html_url || item?.url || item?.web_url || '';
          const metaLine = [
            repo,
            item?.author?.login || item?.user?.login || item?.author || '',
            item?.updated_at ? fmtAgo(item.updated_at) : item?.created_at ? fmtAgo(item.created_at) : '',
          ].filter(Boolean).join(' • ');
          return h(
            'div',
            { key: `${title}-${index}`, className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
            h('div', { className: 'flex flex-wrap items-center justify-between gap-3' },
              h('div', { className: 'min-w-0 flex-1' },
                h('div', { className: 'text-sm font-medium break-all' }, title),
                metaLine ? h('div', { className: 'mt-1 text-xs text-muted-foreground' }, metaLine) : null,
              ),
              h('div', { className: 'flex items-center gap-2' },
                stateValue ? h(Badge, { status: String(stateValue).toLowerCase() }) : null,
                url ? h(ActionButton, { label: 'Open', onClick: () => openExternal(url), variant: 'secondary' }) : null,
              ),
            ),
            item?.body ? h('p', { className: 'mt-2 whitespace-pre-wrap text-sm text-muted-foreground' }, item.body) : null,
          );
        }),
      ) : null,
    );
  }

  function KnowledgeView({ onAction }) {
    const bridge = getBridge();
    const [tab, setTab] = useState('query');
    const [query, setQuery] = useState('');
    const [limit, setLimit] = useState('10');
    const [queryResult, setQueryResult] = useState(null);
    const [browseTag, setBrowseTag] = useState('');
    const [browseSource, setBrowseSource] = useState('');
    const [browseResult, setBrowseResult] = useState(null);
    const [ingestContent, setIngestContent] = useState('');
    const [metadataText, setMetadataText] = useState('{}');
    const [ingestResult, setIngestResult] = useState(null);
    const [monitors, setMonitors] = useState([]);
    const [healthResult, setHealthResult] = useState(null);
    const [statusResult, setStatusResult] = useState(null);
    const [absorbInput, setAbsorbInput] = useState('');
    const [jobId, setJobId] = useState('');
    const [absorbResult, setAbsorbResult] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const run = async (action, data, setter) => {
      setBusy(true);
      setError('');
      try {
        const result = await Promise.resolve(onAction?.(action, data));
        if (result?.ok === false) {
          setError(result.error || 'Request failed.');
          if (setter) setter(null);
        } else if (setter) {
          setter(result?.data ?? result);
        }
      } catch (errorValue) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        if (setter) setter(null);
      } finally {
        setBusy(false);
      }
    };

    const refreshMonitors = async () => {
      try {
        const result = await Promise.resolve(onAction?.('knowledge-monitors-list'));
        if (result?.ok === false) {
          setError(result.error || 'Failed to load monitors.');
          return;
        }
        setMonitors(asArray(result?.data, 'monitors'));
      } catch (errorValue) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
      }
    };

    const refreshHealth = async () => {
      try {
        const [statusRes, healthRes] = await Promise.all([
          Promise.resolve(onAction?.('knowledge-status')),
          Promise.resolve(onAction?.('knowledge-health')),
        ]);
        setStatusResult(statusRes?.data || null);
        setHealthResult(healthRes?.data || null);
      } catch (errorValue) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        setStatusResult(null);
        setHealthResult(null);
      }
    };

    useEffect(() => {
      if (tab === 'monitors' && monitors.length === 0) {
        void refreshMonitors();
      }
      if (tab === 'health' && !statusResult && !healthResult) {
        void refreshHealth();
      }
    }, [tab]);

    const pickFiles = async () => {
      const raw = await bridge?.dialog?.openFile?.({
        filters: [
          { name: 'Documents', extensions: ['pdf', 'docx', 'xlsx', 'pptx', 'html', 'htm', 'md', 'csv', 'json', 'txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      const files = raw?.files || [];
      if (!Array.isArray(files) || files.length === 0) return;
      const paths = files.map((file) => file?.path).filter(Boolean);
      if (paths.length === 0) return;
      await run('knowledge-ingest-file', { filePath: paths[0] }, setIngestResult);
    };

    const pickDirectory = async () => {
      const result = await bridge?.dialog?.openDirectoryFiles?.();
      if (!result || result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length === 0) return;
      await run('knowledge-ingest-file', { filePath: result.filePaths[0] }, setIngestResult);
    };

    const tabs = [
      { key: 'query', label: 'Query' },
      { key: 'browse', label: 'Browse' },
      { key: 'ingest', label: 'Ingest' },
      { key: 'monitors', label: 'Monitors' },
      { key: 'health', label: 'Health' },
      { key: 'absorb', label: 'Absorb' },
    ];

    let body = null;

    if (tab === 'query') {
      body = h(Section, {
        title: 'Apollo Query',
        subtitle: 'Run retrieval queries against daemon knowledge stores.',
      },
      h('div', { className: 'grid gap-4 lg:grid-cols-[1fr_160px]' },
        h(TextAreaField, { label: 'Query', value: query, onChange: setQuery, placeholder: 'What knowledge should Legion retrieve?', rows: 4 }),
        h(Field, { label: 'Limit', value: limit, onChange: setLimit, placeholder: '10' }),
      ),
      h('div', { className: 'mt-4 flex flex-wrap gap-2' },
        h(ActionButton, { label: busy ? 'Querying...' : 'Query', onClick: () => run('knowledge-query', { query, limit: Number(limit) || 10 }, setQueryResult), disabled: busy || !query.trim() }),
      ),
      h('div', { className: 'mt-4' }, h(JsonBox, { value: queryResult, emptyLabel: 'Run a knowledge query to inspect results here.' })));
    }

    if (tab === 'browse') {
      body = h(Section, {
        title: 'Browse Knowledge',
        subtitle: 'Search daemon entries by tag or source channel.',
      },
      h('div', { className: 'grid gap-4 md:grid-cols-2' },
        h(Field, { label: 'Tag', value: browseTag, onChange: setBrowseTag, placeholder: 'project, code, docs' }),
        h(Field, { label: 'Source', value: browseSource, onChange: setBrowseSource, placeholder: 'github, slack, local file' }),
      ),
      h('div', { className: 'mt-4 flex flex-wrap gap-2' },
        h(ActionButton, { label: busy ? 'Loading...' : 'Browse', onClick: () => run('knowledge-browse', { filters: { tag: browseTag, source: browseSource, per_page: '50' } }, setBrowseResult), disabled: busy }),
      ),
      h('div', { className: 'mt-4' }, h(JsonBox, { value: browseResult, emptyLabel: 'Browse results will appear here.' })));
    }

    if (tab === 'ingest') {
      body = h(Section, {
        title: 'Ingest Content',
        subtitle: 'Send text or selected files into daemon knowledge ingestion.',
      },
      h(TextAreaField, { label: 'Content', value: ingestContent, onChange: setIngestContent, placeholder: 'Paste text, markdown, notes, or extracted content to ingest.', rows: 8 }),
      h(TextAreaField, { label: 'Metadata JSON', value: metadataText, onChange: setMetadataText, placeholder: '{"tags":["notes"]}', rows: 5 }),
      h('div', { className: 'mt-4 flex flex-wrap gap-2' },
        h(ActionButton, {
          label: busy ? 'Ingesting...' : 'Ingest Text',
          onClick: () => {
            const metadata = parseJson(metadataText, {});
            if (metadata == null) {
              setError('Metadata JSON must be valid.');
              return;
            }
            void run('knowledge-ingest-content', { content: ingestContent, metadata }, setIngestResult);
          },
          disabled: busy || !ingestContent.trim(),
        }),
        h(ActionButton, { label: 'Pick File', onClick: () => { void pickFiles(); }, disabled: busy, variant: 'secondary' }),
        h(ActionButton, { label: 'Pick Directory', onClick: () => { void pickDirectory(); }, disabled: busy, variant: 'secondary' }),
      ),
      h('div', { className: 'mt-4' }, h(JsonBox, { value: ingestResult, emptyLabel: 'No ingest results yet.' })));
    }

    if (tab === 'monitors') {
      body = h(Section, {
        title: 'Corpus Monitors',
        subtitle: 'Manage daemon-side filesystem monitors for knowledge capture.',
        actions: [
          h(ActionButton, { key: 'refresh', label: 'Refresh', onClick: () => { void refreshMonitors(); }, variant: 'secondary' }),
        ],
      },
      h('div', { className: 'mb-4 flex flex-wrap gap-2' },
        h(ActionButton, { label: 'Choose Path And Add', onClick: async () => {
          const raw = await bridge?.dialog?.openFile?.();
          const filePath = raw?.files?.[0]?.path;
          if (filePath) {
            const slashIndex = filePath.lastIndexOf('/');
            const dirPath = slashIndex >= 0 ? filePath.slice(0, slashIndex) : filePath;
            await run('knowledge-monitor-add', { path: dirPath }, null);
            await refreshMonitors();
          }
        }, variant: 'secondary' }),
      ),
      monitors.length === 0
        ? h('p', { className: 'text-sm text-muted-foreground' }, 'No monitors are currently configured.')
        : h(
          'div',
          { className: 'space-y-2' },
          monitors.map((monitor) => h(
            'div',
            { key: monitor.id || monitor.path, className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
            h('div', { className: 'flex flex-wrap items-center justify-between gap-3' },
              h('div', { className: 'min-w-0 flex-1' },
                h('div', { className: 'text-sm font-medium break-all' }, monitor.path || monitor.id),
                h('div', { className: 'mt-1 text-xs text-muted-foreground' }, `${monitor.status || 'unknown'}${monitor.file_count != null ? ` • ${monitor.file_count} files` : ''}${monitor.last_scan ? ` • last scan ${fmtTime(monitor.last_scan)}` : ''}`),
              ),
              h('div', { className: 'flex flex-wrap gap-2' },
                h(ActionButton, { label: 'Scan', onClick: () => { void run('knowledge-monitor-scan', { id: monitor.id }, null).then(() => refreshMonitors()); }, variant: 'secondary' }),
                h(ActionButton, { label: 'Remove', onClick: () => { void run('knowledge-monitor-remove', { id: monitor.id }, null).then(() => refreshMonitors()); }, variant: 'danger' }),
              ),
            ),
          )),
        ));
    }

    if (tab === 'health') {
      body = h(Section, {
        title: 'Knowledge Health',
        subtitle: 'Inspect daemon Apollo health and run maintenance.',
        actions: [
          h(ActionButton, { key: 'refresh', label: 'Refresh', onClick: () => { void refreshHealth(); }, variant: 'secondary' }),
          h(ActionButton, { key: 'maintain', label: 'Run Maintenance', onClick: () => { void run('knowledge-maintain', {}, setHealthResult).then(() => refreshHealth()); }, variant: 'secondary' }),
        ],
      },
      h('div', { className: 'grid gap-4 xl:grid-cols-2' },
        h(JsonBox, { value: statusResult, emptyLabel: 'No knowledge status loaded yet.' }),
        h(JsonBox, { value: healthResult, emptyLabel: 'No Apollo stats loaded yet.' }),
      ));
    }

    if (tab === 'absorb') {
      body = h(Section, {
        title: 'Absorber Pipeline',
        subtitle: 'Resolve and dispatch absorber jobs through the daemon.',
      },
      h(TextAreaField, { label: 'Input', value: absorbInput, onChange: setAbsorbInput, placeholder: 'Describe what should be resolved or dispatched.', rows: 4 }),
      h(Field, { label: 'Job ID', value: jobId, onChange: setJobId, placeholder: 'Optional existing job id' }),
      h('div', { className: 'mt-4 flex flex-wrap gap-2' },
        h(ActionButton, { label: 'Resolve', onClick: () => run('absorber-resolve', { input: absorbInput }, setAbsorbResult), disabled: busy || !absorbInput.trim() }),
        h(ActionButton, { label: 'Dispatch', onClick: () => run('absorber-dispatch', { input: absorbInput }, setAbsorbResult), disabled: busy || !absorbInput.trim(), variant: 'secondary' }),
        h(ActionButton, { label: 'Lookup Job', onClick: () => run('absorber-job', { jobId }, setAbsorbResult), disabled: busy || !jobId.trim(), variant: 'secondary' }),
      ),
      h('div', { className: 'mt-4' }, h(JsonBox, { value: absorbResult, emptyLabel: 'No absorber result yet.' })));
    }

    return h(
      'div',
      { className: 'space-y-5' },
      error ? h('div', { className: 'rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-300' }, error) : null,
      h(SegmentTabs, { tabs, active: tab, onChange: setTab }),
      body,
    );
  }

  function MarketplaceView({ onAction }) {
    const [tab, setTab] = useState('browse');
    const [available, setAvailable] = useState([]);
    const [installed, setInstalled] = useState([]);
    const [selectedConfig, setSelectedConfig] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const loadAvailable = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await Promise.resolve(onAction?.('daemon-call', { path: '/api/extensions/available', quiet: true }));
        if (result?.ok === false) {
          setError(result.error || 'Failed to load marketplace listings.');
          setAvailable([]);
        } else {
          setAvailable(asArray(result?.data));
        }
      } catch (errorValue) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        setAvailable([]);
      } finally {
        setLoading(false);
      }
    };

    const loadInstalled = async () => {
      setLoading(true);
      setError('');
      try {
        const result = await Promise.resolve(onAction?.('daemon-call', { path: '/api/extensions', quiet: true }));
        if (result?.ok === false) {
          setError(result.error || 'Failed to load installed extensions.');
          setInstalled([]);
        } else {
          setInstalled(asArray(result?.data));
        }
      } catch (errorValue) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
        setInstalled([]);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => {
      if (tab === 'browse' && available.length === 0) {
        void loadAvailable();
      }
      if (tab === 'installed' && installed.length === 0) {
        void loadInstalled();
      }
    }, [tab]);

    const refresh = () => {
      if (tab === 'browse') {
        void loadAvailable();
      } else {
        void loadInstalled();
      }
    };

    const mutate = async (path, id) => {
      setLoading(true);
      setError('');
      try {
        const result = await Promise.resolve(onAction?.('daemon-call', {
          path: path.replace(':id', encodeURIComponent(id)),
          method: 'POST',
          body: {},
          refreshRuntime: true,
        }));
        if (result?.ok === false) {
          setError(result.error || 'Extension operation failed.');
        }
      } finally {
        setLoading(false);
        refresh();
      }
    };

    const loadConfig = async (id) => {
      setLoading(true);
      setError('');
      try {
        const result = await Promise.resolve(onAction?.('daemon-call', {
          path: `/api/extensions/${encodeURIComponent(id)}/config`,
          quiet: true,
        }));
        if (result?.ok === false) {
          setError(result.error || 'Failed to load extension config.');
          setSelectedConfig(null);
        } else {
          setSelectedConfig(result?.data || null);
        }
      } finally {
        setLoading(false);
      }
    };

    const list = tab === 'browse' ? available : installed;

    return h(
      'div',
      { className: 'space-y-5' },
      h(Section, {
        title: 'Extension Marketplace',
        subtitle: 'Browse daemon extension listings and manage installed packages.',
        actions: [
          h(ActionButton, { key: 'refresh', label: loading ? 'Refreshing...' : 'Refresh', onClick: refresh, disabled: loading, variant: 'secondary' }),
        ],
      },
      h(SegmentTabs, {
        tabs: [
          { key: 'browse', label: 'Browse' },
          { key: 'installed', label: 'Installed' },
        ],
        active: tab,
        onChange: setTab,
      })),
      error ? h('div', { className: 'rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-300' }, error) : null,
      list.length === 0 && !loading ? h(EmptyState, {
        title: tab === 'browse' ? 'No marketplace listings' : 'No installed extensions',
        body: tab === 'browse' ? 'Refresh to load available daemon extensions.' : 'No installed daemon extensions were returned.',
      }) : null,
      list.length > 0 ? h(
        'div',
        { className: 'space-y-2' },
        list.map((entry, index) => {
          const id = entry?.id || entry?.name || `extension-${index}`;
          const title = entry?.display_name || entry?.displayName || entry?.name || entry?.id || id;
          const description = entry?.description || entry?.summary || '';
          const enabled = entry?.enabled;
          return h(
            'div',
            { key: id, className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
            h('div', { className: 'flex flex-wrap items-start justify-between gap-3' },
              h('div', { className: 'min-w-0 flex-1' },
                h('div', { className: 'text-sm font-medium break-all' }, title),
                description ? h('p', { className: 'mt-1 text-sm text-muted-foreground' }, description) : null,
                h('div', { className: 'mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground' },
                  entry?.version ? h('span', null, `v${entry.version}`) : null,
                  entry?.category ? h('span', null, entry.category) : null,
                  tab === 'installed' && enabled != null ? h(Badge, { status: enabled ? 'success' : 'warning' }) : null,
                ),
              ),
              h('div', { className: 'flex flex-wrap gap-2' },
                tab === 'browse'
                  ? h(ActionButton, { label: 'Install', onClick: () => { void mutate('/api/extensions/:id/install', id); }, disabled: loading })
                  : null,
                tab === 'installed'
                  ? h(ActionButton, { label: enabled === false ? 'Enable' : 'Disable', onClick: () => { void mutate(enabled === false ? '/api/extensions/:id/enable' : '/api/extensions/:id/disable', id); }, disabled: loading, variant: 'secondary' })
                  : null,
                tab === 'installed'
                  ? h(ActionButton, { label: 'Config', onClick: () => { void loadConfig(id); }, disabled: loading, variant: 'secondary' })
                  : null,
                tab === 'installed'
                  ? h(ActionButton, { label: 'Uninstall', onClick: () => { void mutate('/api/extensions/:id/uninstall', id); }, disabled: loading, variant: 'danger' })
                  : null,
              ),
            ),
          );
        }),
      ) : null,
      h(Section, {
        title: 'Selected Extension Config',
        subtitle: 'A raw config payload from `/api/extensions/:id/config` for the most recently selected installed extension.',
      },
      h(JsonBox, { value: selectedConfig, emptyLabel: 'Select an installed extension and load its config to inspect it here.' })),
    );
  }

  function WorkflowsView({ pluginState, onAction }) {
    const [message, setMessage] = useState('');
    const [model, setModel] = useState('');
    const [tasks, setTasks] = useState([]);
    const [taskError, setTaskError] = useState('');
    const [busy, setBusy] = useState(false);
    const workflows = Array.isArray(pluginState?.workflows) ? pluginState.workflows : [];

    const loadTasks = async () => {
      setBusy(true);
      setTaskError('');
      try {
        const result = await Promise.resolve(onAction?.('daemon-call', { path: '/api/tasks', quiet: true }));
        if (result?.ok === false) {
          setTaskError(result.error || 'Failed to load daemon tasks.');
          setTasks([]);
        } else {
          setTasks(asArray(result?.data));
        }
      } catch (error) {
        setTaskError(error instanceof Error ? error.message : String(error));
        setTasks([]);
      } finally {
        setBusy(false);
      }
    };

    useEffect(() => {
      if (tasks.length === 0) {
        void loadTasks();
      }
    }, []);

    const createSubAgent = async () => {
      if (!message.trim()) return;
      setBusy(true);
      setTaskError('');
      try {
        const result = await Promise.resolve(onAction?.('create-subagent', {
          message: message.trim(),
          model: model.trim() || undefined,
          parentConversationId: pluginState?.proactiveConversationId || undefined,
        }));
        if (result?.ok === false) {
          setTaskError(result.error || 'Failed to create sub-agent.');
        } else {
          setMessage('');
          void loadTasks();
        }
      } finally {
        setBusy(false);
      }
    };

    return h(
      'div',
      { className: 'space-y-5' },
      h(Section, {
        title: 'Trigger Workflows',
        subtitle: 'Plugin-managed observe/act workflows routed from daemon trigger events.',
        actions: [
          h(ActionButton, { key: 'refresh-workflows', label: 'Refresh Workflow Status', onClick: () => { void onAction?.('refresh-workflows'); }, variant: 'secondary' }),
          h(ActionButton, { key: 'open-thread', label: 'Open Proactive Thread', onClick: () => { void onAction?.('open-proactive-thread'); }, variant: 'secondary' }),
        ],
      },
      workflows.length === 0
        ? h(EmptyState, { title: 'No workflows yet', body: 'Trigger events routed by the daemon will create workflows here when rules match.' })
        : h(
          'div',
          { className: 'space-y-2' },
          workflows.map((workflow) => h(
            'div',
            { key: workflow.id, className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
            h('div', { className: 'flex flex-wrap items-start justify-between gap-3' },
              h('div', { className: 'min-w-0 flex-1' },
                h('div', { className: 'text-sm font-medium' }, `${workflow.source} • ${workflow.eventType}`),
                h('div', { className: 'mt-1 text-xs text-muted-foreground' }, `${workflow.action} • started ${fmtTime(workflow.startedAt)}${workflow.taskId ? ` • task ${workflow.taskId}` : ''}`),
                workflow.summary ? h('p', { className: 'mt-2 text-sm text-muted-foreground' }, workflow.summary) : null,
                workflow.error ? h('p', { className: 'mt-2 text-sm text-red-600 dark:text-red-300' }, workflow.error) : null,
              ),
              h(Badge, { status: workflow.status }),
            ),
            workflow.payload ? h('details', { className: 'mt-3' },
              h('summary', { className: 'cursor-pointer text-xs text-muted-foreground' }, 'Payload'),
              h(JsonBox, { value: workflow.payload, emptyLabel: 'No payload.' }),
            ) : null,
          )),
        )),
      h(Section, {
        title: 'Daemon Sub-Agent Task',
        subtitle: 'Manually create a daemon sub-agent task and inspect the broader daemon task queue.',
      },
      h('div', { className: 'grid gap-4 lg:grid-cols-[1fr_220px]' },
        h(TextAreaField, { label: 'Task Message', value: message, onChange: setMessage, placeholder: 'Ask the Legion daemon to spawn a sub-agent for a bounded task.', rows: 5 }),
        h('div', { className: 'grid content-start gap-3' },
          h(Field, { label: 'Model', value: model, onChange: setModel, placeholder: 'Optional model override' }),
          h(ActionButton, { label: busy ? 'Creating...' : 'Create Sub-Agent', onClick: createSubAgent, disabled: busy || !message.trim() }),
          h(ActionButton, { label: 'Refresh Tasks', onClick: () => { void loadTasks(); }, disabled: busy, variant: 'secondary' }),
        ),
      )),
      taskError ? h('div', { className: 'rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-300' }, taskError) : null,
      tasks.length === 0 && !busy ? h(EmptyState, { title: 'No daemon tasks loaded', body: 'Refresh tasks to inspect the daemon queue.' }) : null,
      tasks.length > 0 ? h(
        'div',
        { className: 'space-y-2' },
        tasks.slice(0, 25).map((task, index) => h(
          'div',
          { key: task?.id || task?.task_id || index, className: 'rounded-2xl border border-border/60 bg-background/45 px-4 py-3' },
          h('div', { className: 'flex flex-wrap items-start justify-between gap-3' },
            h('div', { className: 'min-w-0 flex-1' },
              h('div', { className: 'text-sm font-medium break-all' }, task?.name || task?.title || task?.id || task?.task_id || `Task ${index + 1}`),
              h('div', { className: 'mt-1 text-xs text-muted-foreground' }, `${task?.created_at ? fmtAgo(task.created_at) : 'recent'}${task?.parent_id ? ` • parent ${task.parent_id}` : ''}`),
            ),
            h(Badge, { status: String(task?.status || 'unknown').toLowerCase() }),
          ),
        )),
      ) : null,
    );
  }

  function LegionWorkspace({ props, pluginState, pluginConfig, onAction }) {
    const view = props?.view || 'dashboard';

    if (view === 'dashboard') {
      return h(DashboardView, { pluginState, pluginConfig, onAction });
    }
    if (view === 'notifications') {
      return h(NotificationsView, { pluginState, pluginConfig, onAction });
    }
    if (view === 'operations') {
      return h(OperationsView, { pluginState, pluginConfig, onAction });
    }
    if (view === 'knowledge') {
      return h(KnowledgeView, { pluginState, pluginConfig, onAction });
    }
    if (view === 'github') {
      return h(GitHubView, { pluginState, pluginConfig, onAction });
    }
    if (view === 'marketplace') {
      return h(MarketplaceView, { pluginState, pluginConfig, onAction });
    }
    if (view === 'workflows') {
      return h(WorkflowsView, { pluginState, pluginConfig, onAction });
    }

    return h(EmptyState, { title: 'Unknown Legion view', body: `No renderer view is registered for "${view}".` });
  }

  registerComponents('legion', {
    LegionSettings,
    LegionWorkspace,
  });
}
