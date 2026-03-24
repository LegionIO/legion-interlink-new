import { useState, useCallback, useEffect, type FC } from 'react';
import { ConfigProvider, useConfig } from '@/providers/ConfigProvider';
import { AttachmentProvider } from '@/providers/AttachmentContext';
import { RuntimeProvider, useSubAgents } from '@/providers/RuntimeProvider';
import { RealtimeProvider } from '@/providers/RealtimeProvider';
import { Thread } from '@/components/thread/Thread';
import { SubAgentThread } from '@/components/thread/SubAgentThread';
import { DropZone } from '@/components/thread/DropZone';
import { ConversationList } from '@/components/conversations/ConversationList';
import { SubAgentSidebarSection } from '@/components/conversations/SubAgentSidebarSection';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { PluginProvider } from '@/providers/PluginProvider';
import { PluginBannerSlot } from '@/components/plugins/PluginBannerSlot';
import { PluginModalHost } from '@/components/plugins/PluginModalHost';
import { CpuIcon, SettingsIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { ReasoningEffort } from '@/components/thread/ReasoningEffortSelector';
import { legion } from '@/lib/ipc-client';
import type { ConversationRecord } from '@/providers/RuntimeProvider';

export default function App() {
  return (
    <ConfigProvider>
      <PluginProvider>
        <AppShell />
      </PluginProvider>
    </ConfigProvider>
  );
}

const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 520;

function clampSidebarWidth(width: number) {
  return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

function getConversationDisplayTitle(conversation: Pick<ConversationRecord, 'title' | 'fallbackTitle'> | null) {
  return conversation?.title?.trim() || conversation?.fallbackTitle?.trim() || 'New Conversation';
}

function isDisposableNewConversation(conversation: ConversationRecord | null): boolean {
  if (!conversation) return false;

  const hasMessages = Array.isArray(conversation.messages) && conversation.messages.length > 0;
  const hasTreeMessages = Array.isArray(conversation.messageTree) && conversation.messageTree.length > 0;
  const hasTitle = Boolean(conversation.title?.trim() || conversation.fallbackTitle?.trim());

  return !hasTitle
    && !hasMessages
    && !hasTreeMessages
    && (conversation.messageCount ?? 0) === 0
    && (conversation.userMessageCount ?? 0) === 0
    && conversation.runStatus === 'idle';
}

type ConversationsStore = {
  conversations?: Record<string, ConversationRecord>;
  activeConversationId?: string | null;
};

/**
 * Delete all empty "New Conversation" entries except the currently active one.
 * If a conversation list is provided, uses it directly; otherwise fetches from IPC.
 * Returns the IDs of deleted conversations (for animation).
 */
async function cleanupEmptyConversations(
  activeId?: string | null,
  existingList?: ConversationRecord[],
): Promise<string[]> {
  try {
    const list = existingList ?? (await legion.conversations.list()) as ConversationRecord[];
    const disposableIds = list
      .filter((conv) => conv.id !== activeId && isDisposableNewConversation(conv))
      .map((conv) => conv.id);

    if (disposableIds.length === 0) return [];

    console.info(`[Conversations] Cleaning up ${disposableIds.length} empty conversations`);
    await Promise.all(disposableIds.map((id) => legion.conversations.delete(id)));
    return disposableIds;
  } catch (err) {
    console.warn('[Conversations] Cleanup failed:', err);
    return [];
  }
}

function AppShell() {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState('New Conversation');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const [selectedProfileKey, setSelectedProfileKey] = useState<string | null>(null);
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  // Track the primary model key of the currently selected profile so we can
  // restore it when auto-routing is re-enabled.
  const [profilePrimaryModelKey, setProfilePrimaryModelKey] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [dragState, setDragState] = useState<{ startX: number; startWidth: number } | null>(null);
  const { config, updateConfig } = useConfig();

  useEffect(() => {
    const ui = config?.ui as { sidebarWidth?: number } | undefined;
    if (typeof ui?.sidebarWidth === 'number') {
      setSidebarWidth(clampSidebarWidth(ui.sidebarWidth));
    }
  }, [config]);

  useEffect(() => {
    let cancelled = false;

    const applyStore = (store: ConversationsStore | null) => {
      if (cancelled) return;
      const resolvedActiveId = store?.activeConversationId ?? null;
      const conversation = resolvedActiveId && store?.conversations
        ? store.conversations[resolvedActiveId] ?? null
        : null;

      setActiveConversationId(resolvedActiveId);
      setActiveConversationTitle(getConversationDisplayTitle(conversation));
    };

    const loadActiveConversation = async () => {
      try {
        const [id, list] = await Promise.all([
          legion.conversations.getActiveId(),
          legion.conversations.list(),
        ]);
        if (cancelled) return;

        const conversations = Object.fromEntries(
          (list as ConversationRecord[]).map((conversation) => [conversation.id, conversation]),
        );
        applyStore({ activeConversationId: id, conversations });

        // Clean up historical empty conversations on load
        void cleanupEmptyConversations(id, list as ConversationRecord[]);
      } catch {
        if (!cancelled) {
          setActiveConversationId(null);
          setActiveConversationTitle('New Conversation');
        }
      }
    };

    void loadActiveConversation();
    const unsubscribe = legion.conversations.onChanged((store) => {
      applyStore(store as ConversationsStore);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!dragState) return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const delta = event.clientX - dragState.startX;
      setSidebarWidth(clampSidebarWidth(dragState.startWidth + delta));
    };

    const finishResize = () => {
      const finalWidth = clampSidebarWidth(sidebarWidth);
      setSidebarWidth(finalWidth);
      setDragState(null);
      void updateConfig('ui.sidebarWidth', finalWidth);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
    };
  }, [dragState, sidebarWidth, updateConfig]);

  const cleanupAbandonedConversation = useCallback(async (nextConversationId?: string | null) => {
    if (!activeConversationId || activeConversationId === nextConversationId) return;

    try {
      const conversation = await legion.conversations.get(activeConversationId) as ConversationRecord | null;
      if (!isDisposableNewConversation(conversation)) return;

      await legion.conversations.delete(activeConversationId);
      setActiveConversationId(null);
      setActiveConversationTitle('New Conversation');
    } catch {
      // Leave the current conversation intact if cleanup fails.
    }
  }, [activeConversationId]);

  const handleSwitchConversation = useCallback(async (id: string) => {
    const { legion } = await import('@/lib/ipc-client');
    await cleanupAbandonedConversation(id);
    await legion.conversations.setActiveId(id);
    setSettingsOpen(false);
    setActiveConversationId(id);
    // Clean up any other empty conversations in the background
    void cleanupEmptyConversations(id);
  }, [cleanupAbandonedConversation]);

  const handleNewConversation = useCallback(async () => {
    const { legion } = await import('@/lib/ipc-client');
    await cleanupAbandonedConversation();
    const newId = crypto.randomUUID();
    const now = new Date().toISOString();
    await legion.conversations.put({
      id: newId, title: null, fallbackTitle: null, messages: [],
      conversationCompaction: null, lastContextUsage: null,
      createdAt: now, updatedAt: now, lastMessageAt: null,
      titleStatus: 'idle', titleUpdatedAt: null,
      messageCount: 0, userMessageCount: 0,
      runStatus: 'idle', hasUnread: false, lastAssistantUpdateAt: null,
      selectedModelKey: null,
    });
    await legion.conversations.setActiveId(newId);
    setSettingsOpen(false);
    setActiveConversationId(newId);
    // Reset per-conversation settings for the new conversation
    setSelectedModelKey(null);
    setSelectedProfileKey(null);
    setFallbackEnabled(false);
    setProfilePrimaryModelKey(null);
  }, [cleanupAbandonedConversation]);

  const handleSettingsToggle = useCallback(async () => {
    if (!settingsOpen) {
      await cleanupAbandonedConversation();
    }
    setSettingsOpen((open) => !open);
  }, [cleanupAbandonedConversation, settingsOpen]);

  const handleOpenSettings = useCallback(async () => {
    await cleanupAbandonedConversation();
    setSettingsOpen(true);
  }, [cleanupAbandonedConversation]);

  // Listen for Cmd+, / menu Settings
  useEffect(() => {
    const cleanup = window.legion?.onMenuOpenSettings(() => {
      void handleOpenSettings();
    });
    return cleanup;
  }, [handleOpenSettings]);

  // Listen for AI-initiated model switches
  useEffect(() => {
    if (!window.legion?.onModelSwitched) return;
    const cleanup = window.legion.onModelSwitched((modelKey) => setSelectedModelKey(modelKey));
    return cleanup;
  }, []);

  // When selecting a non-default profile, auto-enable fallback routing and
  // update the model selector to show the profile's primary model.
  const handleSelectProfile = useCallback((key: string | null, primaryModelKey: string | null) => {
    setSelectedProfileKey(key);
    setProfilePrimaryModelKey(primaryModelKey);
    if (key !== null) {
      setFallbackEnabled(true);
      if (primaryModelKey) setSelectedModelKey(primaryModelKey);
    } else {
      setFallbackEnabled(false);
      setSelectedModelKey(null);
    }
  }, []);

  // When toggling auto-routing back ON with an active profile, restore the
  // profile's primary model in the model selector.
  const handleToggleFallback = useCallback((enabled: boolean) => {
    setFallbackEnabled(enabled);
    if (enabled && selectedProfileKey && profilePrimaryModelKey) {
      setSelectedModelKey(profilePrimaryModelKey);
    }
  }, [selectedProfileKey, profilePrimaryModelKey]);

  // Restore per-conversation settings when switching conversations
  const handleConversationSettingsLoaded = useCallback((settings: {
    selectedModelKey: string | null;
    selectedProfileKey: string | null;
    fallbackEnabled: boolean;
    profilePrimaryModelKey: string | null;
  }) => {
    setSelectedModelKey(settings.selectedModelKey);
    setSelectedProfileKey(settings.selectedProfileKey);
    setFallbackEnabled(settings.fallbackEnabled);
    setProfilePrimaryModelKey(settings.profilePrimaryModelKey);
  }, []);

  // Persist per-conversation settings whenever they change
  useEffect(() => {
    if (!activeConversationId) return;
    legion.conversations.get(activeConversationId).then((conv: unknown) => {
      const record = conv as Record<string, unknown> | null;
      if (!record) return;
      legion.conversations.put({
        ...record,
        selectedModelKey,
        selectedProfileKey,
        fallbackEnabled,
        profilePrimaryModelKey,
        updatedAt: new Date().toISOString(),
      } as any);
    }).catch(() => {});
  }, [activeConversationId, selectedModelKey, selectedProfileKey, fallbackEnabled, profilePrimaryModelKey]);

  return (
    <AttachmentProvider>
      <DropZone>
      <RuntimeProvider
        conversationId={activeConversationId}
        selectedModelKey={selectedModelKey}
        reasoningEffort={reasoningEffort}
        selectedProfileKey={selectedProfileKey}
        fallbackEnabled={fallbackEnabled}
        onModelFallback={setSelectedModelKey}
        onConversationSettingsLoaded={handleConversationSettingsLoaded}
      >
      <RealtimeProvider>
        <PluginModalHost />
        <div className="flex h-full bg-transparent text-foreground">
          {/* Sidebar */}
          <aside
            className="legion-shell-panel flex h-full shrink-0 flex-col border-r border-sidebar-border/80 bg-sidebar text-sidebar-foreground"
            style={{ width: `${sidebarWidth}px` }}
          >
            <div className="titlebar-drag relative flex h-14 items-center justify-center border-b border-sidebar-border/80 px-4">
              <div className="pointer-events-none absolute inset-y-0 left-0 w-20" />
              <span className="titlebar-no-drag inline-flex items-center gap-0.5 text-sm font-medium text-sidebar-foreground">
                <span className="legion-gradient-text legion-wordmark">INTERLINK</span>
                <CpuIcon className="h-4 w-4 text-primary/80" />
              </span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ConversationList
                  activeConversationId={activeConversationId}
                  onSwitchConversation={handleSwitchConversation}
                  onNewConversation={handleNewConversation}
                />
              </div>
              <div className="shrink-0">
                <SubAgentSidebarSection />
              </div>
              <div className="flex items-center gap-2 border-t border-sidebar-border/80 px-4 py-3">
                <button
                  type="button"
                  onClick={() => { void handleSettingsToggle(); }}
                  className="titlebar-no-drag flex flex-1 items-center gap-2 rounded-xl px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  title="Settings"
                >
                  <SettingsIcon className="h-4 w-4" />
                  Settings
                </button>
                <ThemeToggle />
              </div>
            </div>
          </aside>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left navigation"
            aria-valuenow={sidebarWidth}
            aria-valuemin={SIDEBAR_MIN_WIDTH}
            aria-valuemax={SIDEBAR_MAX_WIDTH}
            onPointerDown={(event) => {
              event.preventDefault();
              setDragState({ startX: event.clientX, startWidth: sidebarWidth });
            }}
            className="group relative -ml-px h-full w-2 shrink-0 cursor-col-resize bg-transparent"
          >
            <div className="absolute inset-y-0 left-0 w-px bg-border/40 transition-colors group-hover:bg-primary/50" />
          </div>

          {/* Main content area */}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="titlebar-drag flex h-14 items-center justify-between border-b border-border/70 bg-background/85 px-6 backdrop-blur-md">
              <div className="titlebar-no-drag min-w-0">
                {settingsOpen ? (
                  <span className="text-sm font-medium text-foreground">Settings</span>
                ) : (
                  <span className="block truncate text-sm font-medium text-foreground">
                    {activeConversationTitle}
                  </span>
                )}
              </div>
            </div>
            <PluginBannerSlot />
            <div className="flex-1 min-h-0">
              {settingsOpen ? (
                <SettingsPanel onClose={() => setSettingsOpen(false)} />
              ) : (
                <ThreadOrSubAgent
                  selectedModelKey={selectedModelKey}
                  onSelectModel={setSelectedModelKey}
                  reasoningEffort={reasoningEffort}
                  onChangeReasoningEffort={setReasoningEffort}
                  selectedProfileKey={selectedProfileKey}
                  onSelectProfile={handleSelectProfile}
                  fallbackEnabled={fallbackEnabled}
                  onToggleFallback={handleToggleFallback}
                />
              )}
            </div>
          </main>
        </div>
      </RealtimeProvider>
      </RuntimeProvider>
    </DropZone>
    </AttachmentProvider>
  );
}

/** Switches between the main Thread and a SubAgentThread view */
const ThreadOrSubAgent: FC<{
  selectedModelKey: string | null;
  onSelectModel: (key: string) => void;
  reasoningEffort: ReasoningEffort;
  onChangeReasoningEffort: (value: ReasoningEffort) => void;
  selectedProfileKey: string | null;
  onSelectProfile: (key: string | null, primaryModelKey: string | null) => void;
  fallbackEnabled: boolean;
  onToggleFallback: (value: boolean) => void;
}> = ({ selectedModelKey, onSelectModel, reasoningEffort, onChangeReasoningEffort, selectedProfileKey, onSelectProfile, fallbackEnabled, onToggleFallback }) => {
  const { activeSubAgentView, setActiveSubAgentView } = useSubAgents();

  if (activeSubAgentView) {
    return (
      <SubAgentThread
        subAgentConversationId={activeSubAgentView}
        onBack={() => setActiveSubAgentView(null)}
      />
    );
  }

  return (
    <Thread
      selectedModelKey={selectedModelKey}
      onSelectModel={onSelectModel}
      reasoningEffort={reasoningEffort}
      onChangeReasoningEffort={onChangeReasoningEffort}
      selectedProfileKey={selectedProfileKey}
      onSelectProfile={onSelectProfile}
      fallbackEnabled={fallbackEnabled}
      onToggleFallback={onToggleFallback}
    />
  );
};
