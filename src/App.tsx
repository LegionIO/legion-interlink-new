import { useState, useCallback, useEffect, useRef, type FC } from 'react';
import { ConfigProvider, useConfig } from '@/providers/ConfigProvider';
import { AttachmentProvider } from '@/providers/AttachmentContext';
import { RuntimeProvider, useSubAgents } from '@/providers/RuntimeProvider';
import { RealtimeProvider } from '@/providers/RealtimeProvider';
import { Thread, type ThreadMode } from '@/components/thread/Thread';
import { ComputerSessionPanel } from '@/components/thread/ComputerSessionPanel';
import { ComputerSetupPanel } from '@/components/thread/ComputerSetupPanel';
import { SubAgentThread } from '@/components/thread/SubAgentThread';
import { DropZone } from '@/components/thread/DropZone';
import { ConversationList } from '@/components/conversations/ConversationList';
import { SubAgentSidebarSection } from '@/components/conversations/SubAgentSidebarSection';
import { SettingsPanel } from '@/components/settings/SettingsPanel';
import { KnowledgePanel } from '@/components/knowledge/KnowledgePanel';
import { GitHubPanel } from '@/components/github/GitHubPanel';
import { MarketplacePanel } from '@/components/marketplace/MarketplacePanel';
import { CommandBar } from '@/components/CommandBar';
import { NotificationPanel } from '@/components/notifications/NotificationPanel';
import { DashboardPanel } from '@/components/dashboard/DashboardPanel';
import { KeyboardShortcutsOverlay } from '@/components/KeyboardShortcutsOverlay';
import { ExportDialog } from '@/components/conversations/ExportDialog';
import { SubAgentDashboard } from '@/components/subagents/SubAgentDashboard';
import { ToastContainer } from '@/components/notifications/ToastContainer';
import { NotificationProvider, useNotifications } from '@/providers/NotificationProvider';
import { PluginProvider } from '@/providers/PluginProvider';
import { PluginBannerSlot } from '@/components/plugins/PluginBannerSlot';
import { PluginModalHost } from '@/components/plugins/PluginModalHost';
import { ComputerUseProvider, useComputerUse } from '@/providers/ComputerUseProvider';
import { OverlayShell } from '@/components/overlay/OverlayShell';
import { BellIcon, BookOpenIcon, BotIcon, CpuIcon, DownloadIcon, GaugeIcon, GitBranchIcon, PuzzleIcon, SettingsIcon } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import type { ReasoningEffort } from '@/components/thread/ReasoningEffortSelector';
import { legion } from '@/lib/ipc-client';
import type { ConversationRecord } from '@/providers/RuntimeProvider';
import { shouldShowComputerSetup, type ComputerSession, type ComputerUseSurface } from '../shared/computer-use';

export default function App() {
  return (
    <ConfigProvider>
      <PluginProvider>
        <ComputerUseProvider>
          <NotificationProvider>
            <AppRoot />
          </NotificationProvider>
        </ComputerUseProvider>
      </PluginProvider>
    </ConfigProvider>
  );
}

function AppRoot() {
  const search = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const isOperatorWindow = search?.get('operator') === '1';
  const isOverlayWindow = search?.get('overlay') === '1';
  const isComputerSetupWindow = isOperatorWindow && search?.get('setup') === '1';
  const operatorSessionId = isOperatorWindow && !isComputerSetupWindow ? search.get('sessionId') : null;
  const operatorConversationId = isComputerSetupWindow ? search?.get('conversationId') : null;
  const overlaySessionId = isOverlayWindow ? search?.get('sessionId') ?? null : null;

  if (overlaySessionId) {
    return <OverlayShell sessionId={overlaySessionId} />;
  }

  if (isComputerSetupWindow) {
    return <ComputerSetupShell preferredConversationId={operatorConversationId} />;
  }

  if (operatorSessionId) {
    return <OperatorSessionShell sessionId={operatorSessionId} />;
  }

  return <AppShell />;
}

const OperatorSessionShell: FC<{ sessionId: string }> = ({ sessionId }) => {
  const { sessions, setSurface } = useComputerUse();
  const session = sessions.find((candidate) => candidate.id === sessionId) ?? null;

  return (
    <div className="h-screen overflow-hidden bg-background px-6 py-6 text-foreground">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Live Operator</div>
            <div className="text-xs text-muted-foreground">{session?.goal ? `Goal: ${session.goal}` : 'Waiting for session...'}</div>
          </div>
          <button
            type="button"
            onClick={() => { void setSurface(sessionId, 'docked'); }}
            className="rounded-xl border border-border/70 bg-card/70 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
          >
            Return to Docked View
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {session ? (
            <ComputerSessionPanel session={session} />
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center text-sm text-muted-foreground">
              Waiting for computer session state...
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

function useOperatorConversationId(preferredConversationId?: string | null): string | null {
  const [conversationId, setConversationId] = useState<string | null>(preferredConversationId ?? null);

  useEffect(() => {
    if (preferredConversationId) {
      setConversationId(preferredConversationId);
      return undefined;
    }

    let cancelled = false;
    legion.conversations.getActiveId()
      .then((id) => {
        if (!cancelled) setConversationId(id);
      })
      .catch(() => {
        if (!cancelled) setConversationId(null);
      });

    const unsubscribe = legion.conversations.onChanged((store) => {
      if (cancelled) return;
      const payload = store as { activeConversationId?: string | null } | null;
      setConversationId(payload?.activeConversationId ?? null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [preferredConversationId]);

  return conversationId;
}

const ComputerSetupShell: FC<{ preferredConversationId?: string | null }> = ({ preferredConversationId }) => {
  const conversationId = useOperatorConversationId(preferredConversationId);
  const { sessionsByConversation } = useComputerUse();
  const activeComputerSession = getComputerSessionForConversation(conversationId, sessionsByConversation);
  const showComputerSetup = shouldShowComputerSetup(activeComputerSession);
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const [selectedProfileKey, setSelectedProfileKey] = useState<string | null>(null);
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [profilePrimaryModelKey, setProfilePrimaryModelKey] = useState<string | null>(null);

  useEffect(() => {
    if (!conversationId) {
      setSelectedModelKey(null);
      setSelectedProfileKey(null);
      setFallbackEnabled(false);
      setProfilePrimaryModelKey(null);
      return;
    }

    let cancelled = false;
    legion.conversations.get(conversationId)
      .then((conversation) => {
        if (cancelled) return;
        const record = conversation as {
          selectedModelKey?: string | null;
          selectedProfileKey?: string | null;
          fallbackEnabled?: boolean;
          profilePrimaryModelKey?: string | null;
        } | null;
        setSelectedModelKey(record?.selectedModelKey ?? null);
        setSelectedProfileKey(record?.selectedProfileKey ?? null);
        setFallbackEnabled(record?.fallbackEnabled ?? false);
        setProfilePrimaryModelKey(record?.profilePrimaryModelKey ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setSelectedModelKey(null);
        setSelectedProfileKey(null);
        setFallbackEnabled(false);
        setProfilePrimaryModelKey(null);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    legion.conversations.get(conversationId).then((conv: unknown) => {
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
  }, [conversationId, fallbackEnabled, profilePrimaryModelKey, selectedModelKey, selectedProfileKey]);

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

  const handleToggleFallback = useCallback((enabled: boolean) => {
    setFallbackEnabled(enabled);
    if (enabled && selectedProfileKey && profilePrimaryModelKey) {
      setSelectedModelKey(profilePrimaryModelKey);
    }
  }, [profilePrimaryModelKey, selectedProfileKey]);

  return (
    <div className="h-screen overflow-hidden bg-background px-6 py-6 text-foreground">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4">
        <div className="rounded-2xl border border-border/70 bg-card/60 px-4 py-3">
          <div className="text-sm font-semibold">{showComputerSetup ? 'Computer Setup' : 'Computer Session'}</div>
          <div className="text-xs text-muted-foreground">
            {showComputerSetup
              ? 'Configure your session here. Starting will open the live operator view.'
              : 'A session is currently active. Setup options will return when it finishes.'}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="rounded-[1.7rem] border border-border/70 bg-card/78 px-3 py-3 shadow-[inset_0_0_0_1px_rgba(197,194,245,0.08),0_12px_40px_rgba(5,4,15,0.18)]">
            {showComputerSetup ? (
              <ComputerSetupPanel
                conversationId={conversationId}
                selectedModelKey={selectedModelKey}
                onSelectModel={setSelectedModelKey}
                reasoningEffort={reasoningEffort}
                onChangeReasoningEffort={setReasoningEffort}
                selectedProfileKey={selectedProfileKey}
                onSelectProfile={handleSelectProfile}
                fallbackEnabled={fallbackEnabled}
                onToggleFallback={handleToggleFallback}
                startSurface="window"
                activeComputerSession={activeComputerSession}
              />
            ) : activeComputerSession ? (
              <ComputerSessionPanel session={activeComputerSession} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 520;

function clampSidebarWidth(width: number) {
  return Math.min(Math.max(width, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
}

function getConversationDisplayTitle(
  conversation: Pick<ConversationRecord, 'title' | 'fallbackTitle'> | null,
  computerSessions?: ComputerSession[],
) {
  // Prefer chat-based titles
  const chatTitle = conversation?.title?.trim() || conversation?.fallbackTitle?.trim();
  if (chatTitle) return chatTitle;

  // Fall back to computer-use session goal if available
  if (computerSessions?.length) {
    const goal = computerSessions[0].goal;
    if (goal) {
      const truncated = goal.length > 60 ? goal.slice(0, 57).trimEnd() + '...' : goal;
      return truncated;
    }
  }

  return 'New Conversation';
}

function getComputerSessionForConversation(
  conversationId: string | null | undefined,
  sessionsByConversation: Map<string, ComputerSession[]>,
): ComputerSession | undefined {
  if (!conversationId) return undefined;
  return sessionsByConversation.get(conversationId)?.[0];
}

function isDisposableNewConversation(conversation: ConversationRecord | null, hasComputerSessions = false): boolean {
  if (!conversation) return false;
  if (hasComputerSessions) return false; // Never auto-delete conversations with computer-use history

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
  sessionsByConversation?: Map<string, ComputerSession[]>,
): Promise<string[]> {
  try {
    const list = existingList ?? (await legion.conversations.list()) as ConversationRecord[];
    const disposableIds = list
      .filter((conv) => conv.id !== activeId && isDisposableNewConversation(conv, Boolean(sessionsByConversation?.has(conv.id))))
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

type AppView = 'chat' | 'dashboard' | 'settings' | 'knowledge' | 'github' | 'marketplace' | 'notifications' | 'subagents';

function AppShell() {
  const { unreadCount } = useNotifications();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversationTitle, setActiveConversationTitle] = useState('New Conversation');
  const [activeView, setActiveView] = useState<AppView>('chat');
  const [threadMode, setThreadMode] = useState<ThreadMode>('chat');
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium');
  const [selectedProfileKey, setSelectedProfileKey] = useState<string | null>(null);
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const { sessionsByConversation: cuSessionsByConversation } = useComputerUse();
  // Track the primary model key of the currently selected profile so we can
  // restore it when auto-routing is re-enabled.
  const [profilePrimaryModelKey, setProfilePrimaryModelKey] = useState<string | null>(null);
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
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
      setActiveConversationTitle(getConversationDisplayTitle(
        conversation,
        resolvedActiveId ? cuSessionsByConversation.get(resolvedActiveId) : undefined,
      ));
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
        void cleanupEmptyConversations(id, list as ConversationRecord[], cuSessionsByConversation);
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

  // Update conversation title when computer-use sessions become available
  // (sessions load async, so the title may initially be "New Conversation")
  useEffect(() => {
    if (!activeConversationId || activeConversationTitle !== 'New Conversation') return;
    const sessions = cuSessionsByConversation.get(activeConversationId);
    if (sessions?.length) {
      const goal = sessions[0].goal;
      if (goal) {
        setActiveConversationTitle(goal.length > 60 ? goal.slice(0, 57).trimEnd() + '...' : goal);
      }
    }
  }, [activeConversationId, activeConversationTitle, cuSessionsByConversation]);

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
      const hasComputerSessions = cuSessionsByConversation.has(activeConversationId);
      if (!isDisposableNewConversation(conversation, hasComputerSessions)) return;

      await legion.conversations.delete(activeConversationId);
      setActiveConversationId(null);
      setActiveConversationTitle('New Conversation');
    } catch {
      // Leave the current conversation intact if cleanup fails.
    }
  }, [activeConversationId, cuSessionsByConversation]);

  const handleSwitchConversation = useCallback(async (id: string) => {
    const { legion } = await import('@/lib/ipc-client');
    await cleanupAbandonedConversation(id);
    await legion.conversations.setActiveId(id);
    setActiveView('chat');
    setActiveConversationId(id);
    // Clean up any other empty conversations in the background
    void cleanupEmptyConversations(id, undefined, cuSessionsByConversation);
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
    setActiveView('chat');
    setActiveConversationId(newId);
    // Reset per-conversation settings for the new conversation
    setSelectedModelKey(null);
    setSelectedProfileKey(null);
    setFallbackEnabled(false);
    setProfilePrimaryModelKey(null);
  }, [cleanupAbandonedConversation]);

  const handleSettingsToggle = useCallback(async () => {
    if (activeView !== 'settings') {
      await cleanupAbandonedConversation();
    }
    setActiveView((v) => v === 'settings' ? 'chat' : 'settings');
  }, [cleanupAbandonedConversation, activeView]);

  const handleOpenSettings = useCallback(async () => {
    await cleanupAbandonedConversation();
    setActiveView('settings');
  }, [cleanupAbandonedConversation]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      switch (e.key) {
        case 'k': e.preventDefault(); setCommandBarOpen((v) => !v); break;
        case '?': e.preventDefault(); setShortcutsOpen((v) => !v); break;
        case '1': e.preventDefault(); setActiveView((v) => v === 'dashboard' ? 'chat' : 'dashboard'); break;
        case '2': e.preventDefault(); setActiveView((v) => v === 'knowledge' ? 'chat' : 'knowledge'); break;
        case '3': e.preventDefault(); setActiveView((v) => v === 'github' ? 'chat' : 'github'); break;
        case '4': e.preventDefault(); setActiveView((v) => v === 'marketplace' ? 'chat' : 'marketplace'); break;
        case '5': e.preventDefault(); setActiveView((v) => v === 'notifications' ? 'chat' : 'notifications'); break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

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
      <ComputerUseAutoNavigator
        activeConversationId={activeConversationId}
        onRevealComputerSurface={() => {
          setActiveView('chat');
          setThreadMode('computer');
        }}
      />
      <RealtimeProvider>
        <PluginModalHost />
        <CommandBar open={commandBarOpen} onClose={() => setCommandBarOpen(false)} />
        <KeyboardShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} conversationId={activeConversationId} />
        <ToastContainer />
        <div className="flex h-screen overflow-hidden bg-transparent text-foreground">
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
                  activeThreadMode={threadMode}
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
                <button
                  type="button"
                  onClick={() => setActiveView(activeView === 'dashboard' ? 'chat' : 'dashboard')}
                  className={`rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/80 ${activeView === 'dashboard' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
                  title="Dashboard"
                >
                  <GaugeIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView(activeView === 'knowledge' ? 'chat' : 'knowledge')}
                  className={`rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/80 ${activeView === 'knowledge' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
                  title="Knowledge"
                >
                  <BookOpenIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView(activeView === 'github' ? 'chat' : 'github')}
                  className={`rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/80 ${activeView === 'github' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
                  title="GitHub"
                >
                  <GitBranchIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView(activeView === 'marketplace' ? 'chat' : 'marketplace')}
                  className={`rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/80 ${activeView === 'marketplace' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
                  title="Extensions"
                >
                  <PuzzleIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView(activeView === 'subagents' ? 'chat' : 'subagents')}
                  className={`rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/80 ${activeView === 'subagents' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
                  title="Sub-Agents"
                >
                  <BotIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActiveView(activeView === 'notifications' ? 'chat' : 'notifications')}
                  className={`relative rounded-md p-1.5 transition-colors hover:bg-sidebar-accent/80 ${activeView === 'notifications' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
                  title="Notifications"
                >
                  <BellIcon className="h-4 w-4" />
                  {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
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
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="titlebar-drag flex h-14 items-center justify-between border-b border-border/70 bg-background/85 px-6 backdrop-blur-md">
              <div className="titlebar-no-drag min-w-0">
                {activeView === 'settings' ? (
                  <span className="text-sm font-medium text-foreground">Settings</span>
                ) : activeView === 'knowledge' ? (
                  <span className="text-sm font-medium text-foreground">Knowledge</span>
                ) : activeView === 'github' ? (
                  <span className="text-sm font-medium text-foreground">GitHub</span>
                ) : activeView === 'marketplace' ? (
                  <span className="text-sm font-medium text-foreground">Extensions</span>
                ) : activeView === 'notifications' ? (
                  <span className="text-sm font-medium text-foreground">Notifications</span>
                ) : activeView === 'dashboard' ? (
                  <span className="text-sm font-medium text-foreground">Dashboard</span>
                ) : activeView === 'subagents' ? (
                  <span className="text-sm font-medium text-foreground">Sub-Agents</span>
                ) : (
                  <span className="block truncate text-sm font-medium text-foreground">
                    {activeConversationTitle}
                  </span>
                )}
              </div>
              {activeView === 'chat' && activeConversationId && (
                <button
                  type="button"
                  onClick={() => setExportOpen(true)}
                  className="titlebar-no-drag rounded-md p-1.5 text-muted-foreground hover:bg-muted/40 transition-colors"
                  title="Export conversation"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <PluginBannerSlot />
            <div className="min-h-0 flex-1 overflow-hidden">
              {activeView === 'settings' ? (
                <SettingsPanel onClose={() => setActiveView('chat')} />
              ) : activeView === 'knowledge' ? (
                <KnowledgePanel onClose={() => setActiveView('chat')} />
              ) : activeView === 'github' ? (
                <GitHubPanel onClose={() => setActiveView('chat')} />
              ) : activeView === 'marketplace' ? (
                <MarketplacePanel onClose={() => setActiveView('chat')} />
              ) : activeView === 'notifications' ? (
                <NotificationPanel onClose={() => setActiveView('chat')} />
              ) : activeView === 'dashboard' ? (
                <DashboardPanel onClose={() => setActiveView('chat')} />
              ) : activeView === 'subagents' ? (
                <SubAgentDashboard onClose={() => setActiveView('chat')} />
              ) : (
                <ThreadOrSubAgent
                  mode={threadMode}
                  onChangeMode={setThreadMode}
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

const ComputerUseAutoNavigator: FC<{
  activeConversationId: string | null;
  onRevealComputerSurface: () => void;
}> = ({ activeConversationId, onRevealComputerSurface }) => {
  const { sessionsByConversation } = useComputerUse();
  const { setActiveSubAgentView } = useSubAgents();
  const hydratedRef = useRef(false);
  const knownSessionsRef = useRef(new Map<string, { surface: ComputerUseSurface }>());
  const activeSession = getComputerSessionForConversation(activeConversationId, sessionsByConversation) ?? null;

  useEffect(() => {
    const nextKnown = new Map<string, { surface: ComputerUseSurface }>();
    for (const sessionList of sessionsByConversation.values()) {
      for (const session of sessionList) {
        nextKnown.set(session.id, { surface: session.surface });
      }
    }

    if (!hydratedRef.current) {
      knownSessionsRef.current = nextKnown;
      hydratedRef.current = true;
      return;
    }

    if (!activeSession) {
      knownSessionsRef.current = nextKnown;
      return;
    }

    const previous = knownSessionsRef.current.get(activeSession.id);
    const shouldReveal = activeSession.surface === 'docked'
      && activeSession.status !== 'completed'
      && activeSession.status !== 'failed'
      && activeSession.status !== 'stopped'
      && (!previous || previous.surface !== 'docked');

    knownSessionsRef.current = nextKnown;

    if (!shouldReveal) return;

    setActiveSubAgentView(null);
    onRevealComputerSurface();
  }, [activeSession, onRevealComputerSurface, sessionsByConversation, setActiveSubAgentView]);

  return null;
};

/** Switches between the main Thread and a SubAgentThread view */
const ThreadOrSubAgent: FC<{
  mode: ThreadMode;
  onChangeMode: (mode: ThreadMode) => void;
  selectedModelKey: string | null;
  onSelectModel: (key: string) => void;
  reasoningEffort: ReasoningEffort;
  onChangeReasoningEffort: (value: ReasoningEffort) => void;
  selectedProfileKey: string | null;
  onSelectProfile: (key: string | null, primaryModelKey: string | null) => void;
  fallbackEnabled: boolean;
  onToggleFallback: (value: boolean) => void;
}> = ({ mode, onChangeMode, selectedModelKey, onSelectModel, reasoningEffort, onChangeReasoningEffort, selectedProfileKey, onSelectProfile, fallbackEnabled, onToggleFallback }) => {
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
      mode={mode}
      onChangeMode={onChangeMode}
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
