import { app, shell, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import { accessSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type {
  ComputerDisplayInfo,
  ComputerDisplayLayout,
  ComputerUsePermissionRequestResult,
  ComputerUsePermissionSection,
  ComputerUsePermissions,
} from '../../shared/computer-use.js';
import { LOCAL_MACOS_HELPER_SOURCE } from './helpers/local-macos-helper-source.js';

const execFileAsync = promisify(execFile);
const LOCAL_MACOS_PRIVACY_URLS: Record<ComputerUsePermissionSection, string> = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  'screen-recording': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  'input-monitoring': 'x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent',
};

/**
 * Resolve the pre-compiled LocalMacosHelper binary path.
 *
 * In production (packaged .app): looks in process.resourcesPath/bin/
 * In development: looks in <project>/build/bin/
 *
 * Returns the path if the binary exists and is executable, otherwise null.
 */
export function resolveCompiledHelperBinary(): string | null {
  const candidates: string[] = [];

  // Production: electron-builder extraResources places it under Resources/bin/
  if (app.isPackaged) {
    candidates.push(join(process.resourcesPath, 'bin', 'LocalMacosHelper'));
  }

  // Dev: compiled via `pnpm compile:swift` into build/bin/
  candidates.push(join(process.cwd(), 'build', 'bin', 'LocalMacosHelper'));

  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Not found or not executable — try next
    }
  }

  return null;
}

/**
 * Build a safe env for the `xcrun swift` fallback path.
 *
 * Packaged macOS .app bundles launched from Finder/Dock inherit a minimal PATH
 * that may not include the Xcode toolchain. This ensures xcrun and swiftc can
 * find each other even in that context.
 */
export function buildSwiftFallbackEnv(): NodeJS.ProcessEnv {
  const basePaths = [
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    '/usr/local/bin',
    '/Library/Developer/CommandLineTools/usr/bin',
  ];

  const existingPath = process.env.PATH ?? '';
  const pathSet = new Set([...basePaths, ...existingPath.split(':').filter(Boolean)]);
  const mergedPath = [...pathSet].join(':');

  const env: NodeJS.ProcessEnv = { ...process.env, PATH: mergedPath };

  // Set DEVELOPER_DIR if not already present — helps xcrun locate the SDK
  if (!env.DEVELOPER_DIR) {
    const xcodeDir = '/Applications/Xcode.app/Contents/Developer';
    const cltDir = '/Library/Developer/CommandLineTools';
    if (existsSync(xcodeDir)) {
      env.DEVELOPER_DIR = xcodeDir;
    } else if (existsSync(cltDir)) {
      env.DEVELOPER_DIR = cltDir;
    }
  }

  return env;
}

function resolveHelperSource(): string {
  const candidates = [
    fileURLToPath(new URL('./helpers/LocalMacosHelper.swift', import.meta.url)),
    fileURLToPath(new URL('../../electron/computer-use/helpers/LocalMacosHelper.swift', import.meta.url)),
    join(process.cwd(), 'electron', 'computer-use', 'helpers', 'LocalMacosHelper.swift'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf-8');
    }
  }

  return LOCAL_MACOS_HELPER_SOURCE;
}

function resolveHelperRuntimeDir(): string {
  if (app.isReady()) {
    return app.getPath('userData');
  }
  return join(homedir(), '.' + __BRAND_APP_SLUG);
}

export function resolveMaterializedHelperPath(): string {
  const helperDir = join(resolveHelperRuntimeDir(), 'computer-use', 'helpers');
  const helperScriptPath = join(helperDir, 'LocalMacosHelper.swift');
  const helperSource = resolveHelperSource();

  mkdirSync(helperDir, { recursive: true });

  if (!existsSync(helperScriptPath) || readFileSync(helperScriptPath, 'utf-8') !== helperSource) {
    writeFileSync(helperScriptPath, helperSource, 'utf-8');
  }

  return helperScriptPath;
}

export type LocalMacosHelperResponse = {
  ok?: boolean;
  accessibilityTrusted?: boolean;
  screenRecordingGranted?: boolean;
  automationGranted?: boolean;
  inputMonitoringGranted?: boolean;
  desktopCoordinateWidth?: number;
  desktopCoordinateHeight?: number;
  desktopWidth?: number;
  desktopHeight?: number;
  pointerX?: number;
  pointerY?: number;
  imageBase64?: string;
  width?: number;
  height?: number;
  error?: string;
  /** Display index of the captured display */
  displayIndex?: number;
  /** Info for the captured display */
  displayInfo?: Record<string, unknown>;
  /** All connected displays metadata */
  displays?: Array<{
    displayId?: string;
    name?: string;
    pixelWidth?: number;
    pixelHeight?: number;
    logicalWidth?: number;
    logicalHeight?: number;
    globalX?: number;
    globalY?: number;
    scaleFactor?: number;
    isPrimary?: boolean;
  }>;
  displayCount?: number;
};

async function runLocalMacHelper(args: string[]): Promise<LocalMacosHelperResponse> {
  try {
    // Prefer the pre-compiled binary (always available in production builds,
    // available in dev after running `pnpm compile:swift`)
    const binaryPath = resolveCompiledHelperBinary();
    if (binaryPath) {
      const { stdout } = await execFileAsync(binaryPath, args, { timeout: 15000 });
      return JSON.parse(stdout || '{}') as LocalMacosHelperResponse;
    }

    // Fallback: interpret via xcrun swift (dev mode without pre-compiled binary).
    // Use the safe env to ensure xcrun/swift are on PATH even in packaged apps.
    const helperScriptPath = resolveMaterializedHelperPath();
    const { stdout } = await execFileAsync('xcrun', ['swift', helperScriptPath, ...args], {
      timeout: 15000,
      env: buildSwiftFallbackEnv(),
    });
    return JSON.parse(stdout || '{}') as LocalMacosHelperResponse;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getAccessibilityStatus(): boolean {
  try {
    return process.platform === 'darwin'
      ? systemPreferences.isTrustedAccessibilityClient(false)
      : false;
  } catch {
    return false;
  }
}

function getScreenRecordingStatus(helperResult?: LocalMacosHelperResponse): boolean {
  try {
    const status = process.platform === 'darwin'
      ? systemPreferences.getMediaAccessStatus('screen')
      : 'not-determined';
    return status === 'granted';
  } catch {
    return helperResult?.screenRecordingGranted ?? false;
  }
}

async function requestScreenRecordingPermission(): Promise<boolean> {
  const result = await runLocalMacHelper(['requestScreenRecording']);
  return result.ok === true && (result.screenRecordingGranted ?? false);
}

async function probeAutomationPermission(): Promise<boolean> {
  try {
    await execFileAsync('osascript', ['-e', 'tell application "System Events" to count processes'], {
      timeout: 10000,
    });
    return true;
  } catch {
    return false;
  }
}

async function requestAutomationPermission(): Promise<boolean> {
  return probeAutomationPermission();
}

/**
 * Functional probe for Input Monitoring permission.
 *
 * Spawns the helper with `probeInputMonitoring <timeoutMs>`. The helper starts a
 * listenOnly event tap and waits for any real physical mouse/keyboard event. If
 * one arrives within the timeout, the permission is confirmed. If the timeout
 * elapses with no events, the permission is likely missing.
 *
 * The caller should ensure the user has been prompted to move their mouse or
 * press a key so the probe has something to detect.
 */
export async function probeInputMonitoring(timeoutMs = 3000): Promise<boolean> {
  const result = await runLocalMacHelper(['probeInputMonitoring', String(timeoutMs)]);
  return result.ok === true && (result.inputMonitoringGranted ?? false);
}

function firstMissingPermission(permissions: ComputerUsePermissions): ComputerUsePermissionSection | null {
  if (!permissions.accessibilityTrusted) return 'accessibility';
  if (!permissions.screenRecordingGranted) return 'screen-recording';
  if (!permissions.automationGranted) return 'automation';
  if (!permissions.inputMonitoringGranted) return 'input-monitoring';
  return null;
}

function buildPermissionGuidance(
  permissions: ComputerUsePermissions,
  requested: ComputerUsePermissionSection[],
  openedSettings: ComputerUsePermissionSection[],
): string | undefined {
  const fragments: string[] = [];
  if (requested.length > 0) {
    fragments.push(__BRAND_PRODUCT_NAME + ' requested the missing Local Mac permissions automatically.');
  }
  if (openedSettings.length > 0) {
    fragments.push('System Settings was opened so you can finish the approval flow.');
  }
  if (!permissions.accessibilityTrusted || !permissions.screenRecordingGranted || !permissions.automationGranted || !permissions.inputMonitoringGranted) {
    fragments.push('After granting access, start or resume the session again.');
  }
  return fragments.length > 0 ? fragments.join(' ') : undefined;
}

export async function openLocalMacosPrivacySettings(section: ComputerUsePermissionSection): Promise<void> {
  if (process.platform !== 'darwin') return;
  await shell.openExternal(LOCAL_MACOS_PRIVACY_URLS[section]);
}

export async function getComputerUsePermissions(options?: {
  /**
   * When true (the default), run the functional Input Monitoring probe — spawns
   * a listenOnly event tap and waits up to `probeTimeoutMs` for a real physical
   * input event.  This is reliable in interactive contexts where the user has
   * been prompted to move their mouse, but **unreliable** for automated checks
   * at session start/resume because the user is typically idle and the probe
   * times out, falsely reporting the permission as missing.
   *
   * Pass `false` to skip the probe entirely and leave `inputMonitoringGranted`
   * as `null` in the returned object — callers can then decide whether to treat
   * a missing value as granted or unknown.
   */
  probeInputMonitoring?: boolean;
  /** Timeout (ms) for the input monitoring probe. Default 3 000. */
  probeTimeoutMs?: number;
}): Promise<ComputerUsePermissions> {
  const shouldProbe = options?.probeInputMonitoring ?? true;
  const probeTimeout = options?.probeTimeoutMs ?? 3000;

  // Run the basic permissions check (and optionally the input monitoring probe) in parallel.
  const [helperResult, automationGranted, inputMonitoringProbeResult] = await Promise.all([
    runLocalMacHelper(['permissions']),
    probeAutomationPermission(),
    shouldProbe ? probeInputMonitoring(probeTimeout) : Promise.resolve(null),
  ]);

  return {
    target: 'local-macos',
    accessibilityTrusted: getAccessibilityStatus(),
    screenRecordingGranted: getScreenRecordingStatus(helperResult),
    automationGranted,
    // When the probe was skipped, default to true — the caller opted out of
    // checking, so we shouldn't block on an unknown value.
    inputMonitoringGranted: inputMonitoringProbeResult ?? true,
    helperReady: helperResult.ok === true,
    message: helperResult.error,
  };
}

export async function requestLocalMacosPermissions(options?: {
  accessibility?: boolean;
  screenRecording?: boolean;
  automation?: boolean;
  inputMonitoring?: boolean;
  openSettings?: boolean;
}): Promise<ComputerUsePermissionRequestResult> {
  const requested: ComputerUsePermissionSection[] = [];
  const openedSettings: ComputerUsePermissionSection[] = [];
  let permissions = await getComputerUsePermissions();

  if (!permissions.accessibilityTrusted && options?.accessibility !== false && process.platform === 'darwin') {
    requested.push('accessibility');
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
    } catch {
      // Ignore prompt failures and re-check current state below.
    }
    permissions = await getComputerUsePermissions();
  }

  if (!permissions.screenRecordingGranted && options?.screenRecording !== false) {
    requested.push('screen-recording');
    await requestScreenRecordingPermission();
    permissions = await getComputerUsePermissions();
  }

  if (!permissions.automationGranted && options?.automation !== false) {
    requested.push('automation');
    await requestAutomationPermission();
    permissions = await getComputerUsePermissions();
  }

  if (options?.openSettings !== false) {
    const missing = firstMissingPermission(permissions);
    if (missing) {
      await openLocalMacosPrivacySettings(missing);
      openedSettings.push(missing);
    }
  }

  return {
    permissions,
    requested,
    openedSettings,
    message: buildPermissionGuidance(permissions, requested, openedSettings),
  };
}

/**
 * Request a single permission section and return updated permission state.
 *
 * Unlike `requestLocalMacosPermissions()` which walks through all missing
 * permissions sequentially, this targets exactly one section — useful for
 * per-permission "Grant" buttons in the UI.
 */
export async function requestSinglePermission(
  section: ComputerUsePermissionSection,
  options?: { openSettings?: boolean },
): Promise<ComputerUsePermissions> {
  switch (section) {
    case 'accessibility':
      if (process.platform === 'darwin') {
        try {
          systemPreferences.isTrustedAccessibilityClient(true);
        } catch {
          // Ignore prompt failures — re-check below.
        }
      }
      break;
    case 'screen-recording':
      await requestScreenRecordingPermission();
      break;
    case 'automation':
      await requestAutomationPermission();
      break;
    case 'input-monitoring':
      // Input Monitoring cannot be programmatically requested — the user must
      // grant it in System Settings. Open the pane directly.
      await openLocalMacosPrivacySettings('input-monitoring');
      break;
  }

  const permissions = await getComputerUsePermissions();

  // If the permission is still missing and the caller wants to open Settings,
  // deep-link to the relevant pane.
  if (options?.openSettings !== false) {
    const stillMissing =
      (section === 'accessibility' && !permissions.accessibilityTrusted) ||
      (section === 'screen-recording' && !permissions.screenRecordingGranted) ||
      (section === 'automation' && !permissions.automationGranted) ||
      (section === 'input-monitoring' && !permissions.inputMonitoringGranted);
    if (stillMissing) {
      await openLocalMacosPrivacySettings(section);
    }
  }

  return permissions;
}

export async function runLocalMacMouseCommand(args: string[]): Promise<LocalMacosHelperResponse> {
  const result = await runLocalMacHelper(args);
  if (!result.ok) {
    throw new Error(result.error ?? 'Local macOS helper failed');
  }
  return result;
}

export async function getLocalMacPointerPosition(): Promise<{ x: number; y: number } | null> {
  const result = await runLocalMacHelper(['pointer']);
  if (!result.ok) return null;
  if (typeof result.pointerX !== 'number' || typeof result.pointerY !== 'number') return null;
  return {
    x: result.pointerX,
    y: result.pointerY,
  };
}

export async function getLocalMacDesktopSize(): Promise<{ width: number; height: number } | null> {
  const result = await runLocalMacHelper(['permissions']);
  if (!result.ok) return null;
  const width = typeof result.desktopWidth === 'number' ? Math.max(1, Math.round(result.desktopWidth)) : null;
  const height = typeof result.desktopHeight === 'number' ? Math.max(1, Math.round(result.desktopHeight)) : null;
  if (!width || !height) return null;
  return { width, height };
}

/**
 * Parse raw display info from the Swift helper response into typed ComputerDisplayInfo[].
 */
export function parseDisplayInfoArray(
  raw: LocalMacosHelperResponse['displays'],
  allowedDisplays?: string[],
): ComputerDisplayInfo[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  let displays: ComputerDisplayInfo[] = raw
    .filter((d) => d && typeof d.pixelWidth === 'number' && d.pixelWidth > 0)
    .map((d, index) => ({
      displayId: String(d.displayId ?? ''),
      name: String(d.name ?? 'Unknown'),
      pixelWidth: Math.round(d.pixelWidth ?? 0),
      pixelHeight: Math.round(d.pixelHeight ?? 0),
      logicalWidth: Math.round(d.logicalWidth ?? d.pixelWidth ?? 0),
      logicalHeight: Math.round(d.logicalHeight ?? d.pixelHeight ?? 0),
      globalX: Math.round(d.globalX ?? 0),
      globalY: Math.round(d.globalY ?? 0),
      scaleFactor: typeof d.scaleFactor === 'number' ? d.scaleFactor : 1,
      isPrimary: d.isPrimary === true,
      displayIndex: index,
    }));

  // Filter by allowed displays (by ID or name) if specified
  if (allowedDisplays && allowedDisplays.length > 0) {
    const allowed = new Set(allowedDisplays.map((s) => s.toLowerCase()));
    displays = displays.filter(
      (d) => allowed.has(d.displayId.toLowerCase()) || allowed.has(d.name.toLowerCase()),
    );
    // Re-index after filtering
    displays.forEach((d, i) => { d.displayIndex = i; });
  }

  return displays;
}

/**
 * Build a ComputerDisplayLayout from a helper response.
 */
export function buildDisplayLayout(
  raw: LocalMacosHelperResponse['displays'],
  allowedDisplays?: string[],
): ComputerDisplayLayout | undefined {
  const displays = parseDisplayInfoArray(raw, allowedDisplays);
  if (displays.length === 0) return undefined;
  return { displays };
}

/**
 * Get the full multi-display layout from the Swift helper.
 */
export async function getLocalMacDisplayLayout(
  allowedDisplays?: string[],
): Promise<ComputerDisplayLayout | undefined> {
  const result = await runLocalMacHelper(['displays']);
  if (!result.ok) return undefined;
  return buildDisplayLayout(result.displays, allowedDisplays);
}
