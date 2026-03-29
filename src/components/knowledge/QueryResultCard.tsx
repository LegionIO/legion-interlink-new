import { useState, type FC } from 'react';
import { ChevronRightIcon, ChevronDownIcon, FileTextIcon } from 'lucide-react';

export interface KnowledgeResult {
  id: string;
  content: string;
  confidence: number;
  source?: string;
  tags?: string[];
  created_at?: string;
}

interface Props {
  result: KnowledgeResult;
}

function confidenceClass(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (pct >= 50) return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  return 'bg-red-500/10 text-red-400 border-red-500/20';
}

function sourceFilename(source?: string): string | null {
  if (!source) return null;
  const parts = source.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? source;
}

export const QueryResultCard: FC<Props> = ({ result }) => {
  const [expanded, setExpanded] = useState(false);

  const pct = Math.round(result.confidence * 100);
  const snippet = result.content.length > 200 ? result.content.slice(0, 200) + '…' : result.content;
  const filename = sourceFilename(result.source);

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="w-full text-left rounded-lg border border-border/50 bg-card/50 p-3 transition-colors hover:bg-card/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {/* Top row */}
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-muted-foreground">
          {expanded ? (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronRightIcon className="h-3.5 w-3.5" />
          )}
        </span>

        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Source + confidence row */}
          <div className="flex flex-wrap items-center gap-2">
            {filename && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[240px]">
                <FileTextIcon className="h-3 w-3 shrink-0" />
                {filename}
              </span>
            )}
            <span
              className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${confidenceClass(pct)}`}
            >
              {pct}%
            </span>
          </div>

          {/* Content */}
          <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
            {expanded ? result.content : snippet}
          </p>

          {/* Tags */}
          {result.tags && result.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {result.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  );
};
