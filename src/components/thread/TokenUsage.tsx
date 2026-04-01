import { useState, type FC } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { TokenUsageData } from '@/providers/RuntimeProvider';

function formatTokenCount(n: number): string {
  return n.toLocaleString('en-US');
}

export const TokenUsage: FC<{ usage: TokenUsageData }> = ({ usage }) => {
  const [expanded, setExpanded] = useState(false);

  const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, totalTokens } = usage;
  const hasCacheTokens = cacheReadTokens > 0 || cacheWriteTokens > 0;

  const cacheHitRatio = totalTokens > 0 && hasCacheTokens
    ? (cacheReadTokens / totalTokens)
    : null;

  return (
    <div className="mt-1.5 flex items-center justify-end">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="group flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] text-muted-foreground/50 transition-colors hover:bg-muted/30 hover:text-muted-foreground/80"
        title="Token usage"
      >
        {expanded ? (
          <span className="flex items-center gap-2">
            <span title="Input tokens">
              <span className="opacity-60">in</span>{' '}
              <span className="tabular-nums">{formatTokenCount(inputTokens)}</span>
            </span>
            <span className="opacity-30">·</span>
            <span title="Output tokens">
              <span className="opacity-60">out</span>{' '}
              <span className="tabular-nums">{formatTokenCount(outputTokens)}</span>
            </span>
            {hasCacheTokens && (
              <>
                <span className="opacity-30">·</span>
                <span title={`Cache read: ${formatTokenCount(cacheReadTokens)} / Cache write: ${formatTokenCount(cacheWriteTokens)}`}>
                  <span className="opacity-60">cache</span>{' '}
                  <span className="tabular-nums">{formatTokenCount(cacheReadTokens + cacheWriteTokens)}</span>
                </span>
              </>
            )}
            {cacheHitRatio !== null && cacheHitRatio > 0 && (
              <>
                <span className="opacity-30">·</span>
                <span
                  className="tabular-nums text-emerald-500/60"
                  title={`Cache hit ratio: ${Math.round(cacheHitRatio * 100)}%`}
                >
                  {Math.round(cacheHitRatio * 100)}% cached
                </span>
              </>
            )}
            <ChevronDownIcon className="h-2.5 w-2.5 rotate-180 opacity-50 transition-transform" />
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <span className="tabular-nums">{formatTokenCount(totalTokens)}</span>
            <span className="opacity-50">tok</span>
            <ChevronDownIcon className="h-2.5 w-2.5 opacity-50 transition-transform" />
          </span>
        )}
      </button>
    </div>
  );
};
