import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ComputerActionProposal,
  ComputerEnvironmentMetadata,
  ComputerFrame,
  ComputerSession,
} from '../../../shared/computer-use.js';
import { makeComputerUseId, nowIso } from '../../../shared/computer-use.js';
import type { LegionConfig } from '../../config/schema.js';
import {
  getComputerUsePermissions,
  getLocalMacDesktopSize,
  getLocalMacPointerPosition,
  resolveMaterializedHelperPath,
  runLocalMacMouseCommand,
} from '../permissions.js';
import type { ComputerHarness, ComputerHarnessActionContext, ComputerHarnessActionResult } from './shared.js';

const execFileAsync = promisify(execFile);

const LOCAL_MACOS_HELPER_COMMANDS = {
  permissions: 'permissions',
  move: 'move',
  click: 'click',
  doubleClick: 'doubleClick',
  drag: 'drag',
  scroll: 'scroll',
  typeText: 'typeText',
  pressKeys: 'pressKeys',
  pointer: 'pointer',
  monitor: 'monitor',
  screenshot: 'screenshot',
} as const;

type LocalMacosHelperCommand = typeof LOCAL_MACOS_HELPER_COMMANDS[keyof typeof LOCAL_MACOS_HELPER_COMMANDS];

export type LocalMacosTakeoverEvent = {
  event: 'takeover';
  kind: 'mouse' | 'keyboard' | 'other';
  eventType: string;
  x: number;
  y: number;
  keyCode?: number;
  deltaX?: number;
  deltaY?: number;
  timestampMs: number;
};

function resolveMonitorHelperPath(): string {
  return resolveMaterializedHelperPath();
}

function parseMonitorLine(line: string): LocalMacosTakeoverEvent | null {
  if (!line.trim()) return null;
  try {
    const payload = JSON.parse(line) as {
      event?: string;
      kind?: string;
      eventType?: string;
      x?: number;
      y?: number;
      keyCode?: number;
      deltaX?: number;
      deltaY?: number;
      timestampMs?: number;
    };
    if (payload.event !== 'takeover') return null;
    if (typeof payload.kind !== 'string' || typeof payload.eventType !== 'string') return null;
    if (typeof payload.x !== 'number' || typeof payload.y !== 'number' || typeof payload.timestampMs !== 'number') return null;
    return {
      event: 'takeover',
      kind: payload.kind === 'keyboard' || payload.kind === 'mouse' ? payload.kind : 'other',
      eventType: payload.eventType,
      x: payload.x,
      y: payload.y,
      ...(typeof payload.keyCode === 'number' ? { keyCode: payload.keyCode } : {}),
      ...(typeof payload.deltaX === 'number' ? { deltaX: payload.deltaX } : {}),
      ...(typeof payload.deltaY === 'number' ? { deltaY: payload.deltaY } : {}),
      timestampMs: payload.timestampMs,
    };
  } catch {
    return null;
  }
}

export type LocalMacosTakeoverMonitorHandle = {
  process: ChildProcessWithoutNullStreams;
  stop: () => void;
};

export function startLocalMacosTakeoverMonitor(params: {
  onEvent: (event: LocalMacosTakeoverEvent) => void;
  onError?: (error: string) => void;
}): LocalMacosTakeoverMonitorHandle {
  const helperPath = resolveMonitorHelperPath();
  const child = spawn('xcrun', ['swift', helperPath, LOCAL_MACOS_HELPER_COMMANDS.monitor], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    while (true) {
      const newline = stdoutBuffer.indexOf('\n');
      if (newline === -1) break;
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      const event = parseMonitorLine(line);
      if (event) {
        params.onEvent(event);
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim();
    if (text) params.onError?.(text);
  });

  child.on('error', (error) => {
    params.onError?.(error.message);
  });

  return {
    process: child,
    stop: () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    },
  };
}

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('osascript', ['-e', script], { timeout: 15000 });
  return stdout.trim();
}

function helperArgs(command: LocalMacosHelperCommand, args: Array<string | number>): string[] {
  return [command, ...args.map((value) => String(value))];
}

function buildResult(summary: string, cursor?: { x: number; y: number }): ComputerHarnessActionResult {
  return {
    summary,
    ...(cursor ? { cursor: { x: cursor.x, y: cursor.y, visible: true } } : {}),
  };
}

function resolveMovementPath(action: ComputerActionProposal): 'direct' | 'horizontal-first' | 'vertical-first' {
  return action.movementPath;
}

async function resolveActualCursor(fallback: { x: number; y: number }): Promise<{ x: number; y: number }> {
  const actual = await getLocalMacPointerPosition().catch(() => null);
  if (!actual) return fallback;
  return {
    x: Math.round(actual.x),
    y: Math.round(actual.y),
  };
}

function summarizePointerAction(prefix: string, requested: { x: number; y: number }, actual: { x: number; y: number }, movementPath: 'direct' | 'horizontal-first' | 'vertical-first'): string {
  const pathSuffix = movementPath === 'direct' ? '' : ' via ' + movementPath;
  if (requested.x === actual.x && requested.y === actual.y) {
    return prefix + ' ' + requested.x + ', ' + requested.y + pathSuffix + '.';
  }
  return prefix + ' ' + requested.x + ', ' + requested.y + pathSuffix + ' (actual ' + actual.x + ', ' + actual.y + ').';
}

type LocalMacCoordinateSpace = {
  frameWidth: number;
  frameHeight: number;
  desktopWidth: number;
  desktopHeight: number;
};

async function resolveCoordinateSpace(session: ComputerSession): Promise<LocalMacCoordinateSpace> {
  const frameWidth = Math.max(1, Math.round(session.latestFrame?.width ?? 1440));
  const frameHeight = Math.max(1, Math.round(session.latestFrame?.height ?? 900));
  const desktop = await getLocalMacDesktopSize().catch(() => null);
  return {
    frameWidth,
    frameHeight,
    desktopWidth: Math.max(1, Math.round(desktop?.width ?? frameWidth)),
    desktopHeight: Math.max(1, Math.round(desktop?.height ?? frameHeight)),
  };
}

function toDesktopPoint(point: { x: number; y: number }, space: LocalMacCoordinateSpace): { x: number; y: number } {
  return {
    x: Math.round((point.x / Math.max(space.frameWidth, 1)) * space.desktopWidth),
    y: Math.round((point.y / Math.max(space.frameHeight, 1)) * space.desktopHeight),
  };
}

function toFramePoint(point: { x: number; y: number }, space: LocalMacCoordinateSpace): { x: number; y: number } {
  return {
    x: Math.round((point.x / Math.max(space.desktopWidth, 1)) * space.frameWidth),
    y: Math.round((point.y / Math.max(space.desktopHeight, 1)) * space.frameHeight),
  };
}

export class LocalMacosHarness implements ComputerHarness {
  readonly target = 'local-macos' as const;
  private readonly getConfig: () => LegionConfig;

  constructor(getConfig: () => LegionConfig) {
    this.getConfig = getConfig;
  }

  async initialize(_session: ComputerSession): Promise<void> {
    const permissions = await getComputerUsePermissions();
    if (!permissions.helperReady) {
      throw new Error(permissions.message ?? 'Local macOS helper is unavailable.');
    }
  }

  async dispose(_sessionId: string): Promise<void> {
    return Promise.resolve();
  }

  async captureFrame(session: ComputerSession): Promise<ComputerFrame> {
    const config = this.getConfig();
    const excludeApps = config.computerUse.localMacos.captureExcludedApps ?? ['Electron', 'Interlink'];
    const jpegQuality = config.computerUse.capture.jpegQuality ?? 0.8;

    const excludeArg = Buffer.from(JSON.stringify(excludeApps)).toString('base64');
    const qualityArg = String(jpegQuality);

    const result = await runLocalMacMouseCommand(
      helperArgs(LOCAL_MACOS_HELPER_COMMANDS.screenshot, [excludeArg, qualityArg]),
    );

    if (!result.imageBase64 || !result.width || !result.height) {
      throw new Error(result.error ?? 'Screenshot capture failed');
    }

    return {
      id: makeComputerUseId('frame'),
      sessionId: session.id,
      createdAt: nowIso(),
      mimeType: 'image/jpeg',
      dataUrl: `data:image/jpeg;base64,${result.imageBase64}`,
      width: result.width,
      height: result.height,
      source: 'local-macos',
    };
  }

  async movePointer(session: ComputerSession, action: ComputerActionProposal, _context?: ComputerHarnessActionContext): Promise<ComputerHarnessActionResult> {
    const requested = {
      x: Math.round(action.x ?? 0),
      y: Math.round(action.y ?? 0),
    };
    const movementPath = resolveMovementPath(action);
    const space = await resolveCoordinateSpace(session);
    const target = toDesktopPoint(requested, space);
    const durationMs = Math.max(60, Math.min(action.waitMs ?? 180, 1200));
    await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.move, [target.x, target.y, durationMs, 18, movementPath]));
    const actual = toFramePoint(await resolveActualCursor(target), space);
    return buildResult(summarizePointerAction('Moved pointer to', requested, actual, movementPath), actual);
  }

  async click(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const requested = {
      x: Math.round(action.x ?? 0),
      y: Math.round(action.y ?? 0),
    };
    const movementPath = resolveMovementPath(action);
    const space = await resolveCoordinateSpace(session);
    const target = toDesktopPoint(requested, space);
    await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.click, [target.x, target.y, 120, movementPath]));
    const actual = toFramePoint(await resolveActualCursor(target), space);
    return buildResult(summarizePointerAction('Clicked at', requested, actual, movementPath), actual);
  }

  async doubleClick(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const requested = {
      x: Math.round(action.x ?? 0),
      y: Math.round(action.y ?? 0),
    };
    const movementPath = resolveMovementPath(action);
    const space = await resolveCoordinateSpace(session);
    const target = toDesktopPoint(requested, space);
    await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.doubleClick, [target.x, target.y, 130, movementPath]));
    const actual = toFramePoint(await resolveActualCursor(target), space);
    return buildResult(summarizePointerAction('Double-clicked at', requested, actual, movementPath), actual);
  }

  async drag(session: ComputerSession, action: ComputerActionProposal, _context?: ComputerHarnessActionContext): Promise<ComputerHarnessActionResult> {
    const requestedStart = {
      x: Math.round(action.x ?? action.endX ?? 0),
      y: Math.round(action.y ?? action.endY ?? 0),
    };
    const requestedEnd = {
      x: Math.round(action.endX ?? requestedStart.x),
      y: Math.round(action.endY ?? requestedStart.y),
    };
    const movementPath = resolveMovementPath(action);
    const space = await resolveCoordinateSpace(session);
    const start = toDesktopPoint(requestedStart, space);
    const end = toDesktopPoint(requestedEnd, space);
    const durationMs = Math.max(120, Math.min(action.waitMs ?? 320, 2400));
    await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.drag, [start.x, start.y, end.x, end.y, durationMs, 28, movementPath]));
    const actual = toFramePoint(await resolveActualCursor(end), space);
    const pathSuffix = movementPath === 'direct' ? '' : ' via ' + movementPath;
    const summary = actual.x === requestedEnd.x && actual.y === requestedEnd.y
      ? `Dragged pointer from ${requestedStart.x}, ${requestedStart.y} to ${requestedEnd.x}, ${requestedEnd.y}${pathSuffix}.`
      : `Dragged pointer from ${requestedStart.x}, ${requestedStart.y} to ${requestedEnd.x}, ${requestedEnd.y}${pathSuffix} (actual ${actual.x}, ${actual.y}).`;
    return buildResult(summary, actual);
  }

  async scroll(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const deltaX = Math.round(action.deltaX ?? 0);
    const deltaY = Math.round(action.deltaY ?? 0);
    await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.scroll, [deltaX, deltaY]));
    return buildResult(`Scrolled by ${deltaX}, ${deltaY}.`);
  }

  async typeText(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const text = action.text ?? '';
    const encoded = Buffer.from(text, 'utf-8').toString('base64');
    const delayMs = Math.max(8, Math.min(action.waitMs ?? 45, 250));
    await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.typeText, [encoded, delayMs]));
    return buildResult(`Typed ${JSON.stringify(text)}.`);
  }

  async pressKeys(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const keys = action.keys ?? [];
    const encoded = Buffer.from(JSON.stringify(keys), 'utf-8').toString('base64');
    const delayMs = Math.max(12, Math.min(action.waitMs ?? 60, 400));
    await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.pressKeys, [encoded, delayMs]));
    return buildResult(`Pressed keys: ${keys.join(' + ') || 'Enter'}.`);
  }

  async openApp(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const appName = action.appName?.trim();
    if (!appName) throw new Error('Open app requires appName.');
    await execFileAsync('open', ['-a', appName], { timeout: 15000 });
    return buildResult(`Opened ${appName}.`);
  }

  async focusWindow(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const appName = action.appName?.trim();
    if (!appName) throw new Error('Focus window requires appName.');
    await runAppleScript(`tell application "${appName}" to activate`);
    return buildResult(`Focused ${appName}.`);
  }

  async navigate(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const url = action.url?.trim();
    if (!url) throw new Error('Navigation requires a URL.');
    await execFileAsync('open', [url], { timeout: 15000 });
    return buildResult(`Opened ${url}.`);
  }

  async waitForIdle(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const waitMs = Math.max(250, Math.min(action.waitMs ?? 1000, 10000));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return buildResult(`Waited ${waitMs}ms.`);
  }

  async getEnvironmentMetadata(_session: ComputerSession): Promise<ComputerEnvironmentMetadata> {
    const permissions = await getComputerUsePermissions();
    const appName = await runAppleScript('tell application "System Events" to get name of first application process whose frontmost is true');
    let windowTitle = '';
    try {
      windowTitle = await runAppleScript('tell application "System Events" to tell (first application process whose frontmost is true) to get value of attribute "AXTitle" of front window');
    } catch {
      windowTitle = '';
    }
    return {
      appName,
      windowTitle,
      permissionState: {
        accessibility: permissions.accessibilityTrusted,
        screenRecording: permissions.screenRecordingGranted,
        automation: permissions.automationGranted,
      },
    };
  }
}
