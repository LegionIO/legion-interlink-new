import { useState, useEffect, useCallback, useRef, type FC } from 'react';
import { ChevronDownIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { NumberField, Toggle, settingsSelectClass, type SettingsProps } from './shared';
import { app } from '@/lib/ipc-client';

type ComputerUseConfig = {
  enabled: boolean;
  showStepLog: boolean;
  toolSurface: 'both' | 'only-calls' | 'only-chat' | 'none';
  defaultSurface: 'docked' | 'window';
  defaultTarget: 'isolated-browser' | 'local-macos';
  approvalModeDefault: 'step' | 'goal' | 'autonomous';
  idleTimeoutSec: number;
  postActionDelayMs: number;
  maxSessionDurationMin: number;
  models: {
    plannerModelKey?: string;
    driverModelKey?: string;
    verifierModelKey?: string;
    recoveryModelKey?: string;
  };
  capture: {
    maxDimension: number;
    jpegQuality: number;
  };
  safety: {
    pauseOnTerminal: boolean;
    manualTakeoverPauses: boolean;
  };
  localMacos: {
    autoRequestPermissions: boolean;
    autoOpenPrivacySettings: boolean;
    allowedDisplays: string[];
    captureExcludedApps: string[];
  };
  overlay: {
    enabled: boolean;
    position: 'top' | 'bottom';
    heightPx: number;
    opacity: number;
  };
};

const MODEL_ROLES: Array<[string, string, string]> = [
  ['plannerModelKey', 'Planner', 'Decomposes goals into subgoals and action plans'],
  ['driverModelKey', 'Driver', 'Executes actions on the computer'],
  ['verifierModelKey', 'Verifier', 'Validates actions before execution'],
  ['recoveryModelKey', 'Recovery', 'Handles errors and retries'],
];

/**
 * A combobox-style picker for app names — shows current selections as removable
 * chips, and a single input that filters discovered running apps while also
 * offering an "Add custom" option for free-text entry.
 */
const AppListPicker: FC<{
  label: string;
  hint?: string;
  value: string[];
  onChange: (value: string[]) => void;
}> = ({ label, hint, value, onChange }) => {
  const [runningApps, setRunningApps] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const refreshApps = useCallback(() => {
    setIsLoading(true);
    void app.computerUse.listRunningApps().then(({ apps }) => {
      setRunningApps(apps);
    }).catch(() => {}).finally(() => setIsLoading(false));
  }, []);

  useEffect(() => { refreshApps(); }, [refreshApps]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isFocused) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isFocused]);

  const addApp = (appName: string) => {
    const trimmed = appName.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setQuery('');
    setHighlightIndex(-1);
  };

  const removeApp = (appName: string) => {
    onChange(value.filter((v) => v !== appName));
  };

  // Build the filtered options list
  const availableApps = runningApps.filter((app) => !value.includes(app));
  const lowerQuery = query.toLowerCase().trim();
  const filteredApps = lowerQuery
    ? availableApps.filter((app) => app.toLowerCase().includes(lowerQuery))
    : availableApps;

  // Show "Add custom" option when the query doesn't exactly match a known app
  const exactMatchExists = lowerQuery && filteredApps.some((app) => app.toLowerCase() === lowerQuery);
  const alreadyAdded = lowerQuery && value.some((v) => v.toLowerCase() === lowerQuery);
  const showCustomOption = lowerQuery && !exactMatchExists && !alreadyAdded;

  // Total items in dropdown for keyboard nav
  const totalItems = filteredApps.length + (showCustomOption ? 1 : 0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.min(prev + 1, totalItems - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filteredApps.length) {
        addApp(filteredApps[highlightIndex]);
      } else if (showCustomOption && (highlightIndex === filteredApps.length || highlightIndex === -1)) {
        addApp(query.trim());
      } else if (query.trim()) {
        addApp(query.trim());
      }
    } else if (e.key === 'Escape') {
      setIsFocused(false);
    }
  };

  const showDropdown = isFocused && (totalItems > 0 || isLoading);

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>

      {/* Current selections as removable chips */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((app) => (
            <span
              key={app}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/60 px-2 py-0.5 text-[11px]"
            >
              {app}
              <button
                type="button"
                onClick={() => removeApp(app)}
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Unified combobox input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setHighlightIndex(-1); }}
          onFocus={() => { setIsFocused(true); refreshApps(); }}
          onKeyDown={handleKeyDown}
          placeholder={isLoading ? 'Loading apps...' : 'Search running apps or type a name...'}
          className="w-full rounded-md border border-border/60 bg-card/60 px-2 py-1.5 text-[11px] outline-none placeholder:text-muted-foreground/40 focus:border-primary/50"
        />

        {showDropdown && (
          <div
            ref={dropdownRef}
            className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border/60 bg-popover shadow-lg"
          >
            {filteredApps.map((app, i) => (
              <button
                key={app}
                type="button"
                onClick={() => addApp(app)}
                className={`w-full px-2 py-1 text-left text-[11px] transition-colors ${
                  i === highlightIndex ? 'bg-muted/60' : 'hover:bg-muted/40'
                }`}
              >
                {app}
              </button>
            ))}
            {showCustomOption && (
              <button
                type="button"
                onClick={() => addApp(query.trim())}
                className={`w-full px-2 py-1 text-left text-[11px] transition-colors ${
                  highlightIndex === filteredApps.length ? 'bg-muted/60' : 'hover:bg-muted/40'
                }`}
              >
                <span className="text-muted-foreground/60">Add custom: </span>
                <span className="font-medium">{query.trim()}</span>
              </button>
            )}
            {isLoading && filteredApps.length === 0 && (
              <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">
                Discovering running apps...
              </div>
            )}
          </div>
        )}
      </div>

      {hint && <p className="text-[10px] text-muted-foreground/60">{hint}</p>}
    </div>
  );
};

type DisplayInfo = { name: string; displayId: string; pixelWidth: number; pixelHeight: number; isPrimary: boolean };

/**
 * Picker for connected displays. Shows discovered displays with resolution info,
 * lets users toggle which ones computer-use is allowed to capture. Empty selection
 * means all displays are used.
 */
const DisplayListPicker: FC<{
  label: string;
  hint?: string;
  value: string[];
  onChange: (value: string[]) => void;
  onDisplaysDiscovered?: (displays: DisplayInfo[]) => void;
}> = ({ label, hint, value, onChange, onDisplaysDiscovered }) => {
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const seededRef = useRef(false);
  const prevDisplayFingerprintRef = useRef('');
  // Use refs for callback values to avoid infinite re-render loops
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDisplaysDiscoveredRef = useRef(onDisplaysDiscovered);
  onDisplaysDiscoveredRef.current = onDisplaysDiscovered;

  const refreshDisplays = useCallback(() => {
    setIsLoading(true);
    void app.computerUse.listDisplays().then(({ displays: found }) => {
      setDisplays(found);

      const currentValue = valueRef.current;
      const currentOnChange = onChangeRef.current;
      const currentOnDiscovered = onDisplaysDiscoveredRef.current;

      // Detect display list changes (new/removed displays)
      const newFingerprint = found.map((d) => `${d.displayId}:${d.pixelWidth}x${d.pixelHeight}`).sort().join('|');
      const fingerprintChanged = prevDisplayFingerprintRef.current !== '' && newFingerprint !== prevDisplayFingerprintRef.current;
      prevDisplayFingerprintRef.current = newFingerprint;

      // Auto-seed: when allowedDisplays is empty and we discover displays,
      // default ALL displays to ON by populating allowedDisplays with all display names
      if (found.length > 0 && currentValue.length === 0 && !seededRef.current) {
        seededRef.current = true;
        const allNames = found.map((d) => d.name);
        currentOnChange(allNames);
        currentOnDiscovered?.(found);
      } else if (fingerprintChanged && found.length > 0) {
        // Display list changed (monitor plugged/unplugged) — add any new displays,
        // keep existing selections, remove stale references
        const currentLower = new Set(currentValue.map((v) => v.toLowerCase()));
        const discoveredNames = new Set(found.map((d) => d.name.toLowerCase()));
        const discoveredIds = new Set(found.map((d) => d.displayId.toLowerCase()));
        // Keep existing entries that still match a discovered display, add newly discovered ones
        const kept = currentValue.filter((v) => discoveredNames.has(v.toLowerCase()) || discoveredIds.has(v.toLowerCase()));
        const newDisplayNames = found
          .filter((d) => !currentLower.has(d.name.toLowerCase()) && !currentLower.has(d.displayId.toLowerCase()))
          .map((d) => d.name);
        if (newDisplayNames.length > 0 || kept.length !== currentValue.length) {
          const updated = [...kept, ...newDisplayNames];
          currentOnChange(updated);
          currentOnDiscovered?.(found.filter((d) =>
            updated.some((v) => v.toLowerCase() === d.name.toLowerCase() || v.toLowerCase() === d.displayId.toLowerCase()),
          ));
        }
      }
    }).catch(() => {}).finally(() => setIsLoading(false));
  }, []); // stable — uses refs internally

  useEffect(() => { refreshDisplays(); }, [refreshDisplays]);

  const isSelected = (display: DisplayInfo) =>
    value.some((v) => v.toLowerCase() === display.name.toLowerCase() || v.toLowerCase() === display.displayId.toLowerCase());

  const toggleDisplay = (display: DisplayInfo) => {
    if (isSelected(display)) {
      const next = value.filter((v) => v.toLowerCase() !== display.name.toLowerCase() && v.toLowerCase() !== display.displayId.toLowerCase());
      onChange(next);
      // Update maxDimension based on remaining enabled displays
      const enabledDisplays = displays.filter((d) =>
        next.some((v) => v.toLowerCase() === d.name.toLowerCase() || v.toLowerCase() === d.displayId.toLowerCase()),
      );
      if (enabledDisplays.length > 0) onDisplaysDiscovered?.(enabledDisplays);
    } else {
      const next = [...value, display.name];
      onChange(next);
      // Update maxDimension based on newly enabled displays
      const enabledDisplays = displays.filter((d) =>
        next.some((v) => v.toLowerCase() === d.name.toLowerCase() || v.toLowerCase() === d.displayId.toLowerCase()),
      );
      if (enabledDisplays.length > 0) onDisplaysDiscovered?.(enabledDisplays);
    }
  };

  const removeDisplay = (displayName: string) => {
    const next = value.filter((v) => v !== displayName);
    onChange(next);
    const enabledDisplays = displays.filter((d) =>
      next.some((v) => v.toLowerCase() === d.name.toLowerCase() || v.toLowerCase() === d.displayId.toLowerCase()),
    );
    if (enabledDisplays.length > 0) onDisplaysDiscovered?.(enabledDisplays);
  };

  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-medium text-muted-foreground">{label}</label>

      {/* Current selections that don't match any discovered display (custom entries) */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.filter((v) => !displays.some((d) => d.name.toLowerCase() === v.toLowerCase() || d.displayId.toLowerCase() === v.toLowerCase())).map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/60 px-2 py-0.5 text-[11px]"
            >
              {name}
              <button
                type="button"
                onClick={() => removeDisplay(name)}
                className="text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                <XIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Discovered displays as toggleable cards */}
      {displays.length > 0 && (
        <div className="space-y-1">
          {displays.map((display) => {
            const selected = isSelected(display);
            const noSelection = value.length === 0;
            return (
              <button
                key={display.displayId || display.name}
                type="button"
                onClick={() => toggleDisplay(display)}
                className={`w-full flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition-colors ${
                  selected
                    ? 'border-primary/50 bg-primary/5'
                    : noSelection
                      ? 'border-border/60 bg-card/60 opacity-70'
                      : 'border-border/60 bg-card/60 opacity-40'
                }`}
              >
                <span className={`h-2 w-2 rounded-full flex-shrink-0 ${selected ? 'bg-primary' : noSelection ? 'bg-muted-foreground/30' : 'bg-muted-foreground/20'}`} />
                <span className="flex-1 truncate">
                  {display.name}
                  {display.isPrimary && <span className="text-muted-foreground/60 ml-1">(primary)</span>}
                </span>
                <span className="text-muted-foreground/50 text-[10px] flex-shrink-0">
                  {display.pixelWidth}&times;{display.pixelHeight}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading && displays.length === 0 && (
        <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">
          Discovering displays...
        </div>
      )}

      {!isLoading && displays.length === 0 && (
        <div className="px-2 py-1.5 text-[11px] text-muted-foreground/60">
          No displays detected. Displays are discovered via the macOS helper.
        </div>
      )}

      {hint && <p className="text-[10px] text-muted-foreground/60">{hint}</p>}
    </div>
  );
};

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

  const handleDisplaysDiscovered = useCallback((enabledDisplays: DisplayInfo[]) => {
    if (enabledDisplays.length === 0) return;
    const maxX = Math.max(...enabledDisplays.map((d) => d.pixelWidth));
    const maxY = Math.max(...enabledDisplays.map((d) => d.pixelHeight));
    const largestDim = Math.max(maxX, maxY);
    if (largestDim > 0 && largestDim !== computerUse.capture.maxDimension) {
      updateConfig('computerUse.capture.maxDimension', largestDim);
    }
  }, [computerUse.capture.maxDimension, updateConfig]);

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
          <div>
            <label className="text-[10px] text-muted-foreground block mb-0.5">Tool Availability</label>
            <select className={settingsSelectClass} value={computerUse.toolSurface ?? 'both'} onChange={(e) => updateConfig('computerUse.toolSurface', e.target.value)}>
              <option value="both">Chat & Calls (Both)</option>
              <option value="only-calls">Only Realtime Calls</option>
              <option value="only-chat">Only Chat</option>
              <option value="none">Disabled</option>
            </select>
          </div>
          <NumberField label="Idle Timeout (sec)" value={computerUse.idleTimeoutSec} onChange={(value) => updateConfig('computerUse.idleTimeoutSec', value)} min={30} />
          <NumberField label="Post-Action Delay (ms)" value={computerUse.postActionDelayMs} onChange={(value) => updateConfig('computerUse.postActionDelayMs', value)} min={0} max={5000} />
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
          <Toggle label="Pause on Terminal actions" checked={computerUse.safety.pauseOnTerminal} onChange={(value) => updateConfig('computerUse.safety.pauseOnTerminal', value)} />
          <Toggle label="Pause on manual takeover" checked={computerUse.safety.manualTakeoverPauses} onChange={(value) => updateConfig('computerUse.safety.manualTakeoverPauses', value)} />
        </div>
      </fieldset>

      <fieldset className="rounded-lg border p-3 space-y-3">
        <legend className="text-xs font-semibold px-1">Local Mac</legend>
        <div className="rounded-md border border-border/60 bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          Requires macOS Accessibility, Screen Recording, and Automation permissions. {__BRAND_PRODUCT_NAME} can request these automatically when a session starts.
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle label="Auto-request permissions" checked={computerUse.localMacos.autoRequestPermissions} onChange={(value) => updateConfig('computerUse.localMacos.autoRequestPermissions', value)} />
          <Toggle label="Auto-open Privacy Settings" checked={computerUse.localMacos.autoOpenPrivacySettings} onChange={(value) => updateConfig('computerUse.localMacos.autoOpenPrivacySettings', value)} />
        </div>
        <DisplayListPicker label="Allowed Displays" value={computerUse.localMacos.allowedDisplays ?? []} onChange={(value) => updateConfig('computerUse.localMacos.allowedDisplays', value)} onDisplaysDiscovered={handleDisplaysDiscovered} hint="Select which displays computer use can capture. All displays are enabled by default." />
        <AppListPicker label="Capture Excluded Apps" value={computerUse.localMacos.captureExcludedApps ?? []} onChange={(value) => updateConfig('computerUse.localMacos.captureExcludedApps', value)} hint="Apps hidden from screenshots via ScreenCaptureKit. Our own app is always excluded by process ID." />
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
          <NumberField label="Max Dimension (px)" value={computerUse.capture.maxDimension} onChange={(value) => updateConfig('computerUse.capture.maxDimension', value)} min={512} />
          <NumberField label="JPEG Quality (%)" value={Math.round(computerUse.capture.jpegQuality * 100)} onChange={(value) => updateConfig('computerUse.capture.jpegQuality', Math.max(0.1, Math.min(value / 100, 1)))} min={10} max={100} />
        </div>
      </CollapsibleSection>
    </div>
  );
};
