import { app, shell, systemPreferences } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type {
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
};

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
  return join(homedir(), '.legionio');
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
  desktopWidth?: number;
  desktopHeight?: number;
  pointerX?: number;
  pointerY?: number;
  imageBase64?: string;
  width?: number;
  height?: number;
  error?: string;
};

async function runLocalMacHelper(args: string[]): Promise<LocalMacosHelperResponse> {
  try {
    const helperScriptPath = resolveMaterializedHelperPath();
    const { stdout } = await execFileAsync('xcrun', ['swift', helperScriptPath, ...args], {
      timeout: 15000,
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

function firstMissingPermission(permissions: ComputerUsePermissions): ComputerUsePermissionSection | null {
  if (!permissions.accessibilityTrusted) return 'accessibility';
  if (!permissions.screenRecordingGranted) return 'screen-recording';
  if (!permissions.automationGranted) return 'automation';
  return null;
}

function buildPermissionGuidance(
  permissions: ComputerUsePermissions,
  requested: ComputerUsePermissionSection[],
  openedSettings: ComputerUsePermissionSection[],
): string | undefined {
  const fragments: string[] = [];
  if (requested.length > 0) {
    fragments.push('Interlink requested the missing Local Mac permissions automatically.');
  }
  if (openedSettings.length > 0) {
    fragments.push('System Settings was opened so you can finish the approval flow.');
  }
  if (!permissions.accessibilityTrusted || !permissions.screenRecordingGranted || !permissions.automationGranted) {
    fragments.push('After granting access, start or resume the session again.');
  }
  return fragments.length > 0 ? fragments.join(' ') : undefined;
}

export async function openLocalMacosPrivacySettings(section: ComputerUsePermissionSection): Promise<void> {
  if (process.platform !== 'darwin') return;
  await shell.openExternal(LOCAL_MACOS_PRIVACY_URLS[section]);
}

export async function getComputerUsePermissions(): Promise<ComputerUsePermissions> {
  const helperResult = await runLocalMacHelper(['permissions']);
  const automationGranted = await probeAutomationPermission();
  return {
    target: 'local-macos',
    accessibilityTrusted: getAccessibilityStatus(),
    screenRecordingGranted: getScreenRecordingStatus(helperResult),
    automationGranted,
    helperReady: helperResult.ok === true,
    message: helperResult.error,
  };
}

export async function requestLocalMacosPermissions(options?: {
  accessibility?: boolean;
  screenRecording?: boolean;
  automation?: boolean;
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
