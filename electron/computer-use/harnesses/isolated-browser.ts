import { BrowserWindow } from 'electron';
import type {
  ComputerActionProposal,
  ComputerEnvironmentMetadata,
  ComputerFrame,
  ComputerSession,
  ComputerUseMovementPath,
} from '../../../shared/computer-use.js';
import { makeComputerUseId, nowIso } from '../../../shared/computer-use.js';
import type { ComputerHarness, ComputerHarnessActionContext, ComputerHarnessActionResult } from './shared.js';

const windows = new Map<string, BrowserWindow>();

type BrowserPoint = {
  x: number;
  y: number;
};

type BrowserInteractiveElement = {
  id: string;
  selector?: string;
  role?: string;
  label?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type BrowserCoordinateSpace = {
  frameWidth: number;
  frameHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
};

type ResolvedBrowserTarget = {
  requestedFrame: BrowserPoint;
  requestedViewport: BrowserPoint;
  appliedFrame: BrowserPoint;
  appliedViewport: BrowserPoint;
  elementId?: string;
  elementLabel?: string;
};

const interactiveSelector = 'a, button, input, textarea, select, [role="button"], [contenteditable="true"]';
const actionSearchStopWords = new Set([
  'about', 'above', 'after', 'again', 'button', 'center', 'clear', 'click', 'clearly', 'control',
  'direct', 'entry', 'flow', 'from', 'header', 'icon', 'into', 'initiate', 'just', 'link', 'menu',
  'most', 'next', 'open', 'page', 'right', 'should', 'that', 'then', 'there', 'this', 'top',
  'visible', 'with', 'within',
]);

function clampCoordinate(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (max <= 1) return 0;
  return Math.max(0, Math.min(Math.round(value), max - 1));
}

function ensureWindow(sessionId: string): BrowserWindow {
  const existing = windows.get(sessionId);
  if (existing && !existing.isDestroyed()) return existing;

  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    webPreferences: {
      sandbox: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windows.set(sessionId, win);
  return win;
}

async function evalInPage<T>(win: BrowserWindow, source: string): Promise<T> {
  return win.webContents.executeJavaScript(source, true) as Promise<T>;
}

function result(summary: string, cursor?: { x: number; y: number }): ComputerHarnessActionResult {
  return {
    summary,
    ...(cursor ? { cursor: { x: cursor.x, y: cursor.y, visible: true } } : {}),
  };
}

function point(x?: number, y?: number): BrowserPoint {
  return {
    x: Math.max(0, Math.round(x ?? 0)),
    y: Math.max(0, Math.round(y ?? 0)),
  };
}

function clampPointToBounds(rawPoint: BrowserPoint, width: number, height: number): BrowserPoint {
  return {
    x: clampCoordinate(rawPoint.x, width),
    y: clampCoordinate(rawPoint.y, height),
  };
}

function nearlyEqual(a: number, b: number, tolerance = 0.05): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === b) return true;
  const baseline = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / baseline <= tolerance;
}

function normalizeSearchText(value?: string | null): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSearchTerms(action: ComputerActionProposal): string[] {
  const source = [action.rationale, action.selector, action.elementId]
    .map((value) => normalizeSearchText(value))
    .filter(Boolean)
    .join(' ');
  if (!source) return [];

  return Array.from(new Set(source
    .split(' ')
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && !actionSearchStopWords.has(term))));
}

function centerPointForElement(element: BrowserInteractiveElement): BrowserPoint {
  return point(element.x + (element.width / 2), element.y + (element.height / 2));
}

function distanceToRect(target: BrowserPoint, element: BrowserInteractiveElement): number {
  const maxX = element.x + Math.max(element.width, 1);
  const maxY = element.y + Math.max(element.height, 1);
  const dx = target.x < element.x ? element.x - target.x : target.x > maxX ? target.x - maxX : 0;
  const dy = target.y < element.y ? element.y - target.y : target.y > maxY ? target.y - maxY : 0;
  return Math.hypot(dx, dy);
}

function pointInsideElement(target: BrowserPoint, element: BrowserInteractiveElement): boolean {
  return target.x >= element.x
    && target.x <= element.x + Math.max(element.width, 1)
    && target.y >= element.y
    && target.y <= element.y + Math.max(element.height, 1);
}

function resolveMovementPath(action: ComputerActionProposal): ComputerUseMovementPath {
  return action.movementPath;
}

function movementPathSuffix(path: ComputerUseMovementPath): string {
  return path === 'direct' ? '' : ` via ${path}`;
}

function currentPointer(session: ComputerSession, fallback: BrowserPoint): BrowserPoint {
  if (session.cursor?.visible && Number.isFinite(session.cursor.x) && Number.isFinite(session.cursor.y)) {
    return point(session.cursor.x, session.cursor.y);
  }
  return fallback;
}

async function resolveCoordinateSpace(win: BrowserWindow, session: ComputerSession): Promise<BrowserCoordinateSpace> {
  const metrics = await evalInPage<{
    viewportWidth?: number;
    viewportHeight?: number;
    devicePixelRatio?: number;
  }>(win, `
    (() => ({
      viewportWidth: Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0, visualViewport?.width || 0),
      viewportHeight: Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0, visualViewport?.height || 0),
      devicePixelRatio: window.devicePixelRatio || 1,
    }))();
  `);

  const contentBounds = win.getContentBounds();
  const frameWidth = Math.max(1, Math.round(session.latestFrame?.width ?? Math.max(contentBounds.width, 1)));
  const frameHeight = Math.max(1, Math.round(session.latestFrame?.height ?? Math.max(contentBounds.height, 1)));
  const viewportWidth = Math.max(1, Math.round(metrics.viewportWidth ?? contentBounds.width ?? frameWidth));
  const viewportHeight = Math.max(1, Math.round(metrics.viewportHeight ?? contentBounds.height ?? frameHeight));

  return {
    frameWidth,
    frameHeight,
    viewportWidth,
    viewportHeight,
    devicePixelRatio: Math.max(1, Number(metrics.devicePixelRatio) || 1),
  };
}

function toViewportPoint(pointInFrame: BrowserPoint, space: BrowserCoordinateSpace): BrowserPoint {
  // The model plans against the captured frame we send it. In the isolated
  // browser path that frame is exported at scaleFactor=1, so its coordinates
  // normally already match the browser viewport. Only rescale when the frame
  // size differs by the device pixel ratio, which indicates a true pixel-space
  // mismatch rather than a small Electron/DIP discrepancy.
  const scaleX = space.frameWidth / Math.max(space.viewportWidth, 1);
  const scaleY = space.frameHeight / Math.max(space.viewportHeight, 1);
  const shouldScale = nearlyEqual(scaleX, space.devicePixelRatio) && nearlyEqual(scaleY, space.devicePixelRatio);
  if (!shouldScale) {
    return clampPointToBounds(pointInFrame, space.viewportWidth, space.viewportHeight);
  }

  const frameWidth = Math.max(space.frameWidth - 1, 1);
  const frameHeight = Math.max(space.frameHeight - 1, 1);
  const viewportWidth = Math.max(space.viewportWidth - 1, 1);
  const viewportHeight = Math.max(space.viewportHeight - 1, 1);

  return {
    x: clampCoordinate((pointInFrame.x / frameWidth) * viewportWidth, space.viewportWidth),
    y: clampCoordinate((pointInFrame.y / frameHeight) * viewportHeight, space.viewportHeight),
  };
}

function toFramePoint(pointInViewport: BrowserPoint, space: BrowserCoordinateSpace): BrowserPoint {
  const scaleX = space.frameWidth / Math.max(space.viewportWidth, 1);
  const scaleY = space.frameHeight / Math.max(space.viewportHeight, 1);
  const shouldScale = nearlyEqual(scaleX, space.devicePixelRatio) && nearlyEqual(scaleY, space.devicePixelRatio);
  if (!shouldScale) {
    return clampPointToBounds(pointInViewport, space.frameWidth, space.frameHeight);
  }

  const frameWidth = Math.max(space.frameWidth - 1, 1);
  const frameHeight = Math.max(space.frameHeight - 1, 1);
  const viewportWidth = Math.max(space.viewportWidth - 1, 1);
  const viewportHeight = Math.max(space.viewportHeight - 1, 1);

  return {
    x: clampCoordinate((pointInViewport.x / viewportWidth) * frameWidth, space.frameWidth),
    y: clampCoordinate((pointInViewport.y / viewportHeight) * frameHeight, space.frameHeight),
  };
}

function buildPointerRoute(start: BrowserPoint, end: BrowserPoint, path: ComputerUseMovementPath): BrowserPoint[] {
  const route: BrowserPoint[] = [];
  const push = (next: BrowserPoint) => {
    const last = route[route.length - 1];
    if (!last || last.x !== next.x || last.y !== next.y) {
      route.push(next);
    }
  };

  if (path !== 'teleport') {
    push(start);
  }
  if (path === 'horizontal-first') {
    push({ x: end.x, y: start.y });
  } else if (path === 'vertical-first') {
    push({ x: start.x, y: end.y });
  }
  push(end);
  return route;
}

function buildPointerScript(route: BrowserPoint[], clickCount = 0): string {
  return `
    (() => {
      const route = ${JSON.stringify(route)};
      const clickCount = ${clickCount};
      let hovered = null;
      const createEvent = (type, x, y, buttons, detail, relatedTarget, bubbles = true) => new MouseEvent(type, {
        bubbles,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons,
        detail,
        relatedTarget: relatedTarget ?? null,
      });
      const transition = (x, y, buttons) => {
        const next = document.elementFromPoint(x, y) || document.body;
        if (next !== hovered) {
          if (hovered) {
            hovered.dispatchEvent(createEvent('mouseout', x, y, buttons, 0, next));
            hovered.dispatchEvent(createEvent('mouseleave', x, y, buttons, 0, next, false));
          }
          next.dispatchEvent(createEvent('mouseover', x, y, buttons, 0, hovered));
          next.dispatchEvent(createEvent('mouseenter', x, y, buttons, 0, hovered, false));
          hovered = next;
        }
        hovered.dispatchEvent(createEvent('mousemove', x, y, buttons, 0, null));
        return hovered;
      };

      for (const waypoint of route) {
        transition(waypoint.x, waypoint.y, 0);
      }

      if (clickCount > 0) {
        const last = route[route.length - 1] || { x: 0, y: 0 };
        const target = hovered || document.elementFromPoint(last.x, last.y) || document.body;
        for (let count = 1; count <= clickCount; count += 1) {
          target.dispatchEvent(createEvent('mousedown', last.x, last.y, 1, count, null));
          target.dispatchEvent(createEvent('mouseup', last.x, last.y, 0, count, null));
          target.dispatchEvent(createEvent('click', last.x, last.y, 0, count, null));
        }
        if (clickCount === 2) {
          target.dispatchEvent(createEvent('dblclick', last.x, last.y, 0, 2, null));
        }
      }

      return true;
    })();
  `;
}

function buildDragScript(moveToStartRoute: BrowserPoint[], dragRoute: BrowserPoint[]): string {
  return `
    (() => {
      const moveToStartRoute = ${JSON.stringify(moveToStartRoute)};
      const dragRoute = ${JSON.stringify(dragRoute)};
      let hovered = null;
      const createEvent = (type, x, y, buttons, detail, relatedTarget, bubbles = true) => new MouseEvent(type, {
        bubbles,
        cancelable: true,
        composed: true,
        clientX: x,
        clientY: y,
        screenX: x,
        screenY: y,
        button: 0,
        buttons,
        detail,
        relatedTarget: relatedTarget ?? null,
      });
      const transition = (x, y, buttons) => {
        const next = document.elementFromPoint(x, y) || document.body;
        if (next !== hovered) {
          if (hovered) {
            hovered.dispatchEvent(createEvent('mouseout', x, y, buttons, 0, next));
            hovered.dispatchEvent(createEvent('mouseleave', x, y, buttons, 0, next, false));
          }
          next.dispatchEvent(createEvent('mouseover', x, y, buttons, 0, hovered));
          next.dispatchEvent(createEvent('mouseenter', x, y, buttons, 0, hovered, false));
          hovered = next;
        }
        hovered.dispatchEvent(createEvent('mousemove', x, y, buttons, 0, null));
        return hovered;
      };

      for (const waypoint of moveToStartRoute) {
        transition(waypoint.x, waypoint.y, 0);
      }

      const dragStart = dragRoute[0] || moveToStartRoute[moveToStartRoute.length - 1] || { x: 0, y: 0 };
      let target = transition(dragStart.x, dragStart.y, 0);
      target.dispatchEvent(createEvent('mousedown', dragStart.x, dragStart.y, 1, 1, null));

      for (const waypoint of dragRoute) {
        target = transition(waypoint.x, waypoint.y, 1);
      }

      const dragEnd = dragRoute[dragRoute.length - 1] || dragStart;
      target.dispatchEvent(createEvent('mouseup', dragEnd.x, dragEnd.y, 0, 1, null));
      return true;
    })();
  `;
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value);
}

async function readInteractiveElements(win: BrowserWindow): Promise<BrowserInteractiveElement[]> {
  return evalInPage<BrowserInteractiveElement[]>(win, `
    (() => {
      const viewportWidth = Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0, visualViewport?.width || 0);
      const viewportHeight = Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0, visualViewport?.height || 0);
      return Array.from(document.querySelectorAll(${escapeJson(interactiveSelector)}))
      .filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width < 2 || rect.height < 2) return false;
        if (rect.right <= 0 || rect.bottom <= 0) return false;
        if (rect.left >= viewportWidth || rect.top >= viewportHeight) return false;
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (style.pointerEvents === 'none') return false;
        if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
        return true;
      })
      .sort((a, b) => {
        const rectA = a.getBoundingClientRect();
        const rectB = b.getBoundingClientRect();
        if (Math.abs(rectA.top - rectB.top) > 1) return rectA.top - rectB.top;
        return rectA.left - rectB.left;
      })
      .slice(0, 60)
      .map((el, index) => {
        const rect = el.getBoundingClientRect();
        return {
          id: 'el-' + index,
          selector: el.id ? '#' + el.id : undefined,
          role: el.getAttribute('role') || el.tagName.toLowerCase(),
          label: el.getAttribute('aria-label') || undefined,
          text: (el.textContent || '').trim().slice(0, 160),
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        };
      });
    })();
  `);
}

function describeElement(element: BrowserInteractiveElement): string | undefined {
  const label = element.label?.trim();
  if (label) return label;
  const text = element.text?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

function scoreElementMatch(
  element: BrowserInteractiveElement,
  requestedViewport: BrowserPoint,
  action: ComputerActionProposal,
  terms: string[],
): number {
  let score = 0;
  const normalizedSelector = normalizeSearchText(element.selector);
  const normalizedLabel = normalizeSearchText(element.label);
  const normalizedText = normalizeSearchText(element.text);
  const normalizedRole = normalizeSearchText(element.role);
  const haystack = [normalizedLabel, normalizedText, normalizedSelector, normalizedRole].filter(Boolean).join(' ');
  const actionSelector = normalizeSearchText(action.selector);
  const actionRationale = normalizeSearchText(action.rationale);

  if (action.elementId && action.elementId === element.id) {
    score += 2000;
  }
  if (actionSelector && normalizedSelector && (actionSelector === normalizedSelector || actionSelector.includes(normalizedSelector) || normalizedSelector.includes(actionSelector))) {
    score += 900;
  }

  for (const phrase of [normalizedLabel, normalizedText]) {
    if (phrase && actionRationale.includes(phrase)) {
      score += Math.max(320, phrase.length * 10);
    }
  }

  if (haystack) {
    const matches = terms.filter((term) => haystack.includes(term)).length;
    score += matches * 55;
  }
  if ((normalizedRole.includes('button') || normalizedRole === 'a') && score > 0) {
    score += 45;
  }
  if (pointInsideElement(requestedViewport, element)) {
    score += 120;
  }

  return score - distanceToRect(requestedViewport, element);
}

async function resolveBrowserTarget(
  win: BrowserWindow,
  action: ComputerActionProposal,
  requestedFrame: BrowserPoint,
  space: BrowserCoordinateSpace,
): Promise<ResolvedBrowserTarget> {
  const requestedViewport = toViewportPoint(requestedFrame, space);
  const elements = await readInteractiveElements(win).catch(() => []);
  const terms = extractSearchTerms(action);

  let matched: BrowserInteractiveElement | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const element of elements) {
    const score = scoreElementMatch(element, requestedViewport, action, terms);
    if (score > bestScore) {
      bestScore = score;
      matched = element;
    }
  }

  const shouldUseMatched = Boolean(
    matched
      && (action.elementId === matched.id
        || (action.selector && normalizeSearchText(action.selector) && bestScore >= 200)
        || bestScore >= 260),
  );
  const appliedViewport = shouldUseMatched && matched
    ? centerPointForElement(matched)
    : requestedViewport;
  const appliedFrame = toFramePoint(appliedViewport, space);

  return {
    requestedFrame,
    requestedViewport,
    appliedFrame,
    appliedViewport,
    ...(shouldUseMatched && matched ? {
      elementId: matched.id,
      elementLabel: describeElement(matched),
    } : {}),
  };
}

function formatResolvedPointerSummary(
  verb: 'Moved pointer to' | 'Clicked browser viewport at' | 'Double-clicked browser viewport at',
  target: ResolvedBrowserTarget,
  movementPath: ComputerUseMovementPath,
): string {
  const applied = `${target.appliedFrame.x}, ${target.appliedFrame.y}`;
  const requestedChanged = target.appliedFrame.x !== target.requestedFrame.x || target.appliedFrame.y !== target.requestedFrame.y;
  const pathSuffix = movementPathSuffix(movementPath);
  if (!requestedChanged) {
    return `${verb} ${applied}${pathSuffix}.`;
  }
  const resolvedLabel = target.elementLabel ? ` "${target.elementLabel}"` : '';
  return `${verb} ${applied}${pathSuffix} (requested ${target.requestedFrame.x}, ${target.requestedFrame.y}; resolved to ${target.elementId ?? 'element'}${resolvedLabel}).`;
}

function ensureDebuggerAttached(win: BrowserWindow): void {
  if (win.webContents.debugger.isAttached()) return;
  win.webContents.debugger.attach('1.3');
}

async function dispatchChromiumMouseRoute(
  win: BrowserWindow,
  route: BrowserPoint[],
  options?: {
    clickCount?: number;
    drag?: boolean;
  },
): Promise<void> {
  ensureDebuggerAttached(win);

  for (const waypoint of route) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: waypoint.x,
      y: waypoint.y,
      button: 'none',
      buttons: options?.drag ? 1 : 0,
      pointerType: 'mouse',
    });
  }

  const last = route[route.length - 1] ?? { x: 0, y: 0 };
  if (options?.drag) {
    return;
  }

  const clickCount = Math.max(0, Math.min(options?.clickCount ?? 0, 2));
  if (clickCount === 0) return;

  for (let count = 1; count <= clickCount; count += 1) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: last.x,
      y: last.y,
      button: 'left',
      buttons: 1,
      clickCount: count,
      pointerType: 'mouse',
    });
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: last.x,
      y: last.y,
      button: 'left',
      buttons: 0,
      clickCount: count,
      pointerType: 'mouse',
    });
  }
}

async function dispatchChromiumDrag(
  win: BrowserWindow,
  moveToStartRoute: BrowserPoint[],
  dragRoute: BrowserPoint[],
): Promise<void> {
  ensureDebuggerAttached(win);

  const preDragRoute = moveToStartRoute.length > 0 ? moveToStartRoute : [{ x: 0, y: 0 }];
  for (const waypoint of preDragRoute) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: waypoint.x,
      y: waypoint.y,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
    });
  }

  const dragStart = dragRoute[0] ?? preDragRoute[preDragRoute.length - 1] ?? { x: 0, y: 0 };
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: dragStart.x,
    y: dragStart.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse',
  });

  for (const waypoint of dragRoute) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: waypoint.x,
      y: waypoint.y,
      button: 'left',
      buttons: 1,
      pointerType: 'mouse',
    });
  }

  const dragEnd = dragRoute[dragRoute.length - 1] ?? dragStart;
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: dragEnd.x,
    y: dragEnd.y,
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse',
  });
}

export class IsolatedBrowserHarness implements ComputerHarness {
  readonly target = 'isolated-browser' as const;

  async initialize(session: ComputerSession): Promise<void> {
    const win = ensureWindow(session.id);
    try {
      ensureDebuggerAttached(win);
    } catch {
      // Fall back to synthetic DOM events if the debugger is unavailable.
    }
    if (win.webContents.getURL()) return;
    await win.loadURL('https://example.com');
  }

  async dispose(sessionId: string): Promise<void> {
    const win = windows.get(sessionId);
    windows.delete(sessionId);
    if (win && !win.isDestroyed()) {
      if (win.webContents.debugger.isAttached()) {
        try {
          win.webContents.debugger.detach();
        } catch {
          // Ignore detach failures during teardown.
        }
      }
      win.destroy();
    }
  }

  async captureFrame(session: ComputerSession): Promise<ComputerFrame> {
    const win = ensureWindow(session.id);
    const image = await win.webContents.capturePage();
    const size = image.getSize(1);
    return {
      id: makeComputerUseId('frame'),
      sessionId: session.id,
      createdAt: nowIso(),
      mimeType: 'image/png',
      dataUrl: image.toDataURL({ scaleFactor: 1 }),
      width: size.width,
      height: size.height,
      source: 'isolated-browser',
    };
  }

  async movePointer(session: ComputerSession, action: ComputerActionProposal, _context?: ComputerHarnessActionContext): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    const space = await resolveCoordinateSpace(win, session);
    const requested = point(action.x, action.y);
    const target = await resolveBrowserTarget(win, action, requested, space);
    const movementPath = resolveMovementPath(action);
    const start = toViewportPoint(currentPointer(session, requested), space);
    const route = buildPointerRoute(start, target.appliedViewport, movementPath);
    try {
      await dispatchChromiumMouseRoute(win, route);
    } catch {
      await evalInPage(win, buildPointerScript(route));
    }
    return result(formatResolvedPointerSummary('Moved pointer to', target, movementPath), target.appliedFrame);
  }

  async click(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    const space = await resolveCoordinateSpace(win, session);
    const requested = point(action.x, action.y);
    const target = await resolveBrowserTarget(win, action, requested, space);
    const movementPath = resolveMovementPath(action);
    const start = toViewportPoint(currentPointer(session, requested), space);
    const route = buildPointerRoute(start, target.appliedViewport, movementPath);
    try {
      await dispatchChromiumMouseRoute(win, route, { clickCount: 1 });
    } catch {
      await evalInPage(win, buildPointerScript(route, 1));
    }
    return result(formatResolvedPointerSummary('Clicked browser viewport at', target, movementPath), target.appliedFrame);
  }

  async doubleClick(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    const space = await resolveCoordinateSpace(win, session);
    const requested = point(action.x, action.y);
    const target = await resolveBrowserTarget(win, action, requested, space);
    const movementPath = resolveMovementPath(action);
    const start = toViewportPoint(currentPointer(session, requested), space);
    const route = buildPointerRoute(start, target.appliedViewport, movementPath);
    try {
      await dispatchChromiumMouseRoute(win, route, { clickCount: 2 });
    } catch {
      await evalInPage(win, buildPointerScript(route, 2));
    }
    return result(formatResolvedPointerSummary('Double-clicked browser viewport at', target, movementPath), target.appliedFrame);
  }

  async drag(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    const space = await resolveCoordinateSpace(win, session);
    const requestedStart = point(action.x ?? action.endX, action.y ?? action.endY);
    const requestedEnd = point(action.endX ?? requestedStart.x, action.endY ?? requestedStart.y);
    const dragStart = toViewportPoint(requestedStart, space);
    const dragEnd = toViewportPoint(requestedEnd, space);
    const movementPath = resolveMovementPath(action);
    const start = toViewportPoint(currentPointer(session, requestedStart), space);
    const moveToStartRoute = buildPointerRoute(start, dragStart, movementPath);
    const dragRoute = buildPointerRoute(dragStart, dragEnd, movementPath);
    try {
      await dispatchChromiumDrag(win, moveToStartRoute, dragRoute);
    } catch {
      await evalInPage(win, buildDragScript(moveToStartRoute, dragRoute));
    }
    const actual = toFramePoint(dragEnd, space);
    return result(`Dragged browser viewport pointer from ${requestedStart.x}, ${requestedStart.y} to ${requestedEnd.x}, ${requestedEnd.y}${movementPathSuffix(movementPath)}.`, actual);
  }

  async scroll(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    const dx = action.deltaX ?? 0;
    const dy = action.deltaY ?? 0;
    await evalInPage(win, `window.scrollBy(${dx}, ${dy});`);
    return result(`Scrolled browser viewport by ${dx}, ${dy}.`);
  }

  async typeText(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    const text = action.text ?? '';
    await evalInPage(win, `
      (() => {
        const el = document.activeElement;
        if (!el) return 'No active element';
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          const text = ${escapeJson(text)};
          const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
          const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
          const next = (el.value || '').slice(0, start) + text + (el.value || '').slice(end);
          const cursor = start + text.length;
          el.value = next;
          if (typeof el.setSelectionRange === 'function') {
            el.setSelectionRange(cursor, cursor);
          }
          el.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            data: text,
            inputType: 'insertText',
          }));
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return 'typed';
        }
        if (el instanceof HTMLElement && el.isContentEditable) {
          el.focus();
          const text = ${escapeJson(text)};
          document.execCommand('insertText', false, text);
          return 'typed';
        }
        return 'Active element is not editable';
      })();
    `);
    return result(`Typed ${JSON.stringify(action.text ?? '')} into browser.`);
  }

  async pressKeys(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    const keys = action.keys ?? [];
    const primary = keys[keys.length - 1] ?? 'Enter';
    const modifiers = keys.slice(0, -1);
    await evalInPage(win, `
      (() => {
        const el = document.activeElement || document.body;
        if (el instanceof HTMLElement) {
          el.focus();
        }
        const key = ${escapeJson(primary)};
        const modifiers = new Set(${escapeJson(modifiers.map((value) => value.toLowerCase()))});
        const descriptorByKey = {
          enter: { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13 },
          tab: { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, charCode: 9 },
          escape: { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, charCode: 27 },
          esc: { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, charCode: 27 },
          backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, charCode: 8 },
          delete: { key: 'Delete', code: 'Delete', keyCode: 46, which: 46, charCode: 46 },
          space: { key: ' ', code: 'Space', keyCode: 32, which: 32, charCode: 32 },
          ' ': { key: ' ', code: 'Space', keyCode: 32, which: 32, charCode: 32 },
          arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, charCode: 0 },
          arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, charCode: 0 },
          arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, charCode: 0 },
          arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, charCode: 0 },
        };
        const lowered = String(key).toLowerCase();
        const descriptor = descriptorByKey[lowered] || {
          key,
          code: String(key).length === 1 ? 'Key' + String(key).toUpperCase() : String(key),
          keyCode: String(key).length === 1 ? String(key).toUpperCase().charCodeAt(0) : 0,
          which: String(key).length === 1 ? String(key).toUpperCase().charCodeAt(0) : 0,
          charCode: String(key).length === 1 ? String(key).charCodeAt(0) : 0,
        };

        const keyboardInit = {
          key: descriptor.key,
          code: descriptor.code,
          bubbles: true,
          cancelable: true,
          composed: true,
          ctrlKey: modifiers.has('control') || modifiers.has('ctrl'),
          altKey: modifiers.has('alt'),
          shiftKey: modifiers.has('shift'),
          metaKey: modifiers.has('meta') || modifiers.has('cmd') || modifiers.has('command'),
        };

        const dispatchKeyboard = (type) => {
          const event = new KeyboardEvent(type, keyboardInit);
          for (const [property, value] of Object.entries({
            keyCode: descriptor.keyCode,
            which: descriptor.which,
            charCode: type === 'keypress' || type === 'char' ? descriptor.charCode : 0,
          })) {
            Object.defineProperty(event, property, {
              configurable: true,
              get: () => value,
            });
          }
          el.dispatchEvent(event);
          return event;
        };

        const keyDownEvent = dispatchKeyboard('keydown');
        const shouldEmitKeyPress = descriptor.charCode > 0 || descriptor.key === 'Enter';
        if (shouldEmitKeyPress) {
          dispatchKeyboard('keypress');
        }

        const activateDefaultEnterBehavior = () => {
          const target = el instanceof HTMLElement ? el : document.body;
          if (target instanceof HTMLButtonElement) {
            target.click();
            return true;
          }
          if (target instanceof HTMLAnchorElement) {
            target.click();
            return true;
          }
          if (target instanceof HTMLInputElement) {
            const inputType = (target.type || 'text').toLowerCase();
            if (['button', 'submit', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(inputType)) {
              target.click();
              return true;
            }
            if (target.form) {
              if (typeof target.form.requestSubmit === 'function') {
                target.form.requestSubmit();
              } else {
                target.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              }
              return true;
            }
          }
          if (target instanceof HTMLTextAreaElement) {
            return false;
          }
          const formOwner = target instanceof HTMLElement ? target.closest('form') : null;
          if (formOwner instanceof HTMLFormElement) {
            if (typeof formOwner.requestSubmit === 'function') {
              formOwner.requestSubmit();
            } else {
              formOwner.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }
            return true;
          }
          if (target instanceof HTMLElement && typeof target.click === 'function') {
            target.click();
            return true;
          }
          return false;
        };

        if (descriptor.key === 'Enter' && !keyDownEvent.defaultPrevented) {
          activateDefaultEnterBehavior();
        }

        dispatchKeyboard('keyup');
        return key;
      })();
    `);
    return result(`Pressed keys: ${keys.join(' + ') || primary}.`);
  }

  async openApp(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    if (action.url) {
      return this.navigate(_session, action);
    }
    throw new Error('Isolated browser harness can only open URLs.');
  }

  async focusWindow(session: ComputerSession): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    win.focus();
    return result('Focused isolated browser window.');
  }

  async navigate(session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const win = ensureWindow(session.id);
    const url = action.url?.trim();
    if (!url) throw new Error('Navigation requires a URL.');
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    await win.loadURL(normalized);
    return result(`Navigated to ${normalized}.`);
  }

  async waitForIdle(_session: ComputerSession, action: ComputerActionProposal): Promise<ComputerHarnessActionResult> {
    const waitMs = Math.max(250, Math.min(action.waitMs ?? 1000, 10000));
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return result(`Waited ${waitMs}ms.`);
  }

  async getEnvironmentMetadata(session: ComputerSession): Promise<ComputerEnvironmentMetadata> {
    const win = ensureWindow(session.id);
    const space = await resolveCoordinateSpace(win, session);
    const metadata = await evalInPage<ComputerEnvironmentMetadata & {
      viewportWidth?: number;
      viewportHeight?: number;
      devicePixelRatio?: number;
    }>(win, `
      (() => {
        const viewportWidth = Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0, visualViewport?.width || 0);
        const viewportHeight = Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0, visualViewport?.height || 0);
        const elements = Array.from(document.querySelectorAll(${escapeJson(interactiveSelector)}))
          .filter((el) => {
            if (!(el instanceof HTMLElement)) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            if (rect.width < 2 || rect.height < 2) return false;
            if (rect.right <= 0 || rect.bottom <= 0) return false;
            if (rect.left >= viewportWidth || rect.top >= viewportHeight) return false;
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
            if (style.pointerEvents === 'none') return false;
            if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
            return true;
          })
          .sort((a, b) => {
            const rectA = a.getBoundingClientRect();
            const rectB = b.getBoundingClientRect();
            if (Math.abs(rectA.top - rectB.top) > 1) return rectA.top - rectB.top;
            return rectA.left - rectB.left;
          })
          .slice(0, 60)
          .map((el, index) => {
            const rect = el.getBoundingClientRect();
            return {
              id: 'el-' + index,
              selector: el.id ? '#' + el.id : undefined,
              role: el.getAttribute('role') || el.tagName.toLowerCase(),
              label: el.getAttribute('aria-label') || undefined,
              text: (el.textContent || '').trim().slice(0, 120),
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            };
          });
        return {
          url: location.href,
          title: document.title,
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          viewportWidth: Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0, visualViewport?.width || 0),
          viewportHeight: Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0, visualViewport?.height || 0),
          devicePixelRatio: window.devicePixelRatio || 1,
          visibleText: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2400),
          interactiveElements: elements,
        };
      })();
    `);

    return {
      ...metadata,
      interactiveElements: metadata.interactiveElements?.map((element) => {
        const topLeft = toFramePoint({ x: element.x, y: element.y }, space);
        const bottomRight = toFramePoint(
          { x: element.x + element.width, y: element.y + element.height },
          space,
        );
        return {
          ...element,
          x: topLeft.x,
          y: topLeft.y,
          width: Math.max(1, bottomRight.x - topLeft.x),
          height: Math.max(1, bottomRight.y - topLeft.y),
        };
      }),
    };
  }
}
