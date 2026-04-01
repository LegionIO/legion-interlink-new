import { useState, type FC } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from 'lucide-react';
import type { PipelineEnrichments, DebateEnrichment, CurationEnrichment } from '@/providers/RuntimeProvider';

export { type PipelineEnrichments };

/* ── Exported component ── */

export const PipelineInsights: FC<{ enrichments: PipelineEnrichments }> = ({ enrichments }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDebate = Boolean(enrichments.debate?.enabled);
  const hasCuration = Boolean(enrichments.curation);

  if (!hasDebate && !hasCuration) return null;

  const labels: string[] = [];
  if (hasDebate) labels.push('debate');
  if (hasCuration) labels.push('curation');

  return (
    <div className="mt-3 rounded-lg border border-border/40 bg-muted/20 text-xs overflow-hidden">
      {/* Collapsed header */}
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDownIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        ) : (
          <ChevronRightIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        )}
        <span className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider">
          Pipeline
        </span>
        <span className="text-[10px] text-muted-foreground/50">{labels.join(' + ')}</span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border/30">
          {hasDebate && enrichments.debate && (
            <DebateSection debate={enrichments.debate} />
          )}
          {hasCuration && enrichments.curation && (
            <CurationSection curation={enrichments.curation} />
          )}
        </div>
      )}
    </div>
  );
};

/* ── Debate section ── */

const DebateSection: FC<{ debate: DebateEnrichment }> = ({ debate }) => (
  <div className="px-3 py-2.5 space-y-2.5">
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Adversarial Debate</span>
      {debate.rounds != null && (
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-primary/10 text-primary/80 font-medium">
          {debate.rounds} {debate.rounds === 1 ? 'round' : 'rounds'}
        </span>
      )}
      {debate.judge_confidence != null && (
        <ConfidenceDot confidence={debate.judge_confidence} />
      )}
    </div>

    {/* Models row */}
    {(debate.advocate_model || debate.challenger_model || debate.judge_model) && (
      <div className="flex flex-wrap gap-2">
        {debate.advocate_model && (
          <ModelChip role="advocate" model={debate.advocate_model} color="blue" />
        )}
        {debate.challenger_model && (
          <ModelChip role="challenger" model={debate.challenger_model} color="amber" />
        )}
        {debate.judge_model && (
          <ModelChip role="judge" model={debate.judge_model} color="purple" />
        )}
      </div>
    )}

    {/* Summaries */}
    {debate.advocate_summary && (
      <SummaryBlock label="Advocate" color="blue" text={debate.advocate_summary} />
    )}
    {debate.challenger_summary && (
      <SummaryBlock label="Challenger" color="amber" text={debate.challenger_summary} />
    )}

    {/* Confidence */}
    {debate.judge_confidence != null && (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground/60 w-14 shrink-0">Confidence</span>
        <ConfidenceBar confidence={debate.judge_confidence} />
        <span className="text-[10px] font-mono text-muted-foreground/80 tabular-nums">
          {(debate.judge_confidence * 100).toFixed(0)}%
        </span>
      </div>
    )}
  </div>
);

/* ── Curation section ── */

const CurationSection: FC<{ curation: CurationEnrichment }> = ({ curation }) => {
  const items: Array<{ label: string; value: number }> = [
    { label: 'thinking blocks stripped', value: curation.thinking_blocks_stripped ?? 0 },
    { label: 'tool results distilled', value: curation.tool_results_distilled ?? 0 },
    { label: 'exchanges folded', value: curation.exchanges_folded ?? 0 },
    { label: 'superseded reads evicted', value: curation.superseded_reads_evicted ?? 0 },
    { label: 'duplicates removed', value: curation.duplicates_removed ?? 0 },
  ].filter((item) => item.value > 0);

  const hasSavings = (curation.token_savings_estimate ?? 0) > 0;

  return (
    <div className="px-3 py-2.5 space-y-2 border-t border-border/30 first:border-t-0">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Context Curation</span>
        {hasSavings && (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/10 text-green-600 dark:text-green-400 font-medium">
            ~{curation.token_savings_estimate!.toLocaleString()} tokens saved
          </span>
        )}
      </div>
      {items.length > 0 ? (
        <ul className="space-y-0.5">
          {items.map(({ label, value }) => (
            <li key={label} className="flex items-center gap-2 text-[10px] text-muted-foreground/70">
              <span className="tabular-nums font-mono text-muted-foreground/90 w-4 text-right">{value}</span>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] text-muted-foreground/50">No context modifications recorded.</p>
      )}
    </div>
  );
};

/* ── Sub-components ── */

type ChipColor = 'blue' | 'amber' | 'purple';

const colorMap: Record<ChipColor, string> = {
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  purple: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
};

const summaryBorderMap: Record<ChipColor, string> = {
  blue: 'border-l-blue-500/40',
  amber: 'border-l-amber-500/40',
  purple: 'border-l-violet-500/40',
};

const ModelChip: FC<{ role: string; model: string; color: ChipColor }> = ({ role, model, color }) => (
  <div className={`flex items-center gap-1 rounded border px-1.5 py-0.5 ${colorMap[color]}`}>
    <span className="font-medium capitalize">{role}</span>
    <span className="text-muted-foreground/50">·</span>
    <span className="font-mono">{model}</span>
  </div>
);

const SummaryBlock: FC<{ label: string; color: ChipColor; text: string }> = ({ label, color, text }) => (
  <div className={`border-l-2 pl-2 ${summaryBorderMap[color]}`}>
    <div className={`text-[10px] font-semibold mb-0.5 ${colorMap[color].split(' ').filter((c) => c.startsWith('text-')).join(' ')}`}>
      {label}
    </div>
    <p className="text-[11px] text-muted-foreground/80 leading-relaxed">{text}</p>
  </div>
);

const ConfidenceDot: FC<{ confidence: number }> = ({ confidence }) => {
  const color = confidence >= 0.8
    ? 'bg-green-500'
    : confidence >= 0.5
      ? 'bg-yellow-500'
      : 'bg-red-500';
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${color}`} title={`Judge confidence: ${(confidence * 100).toFixed(0)}%`} />;
};

const ConfidenceBar: FC<{ confidence: number }> = ({ confidence }) => {
  const pct = Math.round(confidence * 100);
  const barColor = confidence >= 0.8
    ? 'bg-green-500'
    : confidence >= 0.5
      ? 'bg-yellow-500'
      : 'bg-red-500';
  return (
    <div className="flex-1 h-1.5 rounded-full bg-muted/60 overflow-hidden max-w-[120px]">
      <div
        className={`h-full rounded-full transition-all ${barColor}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};
