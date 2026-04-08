import type { FC } from 'react';
import {
  BarChart3Icon,
  ArrowDownIcon,
  ArrowUpIcon,
  ZapIcon,
  MicIcon,
  ImageIcon,
} from 'lucide-react';
import { formatTokenCount, formatDuration, formatDateShort } from './chart-utils';

type SummaryData = {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  cacheHitRatio: number;
  totalMessages: number;
  totalConversations: number;
  realtimeCalls: number;
  realtimeDurationSec: number;
  sttEvents: number;
  sttDurationSec: number;
  ttsEvents: number;
  ttsDurationSec: number;
  imagesGenerated: number;
  videosGenerated: number;
  earliestDate: string | null;
};

const StatCard: FC<{
  label: string;
  value: string;
  sub?: string;
  icon: FC<{ className?: string }>;
}> = ({ label, value, sub, icon: Icon }) => (
  <div className="rounded-xl border border-border/40 bg-card/60 p-3">
    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
    <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
  </div>
);

export const UsageSummaryCards: FC<{ data: SummaryData }> = ({ data }) => {
  const audioDuration = data.realtimeDurationSec + data.sttDurationSec + data.ttsDurationSec;
  const audioEvents = data.realtimeCalls + data.sttEvents + data.ttsEvents;
  const mediaCount = data.imagesGenerated + data.videosGenerated;

  return (
    <div className="grid grid-cols-3 gap-3">
      <StatCard
        icon={BarChart3Icon}
        label="Total Tokens"
        value={formatTokenCount(data.totalTokens)}
        sub={data.earliestDate ? `Since ${formatDateShort(data.earliestDate)}` : undefined}
      />
      <StatCard
        icon={ArrowDownIcon}
        label="Input Tokens"
        value={formatTokenCount(data.totalInputTokens)}
        sub={`${data.totalConversations} conversations`}
      />
      <StatCard
        icon={ArrowUpIcon}
        label="Output Tokens"
        value={formatTokenCount(data.totalOutputTokens)}
        sub={`${data.totalMessages} messages`}
      />
      <StatCard
        icon={ZapIcon}
        label="Cache Efficiency"
        value={data.cacheHitRatio > 0 ? `${Math.round(data.cacheHitRatio * 100)}%` : '—'}
        sub={
          data.totalCacheReadTokens > 0 || data.totalCacheWriteTokens > 0
            ? `${formatTokenCount(data.totalCacheReadTokens)} read · ${formatTokenCount(data.totalCacheWriteTokens)} write`
            : 'No cache data'
        }
      />
      <StatCard
        icon={MicIcon}
        label="Audio Duration"
        value={audioDuration > 0 ? formatDuration(audioDuration) : '—'}
        sub={
          audioEvents > 0
            ? `${data.realtimeCalls} realtime · ${data.sttEvents} STT · ${data.ttsEvents} TTS`
            : 'No audio sessions'
        }
      />
      <StatCard
        icon={ImageIcon}
        label="Media Generated"
        value={mediaCount > 0 ? mediaCount.toLocaleString() : '—'}
        sub={
          mediaCount > 0
            ? `${data.imagesGenerated} images · ${data.videosGenerated} videos`
            : 'No media generated'
        }
      />
    </div>
  );
};
