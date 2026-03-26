import { useState, type FC } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { NumberField, TextField, Toggle, settingsSelectClass, type SettingsProps } from './shared';

type ComputerUseConfig = {
  enabled: boolean;
  showStepLog: boolean;
  defaultSurface: 'docked' | 'window';
  defaultTarget: 'isolated-browser' | 'local-macos' | 'isolated-vm';
  approvalModeDefault: 'step' | 'goal' | 'autonomous';
  idleTimeoutSec: number;
  maxSessionDurationMin: number;
  models: {
    plannerModelKey?: string;
    driverModelKey?: string;
    verifierModelKey?: string;
    recoveryModelKey?: string;
  };
  capture: {
    fps: number;
    maxDimension: number;
    jpegQuality: number;
    diffThreshold: number;
  };
  safety: Record<string, boolean>;
  localMacos: {
    autoRequestPermissions: boolean;
    autoOpenPrivacySettings: boolean;
    allowedApps: string[];
    deniedApps: string[];
    allowedDisplays: string[];
    redactApps: string[];
    captureExcludedApps: string[];
  };
  isolated: {
    browserProfileDir: string;
    downloadDir: string;
    allowedDomains: string[];
    persistentSession: boolean;
    remoteVmUrl?: string;
  };
  persistence: {
    saveFrames: boolean;
    saveVideo: boolean;
    checkpointEveryActions: number;
    retainDays: number;
  };
  overlay: {
    enabled: boolean;
    position: 'top' | 'bottom';
    heightPx: number;
    opacity: number;
  };
};

const SAFETY_LABELS: Record<string, string> = {
  confirmDestructive: 'Confirm destructive actions',
  blockSensitiveUrls: 'Block sensitive URLs',
  requireApprovalForDownloads: 'Require approval for downloads',
  blockPasswordFields: 'Block password fields',
  screenshotRedaction: 'Redact sensitive content in screenshots',
  sandboxFileAccess: 'Sandbox file access',
};

const MODEL_ROLES: Array<[string, string, string]> = [
  ['plannerModelKey', 'Planner', 'Decomposes goals into subgoals and action plans'],
  ['driverModelKey', 'Driver', 'Executes actions on the computer'],
  ['verifierModelKey', 'Verifier', 'Validates actions before execution'],
  ['recoveryModelKey', 'Recovery', 'Handles errors and retries'],
];

function joinList(values: string[]): string {
  return values.join(', ');
}

function splitList(value: string): string[] {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

const CollapsibleSection: FC<{ title: string; defaultOpen?: boolean; children: React.ReactNode }> = ({ title, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <fieldset className="rounded-lg border p-3 space-y-3">
      <legend className="text-xs font-semibold px-1">
        <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
          {open ? <ChevronDownIcon className="h-3 w-3" /> : <ChevronRightIcon className="h-3 w-3" />}
          {title}
        </button>
      </legend>
      {open && children}
    </fieldset>
  );
};

export const ComputerUseSettings: FC<SettingsProps> = ({ config, updateConfig }) => {
  const computerUse = config.computerUse as ComputerUseConfig;
  const models = config.models as { catalog: Array<{ key: string; displayName: string }> };

  return (
    <div className="space-y-6">
      <h3 className="text-sm font-semibold">Computer Use</h3>

      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">General</legend>
        <Toggle label="Enabled" checked={computerUse.enabled} onChange={(value) => updateConfig('computerUse.enabled', value)} />
        <Toggle label="Show Step Log" checked={computerUse.showStepLog} onChange={(value) => updateConfig('computerUse.showStepLog', value)} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Default Surface</label>
            <select className={settingsSelectClass} value={computerUse.defaultSurface} onChange={(e) => updateConfig('computerUse.defaultSurface', e.target.value)}>
              <option value="docked">Docked panel</option>
              <option value="window">Detached window</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Default Target</label>
            <select className={settingsSelectClass} value={computerUse.defaultTarget} onChange={(e) => updateConfig('computerUse.defaultTarget', e.target.value)}>
              <option value="isolated-browser">Isolated Browser</option>
              <option value="local-macos">Local Mac</option>
              <option value="isolated-vm">Isolated VM</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Approval Mode</label>
            <select className={settingsSelectClass} value={computerUse.approvalModeDefault} onChange={(e) => updateConfig('computerUse.approvalModeDefault', e.target.value)}>
              <option value="step">Step approvals</option>
              <option value="goal">Goal approvals</option>
              <option value="autonomous">Mostly autonomous</option>
            </select>
          </div>
          <NumberField label="Idle Timeout (sec)" value={computerUse.idleTimeoutSec} onChange={(value) => updateConfig('computerUse.idleTimeoutSec', value)} min={30} />
          <NumberField label="Max Session Duration (min)" value={computerUse.maxSessionDurationMin} onChange={(value) => updateConfig('computerUse.maxSessionDurationMin', value)} min={5} />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Model Assignments</legend>
        <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          Override the default model for each session role. Leave on "Inherit" to use whatever model is selected in the composer.
        </div>
        <div className="grid grid-cols-2 gap-3">
          {MODEL_ROLES.map(([key, label, hint]) => (
            <div key={key}>
              <label className="text-[10px] text-muted-foreground block mb-0.5" title={hint}>{label}</label>
              <select className={settingsSelectClass} value={computerUse.models[key as keyof ComputerUseConfig['models']] ?? ''} onChange={(e) => updateConfig(`computerUse.models.${key}`, e.target.value || undefined)}>
                <option value="">Inherit selected model</option>
                {models.catalog.map((model) => (
                  <option key={model.key} value={model.key}>{model.displayName}</option>
                ))}
              </select>
              <span className="text-[10px] text-muted-foreground/60 mt-0.5 block">{hint}</span>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Safety</legend>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(computerUse.safety).map(([key, value]) => (
            <Toggle
              key={key}
              label={SAFETY_LABELS[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())}
              checked={value}
              onChange={(next) => updateConfig(`computerUse.safety.${key}`, next)}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Local Mac</legend>
        <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          Requires macOS Accessibility, Screen Recording, and Automation permissions. Interlink can request these automatically when a session starts.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle label="Auto-request permissions" checked={computerUse.localMacos.autoRequestPermissions} onChange={(value) => updateConfig('computerUse.localMacos.autoRequestPermissions', value)} />
          <Toggle label="Auto-open Privacy Settings" checked={computerUse.localMacos.autoOpenPrivacySettings} onChange={(value) => updateConfig('computerUse.localMacos.autoOpenPrivacySettings', value)} />
        </div>
        <TextField label="Allowed Apps" value={joinList(computerUse.localMacos.allowedApps)} onChange={(value) => updateConfig('computerUse.localMacos.allowedApps', splitList(value))} hint="Comma-separated app names" />
        <TextField label="Denied Apps" value={joinList(computerUse.localMacos.deniedApps)} onChange={(value) => updateConfig('computerUse.localMacos.deniedApps', splitList(value))} hint="Comma-separated app names" />
        <TextField label="Allowed Displays" value={joinList(computerUse.localMacos.allowedDisplays)} onChange={(value) => updateConfig('computerUse.localMacos.allowedDisplays', splitList(value))} hint="Comma-separated display identifiers" />
        <TextField label="Redact Apps" value={joinList(computerUse.localMacos.redactApps)} onChange={(value) => updateConfig('computerUse.localMacos.redactApps', splitList(value))} hint="Hide sensitive app windows from screenshots" />
        <TextField label="Capture Excluded Apps" value={joinList(computerUse.localMacos.captureExcludedApps ?? [])} onChange={(value) => updateConfig('computerUse.localMacos.captureExcludedApps', splitList(value))} hint="Apps hidden from screenshots via ScreenCaptureKit (comma-separated)" />
      </fieldset>

      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Isolated Browser / VM</legend>
        <TextField label="Remote VM URL" value={computerUse.isolated.remoteVmUrl ?? ''} onChange={(value) => updateConfig('computerUse.isolated.remoteVmUrl', value || undefined)} mono />
        {!computerUse.isolated.remoteVmUrl?.trim() && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Isolated VM sessions require a Remote VM URL.
          </div>
        )}
        <TextField label="Allowed Domains" value={joinList(computerUse.isolated.allowedDomains)} onChange={(value) => updateConfig('computerUse.isolated.allowedDomains', splitList(value))} hint="Comma-separated domains, or * for all" />
        <Toggle label="Persistent Browser Session" checked={computerUse.isolated.persistentSession} onChange={(value) => updateConfig('computerUse.isolated.persistentSession', value)} />
        <TextField label="Browser Profile Dir" value={computerUse.isolated.browserProfileDir} onChange={(value) => updateConfig('computerUse.isolated.browserProfileDir', value)} mono />
        <TextField label="Download Dir" value={computerUse.isolated.downloadDir} onChange={(value) => updateConfig('computerUse.isolated.downloadDir', value)} mono />
      </fieldset>

      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Overlay</legend>
        <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          Shows a status bar on your screen during Local Mac sessions. Excluded from screenshots via ScreenCaptureKit.
        </div>
        <Toggle label="Enabled" checked={computerUse.overlay.enabled} onChange={(value) => updateConfig('computerUse.overlay.enabled', value)} />
        {computerUse.overlay.enabled && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-0.5">Position</label>
              <select className={settingsSelectClass} value={computerUse.overlay.position} onChange={(e) => updateConfig('computerUse.overlay.position', e.target.value)}>
                <option value="top">Top of screen</option>
                <option value="bottom">Bottom of screen</option>
              </select>
            </div>
            <NumberField label="Height (px)" value={computerUse.overlay.heightPx} onChange={(value) => updateConfig('computerUse.overlay.heightPx', value)} min={60} max={300} />
            <NumberField label="Opacity (%)" value={Math.round(computerUse.overlay.opacity * 100)} onChange={(value) => updateConfig('computerUse.overlay.opacity', Math.max(0.3, Math.min(value / 100, 0.95)))} min={30} max={95} />
          </div>
        )}
      </fieldset>

      <CollapsibleSection title="Capture (Advanced)">
        <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          Fine-tune screenshot capture. Most users can leave these at defaults.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Frames Per Second" value={computerUse.capture.fps} onChange={(value) => updateConfig('computerUse.capture.fps', value)} min={0.1} max={2} />
          <NumberField label="Max Dimension (px)" value={computerUse.capture.maxDimension} onChange={(value) => updateConfig('computerUse.capture.maxDimension', value)} min={512} />
          <NumberField label="JPEG Quality (%)" value={Math.round(computerUse.capture.jpegQuality * 100)} onChange={(value) => updateConfig('computerUse.capture.jpegQuality', Math.max(0.1, Math.min(value / 100, 1)))} min={10} max={100} />
          <NumberField label="Diff Threshold (%)" value={Math.round(computerUse.capture.diffThreshold * 100)} onChange={(value) => updateConfig('computerUse.capture.diffThreshold', Math.max(0, Math.min(value / 100, 1)))} min={0} max={100} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Session Persistence (Advanced)">
        <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          Control what gets saved between sessions.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Toggle label="Save Frames" checked={computerUse.persistence.saveFrames} onChange={(value) => updateConfig('computerUse.persistence.saveFrames', value)} />
          <Toggle label="Save Video" checked={computerUse.persistence.saveVideo} onChange={(value) => updateConfig('computerUse.persistence.saveVideo', value)} />
          <NumberField label="Checkpoint Interval (actions)" value={computerUse.persistence.checkpointEveryActions} onChange={(value) => updateConfig('computerUse.persistence.checkpointEveryActions', value)} min={1} />
          <NumberField label="Retention (days)" value={computerUse.persistence.retainDays} onChange={(value) => updateConfig('computerUse.persistence.retainDays', value)} min={1} />
        </div>
      </CollapsibleSection>
    </div>
  );
};
