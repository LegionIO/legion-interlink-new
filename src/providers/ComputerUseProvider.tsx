import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { legion } from '@/lib/ipc-client';
import type {
  ComputerSession,
  ComputerFrame,
  ComputerUseApprovalMode,
  ComputerUseEvent,
  ComputerUsePermissions,
  ComputerUsePermissionRequestResult,
  ComputerUsePermissionSection,
  ComputerUseSurface,
  ComputerUseTarget,
} from '../../shared/computer-use';

export type ComputerUseFallbackBanner = {
  sessionId: string;
  fromModel: string;
  toModel: string;
  error: string;
};

type ConversationMessageLike = {
  id?: string;
  parentId?: string | null;
  role?: string;
  content?: unknown;
};

type ConversationRecordLike = {
  title?: string | null;
  fallbackTitle?: string | null;
  messages?: unknown[];
  messageTree?: ConversationMessageLike[];
  headId?: string | null;
};

type OpenPrivacySettingsResult = {
  opened: ComputerUsePermissionSection | null;
};

type ComputerUseContextValue = {
  sessions: ComputerSession[];
  sessionsByConversation: Map<string, ComputerSession[]>;
  /** Map of sessionId -> ordered list of captured frames (for step log traceability). */
  frameHistory: Map<string, ComputerFrame[]>;
  startSession: (goal: string, options: {
    conversationId: string;
    target?: ComputerUseTarget;
    surface?: ComputerUseSurface;
    approvalMode?: ComputerUseApprovalMode;
    modelKey?: string | null;
    profileKey?: string | null;
    fallbackEnabled?: boolean;
    reasoningEffort?: string;
  }) => Promise<ComputerSession>;
  pauseSession: (sessionId: string) => Promise<void>;
  resumeSession: (sessionId: string) => Promise<void>;
  stopSession: (sessionId: string) => Promise<void>;
  approveAction: (sessionId: string, actionId: string) => Promise<void>;
  rejectAction: (sessionId: string, actionId: string, reason?: string) => Promise<void>;
  setSurface: (sessionId: string, surface: ComputerUseSurface) => Promise<void>;
  sendGuidance: (sessionId: string, text: string) => Promise<void>;
  continueSession: (sessionId: string, newGoal: string) => Promise<ComputerSession | null>;
  updateSessionSettings: (sessionId: string, settings: { modelKey?: string | null; profileKey?: string | null; fallbackEnabled?: boolean; reasoningEffort?: string }) => Promise<void>;
  fallbackBanner: ComputerUseFallbackBanner | null;
  dismissFallbackBanner: () => void;
  checkLocalMacosPermissions: () => Promise<ComputerUsePermissions>;
  requestLocalMacosPermissions: () => Promise<ComputerUsePermissionRequestResult>;
  openLocalMacosPrivacySettings: (section?: ComputerUsePermissionSection) => Promise<OpenPrivacySettingsResult>;
  probeInputMonitoring: (timeoutMs?: number) => Promise<boolean>;
};

const ComputerUseContext = createContext<ComputerUseContextValue>({
  sessions: [],
  sessionsByConversation: new Map(),
  frameHistory: new Map(),
  startSession: async () => { throw new Error('ComputerUseProvider not ready'); },
  pauseSession: async () => {},
  resumeSession: async () => {},
  stopSession: async () => {},
  approveAction: async () => {},
  rejectAction: async () => {},
  setSurface: async () => {},
  sendGuidance: async () => {},
  continueSession: async () => null,
  updateSessionSettings: async () => {},
  fallbackBanner: null,
  dismissFallbackBanner: () => {},
  checkLocalMacosPermissions: async () => ({ target: 'local-macos', accessibilityTrusted: false, screenRecordingGranted: false, automationGranted: false, inputMonitoringGranted: false, helperReady: false }),
  requestLocalMacosPermissions: async () => ({ permissions: { target: 'local-macos', accessibilityTrusted: false, screenRecordingGranted: false, automationGranted: false, inputMonitoringGranted: false, helperReady: false }, requested: [], openedSettings: [] }),
  openLocalMacosPrivacySettings: async () => ({ opened: null }),
  probeInputMonitoring: async () => false,
});

function sortSessions(sessions: ComputerSession[]): ComputerSession[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeSnippet(value: string, maxLength = 240): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  return trimmed.length <= maxLength
    ? trimmed
    : trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd() + '...';
}

function extractMessageText(message: unknown): string {
  const content = Array.isArray((message as { content?: unknown })?.content)
    ? (message as { content: unknown[] }).content
    : [];

  return normalizeSnippet(content.flatMap((part) => {
    const candidate = part as {
      type?: string;
      text?: string;
      filename?: string;
      toolName?: string;
      result?: unknown;
      liveOutput?: { stdout?: string; stderr?: string };
    };

    if (candidate.type === 'text' && typeof candidate.text === 'string') {
      return [candidate.text];
    }

    if (candidate.type === 'file' && typeof candidate.filename === 'string') {
      return ['Attached file: ' + candidate.filename];
    }

    if (candidate.type === 'tool-call' && typeof candidate.toolName === 'string') {
      const outputs = [
        typeof candidate.result === 'string' ? candidate.result : '',
        candidate.liveOutput?.stdout ?? '',
        candidate.liveOutput?.stderr ?? '',
      ].map((value) => normalizeSnippet(value, 120)).filter(Boolean);
      return [outputs.length > 0 ? 'Tool ' + candidate.toolName + ': ' + outputs.join(' ') : 'Tool ' + candidate.toolName];
    }

    return [];
  }).join(' '));
}

function resolveConversationMessages(conversation: ConversationRecordLike | null): unknown[] {
  if (Array.isArray(conversation?.messageTree) && conversation.messageTree.length > 0) {
    const byId = new Map(conversation.messageTree
      .filter((message) => typeof message.id === 'string')
      .map((message) => [message.id as string, message]));
    const ordered: ConversationMessageLike[] = [];
    const seen = new Set<string>();
    let cursor = conversation.headId ?? conversation.messageTree[conversation.messageTree.length - 1]?.id ?? null;

    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const message = byId.get(cursor);
      if (!message) break;
      ordered.unshift(message);
      cursor = typeof message.parentId === 'string' ? message.parentId : null;
    }

    if (ordered.length > 0) {
      return ordered;
    }
  }

  return Array.isArray(conversation?.messages) ? conversation.messages : [];
}

function buildConversationContextSummary(conversation: ConversationRecordLike | null): string | undefined {
  const messages = resolveConversationMessages(conversation);
  const excerpts = messages
    .map((message) => {
      const role = typeof (message as { role?: unknown })?.role === 'string'
        ? String((message as { role?: string }).role)
        : 'unknown';
      const text = extractMessageText(message);
      return { role, text };
    })
    .filter((message) => message.text && ['system', 'user', 'assistant'].includes(message.role))
    .slice(-6)
    .map((message) => message.role + ': ' + message.text);

  if (excerpts.length === 0) return undefined;

  const title = normalizeSnippet(conversation?.title ?? conversation?.fallbackTitle ?? '', 120);
  const summary = title
    ? ['Conversation title: ' + title, ...excerpts].join('\n')
    : excerpts.join('\n');

  return summary.length <= 1800
    ? summary
    : summary.slice(0, 1797).trimEnd() + '...';
}

export function ComputerUseProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ComputerSession[]>([]);
  const [frameHistory, setFrameHistory] = useState<Map<string, ComputerFrame[]>>(new Map());
  const [fallbackBanner, setFallbackBanner] = useState<ComputerUseFallbackBanner | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissFallbackBanner = useCallback(() => {
    setFallbackBanner(null);
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    legion.computerUse.listSessions()
      .then((result) => setSessions(sortSessions((result as ComputerSession[]) ?? [])))
      .catch(() => {});

    const unsubscribe = legion.computerUse.onEvent((event) => {
      const payload = event as ComputerUseEvent;

      // Capture frame events into history for step log traceability
      if (payload.type === 'frame') {
        setFrameHistory((current) => {
          const next = new Map(current);
          const existing = next.get(payload.sessionId) ?? [];
          // Keep at most 100 frames per session to bound memory
          const updated = [...existing, payload.frame].slice(-100);
          next.set(payload.sessionId, updated);
          return next;
        });
      }

      if (payload.type === 'session-updated') {
        setSessions((current) => sortSessions([
          ...current.filter((session) => session.id !== payload.session.id),
          payload.session,
        ]));

        // Also capture latestFrame from session updates (in case we missed frame events)
        if (payload.session.latestFrame) {
          setFrameHistory((current) => {
            const next = new Map(current);
            const existing = next.get(payload.session.id) ?? [];
            const lastCaptured = existing[existing.length - 1];
            // Only add if it's a new frame
            if (!lastCaptured || lastCaptured.id !== payload.session.latestFrame!.id) {
              const updated = [...existing, payload.session.latestFrame!].slice(-100);
              next.set(payload.session.id, updated);
              return next;
            }
            return current;
          });
        }
        return;
      }
      if (payload.type === 'session-removed') {
        setSessions((current) => current.filter((session) => session.id !== payload.sessionId));
        setFrameHistory((current) => {
          const next = new Map(current);
          next.delete(payload.sessionId);
          return next;
        });
        return;
      }
      if (payload.type === 'model-fallback') {
        setFallbackBanner({
          sessionId: payload.sessionId,
          fromModel: payload.fromModel,
          toModel: payload.toModel,
          error: payload.error,
        });
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = setTimeout(() => setFallbackBanner(null), 8000);
        // Also refetch the session to pick up the updated selectedModelKey
      }
      if ('sessionId' in payload) {
        void legion.computerUse.getSession(payload.sessionId)
          .then((session) => {
            if (!session) return;
            setSessions((current) => sortSessions([
              ...current.filter((candidate) => candidate.id !== (session as ComputerSession).id),
              session as ComputerSession,
            ]));
          })
          .catch(() => {});
      }
    });

    return unsubscribe;
  }, []);

  const value = useMemo<ComputerUseContextValue>(() => ({
    sessions,
    sessionsByConversation: new Map(
      sessions.reduce<Array<[string, ComputerSession[]]>>((acc, session) => {
        const existing = acc.find(([conversationId]) => conversationId === session.conversationId);
        if (existing) {
          existing[1].push(session);
        } else {
          acc.push([session.conversationId, [session]]);
        }
        return acc;
      }, []),
    ),
    frameHistory,
    startSession: async (goal, options) => {
      let contextSummary: string | undefined;

      try {
        const conversation = await legion.conversations.get(options.conversationId) as ConversationRecordLike | null;
        contextSummary = buildConversationContextSummary(conversation);
      } catch {
        contextSummary = undefined;
      }

      const session = await legion.computerUse.startSession(goal, {
        ...options,
        contextSummary,
      }) as ComputerSession;
      setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
      return session;
    },
    pauseSession: async (sessionId) => {
      const session = await legion.computerUse.pauseSession(sessionId) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
    },
    resumeSession: async (sessionId) => {
      const session = await legion.computerUse.resumeSession(sessionId) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
    },
    stopSession: async (sessionId) => {
      const session = await legion.computerUse.stopSession(sessionId) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
    },
    approveAction: async (sessionId, actionId) => {
      const session = await legion.computerUse.approveAction(sessionId, actionId) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
    },
    rejectAction: async (sessionId, actionId, reason) => {
      const session = await legion.computerUse.rejectAction(sessionId, actionId, reason) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
    },
    setSurface: async (sessionId, surface) => {
      const session = await legion.computerUse.setSurface(sessionId, surface) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
    },
    sendGuidance: async (sessionId, text) => {
      const session = await legion.computerUse.sendGuidance(sessionId, text) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
    },
    continueSession: async (sessionId, newGoal) => {
      const session = await legion.computerUse.continueSession(sessionId, newGoal) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
      return session;
    },
    updateSessionSettings: async (sessionId, settings) => {
      const session = await legion.computerUse.updateSessionSettings(sessionId, settings) as ComputerSession | null;
      if (session) setSessions((current) => sortSessions([...current.filter((existing) => existing.id !== session.id), session]));
    },
    fallbackBanner,
    dismissFallbackBanner,
    checkLocalMacosPermissions: async () => legion.computerUse.getLocalMacosPermissions() as Promise<ComputerUsePermissions>,
    requestLocalMacosPermissions: async () => legion.computerUse.requestLocalMacosPermissions() as Promise<ComputerUsePermissionRequestResult>,
    openLocalMacosPrivacySettings: async (section) => {
      return legion.computerUse.openLocalMacosPrivacySettings(section) as Promise<OpenPrivacySettingsResult>;
    },
    probeInputMonitoring: async (timeoutMs) => {
      const result = await legion.computerUse.probeInputMonitoring(timeoutMs);
      return result.inputMonitoringGranted;
    },
  }), [sessions, frameHistory, fallbackBanner, dismissFallbackBanner]);

  return (
    <ComputerUseContext.Provider value={value}>
      {children}
    </ComputerUseContext.Provider>
  );
}

export function useComputerUse() {
  return useContext(ComputerUseContext);
}
