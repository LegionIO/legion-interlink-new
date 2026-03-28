import { useState, type FC } from 'react';
import {
  CheckCircle2Icon,
  CircleDotIcon,
  LoaderIcon,
  MousePointerIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import type {
  ComputerUsePermissions,
  ComputerUsePermissionSection,
} from '../../../shared/computer-use';

type PermissionRowStatus = 'granted' | 'missing' | 'requesting';

type PermissionRowDef = {
  section: ComputerUsePermissionSection;
  label: string;
  description: string;
  getStatus: (p: ComputerUsePermissions) => boolean;
};

const PERMISSION_ROWS: PermissionRowDef[] = [
  {
    section: 'accessibility',
    label: 'Accessibility',
    description: 'Control mouse, keyboard, and windows',
    getStatus: (p) => p.accessibilityTrusted,
  },
  {
    section: 'screen-recording',
    label: 'Screen Recording',
    description: 'Capture screenshots of your display',
    getStatus: (p) => p.screenRecordingGranted,
  },
  {
    section: 'automation',
    label: 'Automation',
    description: 'Launch and control applications',
    getStatus: (p) => p.automationGranted,
  },
  {
    section: 'input-monitoring',
    label: 'Input Monitoring',
    description: 'Detect takeover to pause sessions',
    getStatus: (p) => p.inputMonitoringGranted,
  },
];

type PermissionChecklistProps = {
  permissions: ComputerUsePermissions;
  isRequestingAll: boolean;
  isProbingInputMonitoring: boolean;
  inputMonitoringProbeAttempts: number;
  onRequestAll: () => void;
  onRequestSingle: (section: ComputerUsePermissionSection) => Promise<void>;
  onProbeInputMonitoring: () => void;
  onOpenSettings: (section?: ComputerUsePermissionSection) => void;
};

export const PermissionChecklist: FC<PermissionChecklistProps> = ({
  permissions,
  isRequestingAll,
  isProbingInputMonitoring,
  inputMonitoringProbeAttempts,
  onRequestAll,
  onRequestSingle,
  onProbeInputMonitoring,
  onOpenSettings,
}) => {
  const [requestingSection, setRequestingSection] = useState<ComputerUsePermissionSection | null>(null);
  const allGranted = PERMISSION_ROWS.every((row) => row.getStatus(permissions));
  const missingCount = PERMISSION_ROWS.filter((row) => !row.getStatus(permissions)).length;

  // Collapsed: all permissions granted
  if (allGranted) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheckIcon className="h-3.5 w-3.5 text-green-500 shrink-0" />
        <span>Local Mac permissions granted</span>
      </div>
    );
  }

  const handleSingleRequest = async (section: ComputerUsePermissionSection) => {
    if (requestingSection || isRequestingAll) return;
    setRequestingSection(section);
    try {
      await onRequestSingle(section);
    } finally {
      setRequestingSection(null);
    }
  };

  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2.5 text-xs text-muted-foreground space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheckIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
          <span>Local Mac Permissions</span>
          <span className="text-muted-foreground font-normal">
            ({missingCount} remaining)
          </span>
        </div>
      </div>

      {/* Permission rows */}
      <div className="space-y-1">
        {PERMISSION_ROWS.map((row) => {
          const granted = row.getStatus(permissions);
          const isRequesting = requestingSection === row.section || (isRequestingAll && !granted);
          const isInputMonitoring = row.section === 'input-monitoring';

          let status: PermissionRowStatus = 'missing';
          if (granted) status = 'granted';
          else if (isRequesting) status = 'requesting';

          return (
            <div
              key={row.section}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
            >
              {/* Left: icon + label + description */}
              <div className="flex items-center gap-2 min-w-0">
                {status === 'granted' ? (
                  <CheckCircle2Icon className="h-3.5 w-3.5 text-green-500 shrink-0" />
                ) : status === 'requesting' || (isInputMonitoring && isProbingInputMonitoring) ? (
                  <LoaderIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                ) : (
                  <CircleDotIcon className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                )}
                <div className="min-w-0">
                  <span className="font-medium text-foreground">{row.label}</span>
                  <span className="ml-1.5 text-muted-foreground/70">{row.description}</span>
                </div>
              </div>

              {/* Right: action button */}
              <div className="shrink-0">
                {status === 'granted' ? (
                  <span className="text-[11px] text-green-500/80">Granted</span>
                ) : isInputMonitoring ? (
                  /* Input Monitoring: special verify flow */
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={onProbeInputMonitoring}
                      disabled={isProbingInputMonitoring || isRequestingAll}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/70 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isProbingInputMonitoring ? (
                        <LoaderIcon className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <MousePointerIcon className="h-2.5 w-2.5" />
                      )}
                      <span>{isProbingInputMonitoring ? 'Listening...' : 'Verify'}</span>
                    </button>
                    {inputMonitoringProbeAttempts > 0 && (
                      <button
                        type="button"
                        onClick={() => onOpenSettings('input-monitoring')}
                        className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/70 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
                      >
                        <SettingsIcon className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                ) : status === 'requesting' ? (
                  <span className="text-[11px] text-muted-foreground">Requesting...</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => { void handleSingleRequest(row.section); }}
                    disabled={requestingSection !== null || isRequestingAll}
                    className="inline-flex items-center gap-1 rounded-lg border border-border/70 bg-card/70 px-2 py-0.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Grant
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Input Monitoring hint — only when probing or after failed probe */}
      {!permissions.inputMonitoringGranted && (isProbingInputMonitoring || inputMonitoringProbeAttempts > 0) && (
        <p className="px-2 text-[11px] text-muted-foreground/70">
          {isProbingInputMonitoring
            ? 'Move your mouse or press any key to verify the takeover monitor can detect your input.'
            : 'No input detected. Ensure Input Monitoring is enabled in System Settings \u203A Privacy & Security \u203A Input Monitoring, then try again.'}
        </p>
      )}

      {/* Footer actions */}
      {missingCount > 1 && (
        <div className="flex items-center gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={onRequestAll}
            disabled={isRequestingAll || requestingSection !== null}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isRequestingAll ? <LoaderIcon className="h-3 w-3 animate-spin" /> : null}
            <span>{isRequestingAll ? 'Requesting...' : 'Grant All Missing'}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenSettings()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/70 px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted/50"
          >
            Open Settings
          </button>
        </div>
      )}
    </div>
  );
};
