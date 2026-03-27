import { useState, type FC } from 'react';
import { SparklesIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { MarkdownText } from '../thread/MarkdownText';

interface AnswerSource {
  id: string;
  content: string;
  confidence: number;
}

interface Props {
  answer: string;
  sources?: AnswerSource[];
}

export const SynthesizedAnswer: FC<Props> = ({ answer, sources }) => {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const hasSources = sources && sources.length > 0;

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-primary shrink-0" />
        <span className="text-xs font-semibold text-primary">Synthesized Answer</span>
      </div>

      {/* Answer body */}
      <div className="text-sm text-foreground/90 leading-relaxed">
        <MarkdownText text={answer} />
      </div>

      {/* Sources toggle */}
      {hasSources && (
        <div className="space-y-2 border-t border-primary/10 pt-2">
          <button
            type="button"
            onClick={() => setSourcesOpen((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {sourcesOpen ? (
              <ChevronDownIcon className="h-3 w-3" />
            ) : (
              <ChevronRightIcon className="h-3 w-3" />
            )}
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </button>

          {sourcesOpen && (
            <div className="space-y-1.5">
              {sources.map((src) => {
                const pct = Math.round(src.confidence * 100);
                const snippet =
                  src.content.length > 120 ? src.content.slice(0, 120) + '…' : src.content;
                return (
                  <div
                    key={src.id}
                    className="rounded-md border border-border/40 bg-card/40 px-3 py-2 space-y-1"
                  >
                    <span className="text-[10px] font-medium text-muted-foreground">
                      {pct}% confidence
                    </span>
                    <p className="text-[11px] text-foreground/70 leading-snug">{snippet}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
