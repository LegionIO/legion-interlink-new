import { useState, useCallback, type FC } from 'react';
import { CodeBlock } from './CodeBlock';
import { ElapsedBadge } from './ElapsedBadge';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircle2Icon,
  AlertCircleIcon,
  LoaderIcon,
  ScissorsIcon,
  DownloadIcon,
} from 'lucide-react';
import { app } from '@/lib/ipc-client';
import { formatElapsed } from '@/lib/response-timing';

type ToolCallPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsText?: string;
  result?: unknown;
  isError?: boolean;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** Original (pre-compaction) result — present when tool output was compacted */
  originalResult?: unknown;
  /** Tool compaction metadata */
  compactionMeta?: {
    wasCompacted: boolean;
    extractionDurationMs: number;
  };
  /** Live compaction phase — 'start' while AI summarization is running */
  compactionPhase?: 'start' | 'complete' | null;
  liveOutput?: {
    stdout?: string;
    stderr?: string;
    truncated?: boolean;
    stopped?: boolean;
  };
};

export const ToolGroup: FC<{ parts: ToolCallPart[] }> = ({ parts }) => {
  if (parts.length === 0) return null;

  return (
    <div className="my-2 space-y-1.5">
      {parts.map((part) => (
        <ToolCallDisplay key={part.toolCallId} part={part} />
      ))}
    </div>
  );
};

export const ToolCallDisplay: FC<{ part: ToolCallPart }> = ({ part }) => {
  const [expanded, setExpanded] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const hasResult = part.result !== undefined;
  const isError = part.isError || (hasResult && isErrorResult(part.result));
  const isRunning = !hasResult;
  const hasLiveOutput = Boolean(part.liveOutput?.stdout || part.liveOutput?.stderr);
  const wasCompacted = Boolean(part.compactionMeta?.wasCompacted);
  const canShowOriginal = wasCompacted && part.originalResult !== undefined;
  const isSummarizing = part.compactionPhase === 'start';
  const mediaResult = hasResult && !isError ? detectMediaResult(part.result) : null;

  return (
    <div className="rounded-lg border bg-card text-sm overflow-hidden">
      {/* Header */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDownIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        )}
        <StatusBadge isRunning={isRunning} isError={isError} />
        {wasCompacted && <CompactedBadge />}
        {isSummarizing && <SummarizingBadge />}
        <span className="font-mono text-xs font-semibold truncate">{part.toolName}</span>
        <span className="text-[10px] text-muted-foreground ml-1 truncate">
          {getToolSummary(part)}
        </span>
        <ToolElapsedBadge
          isRunning={isRunning}
          isError={Boolean(isError)}
          startedAt={part.startedAt}
          finishedAt={part.finishedAt}
          durationMs={part.durationMs}
        />
        <ToolStatusIcon isRunning={isRunning} isError={isError} />
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t">
          {/* Arguments section */}
          <ToolSection title="Arguments" defaultOpen>
            <CodeBlock code={formatArgs(part.args)} language="json" />
          </ToolSection>

          {/* Pre-extraction / In-progress indicator */}
          {isRunning && !isSummarizing && (
            <div className="px-3 py-2 border-t bg-blue-500/5">
              <div className="flex items-center gap-2">
                <LoaderIcon className="h-3.5 w-3.5 animate-spin text-blue-500" />
                <span className="text-xs text-blue-600 dark:text-blue-400">Executing tool...</span>
              </div>
            </div>
          )}

          {/* AI summarization in progress */}
          {isSummarizing && (
            <div className="px-3 py-2 border-t bg-amber-500/5">
              <div className="flex items-center gap-2">
                <ScissorsIcon className="h-3.5 w-3.5 animate-pulse text-amber-500" />
                <span className="text-xs text-amber-600 dark:text-amber-400">Summarizing large output...</span>
              </div>
            </div>
          )}

          {hasLiveOutput && (
            <ToolSection title="Live Output" defaultOpen={isRunning}>
              <CodeBlock code={formatLiveOutput(part.liveOutput)} language="text" />
            </ToolSection>
          )}

          {/* Result section — with compacted/original toggle when available */}
          {hasResult && (
            <ToolSection
              title={isError ? 'Error' : 'Result'}
              defaultOpen
              badge={canShowOriginal ? (
                <CompactionToggle showOriginal={showOriginal} onToggle={() => setShowOriginal(!showOriginal)} />
              ) : undefined}
            >
              {/* Media preview for image/video/audio generation results */}
              {mediaResult && <MediaPreview media={mediaResult} />}
              <CodeBlock
                code={formatResult(canShowOriginal && showOriginal ? part.originalResult : part.result)}
                language="json"
                isError={isError}
              />
            </ToolSection>
          )}

          {/* Metadata */}
          <div className="px-3 py-1.5 border-t bg-muted/30 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span>ID: {part.toolCallId?.slice(0, 12)}...</span>
            {hasResult && <span>{isError ? 'Failed' : 'Completed'}</span>}
            {wasCompacted && part.compactionMeta && (
              <span className="flex items-center gap-1">
                <ScissorsIcon className="h-2.5 w-2.5" />
                Compacted{part.compactionMeta.extractionDurationMs > 0 ? ` in ${formatElapsed(part.compactionMeta.extractionDurationMs)}` : ''}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Media Result Detection & Preview ── */

type MediaResult = {
  type: 'image' | 'video';
  urls: string[];
  filePaths?: string[];
};

function detectMediaResult(result: unknown): MediaResult | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;

  if (r.type === 'image_generation_result') {
    const images = Array.isArray(r.images) ? r.images as Array<Record<string, unknown>> : [];
    const urls = images.map((img) => String(img.url ?? '')).filter(Boolean);
    const filePaths = images.map((img) => String(img.filePath ?? '')).filter(Boolean);
    return urls.length > 0 ? { type: 'image', urls, filePaths } : null;
  }

  if (r.type === 'video_generation_result') {
    const url = typeof r.url === 'string' ? r.url : '';
    const filePath = typeof r.filePath === 'string' ? r.filePath : '';
    return url ? { type: 'video', urls: [url], filePaths: filePath ? [filePath] : [] } : null;
  }

  return null;
}

const MediaPreview: FC<{ media: MediaResult }> = ({ media }) => {
  const handleSave = useCallback((url: string) => {
    // Extract filename from the URL for the save dialog suggestion
    const filename = url.split('/').pop() ?? undefined;
    app.image.save(url, filename);
  }, []);

  if (media.type === 'image') {
    return (
      <div className="mb-2 space-y-2">
        {media.urls.map((url, i) => (
          <div key={url} className="relative group inline-block">
            <img
              src={url}
              alt={`Generated image${media.urls.length > 1 ? ` ${i + 1}` : ''}`}
              className="max-w-md max-h-96 rounded-lg object-contain"
              loading="lazy"
            />
            {media.filePaths?.[i] && (
              <button
                type="button"
                onClick={() => handleSave(url)}
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-80 transition-opacity bg-black/60 hover:bg-black/80 text-white rounded-md p-1.5"
                title="Save image"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (media.type === 'video') {
    return (
      <div className="mb-2 relative group inline-block">
        <video
          src={media.urls[0]}
          controls
          className="max-w-md max-h-96 rounded-lg"
          preload="metadata"
        />
        {media.filePaths?.[0] && (
          <button
            type="button"
            onClick={() => handleSave(media.urls[0])}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-80 transition-opacity bg-black/60 hover:bg-black/80 text-white rounded-md p-1.5"
            title="Save video"
          >
            <DownloadIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return null;
};

/* ── Status Badges ── */

const StatusBadge: FC<{ isRunning: boolean; isError: boolean }> = ({ isRunning, isError }) => {
  if (isRunning) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400">RUNNING</span>;
  }
  if (isError) {
    return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive">ERROR</span>;
  }
  return <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400">DONE</span>;
};

const CompactedBadge: FC = () => (
  <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400">
    <ScissorsIcon className="h-2.5 w-2.5" />
    COMPACTED
  </span>
);

const SummarizingBadge: FC = () => (
  <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 animate-pulse">
    <ScissorsIcon className="h-2.5 w-2.5" />
    SUMMARIZING
  </span>
);

const CompactionToggle: FC<{ showOriginal: boolean; onToggle: () => void }> = ({ showOriginal, onToggle }) => (
  <span
    role="switch"
    aria-checked={showOriginal}
    tabIndex={0}
    className="ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer select-none"
    onClick={(e) => { e.stopPropagation(); onToggle(); }}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onToggle(); } }}
  >
    {showOriginal ? 'Show Compacted' : 'Show Original'}
  </span>
);

const ToolStatusIcon: FC<{ isRunning: boolean; isError: boolean }> = ({ isRunning, isError }) => {
  if (isRunning) {
    return <LoaderIcon className="h-3.5 w-3.5 animate-spin text-blue-500 shrink-0" />;
  }
  if (isError) {
    return <AlertCircleIcon className="h-3.5 w-3.5 text-destructive shrink-0" />;
  }
  return <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500 shrink-0" />;
};

const ToolElapsedBadge: FC<{
  isRunning: boolean;
  isError: boolean;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}> = ({ isRunning, isError, startedAt, finishedAt, durationMs }) => {
  return (
    <ElapsedBadge
      startedAt={startedAt}
      finishedAt={finishedAt}
      durationMs={durationMs}
      isRunning={isRunning}
      isError={isError}
      className="ml-auto"
    />
  );
};

const ToolSection: FC<{ title: string; defaultOpen?: boolean; badge?: React.ReactNode; children: React.ReactNode }> = ({ title, defaultOpen = false, badge, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:bg-muted/30"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDownIcon className="h-2.5 w-2.5" /> : <ChevronRightIcon className="h-2.5 w-2.5" />}
        {title}
        {badge}
      </button>
      {open && <div className="px-3 pb-2">{children}</div>}
    </div>
  );
};

/* CodeBlock imported from ./CodeBlock */

function isErrorResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return Boolean(r.error) || r.isError === true || (r.exitCode !== undefined && r.exitCode !== 0);
}

function getToolSummary(part: ToolCallPart): string {
  const args = part.args as Record<string, unknown>;
  if (part.toolName === 'sh' && args.command) return String(args.command).slice(0, 60);
  if (part.toolName === 'file_read' && args.path) return String(args.path).split('/').pop() ?? '';
  if (part.toolName === 'file_write' && args.path) return String(args.path).split('/').pop() ?? '';
  if (part.toolName === 'file_edit' && args.path) return String(args.path).split('/').pop() ?? '';
  if (part.toolName === 'grep' && args.pattern) return `/${args.pattern}/`;
  if (part.toolName === 'glob' && args.pattern) return String(args.pattern);
  if (part.toolName === 'list_directory' && args.path) return String(args.path);
  if (part.toolName === 'agent_lattice_chat') return 'Remote agent call';
  if (part.toolName === 'generate_image' && args.prompt) return String(args.prompt).slice(0, 60);
  if (part.toolName === 'generate_video' && args.prompt) return String(args.prompt).slice(0, 60);
  return '';
}

function formatArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function formatResult(result: unknown): string {
  const sanitized = sanitizeResultForDisplay(result);
  if (typeof sanitized === 'string') return sanitized;
  try {
    return JSON.stringify(sanitized, null, 2);
  } catch {
    return String(sanitized);
  }
}

function sanitizeResultForDisplay(result: unknown): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const record = result as Record<string, unknown>;
  const internalKeys = new Set(['observer', 'modelStream', '__compaction', '__executeToolCallId']);
  const visibleEntries = Object.entries(record).filter(([key]) => !internalKeys.has(key));
  const visible = Object.fromEntries(visibleEntries);

  // Observer augmentation may wrap primitive results as { value, observer }.
  if ('value' in visible && Object.keys(visible).length === 1) {
    return visible.value;
  }

  return visible;
}

function formatLiveOutput(output?: { stdout?: string; stderr?: string; truncated?: boolean; stopped?: boolean }): string {
  if (!output) return '';
  const chunks: string[] = [];
  if (output.stdout) chunks.push(`STDOUT\n${output.stdout}`);
  if (output.stderr) chunks.push(`STDERR\n${output.stderr}`);
  if (output.truncated) chunks.push('[output truncated]');
  if (output.stopped) chunks.push('[streaming stopped at max output]');
  return chunks.join('\n\n') || '[no output yet]';
}
