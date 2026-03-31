import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { useRealtime } from '@/providers/RealtimeProvider';
import { useConfig } from '@/providers/ConfigProvider';
import { DeviceRow } from './DeviceRow';
import { app } from '@/lib/ipc-client';
import { listOutputDevices } from '@/lib/audio/realtime-playback';
import { PhoneOffIcon, MicIcon, Volume2Icon, ChevronUpIcon } from 'lucide-react';

/* ── Helpers ── */

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function LevelBars({ level, count = 5 }: { level: number; count?: number }) {
  const filled = Math.round(level * count);
  return (
    <div className="flex items-end gap-[2px]">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full transition-all duration-75"
          style={{
            height: `${6 + i * 2}px`,
            backgroundColor: i < filled ? '#22c55e' : 'rgba(128,128,128,0.25)',
          }}
        />
      ))}
    </div>
  );
}

/* ── Status Dot ── */

function StatusDot({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
    );
  }
  if (status === 'preparing') {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
      </span>
    );
  }
  if (status === 'connecting') {
    return (
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-yellow-400 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-yellow-500" />
      </span>
    );
  }
  return <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />;
}

/* ── Device Picker Popover ── */

function DevicePicker({
  label,
  icon,
  devices,
  selectedDeviceId,
  levels,
  onSelect,
}: {
  label: string;
  icon: React.ReactNode;
  devices: Array<{ deviceId: string; label: string }>;
  selectedDeviceId: string | undefined;
  levels: Record<string, number>;
  onSelect: (deviceId: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', handler);
    return () => window.removeEventListener('pointerdown', handler);
  }, [open]);

  const selectedLabel =
    (!selectedDeviceId
      ? 'System Default'
      : devices.find((d) => d.deviceId === selectedDeviceId)?.label) ?? 'System Default';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50"
      >
        {icon}
        <span className="max-w-[120px] truncate">{selectedLabel}</span>
        <ChevronUpIcon className="h-2.5 w-2.5" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[300px] rounded-2xl border border-border/70 bg-popover/95 p-1.5 shadow-[0_16px_40px_rgba(5,4,15,0.28)] backdrop-blur-xl">
          <div className="px-3 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            {label}
          </div>
          <div className="max-h-[280px] overflow-y-auto space-y-0.5">
            <DeviceRow
              label="System Default"
              selected={!selectedDeviceId}
              level={levels['default'] ?? 0}
              onClick={() => { onSelect(undefined); setOpen(false); }}
            />
            {devices.filter((d) => d.deviceId !== 'default').map((d) => (
              <DeviceRow
                key={d.deviceId}
                label={d.label}
                selected={selectedDeviceId === d.deviceId}
                level={levels[d.deviceId] ?? 0}
                onClick={() => { onSelect(d.deviceId); setOpen(false); }}
              />
            ))}
            {devices.length === 0 && (
              <div className="px-3 py-3 text-[10px] text-muted-foreground text-center">
                No devices found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── CallOverlay ── */

export const CallOverlay: FC = () => {
  const { callState, endCall, inputLevel, outputLevel } = useRealtime();
  const { config, updateConfig } = useConfig();

  const [inputDevices, setInputDevices] = useState<Array<{ deviceId: string; label: string }>>([]);
  const [outputDevices, setOutputDevices] = useState<Array<{ deviceId: string; label: string }>>([]);

  const realtimeConfig = (config as Record<string, unknown> | null)?.realtime as {
    inputDeviceId?: string;
    outputDeviceId?: string;
  } | undefined;

  const selectedInputDeviceId = realtimeConfig?.inputDeviceId;
  const selectedOutputDeviceId = realtimeConfig?.outputDeviceId;
  const inputLevels = { [selectedInputDeviceId ?? 'default']: inputLevel };
  const outputLevels = { [selectedOutputDeviceId ?? 'default']: outputLevel };

  // Load devices on mount
  useEffect(() => {
    app.mic?.listDevices?.().then(setInputDevices).catch(() => setInputDevices([]));
    listOutputDevices().then(setOutputDevices).catch(() => setOutputDevices([]));
  }, []);

  const handleSelectInput = useCallback(
    (deviceId: string | undefined) => updateConfig('realtime.inputDeviceId', deviceId),
    [updateConfig],
  );

  const handleSelectOutput = useCallback(
    (deviceId: string | undefined) => updateConfig('realtime.outputDeviceId', deviceId),
    [updateConfig],
  );

  // Speaking / listening status text
  const statusText = callState.isSpeaking
    ? 'Speaking...'
    : callState.isResponding
      ? 'AI responding...'
      : 'Listening...';

  const statusPulse = callState.isSpeaking || callState.isResponding;

  return (
    <div className="relative z-20 border-t border-border/70 bg-background/88 px-6 pb-6 pt-4 backdrop-blur-md">
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col gap-3 rounded-[1.7rem] border border-border/70 bg-card/78 px-4 py-4 shadow-[inset_0_0_0_1px_rgba(197,194,245,0.08),0_12px_40px_rgba(5,4,15,0.18)]">
          {/* Row 1: Status, audio levels, timer */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <StatusDot status={callState.status} />
              <span className="text-xs font-medium capitalize text-muted-foreground">
                {callState.status === 'connected' ? 'Connected' : callState.status === 'preparing' ? 'Ringing...' : callState.status === 'connecting' ? 'Connecting...' : callState.status}
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5" title="Input level">
                <MicIcon className="h-3 w-3 text-muted-foreground" />
                <LevelBars level={inputLevel} />
              </div>
              <div className="flex items-center gap-1.5" title="Output level">
                <Volume2Icon className="h-3 w-3 text-muted-foreground" />
                <LevelBars level={outputLevel} />
              </div>
              <span className="tabular-nums text-xs font-medium text-muted-foreground">
                {formatDuration(callState.duration)}
              </span>
            </div>
          </div>

          {/* Row 2: Device selectors */}
          <div className="flex items-center gap-2 px-1">
            <DevicePicker
              label="Input Device"
              icon={<MicIcon className="h-3 w-3" />}
              devices={inputDevices}
              selectedDeviceId={selectedInputDeviceId}
              levels={inputLevels}
              onSelect={handleSelectInput}
            />
            <DevicePicker
              label="Output Device"
              icon={<Volume2Icon className="h-3 w-3" />}
              devices={outputDevices}
              selectedDeviceId={selectedOutputDeviceId}
              levels={outputLevels}
              onSelect={handleSelectOutput}
            />
          </div>

          {/* Row 3: Speaking status + End Call */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-medium ${statusPulse ? 'animate-pulse' : ''} ${
                  callState.isSpeaking
                    ? 'text-emerald-500'
                    : callState.isResponding
                      ? 'text-primary'
                      : 'text-muted-foreground'
                }`}
              >
                {statusText}
              </span>
              {callState.silenceCountdown != null && (
                <span className="text-xs font-medium text-amber-500">
                  Ending in {callState.silenceCountdown}s...
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => void endCall()}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700"
              title="End call"
            >
              <PhoneOffIcon className="h-4 w-4" />
            </button>
          </div>

          {/* Error display */}
          {callState.error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
              {callState.error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
