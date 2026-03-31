import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { BrowserWindow, nativeImage } from 'electron';
import type {
  ComputerActionProposal,
  ComputerDisplayInfo,
  ComputerEnvironmentMetadata,
  ComputerFrame,
  ComputerSession,
} from '../../../shared/computer-use.js';
import { makeComputerUseId, nowIso } from '../../../shared/computer-use.js';
import type { AppConfig } from '../../config/schema.js';
import {
  buildDisplayLayout,
  buildSwiftFallbackEnv,
  getComputerUsePermissions,
  getLocalMacDesktopSize,
  getLocalMacPointerPosition,
  resolveCompiledHelperBinary,
  resolveMaterializedHelperPath,
  runLocalMacMouseCommand,
} from '../permissions.js';
import type { ComputerHarness, ComputerHarnessActionContext, ComputerHarnessActionResult } from './shared.js';

const execFileAsync = promisify(execFile);

/**
 * Maximum pixel dimension (longest side) for screenshots sent to the AI model.
 * Vision models internally downscale large images and then output coordinates in
 * that smaller space.  By resizing to a known size up-front we ensure the
 * model's coordinate output matches the frame dimensions stored in the session,
 * and the existing toDesktopPoint() math correctly scales them back to the real
 * desktop resolution.  The default (1920) is chosen because it matches common
 * display widths where computer-use is already known to work reliably.
 * Configurable via `computerUse.capture.maxDimension`.
 */
const DEFAULT_MAX_FRAME_DIMENSION = 1920;

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
  // Prefer the pre-compiled binary; fall back to xcrun swift interpretation
  const binaryPath = resolveCompiledHelperBinary();
  let child: ChildProcessWithoutNullStreams;

  if (binaryPath) {
    child = spawn(binaryPath, [LOCAL_MACOS_HELPER_COMMANDS.monitor], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } else {
    const helperPath = resolveMaterializedHelperPath();
    child = spawn('xcrun', ['swift', helperPath, LOCAL_MACOS_HELPER_COMMANDS.monitor], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildSwiftFallbackEnv(),
    });
  }

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

function resolveMovementPath(action: ComputerActionProposal): 'teleport' | 'direct' | 'horizontal-first' | 'vertical-first' {
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

function summarizePointerAction(prefix: string, requested: { x: number; y: number }, actual: { x: number; y: number }, movementPath: 'teleport' | 'direct' | 'horizontal-first' | 'vertical-first'): string {
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

/**
 * Downscale a screenshot so its longest side fits within MAX_FRAME_DIMENSION.
 * If the image already fits, it is returned unchanged.
 */
function downscaleFrame(
  data: Buffer,
  originalSize: { width: number; height: number },
  maxFrameDimension?: number,
): { data: Buffer; width: number; height: number } {
  const maxDim = maxFrameDimension ?? DEFAULT_MAX_FRAME_DIMENSION;
  const longest = Math.max(originalSize.width, originalSize.height);
  if (longest <= maxDim) {
    return { data, width: originalSize.width, height: originalSize.height };
  }

  const scale = maxDim / longest;
  const targetWidth = Math.round(originalSize.width * scale);
  const targetHeight = Math.round(originalSize.height * scale);

  const image = nativeImage.createFromBuffer(data);
  const resized = image.resize({ width: targetWidth, height: targetHeight, quality: 'better' });
  const jpegBuffer = resized.toJPEG(85);

  return {
    data: Buffer.from(jpegBuffer),
    width: targetWidth,
    height: targetHeight,
  };
}

export class LocalMacosHarness implements ComputerHarness {
  readonly target = 'local-macos' as const;
  private readonly getConfig: () => AppConfig;

  constructor(getConfig: () => AppConfig) {
    this.getConfig = getConfig;
  }

  async initialize(_session: ComputerSession): Promise<void> {
    // Skip the input monitoring probe here — this runs at session start when the
    // user is idle; we only need to verify the helper binary is functional.
    const permissions = await getComputerUsePermissions({ probeInputMonitoring: false });
    if (!permissions.helperReady) {
      throw new Error(permissions.message ?? 'Local macOS helper is unavailable.');
    }

    // If any of our own windows are full-screened, exit full-screen first.
    // macOS creates a dedicated Space for full-screen apps, and since we
    // exclude our own PID from screenshots, the capture would be blank.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.isFullScreen()) {
        win.setFullScreen(false);
        // Wait for the full-screen exit animation to complete
        await new Promise<void>((resolve) => {
          const onLeave = () => { resolve(); };
          win.once('leave-full-screen', onLeave);
          // Safety timeout in case the event doesn't fire
          setTimeout(() => { win.removeListener('leave-full-screen', onLeave); resolve(); }, 2000);
        });
      }
    }
  }

  async dispose(_sessionId: string): Promise<void> {
    return Promise.resolve();
  }

  async captureFrame(session: ComputerSession): Promise<ComputerFrame> {
    // If our app got full-screened mid-session (e.g. the AI did it),
    // exit full-screen so screenshots aren't blank.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && win.isFullScreen()) {
        win.setFullScreen(false);
        await new Promise<void>((resolve) => {
          const onLeave = () => { resolve(); };
          win.once('leave-full-screen', onLeave);
          setTimeout(() => { win.removeListener('leave-full-screen', onLeave); resolve(); }, 2000);
        });
      }
    }

    const config = this.getConfig();
    const excludeApps = config.computerUse.localMacos.captureExcludedApps ?? ['Electron'];
    const jpegQuality = config.computerUse.capture.jpegQuality ?? 0.8;
    const maxDimension = config.computerUse.capture.maxDimension ?? DEFAULT_MAX_FRAME_DIMENSION;
    const allowedDisplays = config.computerUse.localMacos.allowedDisplays;

    const excludeArg = Buffer.from(JSON.stringify(excludeApps)).toString('base64');
    const qualityArg = String(jpegQuality);
    // Always exclude our own process's windows regardless of app name
    const selfPid = String(process.pid);

    // Capture the primary display (display index 0) as the main frame
    const primaryResult = await runLocalMacMouseCommand(
      helperArgs(LOCAL_MACOS_HELPER_COMMANDS.screenshot, [excludeArg, qualityArg, '0', selfPid]),
    );

    if (!primaryResult.imageBase64 || !primaryResult.width || !primaryResult.height) {
      throw new Error(primaryResult.error ?? 'Screenshot capture failed');
    }

    const rawData = Buffer.from(primaryResult.imageBase64, 'base64');
    const rawSize = { width: primaryResult.width, height: primaryResult.height };
    const frame = downscaleFrame(rawData, rawSize, maxDimension);

    // Build display layout from the helper response
    const displayLayout = buildDisplayLayout(
      primaryResult.displays,
      allowedDisplays && allowedDisplays.length > 0 ? allowedDisplays : undefined,
    );

    // Capture additional displays in parallel
    const displayFrames: ComputerFrame['displayFrames'] = [{
      displayIndex: 0,
      displayName: displayLayout?.displays[0]?.name ?? 'Primary',
      dataUrl: `data:image/jpeg;base64,${frame.data.toString('base64')}`,
      width: frame.width,
      height: frame.height,
    }];

    if (displayLayout && displayLayout.displays.length > 1) {
      for (let i = 1; i < displayLayout.displays.length; i++) {
        try {
          const extraResult = await runLocalMacMouseCommand(
            helperArgs(LOCAL_MACOS_HELPER_COMMANDS.screenshot, [excludeArg, qualityArg, String(i), selfPid]),
          );
          if (extraResult.imageBase64 && extraResult.width && extraResult.height) {
            const extraRaw = Buffer.from(extraResult.imageBase64, 'base64');
            const extraFrame = downscaleFrame(extraRaw, { width: extraResult.width, height: extraResult.height }, maxDimension);
            displayFrames.push({
              displayIndex: i,
              displayName: displayLayout.displays[i]?.name ?? `Display ${i + 1}`,
              dataUrl: `data:image/jpeg;base64,${extraFrame.data.toString('base64')}`,
              width: extraFrame.width,
              height: extraFrame.height,
            });
          }
        } catch {
          // Non-fatal: skip displays that fail to capture
        }
      }
    }

    return {
      id: makeComputerUseId('frame'),
      sessionId: session.id,
      createdAt: nowIso(),
      mimeType: 'image/jpeg',
      dataUrl: `data:image/jpeg;base64,${frame.data.toString('base64')}`,
      width: frame.width,
      height: frame.height,
      source: 'local-macos',
      displayLayout,
      displayFrames: displayFrames.length > 1 ? displayFrames : undefined,
    };
  }

  /**
   * Resolve the display-specific coordinate space for an action.
   * If the action specifies a displayIndex, use that display's dimensions.
   * Otherwise fall back to the primary display (existing single-display logic).
   */
  private resolveDisplayForAction(session: ComputerSession, action: ComputerActionProposal): {
    display: ComputerDisplayInfo;
    frameWidth: number;
    frameHeight: number;
  } | null {
    const layout = session.displayLayout;
    if (!layout || layout.displays.length <= 1) return null;

    const displayIndex = action.displayIndex ?? 0;
    const display = layout.displays[displayIndex] ?? layout.displays[0];

    // Find the matching display frame for dimensions
    const displayFrame = session.latestFrame?.displayFrames?.find((f) => f.displayIndex === displayIndex);
    const frameWidth = displayFrame?.width ?? display.pixelWidth;
    const frameHeight = displayFrame?.height ?? display.pixelHeight;

    return { display, frameWidth, frameHeight };
  }

  /**
   * Convert frame-space coordinates (within a specific display's image)
   * to macOS global logical-point coordinates.
   */
  private displayFrameToGlobal(
    point: { x: number; y: number },
    display: ComputerDisplayInfo,
    frameWidth: number,
    frameHeight: number,
  ): { x: number; y: number } {
    // Map from frame coordinates to local logical coordinates on the display
    const localLogicalX = (point.x / Math.max(frameWidth, 1)) * display.logicalWidth;
    const localLogicalY = (point.y / Math.max(frameHeight, 1)) * display.logicalHeight;

    // Convert to macOS global coordinates
    return {
      x: Math.round(display.globalX + localLogicalX),
      y: Math.round(display.globalY + localLogicalY),
    };
  }

  /**
   * Convert macOS global logical-point coordinates back to frame-space
   * coordinates for a specific display.
   */
  private globalToDisplayFrame(
    point: { x: number; y: number },
    display: ComputerDisplayInfo,
    frameWidth: number,
    frameHeight: number,
  ): { x: number; y: number } {
    const localLogicalX = Math.max(0, Math.min(point.x - display.globalX, display.logicalWidth - 1));
    const localLogicalY = Math.max(0, Math.min(point.y - display.globalY, display.logicalHeight - 1));

    return {
      x: Math.round((localLogicalX / Math.max(display.logicalWidth, 1)) * frameWidth),
      y: Math.round((localLogicalY / Math.max(display.logicalHeight, 1)) * frameHeight),
    };
  }

  async movePointer(session: ComputerSession, action: ComputerActionProposal, _context?: ComputerHarnessActionContext): Promise<ComputerHarnessActionResult> {
    const requested = {
      x: Math.round(action.x ?? 0),
      y: Math.round(action.y ?? 0),
    };
    const movementPath = resolveMovementPath(action);
    const displayCtx = this.resolveDisplayForAction(session, action);

    if (displayCtx) {
      const target = this.displayFrameToGlobal(requested, displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      const durationMs = Math.max(60, Math.min(action.waitMs ?? 180, 1200));
      await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.move, [target.x, target.y, durationMs, 18, movementPath]));
      const actual = this.globalToDisplayFrame(await resolveActualCursor(target), displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      return buildResult(summarizePointerAction('Moved pointer to', requested, actual, movementPath), actual);
    }

    // Single-display fallback
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
    const displayCtx = this.resolveDisplayForAction(session, action);

    if (displayCtx) {
      const target = this.displayFrameToGlobal(requested, displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.click, [target.x, target.y, 120, movementPath]));
      const actual = this.globalToDisplayFrame(await resolveActualCursor(target), displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      return buildResult(summarizePointerAction('Clicked at', requested, actual, movementPath), actual);
    }

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
    const displayCtx = this.resolveDisplayForAction(session, action);

    if (displayCtx) {
      const target = this.displayFrameToGlobal(requested, displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.doubleClick, [target.x, target.y, 130, movementPath]));
      const actual = this.globalToDisplayFrame(await resolveActualCursor(target), displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      return buildResult(summarizePointerAction('Double-clicked at', requested, actual, movementPath), actual);
    }

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
    const displayCtx = this.resolveDisplayForAction(session, action);

    if (displayCtx) {
      const start = this.displayFrameToGlobal(requestedStart, displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      const end = this.displayFrameToGlobal(requestedEnd, displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      const durationMs = Math.max(120, Math.min(action.waitMs ?? 320, 2400));
      await runLocalMacMouseCommand(helperArgs(LOCAL_MACOS_HELPER_COMMANDS.drag, [start.x, start.y, end.x, end.y, durationMs, 28, movementPath]));
      const actual = this.globalToDisplayFrame(await resolveActualCursor(end), displayCtx.display, displayCtx.frameWidth, displayCtx.frameHeight);
      const pathSuffix = movementPath === 'direct' ? '' : ' via ' + movementPath;
      const summary = actual.x === requestedEnd.x && actual.y === requestedEnd.y
        ? `Dragged from ${requestedStart.x}, ${requestedStart.y} to ${requestedEnd.x}, ${requestedEnd.y}${pathSuffix}.`
        : `Dragged from ${requestedStart.x}, ${requestedStart.y} to ${requestedEnd.x}, ${requestedEnd.y}${pathSuffix} (actual ${actual.x}, ${actual.y}).`;
      return buildResult(summary, actual);
    }

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
    const permissions = await getComputerUsePermissions({ probeInputMonitoring: false });
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
