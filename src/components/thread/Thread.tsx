import { useState, useEffect, useCallback, useRef, type FC, type PropsWithChildren } from 'react';
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ActionBarPrimitive,
  useThreadRuntime,
  useMessage,
  useComposerRuntime,
} from '@assistant-ui/react';
import {
  SendHorizontalIcon,
  CopyIcon,
  CheckIcon,
  RefreshCwIcon,
  StopCircleIcon,
  PaperclipIcon,
  XIcon,
  FileIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  BanIcon,
  CpuIcon,
  Volume2Icon,
  SquareIcon,
  MicIcon,
  MicOffIcon,
  ChevronUpIcon,
  PhoneIcon,
  MonitorIcon,
} from 'lucide-react';
import { legion } from '@/lib/ipc-client';
import { useAttachments } from '@/providers/AttachmentContext';
import { useBranchNav } from '@/providers/RuntimeProvider';
import { useConfig } from '@/providers/ConfigProvider';
import { useRealtime } from '@/providers/RealtimeProvider';
import { isDictationSupportedForProvider, createUnifiedDictationAdapter, type DictationSession, type AudioProvider } from '@/lib/audio/speech-adapters';
import { MarkdownText } from './MarkdownText';
import { ToolCallDisplay } from './ToolGroup';
import { SubAgentInline } from './SubAgentInline';
import { ComposerInput } from './ComposerInput';
import { DeviceRow } from './DeviceRow';
import { SearchBar } from './SearchBar';
import { ModelSelector } from './ModelSelector';
import { ReasoningEffortSelector, type ReasoningEffort } from './ReasoningEffortSelector';
import { ProfileSelector } from './ProfileSelector';
import { KnowledgeComposerPopover } from '../knowledge/KnowledgeComposerPopover';
import { FallbackToggle } from './FallbackToggle';
import { FallbackBanner, ComputerUseFallbackBanner } from './FallbackBanner';
import { CallOverlay } from './CallOverlay';
import { ComputerSessionPanel } from './ComputerSessionPanel';
import { ComputerSetupPanel } from './ComputerSetupPanel';
import { useComputerUse } from '@/providers/ComputerUseProvider';
import { shouldShowComputerSetup, type ComputerSession } from '../../../shared/computer-use';
const MATRIX_GLYPHS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890@#$%^&*+-/~{[|`]}<>01';

export type ThreadMode = 'chat' | 'computer';

export const Thread: FC<{
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
  const [searchOpen, setSearchOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const { callState } = useRealtime();

  useEffect(() => {
    if (!window.legion?.onFind) return;
    const cleanup = window.legion.onFind(() => setSearchOpen(true));
    return cleanup;
  }, []);

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col overflow-hidden">
      <SearchBar visible={searchOpen} onClose={() => setSearchOpen(false)} viewportRef={viewportRef} />
      <FallbackBanner />
      <ComputerUseFallbackBanner />
      <ThreadModeTabs mode={mode} onChange={onChangeMode} />
      {mode === 'chat' ? (
        <ThreadPrimitive.Viewport ref={viewportRef} className="relative min-h-0 flex-1 overflow-y-auto">
          <ThreadPrimitive.Empty>
            <MatrixRainBackground />
          </ThreadPrimitive.Empty>
          <div className="relative z-10 mx-auto flex min-h-full w-full max-w-5xl flex-col px-6 pt-8">
            <ThreadWelcome />
            <ThreadPrimitive.Messages
              components={{
                UserMessage,
                AssistantMessage,
              }}
            />

            <div className="min-h-8" />
          </div>
        </ThreadPrimitive.Viewport>
      ) : (
        <ComputerTabSurface />
      )}
      {callState.isInCall ? (
        <CallOverlay />
      ) : (
        <Composer
          mode={mode}
          selectedModelKey={selectedModelKey}
          onSelectModel={onSelectModel}
          reasoningEffort={reasoningEffort}
          onChangeReasoningEffort={onChangeReasoningEffort}
          selectedProfileKey={selectedProfileKey}
          onSelectProfile={onSelectProfile}
          fallbackEnabled={fallbackEnabled}
          onToggleFallback={onToggleFallback}
        />
      )}
    </ThreadPrimitive.Root>
  );
};

const ThreadModeTabs: FC<{ mode: ThreadMode; onChange: (mode: ThreadMode) => void }> = ({ mode, onChange }) => {
  const { config } = useConfig();
  const computerUseEnabled = (config as Record<string, unknown> | null)?.computerUse
    ? ((config as Record<string, unknown>).computerUse as { enabled?: boolean })?.enabled ?? false
    : false;

  if (!computerUseEnabled) return null;

  return (
    <div className="border-b border-border/70 bg-background/85 px-6 py-2 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange('chat')}
          className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'chat' ? 'bg-primary text-primary-foreground' : 'border border-border/70 bg-card/60 text-muted-foreground hover:bg-muted/50'}`}
        >
          Chat
        </button>
        <button
          type="button"
          onClick={() => onChange('computer')}
          className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'computer' ? 'bg-primary text-primary-foreground' : 'border border-border/70 bg-card/60 text-muted-foreground hover:bg-muted/50'}`}
        >
          Computer
        </button>
      </div>
    </div>
  );
};

function useActiveConversationId(): string | null {
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    legion.conversations.getActiveId()
      .then((id) => {
        if (!cancelled) setActiveConversationId(id as string | null);
      })
      .catch(() => {
        if (!cancelled) setActiveConversationId(null);
      });

    const unsubscribe = legion.conversations.onChanged((store) => {
      const payload = store as { activeConversationId?: string | null } | null;
      if (!cancelled) {
        setActiveConversationId(payload?.activeConversationId ?? null);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return activeConversationId;
}

function getActiveComputerSession(
  conversationId: string | null,
  sessionsByConversation: Map<string, ComputerSession[]>,
): ComputerSession | undefined {
  if (!conversationId) return undefined;
  return sessionsByConversation.get(conversationId)?.[0];
}

const ComputerTabSurface: FC = () => {
  const activeConversationId = useActiveConversationId();
  const { sessionsByConversation } = useComputerUse();
  const activeComputerSession = getActiveComputerSession(activeConversationId, sessionsByConversation);

  if (!activeComputerSession) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-6 py-4">
          <div className="mx-auto flex w-full max-w-5xl min-h-0 flex-col">
            <div className="flex min-h-full flex-1 items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/20 px-6 py-8">
              <div className="max-w-md text-center">
                <MonitorIcon className="mx-auto h-8 w-8 text-muted-foreground/40" />
                <div className="mt-3 text-sm font-medium">{activeConversationId ? 'No Active Session' : 'Select a Conversation'}</div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {activeConversationId
                    ? 'Configure a goal and start a session using the controls below.'
                    : 'Choose or create a conversation from the sidebar first.'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="px-6 py-4">
        <div className="mx-auto flex w-full max-w-5xl min-h-0 flex-col">
          <ComputerSessionPanel session={activeComputerSession} />
        </div>
      </div>
    </div>
  );
};

const GuidanceComposer: FC<{ sessionId: string }> = ({ sessionId }) => {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const { sendGuidance } = useComputerUse();

  const handleSend = () => {
    if (!text.trim() || isSending) return;
    setIsSending(true);
    void sendGuidance(sessionId, text.trim())
      .then(() => setText(''))
      .finally(() => setIsSending(false));
  };

  return (
    <div className="rounded-[1.7rem] border border-border/70 bg-card/78 px-3 py-3 shadow-[inset_0_0_0_1px_rgba(197,194,245,0.08),0_12px_40px_rgba(5,4,15,0.18)]">
      <div className="flex items-center gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Guide the session... (Enter to send)"
          rows={1}
          className="min-h-[36px] max-h-[120px] flex-1 resize-none bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground/50"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!text.trim() || isSending}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <SendHorizontalIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

const ThreadWelcome: FC = () => {
  const threadRuntime = useThreadRuntime();

  const handleSuggestion = useCallback((text: string) => {
    threadRuntime.append({
      role: 'user',
      content: [{ type: 'text', text }],
    });
  }, [threadRuntime]);

  return (
    <ThreadPrimitive.Empty>
      <div className="flex flex-1 items-center justify-center py-24">
        <div className="relative z-10 flex select-none flex-col items-center justify-center">
          <div className="mb-3 inline-flex items-center gap-0.5 text-4xl font-semibold">
            <span className="legion-gradient-text legion-wordmark">INTERLINK</span>
            <CpuIcon className="h-9 w-9 text-primary/80" />
          </div>
          <p className="max-w-xl text-center text-sm text-muted-foreground">
            Your local neural workspace for coding, tooling, and system automation.
          </p>
          <div className="mt-8 grid max-w-2xl grid-cols-2 gap-3">
            {['List files in my home directory', 'Search for TODO comments in my code', 'Help me write a shell script', 'Explain a file in my project'].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => handleSuggestion(s)}
                className="rounded-2xl border border-border/70 bg-card/45 px-4 py-3 text-left text-xs transition-colors hover:bg-accent/70"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </ThreadPrimitive.Empty>
  );
};

const MatrixRainBackground: FC = () => (
  <div
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 overflow-hidden"
  >
    <canvas ref={useMatrixCanvas()} className="absolute inset-0 h-full w-full opacity-45" />
    <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background via-background/70 to-transparent" />
    <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background via-background/75 to-transparent" />
    <div className="absolute inset-y-0 left-0 w-28 bg-gradient-to-r from-background via-background/85 to-transparent" />
    <div className="absolute inset-y-0 right-0 w-28 bg-gradient-to-l from-background via-background/85 to-transparent" />
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(160,154,232,0.08),transparent_58%)]" />
  </div>
);

function useMatrixCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    let frameId = 0;
    let animationFrame = 0;
    let drops: number[] = [];
    let columnCount = 0;
    const fontSize = 14;

    const setup = () => {
      const parent = canvas.parentElement;
      const width = parent?.clientWidth ?? window.innerWidth;
      const height = parent?.clientHeight ?? window.innerHeight;
      const devicePixelRatio = window.devicePixelRatio || 1;

      canvas.width = Math.floor(width * devicePixelRatio);
      canvas.height = Math.floor(height * devicePixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.scale(devicePixelRatio, devicePixelRatio);

      columnCount = Math.ceil(width / fontSize);
      drops = Array.from({ length: columnCount }, () => 1);
    };

    const draw = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const styles = getComputedStyle(document.documentElement);

      context.fillStyle = styles.getPropertyValue('--legion-matrix-fade').trim() || 'rgba(10, 8, 18, 0.08)';
      context.fillRect(0, 0, width, height);

      context.fillStyle = styles.getPropertyValue('--legion-matrix-glyph').trim() || 'rgba(197, 194, 245, 0.7)';
      context.font = `${fontSize}px Monaco, "Cascadia Code", monospace`;

      for (let index = 0; index < drops.length; index += 1) {
        const glyph = MATRIX_GLYPHS[Math.floor(Math.random() * MATRIX_GLYPHS.length)];
        const x = index * fontSize;
        const y = drops[index] * fontSize;

        context.fillText(glyph, x, y);

        if (y > height && Math.random() > 0.975) {
          drops[index] = 0;
        }

        drops[index] += 1;
      }

      frameId = window.setTimeout(() => {
        animationFrame = window.requestAnimationFrame(draw);
      }, 65);
    };

    setup();
    draw();

    const handleResize = () => {
      window.clearTimeout(frameId);
      window.cancelAnimationFrame(animationFrame);
      setup();
      draw();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.clearTimeout(frameId);
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return canvasRef;
}

const UserMessage: FC = () => {
  const message = useMessage();
  const { config } = useConfig();
  const ttsEnabled = (config as Record<string, unknown> | null)?.audio
    ? ((config as Record<string, unknown>).audio as { tts?: { enabled?: boolean } })?.tts?.enabled ?? true
    : true;
  return (
    <MessagePrimitive.Root className="group mb-6 flex justify-end">
      <div className="max-w-[72%]">
        <div
          className="rounded-[1.6rem] border px-5 py-3 text-foreground backdrop-blur-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.22),var(--legion-user-bubble-shadow)]"
          style={{
            backgroundColor: 'var(--legion-user-bubble)',
            borderColor: 'var(--legion-user-bubble-border)',
          }}
        >
          <MessagePrimitive.Content components={userContentComponents} />
        </div>
        <div className="flex items-center justify-end gap-1">
          <ActionBarPrimitive.Root className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <CopyButton />
            {ttsEnabled && <SpeakButton />}
          </ActionBarPrimitive.Root>
          <MessageTimestamp date={message.createdAt} align="right" />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const UserImagePart: FC<{ image: string }> = ({ image }) => {
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setPreviewOpen(true)} className="block my-1">
        <img
          src={image}
          alt="Attached"
          className="max-w-[25vw] max-h-[200px] rounded-lg object-contain cursor-pointer hover:opacity-90 transition-opacity"
        />
      </button>
      {previewOpen && <FilePreviewModal src={image} onClose={() => setPreviewOpen(false)} />}
    </>
  );
};

const UserFilePart: FC<{ data?: string; mimeType?: string; filename?: string; file?: unknown }> = (props) => {
  const [previewOpen, setPreviewOpen] = useState(false);
  const filename = props.filename ?? 'file';
  const mimeType = props.mimeType ?? '';
  const data = props.data ?? '';
  const isPdf = mimeType === 'application/pdf';
  const isPreviewable = isPdf || mimeType.startsWith('image/');

  const ext = filename.split('.').pop()?.toUpperCase() ?? 'FILE';
  const iconColors: Record<string, string> = {
    PDF: 'bg-red-500/20 text-red-400',
    JSON: 'bg-yellow-500/20 text-yellow-400',
    MD: 'bg-blue-500/20 text-blue-400',
    TS: 'bg-blue-600/20 text-blue-300',
    TSX: 'bg-blue-600/20 text-blue-300',
    JS: 'bg-yellow-400/20 text-yellow-300',
    PY: 'bg-green-500/20 text-green-400',
    CSV: 'bg-emerald-500/20 text-emerald-400',
    TXT: 'bg-gray-500/20 text-gray-400',
  };
  const badgeClass = iconColors[ext] ?? 'bg-gray-500/20 text-gray-400';

  return (
    <>
      <button
        type="button"
        onClick={() => isPreviewable && data && setPreviewOpen(true)}
        className={`flex items-center gap-2.5 my-1.5 rounded-lg border px-3 py-2 text-left transition-colors ${isPreviewable ? 'cursor-pointer' : 'cursor-default'}`}
        style={{
          backgroundColor: 'var(--legion-file-chip)',
          borderColor: 'var(--legion-user-bubble-border)',
        }}
        onMouseEnter={(event) => {
          if (isPreviewable) event.currentTarget.style.backgroundColor = 'var(--legion-file-chip-hover)';
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.backgroundColor = 'var(--legion-file-chip)';
        }}
      >
        <div className={`flex h-9 w-9 items-center justify-center rounded-md text-[10px] font-bold ${badgeClass}`}>
          {ext}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-xs font-medium truncate max-w-[200px]">{filename}</span>
          <span className="text-[10px] opacity-60">{mimeType}</span>
        </div>
        {isPreviewable && (
          <span className="text-[10px] opacity-50 ml-auto shrink-0">Click to preview</span>
        )}
      </button>
      {previewOpen && data && <FilePreviewModal src={data} onClose={() => setPreviewOpen(false)} />}
    </>
  );
};

const FilePreviewModal: FC<{ src: string; onClose: () => void }> = ({ src, onClose }) => {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label="File preview"
    >
      <div className="flex flex-col items-end gap-2" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-800 border border-neutral-600 shadow-xl hover:bg-neutral-600 active:bg-neutral-500 cursor-pointer select-none transition-colors"
        >
          <XIcon className="h-5 w-5 text-white pointer-events-none" />
        </button>
        {src.startsWith('data:application/pdf') ? (
          <iframe src={src} className="w-[80vw] h-[85vh] rounded-lg bg-white" title="PDF preview" />
        ) : (
          <img src={src} alt="Preview" className="max-w-[90vw] max-h-[85vh] rounded-lg object-contain" />
        )}
      </div>
    </div>
  );
};

/**
 * ToolFallback receives props directly from assistant-ui:
 * { toolCallId, toolName, args, argsText, result, isError, addResult, resume, ... }
 */
const ToolFallback: FC<{
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  startedAt?: string;
  finishedAt?: string;
  originalResult?: unknown;
  compactionMeta?: {
    wasCompacted: boolean;
    extractionDurationMs: number;
  };
  compactionPhase?: 'start' | 'complete' | null;
  liveOutput?: {
    stdout?: string;
    stderr?: string;
    truncated?: boolean;
    stopped?: boolean;
  };
}> = (props) => {
  // Render sub-agent tool calls with the specialized component
  if (props.toolName === 'sub_agent') {
    return (
      <div className="my-1">
        <SubAgentInline
          toolCallId={props.toolCallId}
          args={props.args}
          result={props.result}
          isError={props.isError}
          liveOutput={props.liveOutput}
        />
      </div>
    );
  }

  return (
    <div className="my-1">
      <ToolCallDisplay
        part={{
          type: 'tool-call',
          toolCallId: props.toolCallId ?? `tc-${Date.now()}`,
          toolName: props.toolName ?? 'unknown',
          args: props.args ?? {},
          argsText: props.argsText ?? JSON.stringify(props.args, null, 2),
          result: props.result,
          isError: props.isError,
          startedAt: props.startedAt,
          finishedAt: props.finishedAt,
          originalResult: props.originalResult,
          compactionMeta: props.compactionMeta,
          compactionPhase: props.compactionPhase,
          liveOutput: props.liveOutput,
        }}
      />
    </div>
  );
};

/** Wraps consecutive tool calls with a divider above */
const ToolGroupWrapper: FC<PropsWithChildren> = ({ children }) => (
  <div className="my-2 border-t border-border/40 pt-2 space-y-1.5">
    {children}
  </div>
);

/* ── Hoisted components for MessagePrimitive.Content (stable refs prevent remounting) ── */

const UserTextPart: FC<{ text: string }> = ({ text }) => {
  if (text.startsWith('\n\n--- File:') || text.startsWith('\n[Attached file:')) return null;
  return <span className="whitespace-pre-wrap text-sm leading-6 text-foreground">{text}</span>;
};

const userContentComponents = {
  Text: UserTextPart,
  Image: UserImagePart,
  File: UserFilePart,
};

const AssistantTextPart: FC<{ text: string }> = ({ text }) => {
  if (!text) return null;
  return <div className="py-0.5"><MarkdownText text={text} /></div>;
};

/** Inline interrupt divider — shown where the user interrupted the AI's speech */
const InterruptDivider: FC = () => (
  <div className="my-2 flex items-center gap-2">
    <div className="h-px flex-1 bg-amber-500/40" />
    <div className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5">
      <SquareIcon className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400" />
      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Interrupted</span>
    </div>
    <div className="h-px flex-1 bg-amber-500/40" />
  </div>
);

/** Struck-through text for the unspoken portion after an interrupt */
const UnspokenTextPart: FC<{ text: string }> = ({ text }) => {
  if (!text) return null;
  return (
    <div className="py-0.5 text-muted-foreground/50 line-through decoration-muted-foreground/30">
      <MarkdownText text={text} />
    </div>
  );
};

const assistantContentComponents = {
  Text: AssistantTextPart,
  tools: {
    Fallback: ToolFallback,
  },
  ToolGroup: ToolGroupWrapper,
};

const AssistantMessage: FC = () => {
  const message = useMessage();
  const isRunning = message.status?.type === 'running';
  const content = message.content ?? [];
  const hasContent = content.some((p: { type: string; text?: string }) =>
    p.type === 'tool-call' || (p.type === 'text' && p.text?.trim()),
  );
  const isEmpty = !isRunning && !hasContent;

  // Check if this message has an interrupt (source: 'interrupt' or 'unspoken')
  const hasInterrupt = content.some((p: { type: string; source?: string }) =>
    p.type === 'text' && (p.source === 'interrupt' || p.source === 'unspoken'),
  );

  return (
    <MessagePrimitive.Root className="group mb-8 flex justify-start">
      <div className="w-full max-w-4xl">
        <div className="aui-assistant-content rounded-[1.5rem] border border-border/45 bg-card/[0.22] px-4 py-3 text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-[2px]">
          {isEmpty ? (
            <div className="flex items-center gap-2 py-0.5 text-muted-foreground">
              <BanIcon className="h-3.5 w-3.5" />
              <span className="text-xs italic">Response cancelled</span>
            </div>
          ) : hasInterrupt ? (
            /* Render interrupted message with custom layout */
            <>
              {content.map((part: { type: string; text?: string; source?: string }, idx: number) => {
                if (part.type !== 'text') return null;
                if (part.source === 'interrupt') return <InterruptDivider key={`interrupt-${idx}`} />;
                if (part.source === 'unspoken') return <UnspokenTextPart key={`unspoken-${idx}`} text={part.text ?? ''} />;
                return <AssistantTextPart key={`text-${idx}`} text={part.text ?? ''} />;
              })}
            </>
          ) : (
            <>
              <MessagePrimitive.Content components={assistantContentComponents} />
              {/* Typing dots: visible inside assistant bubble, hidden by CSS once content parts render */}
              <div className="aui-typing-dots">
                <div className="flex items-center gap-1.5 py-0.5">
                  <div className="h-2 w-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:0ms]" />
                  <div className="h-2 w-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:150ms]" />
                  <div className="h-2 w-2 rounded-full bg-foreground/30 animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <MessageTimestamp date={message.createdAt} align="left" />
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  const { config } = useConfig();
  const ttsEnabled = (config as Record<string, unknown> | null)?.audio
    ? ((config as Record<string, unknown>).audio as { tts?: { enabled?: boolean } })?.tts?.enabled ?? true
    : true;
  return (
    <ActionBarPrimitive.Root className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <CopyButton />
      {ttsEnabled && <SpeakButton />}
      <ActionBarPrimitive.Reload asChild>
        <button type="button" className="flex h-7 w-7 items-center justify-center rounded-xl hover:bg-muted transition-colors" title="Regenerate">
          <RefreshCwIcon className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </ActionBarPrimitive.Reload>

      <BranchPicker />
    </ActionBarPrimitive.Root>
  );
};

/** Custom branch picker using our tree-based branching */
const BranchPicker: FC = () => {
  const nav = useBranchNav();
  if (!nav || nav.total <= 1) return null;

  return (
    <div className="flex items-center gap-0.5 ml-1">
      <button
        type="button"
        onClick={nav.goToPrevious}
        disabled={nav.current <= 1}
        className="flex h-7 w-7 items-center justify-center rounded-xl hover:bg-muted transition-colors disabled:opacity-30"
        title="Previous variant"
      >
        <ChevronLeftIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      <span className="text-[10px] text-muted-foreground tabular-nums min-w-[2rem] text-center">
        {nav.current} / {nav.total}
      </span>
      <button
        type="button"
        onClick={nav.goToNext}
        disabled={nav.current >= nav.total}
        className="flex h-7 w-7 items-center justify-center rounded-xl hover:bg-muted transition-colors disabled:opacity-30"
        title="Next variant"
      >
        <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </div>
  );
};

const CopyButton: FC = () => {
  const [copied, setCopied] = useState(false);
  return (
    <ActionBarPrimitive.Copy asChild copiedDuration={2000} onClick={() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
      <button type="button" className="flex h-7 w-7 items-center justify-center rounded-xl hover:bg-muted transition-colors" title="Copy">
        {copied ? <CheckIcon className="h-3.5 w-3.5 text-green-500" /> : <CopyIcon className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
    </ActionBarPrimitive.Copy>
  );
};

const SpeakButton: FC = () => {
  const message = useMessage();
  // The assistant-ui runtime tracks speech state on the message:
  // message.speech is non-null when speaking, null when idle
  const isSpeaking = (message as { speech?: unknown }).speech != null;

  if (isSpeaking) {
    return (
      <ActionBarPrimitive.StopSpeaking asChild>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-xl hover:bg-muted transition-colors"
          title="Stop speaking"
        >
          <SquareIcon className="h-3 w-3 text-primary" />
        </button>
      </ActionBarPrimitive.StopSpeaking>
    );
  }

  return (
    <ActionBarPrimitive.Speak asChild>
      <button
        type="button"
        className="flex h-7 w-7 items-center justify-center rounded-xl hover:bg-muted transition-colors"
        title="Read aloud"
      >
        <Volume2Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </ActionBarPrimitive.Speak>
  );
};

const MessageTimestamp: FC<{ date?: Date; align: 'left' | 'right' }> = ({ date, align }) => {
  if (!date) return null;
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();

  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let label: string;
  if (isToday) {
    label = time;
  } else if (isYesterday) {
    label = `Yesterday ${time}`;
  } else {
    label = `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
  }

  return (
    <div className={`text-[10px] text-muted-foreground/60 mt-0.5 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {label}
    </div>
  );
};

/** Stop generation without restoring composer text (unlike ComposerPrimitive.Cancel which restores draft) */
const StopButton: FC = () => {
  const threadRuntime = useThreadRuntime();
  const composerRuntime = useComposerRuntime();
  return (
    <button
      type="button"
      onClick={() => {
        threadRuntime.cancelRun();
        // Force-clear the composer so it doesn't restore the previous message text
        composerRuntime.setText('');
      }}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
    >
      <StopCircleIcon className="h-4 w-4" />
    </button>
  );
};

const DictationButton: FC = () => {
  const composerRuntime = useComposerRuntime();
  const { config, updateConfig } = useConfig();
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [devices, setDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const sessionRef = useRef<DictationSession | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const audioConfig = (config as Record<string, unknown> | null)?.audio as {
    provider?: AudioProvider;
    azure?: { endpoint?: string; region?: string; subscriptionKey?: string; sttLanguage?: string };
    dictation?: { enabled?: boolean; language?: string; continuous?: boolean; inputDeviceId?: string };
  } | undefined;
  const audioProvider: AudioProvider = audioConfig?.provider ?? 'native';
  const dictationConfig = audioConfig?.dictation;
  const azureConfig = audioConfig?.azure;
  const selectedDeviceId = dictationConfig?.inputDeviceId;

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [pickerOpen]);

  // Load devices and start level monitoring when picker opens
  useEffect(() => {
    if (!pickerOpen) {
      window.legion?.mic?.stopMonitor();
      if (levelTimerRef.current) { clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
      setLevels({});
      return;
    }

    const mic = window.legion?.mic;
    if (!mic) return;

    // Load device list, then start monitoring all devices
    mic.listDevices().then((devs) => {
      setDevices(devs);
      // Get unique device IDs (include 'default' for system default)
      const ids = ['default', ...devs.filter(d => d.deviceId !== 'default').map(d => d.deviceId)];
      mic.startMonitor(ids).then(() => {
        // Poll all levels ~15 fps
        levelTimerRef.current = setInterval(() => {
          mic.getLevel().then(setLevels).catch(() => setLevels({}));
        }, 66);
      });
    }).catch(() => setDevices([]));

    return () => {
      mic.stopMonitor();
      if (levelTimerRef.current) { clearInterval(levelTimerRef.current); levelTimerRef.current = null; }
    };
  }, [pickerOpen]);

  const selectDevice = useCallback((deviceId: string | undefined) => {
    updateConfig('audio.dictation.inputDeviceId', deviceId);
  }, [updateConfig]);

  const handleToggle = useCallback(() => {
    setError(null);

    if (isListening) {
      console.log('[DictationButton] Stopping...');
      sessionRef.current?.stop();
      return;
    }

    console.log('[DictationButton] Starting, provider=%s, deviceId=%s', audioProvider, selectedDeviceId ?? 'default');
    if (!isDictationSupportedForProvider(audioProvider, Boolean(azureConfig?.subscriptionKey))) {
      setError('Speech recognition is not supported');
      return;
    }

    try {
      const adapter = createUnifiedDictationAdapter({
        provider: audioProvider,
        enabled: true,
        language: dictationConfig?.language ?? 'en-US',
        continuous: dictationConfig?.continuous ?? true,
        azure: audioProvider === 'azure' ? {
          endpoint: azureConfig?.endpoint,
          region: azureConfig?.region ?? 'eastus',
          subscriptionKey: azureConfig?.subscriptionKey ?? '',
          language: azureConfig?.sttLanguage ?? dictationConfig?.language ?? 'en-US',
          continuous: dictationConfig?.continuous ?? true,
          inputDeviceId: selectedDeviceId,
        } : undefined,
      });

      if (!adapter) { setError('Failed to create dictation adapter'); return; }

      const session = adapter.listen();
      sessionRef.current = session;
      setIsListening(true);

      // Track the committed text (finalized segments) vs partial preview
      let baseText = composerRuntime.getState().text ?? '';

      session.onSpeech((result) => {
        const transcript = result.transcript?.trim();
        if (!transcript) return;
        console.log('[DictationButton] onSpeech: "%s" isFinal=%s', transcript, result.isFinal);
        if (result.isFinal) {
          baseText = baseText ? baseText.trimEnd() + ' ' + transcript : transcript;
          composerRuntime.setText(baseText);
        } else {
          const preview = baseText ? baseText.trimEnd() + ' ' + transcript : transcript;
          composerRuntime.setText(preview);
        }
      });

      const extSession = session as DictationSession & {
        onError?: (cb: (err: string) => void) => void;
      };
      extSession.onError?.((err) => {
        console.error('[DictationButton] onError:', err);
        setIsListening(false);
        sessionRef.current = null;
        setError(err === 'not-allowed' ? 'Microphone permission denied'
          : err === 'no-speech' ? 'No speech detected — try again'
          : err === 'network' ? 'Network connection required'
          : `Dictation error: ${err}`);
      });
    } catch (err) {
      console.error('[DictationButton] Failed:', err);
      setIsListening(false);
      setError('Failed to start dictation');
    }
  }, [isListening, audioProvider, dictationConfig, azureConfig, composerRuntime, selectedDeviceId]);

  // Poll session status for cleanup
  useEffect(() => {
    if (!isListening || !sessionRef.current) return;
    const session = sessionRef.current;
    const interval = setInterval(() => {
      if (session.status.type === 'ended') {
        setIsListening(false);
        sessionRef.current = null;
        clearInterval(interval);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [isListening]);

  useEffect(() => { return () => { sessionRef.current?.cancel(); }; }, []);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  const isActive = isListening;

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      {/* Split button: mic | caret */}
      <div className={`flex items-center rounded-xl border overflow-hidden transition-colors ${
        isListening ? 'border-emerald-500/50 bg-emerald-500/10'
        : error ? 'border-yellow-500/50 bg-yellow-500/10'
        : 'border-border/70 bg-card/70'
      }`}>
        {/* Mic toggle */}
        <button
          type="button"
          onClick={handleToggle}
          className={`flex h-8 w-7 items-center justify-center transition-colors ${
            isActive ? '' : 'hover:bg-muted/50'
          }`}
          title={error ?? (isListening ? 'Stop dictation' : 'Start dictation')}
        >
          {isListening
            ? <MicIcon className="h-3.5 w-3.5 text-emerald-500 animate-pulse" />
            : <MicOffIcon className={`h-3.5 w-3.5 ${error ? 'text-yellow-500' : 'text-muted-foreground'}`} />
          }
        </button>
        {/* Caret dropdown trigger */}
        <button
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          className={`flex h-8 w-4 items-center justify-center border-l transition-colors ${
            isActive ? 'border-border/30' : 'border-border/50 hover:bg-muted/50'
          }`}
          title="Select microphone"
        >
          <ChevronUpIcon className="h-2.5 w-2.5 text-muted-foreground" />
        </button>
      </div>

      {/* Status label */}
      {isActive && (
        <span className="text-[10px] font-medium animate-pulse text-emerald-500">
          Listening...
        </span>
      )}

      {/* Error tooltip */}
      {error && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-lg bg-card border border-border/70 px-2.5 py-1.5 text-[10px] text-muted-foreground shadow-lg z-50">
          {error}
        </div>
      )}

      {/* Device picker popover */}
      {pickerOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[300px] rounded-2xl border border-border/70 bg-popover/95 p-1.5 shadow-[0_16px_40px_rgba(5,4,15,0.28)] backdrop-blur-xl">
          <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            Input Device
          </div>

          <div className="max-h-[280px] overflow-y-auto space-y-0.5">
            {/* Default device */}
            <DeviceRow
              label="System Default"
              selected={!selectedDeviceId}
              level={levels['default'] ?? 0}
              onClick={() => selectDevice(undefined)}
            />

            {devices.filter(d => d.deviceId !== 'default').map((d) => (
              <DeviceRow
                key={d.deviceId}
                label={d.label}
                selected={selectedDeviceId === d.deviceId}
                level={levels[d.deviceId] ?? 0}
                onClick={() => selectDevice(d.deviceId)}
              />
            ))}

            {devices.length === 0 && (
              <div className="px-3 py-3 text-[10px] text-muted-foreground text-center">
                No input devices found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const CallButton: FC = () => {
  const { startCall } = useRealtime();

  const handleClick = useCallback(async () => {
    try {
      const id = await legion.conversations.getActiveId() as string | null;
      if (id) {
        await startCall(id);
      }
    } catch (err) {
      console.error('[CallButton] Failed to start call:', err);
    }
  }, [startCall]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/70 transition-colors hover:bg-muted/50"
      title="Start voice call"
    >
      <PhoneIcon className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
};

const Composer: FC<{
  mode: ThreadMode;
  selectedModelKey: string | null;
  onSelectModel: (key: string) => void;
  reasoningEffort: ReasoningEffort;
  onChangeReasoningEffort: (value: ReasoningEffort) => void;
  selectedProfileKey: string | null;
  onSelectProfile: (key: string | null, primaryModelKey: string | null) => void;
  fallbackEnabled: boolean;
  onToggleFallback: (value: boolean) => void;
}> = ({ mode, selectedModelKey, onSelectModel, reasoningEffort, onChangeReasoningEffort, selectedProfileKey, onSelectProfile, fallbackEnabled, onToggleFallback }) => {
  const { attachments, addAttachments, removeAttachment } = useAttachments();
  const { config } = useConfig();
  const { sessionsByConversation } = useComputerUse();
  const activeConversationId = useActiveConversationId();
  const dictationEnabled = (config as Record<string, unknown> | null)?.audio
    ? ((config as Record<string, unknown>).audio as { dictation?: { enabled?: boolean } })?.dictation?.enabled ?? true
    : true;

  const activeComputerSession = getActiveComputerSession(activeConversationId, sessionsByConversation);
  const showComputerSetup = shouldShowComputerSetup(activeComputerSession);

  const handleAttach = async () => {
    try {
      const result = await legion.dialog.openFile() as { canceled: boolean; files?: Array<{ name: string; mime: string; isImage: boolean; size: number; dataUrl: string; text?: string }> };
      if (!result.canceled && result.files) addAttachments(result.files);
    } catch (err) { console.error('Attach failed:', err); }
  };

  return (
    <div className="relative z-20 border-t border-border/70 bg-background/88 px-6 pb-6 pt-4 backdrop-blur-md">
      <div className="mx-auto w-full max-w-5xl">
        {mode === 'chat' && attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((file, i) => (
              <div key={`${file.name}-${i}`} className="group/att flex items-center gap-1.5 rounded-2xl border border-border/70 bg-card/65 px-2.5 py-2 text-xs">
                {file.isImage ? (
                  <img src={file.dataUrl} alt={file.name} className="h-10 w-10 rounded object-cover" />
                ) : (
                  <FileIcon className="h-4 w-4 text-muted-foreground" />
                )}
                <div className="flex flex-col">
                  <span className="max-w-[120px] truncate font-medium">{file.name}</span>
                  <span className="text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="ml-1 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 group-hover/att:opacity-100"
                >
                  <XIcon className="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        {mode === 'computer' && !showComputerSetup ? (
          /* Guidance composer — shown when a session is active */
          activeComputerSession ? (
            <GuidanceComposer sessionId={activeComputerSession.id} />
          ) : null
        ) : (
          <ComposerPrimitive.Root className="flex flex-col gap-0 rounded-[1.7rem] border border-border/70 bg-card/78 px-3 py-3 shadow-[inset_0_0_0_1px_rgba(197,194,245,0.08),0_12px_40px_rgba(5,4,15,0.18)]">
            {mode === 'computer' ? (
              <ComputerSetupPanel
                conversationId={activeConversationId}
                selectedModelKey={selectedModelKey}
                onSelectModel={onSelectModel}
                reasoningEffort={reasoningEffort}
                onChangeReasoningEffort={onChangeReasoningEffort}
                selectedProfileKey={selectedProfileKey}
                onSelectProfile={onSelectProfile}
                fallbackEnabled={fallbackEnabled}
                onToggleFallback={onToggleFallback}
                activeComputerSession={activeComputerSession}
                onOpenPopout={() => { void legion.computerUse.openSetupWindow(activeConversationId ?? undefined); }}
              />
            ) : (
              <>
                <ComposerInput
                  placeholder="Message Interlink..."
                  className="min-h-[48px] max-h-[220px] w-full overflow-y-auto px-1 py-0.5 text-[15px]"
                  autoFocus
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <button type="button" onClick={handleAttach} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-card/70 transition-colors hover:bg-muted/50" title="Attach file">
                      <PaperclipIcon className="h-4 w-4 text-muted-foreground" />
                    </button>
                    {dictationEnabled && <DictationButton />}
                    <CallButton />
                    <ProfileSelector
                      selectedProfileKey={selectedProfileKey}
                      onSelectProfile={onSelectProfile}
                    />
                    <FallbackToggle
                      enabled={fallbackEnabled}
                      onToggle={onToggleFallback}
                    />
                    <ModelSelector
                      selectedModelKey={selectedModelKey}
                      onSelectModel={onSelectModel}
                      disabled={fallbackEnabled}
                    />
                    <ReasoningEffortSelector
                      value={reasoningEffort}
                      onChange={onChangeReasoningEffort}
                    />
                    <KnowledgeComposerPopover />
                  </div>
                  <ThreadPrimitive.If running={false}>
                    <ComposerPrimitive.Send asChild>
                      <button type="button" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40">
                        <SendHorizontalIcon className="h-4 w-4" />
                      </button>
                    </ComposerPrimitive.Send>
                  </ThreadPrimitive.If>
                  <ThreadPrimitive.If running>
                    <StopButton />
                  </ThreadPrimitive.If>
                </div>
              </>
            )}
          </ComposerPrimitive.Root>
        )}
      </div>
    </div>
  );
};
