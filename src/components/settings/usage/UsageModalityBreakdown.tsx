import { useState, type FC } from 'react';
import { ChevronRightIcon, ChevronDownIcon, MicIcon, ImageIcon, VideoIcon, AudioLinesIcon } from 'lucide-react';
import { formatDuration, formatDateShort } from './chart-utils';

type UsageEvent = {
  id: string;
  timestamp: string;
  modality: 'realtime' | 'tts' | 'stt' | 'image-gen' | 'video-gen';
  conversationId?: string;
  modelKey?: string;
  durationSec?: number;
  imageCount?: number;
  videoCount?: number;
  size?: string;
  quality?: string;
  estimatedCostUsd?: number;
};

type ModalitySection = {
  key: string;
  label: string;
  icon: FC<{ className?: string }>;
  filter: (e: UsageEvent) => boolean;
  count: (events: UsageEvent[]) => string;
  detail: (events: UsageEvent[]) => string;
};

const SECTIONS: ModalitySection[] = [
  {
    key: 'realtime',
    label: 'Realtime Voice',
    icon: MicIcon,
    filter: (e) => e.modality === 'realtime',
    count: (events) => {
      const dur = events.reduce((s, e) => s + (e.durationSec ?? 0), 0);
      return dur > 0 ? formatDuration(dur) : `${events.length} calls`;
    },
    detail: (events) => {
      const dur = events.reduce((s, e) => s + (e.durationSec ?? 0), 0);
      const avg = events.length > 0 ? dur / events.length : 0;
      return `${events.length} calls · ${formatDuration(dur)} total · ${formatDuration(avg)} avg`;
    },
  },
  {
    key: 'stt',
    label: 'Speech-to-Text',
    icon: AudioLinesIcon,
    filter: (e) => e.modality === 'stt',
    count: (events) => {
      const dur = events.reduce((s, e) => s + (e.durationSec ?? 0), 0);
      return dur > 0 ? formatDuration(dur) : `${events.length} events`;
    },
    detail: (events) => {
      const dur = events.reduce((s, e) => s + (e.durationSec ?? 0), 0);
      return `${events.length} recordings · ${formatDuration(dur)} total`;
    },
  },
  {
    key: 'tts',
    label: 'Text-to-Speech',
    icon: AudioLinesIcon,
    filter: (e) => e.modality === 'tts',
    count: (events) => {
      const dur = events.reduce((s, e) => s + (e.durationSec ?? 0), 0);
      return dur > 0 ? formatDuration(dur) : `${events.length} events`;
    },
    detail: (events) => {
      const dur = events.reduce((s, e) => s + (e.durationSec ?? 0), 0);
      return `${events.length} utterances · ${formatDuration(dur)} total`;
    },
  },
  {
    key: 'image-gen',
    label: 'Image Generation',
    icon: ImageIcon,
    filter: (e) => e.modality === 'image-gen',
    count: (events) => {
      const total = events.reduce((s, e) => s + (e.imageCount ?? 1), 0);
      return `${total} images`;
    },
    detail: (events) => {
      const total = events.reduce((s, e) => s + (e.imageCount ?? 1), 0);
      const sizes = new Map<string, number>();
      for (const e of events) {
        const key = e.size ?? 'default';
        sizes.set(key, (sizes.get(key) ?? 0) + (e.imageCount ?? 1));
      }
      const breakdown = Array.from(sizes.entries())
        .map(([k, v]) => `${v} @ ${k}`)
        .join(', ');
      return `${total} images · ${breakdown}`;
    },
  },
  {
    key: 'video-gen',
    label: 'Video Generation',
    icon: VideoIcon,
    filter: (e) => e.modality === 'video-gen',
    count: (events) => {
      const total = events.reduce((s, e) => s + (e.videoCount ?? 1), 0);
      return `${total} videos`;
    },
    detail: (events) => {
      const total = events.reduce((s, e) => s + (e.videoCount ?? 1), 0);
      return `${total} videos generated`;
    },
  },
];

const ModalitySectionView: FC<{ section: ModalitySection; events: UsageEvent[] }> = ({
  section,
  events,
}) => {
  const [expanded, setExpanded] = useState(false);
  const filtered = events.filter(section.filter);
  const Icon = section.icon;
  const isEmpty = filtered.length === 0;

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 overflow-hidden">
      <button
        type="button"
        onClick={() => !isEmpty && setExpanded((v) => !v)}
        className={`flex w-full items-center gap-2 px-3 py-2.5 text-xs transition-colors ${
          isEmpty ? 'cursor-default opacity-60' : 'hover:bg-muted/30'
        }`}
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium">{section.label}</span>
        <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
          {isEmpty ? 'No data' : section.count(filtered)}
        </span>
        {!isEmpty &&
          (expanded ? (
            <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRightIcon className="h-3 w-3 text-muted-foreground" />
          ))}
      </button>

      {expanded && !isEmpty && (
        <div className="border-t border-border/30 px-3 py-2 space-y-2">
          <p className="text-[10px] text-muted-foreground">{section.detail(filtered)}</p>
          {/* Recent events list (last 10) */}
          <div className="space-y-1">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
              Recent
            </p>
            {filtered.slice(0, 10).map((evt) => (
              <div
                key={evt.id}
                className="flex items-center gap-3 text-[10px] text-muted-foreground py-0.5"
              >
                <span className="tabular-nums shrink-0">{formatDateShort(evt.timestamp)}</span>
                {evt.durationSec !== undefined && (
                  <span className="tabular-nums">{formatDuration(evt.durationSec)}</span>
                )}
                {evt.imageCount !== undefined && <span>{evt.imageCount} img</span>}
                {evt.videoCount !== undefined && <span>{evt.videoCount} vid</span>}
                {evt.size && <span>{evt.size}</span>}
                {evt.quality && <span className="capitalize">{evt.quality}</span>}
                {evt.modelKey && (
                  <span className="truncate max-w-[120px]" title={evt.modelKey}>
                    {evt.modelKey}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const UsageModalityBreakdown: FC<{ events: UsageEvent[] }> = ({ events }) => (
  <div className="space-y-3">
    <h4 className="text-xs font-medium text-muted-foreground">By Modality</h4>
    {SECTIONS.map((section) => (
      <ModalitySectionView key={section.key} section={section} events={events} />
    ))}
  </div>
);
