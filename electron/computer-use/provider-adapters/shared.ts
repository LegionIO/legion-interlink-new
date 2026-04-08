import { z } from 'zod';
import { generateObject, generateText, Output } from 'ai';
import { safeParseJSON } from '@ai-sdk/provider-utils';
import { jsonrepair } from 'jsonrepair';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  ComputerActionProposal,
  ComputerDisplayLayout,
  ComputerPlannerState,
  ComputerSession,
  ComputerUseRole,
} from '../../../shared/computer-use.js';
import { makeComputerUseId } from '../../../shared/computer-use.js';
import type { LLMModelConfig } from '../../agent/model-catalog.js';
import { createLanguageModelFromConfig } from '../../agent/language-model.js';

// ── Model chain + fallback types ───────────────────────────────────────────────

export type ModelChainEntry = {
  key: string;
  modelConfig: LLMModelConfig;
  displayName: string;
};

export type FallbackCallbacks = {
  onRetry?: (attempt: number, model: string, error: string) => void;
  onFallback?: (fromModel: string, toModel: string, toModelKey: string, error: string) => void;
  onModelStart?: (model: string, modelIndex: number, totalModels: number) => void;
};

// ── Parse-error classification ─────────────────────────────────────────────────

function isRetryableParseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes('could not parse')
    || lower.includes('no object generated')
    || lower.includes('ai_noobjectgeneratederror')
    || (error instanceof Error && error.constructor.name === 'NoObjectGeneratedError');
}

function isClaudeOpenAICompatModel(modelConfig: LLMModelConfig): boolean {
  return modelConfig.provider === 'openai-compatible'
    && /(?:^|[./:_-])(claude|anthropic)(?:$|[./:_-])|claude|anthropic/i.test(modelConfig.modelName);
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fencedMatches = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of fencedMatches) {
    const candidate = match[1]?.trim();
    if (candidate) return candidate;
  }

  if (/^\s*{/.test(trimmed)) return trimmed;
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return null;
}

async function generateObjectWithJsonRepair<T extends z.ZodType>(
  schema: T,
  request: Omit<Parameters<typeof generateObject>[0], 'model'>,
  model: Awaited<ReturnType<typeof createModel>>,
): Promise<z.infer<T>> {
  const schemaJson = JSON.stringify(zodToJsonSchema(schema, 'result'), null, 2);
  const jsonOnlyInstruction = [
    'Return only a JSON object that matches the JSON Schema exactly.',
    'Do not include markdown fences, explanations, or any text before or after the JSON.',
    'Use null for fields that do not apply.',
    `JSON Schema:\n${schemaJson}`,
  ].join('\n\n');

  const textRequest = {
    ...(request as Omit<Parameters<typeof generateObject>[0], 'model'> & {
      schema: T;
      output?: string;
      schemaName?: string;
      schemaDescription?: string;
    }),
  } as Record<string, unknown>;
  delete textRequest.schema;
  delete textRequest.output;
  delete textRequest.schemaName;
  delete textRequest.schemaDescription;

  const result = await generateText({
    ...(textRequest as Parameters<typeof generateText>[0]),
    model,
    output: Output.text(),
    system: [String(textRequest.system ?? '').trim() || undefined, jsonOnlyInstruction].filter(Boolean).join('\n\n'),
  });

  const jsonLikeText = extractJsonCandidate(result.text) ?? result.text;
  const repairedText = jsonrepair(jsonLikeText);
  const parseResult = await safeParseJSON({ text: repairedText });
  if (!parseResult.success) {
    throw parseResult.error;
  }

  const validated = schema.safeParse(parseResult.value);
  if (!validated.success) {
    throw new Error(`Repaired JSON did not match schema: ${validated.error.message}`);
  }

  return validated.data;
}

// ── generateObjectWithFallback ─────────────────────────────────────────────────

export type GenerateObjectResult<T> = {
  object: T;
  /** Index into the model chain of the model that succeeded. */
  modelIndex: number;
};

async function generateObjectWithFallback<T extends z.ZodType>(
  chain: ModelChainEntry[],
  maxRetries: number,
  buildRequest: (model: unknown) => Omit<Parameters<typeof generateObject>[0], 'model'>,
  callbacks?: FallbackCallbacks,
): Promise<GenerateObjectResult<z.infer<T>>> {
  let lastError: unknown = new Error('No models in chain');

  for (let modelIndex = 0; modelIndex < chain.length; modelIndex++) {
    const entry = chain[modelIndex];
    callbacks?.onModelStart?.(entry.displayName, modelIndex, chain.length);
    const model = await createModel(entry.modelConfig);
    const retryLimit = Math.max(0, maxRetries);

    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      try {
        const request = buildRequest(model);
        if (isClaudeOpenAICompatModel(entry.modelConfig)) {
          const repairedObject = await generateObjectWithJsonRepair((request as { schema: T }).schema, request, model);
          return { object: repairedObject, modelIndex };
        }
        const result = await generateObject({ ...request, model } as Parameters<typeof generateObject>[0]);
        return { object: (result as { object: z.infer<T> }).object, modelIndex };
      } catch (error) {
        lastError = error;
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (isRetryableParseError(error) && attempt < retryLimit) {
          callbacks?.onRetry?.(attempt + 1, entry.displayName, errorMessage);
          continue;
        }

        // Non-retryable or out of retries — try next model
        if (modelIndex < chain.length - 1) {
          const nextEntry = chain[modelIndex + 1];
          callbacks?.onFallback?.(entry.displayName, nextEntry.displayName, nextEntry.key, errorMessage);
        }
        break;
      }
    }
  }

  throw lastError;
}

/**
 * Reorder a model chain so that the model at `startIndex` is first,
 * followed by the remaining models in their original order.
 */
export function reorderChain(chain: ModelChainEntry[], startIndex: number): ModelChainEntry[] {
  if (startIndex <= 0 || startIndex >= chain.length) return chain;
  return [...chain.slice(startIndex), ...chain.slice(0, startIndex)];
}

const plannerSchema = z.object({
  summary: z.string().min(1),
  subgoals: z.array(z.string().min(1)).min(1).max(6),
  successCriteria: z.array(z.string().min(1)).min(1).max(6),
});

const nullableString = z.string().nullable();
const nullableNumber = z.number().nullable();
const nullableStringArray = z.array(z.string()).nullable();
const requiredMovementPath = z.enum(['teleport', 'direct', 'horizontal-first', 'vertical-first']).describe('Cursor travel strategy. Prefer teleport by default for pointer actions because it jumps directly to the destination without traversing intermediate hover targets. Use horizontal-first or vertical-first only when you intentionally need a visible routed hover path. Use direct only when a straight visible movement is clearly safe and necessary.');

const actionSchema = z.object({
  complete: z.boolean(),
  summary: z.string().min(1).max(240),
  nextSubgoal: z.string().min(1).max(240).nullable(),
  actions: z.array(z.object({
    kind: z.enum(['navigate', 'movePointer', 'click', 'doubleClick', 'drag', 'scroll', 'typeText', 'pressKeys', 'wait', 'openApp', 'focusWindow']),
    rationale: z.string().min(1).max(240),
    risk: z.enum(['low', 'medium', 'high']),
    selector: nullableString,
    elementId: nullableString,
    x: nullableNumber,
    y: nullableNumber,
    endX: nullableNumber,
    endY: nullableNumber,
    url: nullableString,
    text: nullableString,
    keys: nullableStringArray,
    deltaX: nullableNumber,
    deltaY: nullableNumber,
    appName: nullableString,
    waitMs: nullableNumber,
    movementPath: requiredMovementPath,
    displayIndex: nullableNumber.describe('Which display/monitor this action targets (0-indexed). 0 = primary. Only needed for multi-monitor setups when targeting a non-primary display.'),
  })).max(3),
});

export type PlannedActions = {
  plannerState: ComputerPlannerState;
  summary: string;
  complete: boolean;
  currentSubgoal: string;
  actions: ComputerActionProposal[];
};

function toImageInput(frame: ComputerSession['latestFrame']): { image: Buffer | URL; mediaType?: string } | null {
  if (!frame) return null;

  if (frame.dataUrl.startsWith('data:')) {
    const match = frame.dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/);
    if (!match) {
      throw new Error('Computer-use frame data URL is not a valid base64 image payload.');
    }
    const [, mediaType, base64] = match;
    return {
      image: Buffer.from(base64, 'base64'),
      mediaType: mediaType ?? frame.mimeType,
    };
  }

  if (/^https?:\/\//i.test(frame.dataUrl)) {
    return {
      image: new URL(frame.dataUrl),
      mediaType: frame.mimeType,
    };
  }

  return {
    image: Buffer.from(frame.dataUrl, 'base64'),
    mediaType: frame.mimeType,
  };
}

function normalizeText(value?: string | null, maxLength = 120): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function describeInteractiveElements(session: ComputerSession, maxItems = 24): string | undefined {
  const elements = session.latestEnvironment?.interactiveElements;
  if (!Array.isArray(elements) || elements.length === 0) return undefined;

  const lines = elements
    .slice(0, maxItems)
    .map((element, index) => {
      const role = normalizeText(element.role, 24) || 'element';
      const label = normalizeText(element.label, 40);
      const text = normalizeText(element.text, 48);
      const selector = normalizeText(element.selector, 40);
      const descriptors = [label && `label="${label}"`, text && `text="${text}"`, selector && `selector=${selector}`]
        .filter(Boolean)
        .join(' ');

      return `${index + 1}. ${element.id} ${role} at (${element.x}, ${element.y}) size ${element.width}x${element.height}${descriptors ? ` ${descriptors}` : ''}`;
    });

  if (lines.length === 0) return undefined;
  return `Interactive elements (frame coordinates):\n${lines.join('\n')}`;
}

function actionFingerprint(action: Pick<ComputerActionProposal, 'kind' | 'selector' | 'elementId' | 'x' | 'y' | 'endX' | 'endY' | 'url' | 'text' | 'keys' | 'deltaX' | 'deltaY' | 'appName' | 'waitMs' | 'movementPath'>): string {
  return JSON.stringify({
    kind: action.kind,
    selector: action.selector ?? null,
    elementId: action.elementId ?? null,
    x: action.x ?? null,
    y: action.y ?? null,
    endX: action.endX ?? null,
    endY: action.endY ?? null,
    url: action.url ?? null,
    text: normalizeText(action.text ?? null, 80) || null,
    keys: action.keys ?? null,
    deltaX: action.deltaX ?? null,
    deltaY: action.deltaY ?? null,
    appName: action.appName ?? null,
    waitMs: action.waitMs ?? null,
    movementPath: action.movementPath,
  });
}

function describeAction(action: Pick<ComputerActionProposal, 'kind' | 'selector' | 'elementId' | 'x' | 'y' | 'endX' | 'endY' | 'url' | 'text' | 'keys' | 'deltaX' | 'deltaY' | 'appName' | 'waitMs' | 'movementPath'>): string {
  const parts: string[] = [action.kind];
  if (action.selector) parts.push(`selector=${action.selector}`);
  if (action.elementId) parts.push(`element=${action.elementId}`);
  if (action.x != null && action.y != null) parts.push(`at ${action.x},${action.y}`);
  if (action.endX != null && action.endY != null) parts.push(`to ${action.endX},${action.endY}`);
  if (action.url) parts.push(`url=${action.url}`);
  if (action.text) parts.push(`text=${normalizeText(action.text, 60)}`);
  if (action.keys?.length) parts.push(`keys=${action.keys.join('+')}`);
  if (action.deltaX != null || action.deltaY != null) parts.push(`scroll=${action.deltaX ?? 0},${action.deltaY ?? 0}`);
  if (action.appName) parts.push(`app=${action.appName}`);
  if (action.waitMs != null) parts.push(`wait=${action.waitMs}ms`);
  if (action.kind === 'movePointer' || action.kind === 'click' || action.kind === 'doubleClick' || action.kind === 'drag') {
    parts.push(`path=${action.movementPath}`);
  }
  return parts.join(' · ');
}

function buildLoopAlert(session: ComputerSession): string | undefined {
  const candidates = session.actions
    .filter((action) => action.status === 'completed' || action.status === 'running' || action.status === 'failed')
    .slice(-8);
  if (candidates.length < 3) return undefined;

  const counts = new Map();
  let repeatedFingerprint: string | null = null;
  let repeatedAction: ComputerActionProposal | null = null;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const action = candidates[index];
    const fingerprint = actionFingerprint(action);
    const nextCount = (counts.get(fingerprint) ?? 0) + 1;
    counts.set(fingerprint, nextCount);
    if (nextCount >= 3) {
      repeatedFingerprint = fingerprint;
      repeatedAction = action;
      break;
    }
  }

  if (!repeatedFingerprint || !repeatedAction) return undefined;

  const sameActions = candidates.filter((action) => actionFingerprint(action) === repeatedFingerprint);
  if (sameActions.length < 3) return undefined;

  const failedCount = sameActions.filter((action) => action.status === 'failed').length;
  const latestResult = normalizeText(sameActions[sameActions.length - 1]?.resultSummary ?? sameActions[sameActions.length - 1]?.error ?? '', 160);
  const suffix = latestResult ? ` Latest outcome: ${latestResult}.` : '';
  return `Loop alert: the action \"${describeAction(repeatedAction)}\" was attempted ${sameActions.length} times recently${failedCount > 0 ? ` (${failedCount} failed)` : ''}. Do not propose that same action again unless the UI clearly changed and you explain why repeating it is now safe.${suffix}`;
}

async function createModel(modelConfig: LLMModelConfig): Promise<Awaited<ReturnType<typeof createLanguageModelFromConfig>>> {
  return createLanguageModelFromConfig(modelConfig);
}

export async function createPlannerState(
  goal: string,
  modelChain: ModelChainEntry[],
  maxRetries: number,
  conversationContext?: string,
  callbacks?: FallbackCallbacks,
): Promise<{ state: ComputerPlannerState; modelIndex: number }> {
  const prompt = [
    'You are planning a computer-use session. Create a short task graph for the goal below.',
    '',
    `Goal:\n${goal}`,
    conversationContext ? `Conversation context to resolve references like "that fix":\n${conversationContext}` : undefined,
    'Keep it concise and executable.',
  ].filter(Boolean).join('\n\n');
  const result = await generateObjectWithFallback(
    modelChain,
    maxRetries,
    () => ({
      output: 'object' as const,
      schema: plannerSchema,
      prompt,
    }),
    callbacks,
  );
  return {
    state: {
      summary: result.object.summary,
      subgoals: result.object.subgoals,
      successCriteria: result.object.successCriteria,
      activeSubgoalIndex: 0,
    },
    modelIndex: result.modelIndex,
  };
}

function describeDisplayLayout(layout: ComputerDisplayLayout | undefined): string | undefined {
  if (!layout || layout.displays.length <= 1) return undefined;

  const lines: string[] = [
    '--- MULTI-MONITOR SETUP ---',
    `You are viewing ${layout.displays.length} separate monitor screenshots (one image per monitor).`,
    '',
  ];

  for (let i = 0; i < layout.displays.length; i++) {
    const d = layout.displays[i];
    const primary = d.isPrimary ? ' (PRIMARY)' : '';
    const position = `global position (${d.globalX}, ${d.globalY})`;
    lines.push(`  Display ${i}${primary}: "${d.name}" — ${d.logicalWidth}x${d.logicalHeight} logical, ${position}`);
  }

  lines.push('');
  lines.push('IMPORTANT: When specifying x/y coordinates for a pointer action (click, movePointer, doubleClick, drag), also set displayIndex to the display number (0-indexed) where the target element is visible. x/y are relative to THAT display\'s image, not a combined image. If you omit displayIndex or set it to 0, the action targets the primary display.');
  lines.push('--- END MULTI-MONITOR SETUP ---');
  return lines.join('\n');
}

export async function generateNextActions(params: {
  session: ComputerSession;
  modelChain: ModelChainEntry[];
  maxRetries: number;
  role: ComputerUseRole;
  captureExcludedApps?: string[];
  callbacks?: FallbackCallbacks;
}): Promise<PlannedActions> {
  const { session, modelChain, maxRetries, role, captureExcludedApps, callbacks } = params;
  const plannerState = session.plannerState ?? {
    summary: session.goal,
    subgoals: [session.goal],
    successCriteria: ['Task completed'],
    activeSubgoalIndex: 0,
  };
  const currentSubgoal = plannerState.subgoals[plannerState.activeSubgoalIndex] ?? plannerState.subgoals[0] ?? session.goal;
  const recentActions = session.actions.slice(-8).map((action) => {
    const path = action.kind === 'movePointer' || action.kind === 'click' || action.kind === 'doubleClick' || action.kind === 'drag'
      ? ` [path=${action.movementPath}]`
      : '';
    const suffix = action.resultSummary ? ` -> ${action.resultSummary}` : action.error ? ` -> ERROR: ${action.error}` : '';
    return `${action.kind}${path} (${action.status})${suffix}`;
  }).join('\n');
  const loopAlert = buildLoopAlert(session);
  const frame = session.latestFrame;
  const imageInput = toImageInput(frame);
  const metadata = session.latestEnvironment;
  // Build guidance message section from recent guidance (including newly injected ones)
  const guidanceMessages = (session.guidanceMessages ?? [])
    .filter((m) => m.text.trim())
    .slice(-10)
    .map((m) => {
      const time = new Date(m.createdAt).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `[${time}] "${m.text}"`;
    });
  const guidanceSection = guidanceMessages.length > 0
    ? `User guidance (received during this session — treat as highest-priority steering):\n${guidanceMessages.join('\n')}`
    : undefined;
  const interactiveElementsSection = describeInteractiveElements(session);

  // ── Focused window state & hidden-app detection ──
  const focusedApp = metadata?.appName ?? null;
  const focusedWindowTitle = metadata?.windowTitle ?? null;
  const excludedApps = captureExcludedApps ?? [];
  const focusedAppIsHidden = focusedApp != null
    && excludedApps.some((excluded) => focusedApp.toLowerCase() === excluded.toLowerCase());

  // Build a consolidated block describing what the OS reports as the focused window.
  // This is critical because the screenshot only shows *visible* windows — the actual
  // focused/frontmost app may be hidden (excluded from capture) and therefore invisible.
  const focusedWindowLines: string[] = [
    '--- FOCUSED WINDOW STATE (from OS, not from screenshot) ---',
    `Focused application: ${focusedApp ?? 'unknown'}`,
    `Focused window title: ${focusedWindowTitle || '(none)'}`,
  ];
  if (focusedAppIsHidden) {
    focusedWindowLines.push(
      `MISMATCH: "${focusedApp}" is focused but HIDDEN from the screenshot (it is in the excluded apps list).`,
      'The screenshot does NOT show this application. Any input actions (click, type, pressKeys) will be sent to this INVISIBLE window, not to what you see in the screenshot.',
    );
  }
  if (excludedApps.length > 0) {
    focusedWindowLines.push(`Hidden/excluded applications: ${excludedApps.join(', ')}`);
  }
  focusedWindowLines.push('--- END FOCUSED WINDOW STATE ---');
  const focusedWindowBlock = focusedWindowLines.join('\n');

  // When the focused app is hidden, emit a hard-stop warning that goes at the very top
  // of the prompt so the model cannot miss it.
  const hiddenFocusWarning = focusedAppIsHidden
    ? [
        'STOP — WRONG WINDOW FOCUSED.',
        `The OS reports "${focusedApp}" as the frontmost application, but "${focusedApp}" is excluded from screenshots so you CANNOT see it.`,
        'All mouse clicks, keyboard input, and other actions will go to this invisible window — NOT to what is shown in the screenshot.',
        'You MUST issue a focusWindow or openApp action to bring the correct target application to the front BEFORE doing anything else.',
        'Do NOT click, type, scroll, or press keys until the focused application matches the window you intend to interact with.',
      ].join(' ')
    : undefined;

  const promptParts = [
    // Hidden-focus hard-stop goes first so it is the very first thing the model reads
    hiddenFocusWarning,
    `Role: ${role}`,
    `Overall goal: ${session.goal}`,
    session.conversationContext ? `Conversation context:\n${session.conversationContext}` : undefined,
    guidanceSection,
    `Plan summary: ${plannerState.summary}`,
    `Current subgoal: ${currentSubgoal}`,
    `Success criteria: ${plannerState.successCriteria.join(' | ')}`,
    // Display layout description (multi-monitor awareness)
    describeDisplayLayout(session.displayLayout),
    // Focused window state block (always included — the model needs to know what window
    // is actually focused regardless of whether it is hidden)
    focusedWindowBlock,
    metadata?.url ? `Current URL: ${metadata.url}` : undefined,
    metadata?.title ? `Current page title: ${metadata.title}` : undefined,
    metadata?.visibleText ? `Visible text:\n${metadata.visibleText}` : undefined,
    interactiveElementsSection,
    recentActions ? `Recent actions:\n${recentActions}` : undefined,
    loopAlert,
    role === 'recovery'
      ? 'You are in recovery mode because the session appears stuck or repetitive. Diagnose why the prior approach failed, then choose a different next step. Prefer observation, focus changes, navigation changes, escape/back, or a short wait over repeating the same click.'
      : undefined,
    'Resolve references such as "that", "that fix", or "the change we discussed" against the conversation context before acting.',
    'Return the next 0-3 actions. Prefer navigate when a URL is obvious. Use click/scroll/type only when grounded in the current UI. Mark complete=true only when the user goal is clearly done.',
    'If the last approach appears stuck, do not repeat the same action sequence. Change strategy and gather new evidence from the current UI first.',
    'When interactive elements are listed and the intended control is clearly one of them, prefer returning its elementId and leave x/y null so the runtime can resolve the exact target location.',
    'If you use x/y for a pointer action, use the screenshot coordinates for the visible point you want.',
    'Always set movementPath to teleport, direct, horizontal-first, or vertical-first. For pointer-moving actions (movePointer, click, doubleClick, drag), default to teleport unless you intentionally need the pointer to travel through a visible route.',

    // ── Cursor travel direction & moving targets ──
    'CRITICAL — Cursor movement mode matters. Many UI elements are "moving targets" that react to the pointer as it travels, so avoid traveled paths unless you truly need them.',

    'Default to teleport: teleport is the safest default for local computer use because it jumps straight to the destination without crossing intermediate hover targets, which avoids accidentally opening the wrong submenu, hover card, dock icon, or flyout on the way. Leave movementPath as teleport unless you have a specific reason not to.',

    'Dock magnification: The macOS dock magnifies icons under the cursor. If your cursor path crosses the dock on the way to a target, the magnification effect shifts every icon\'s position while the pointer is in transit. Teleport avoids that entirely and should be preferred. If you must use a traveled path, approach from the direction that minimizes travel along the dock axis. For a bottom dock, move vertically down to the icon\'s column first (horizontal-first), then slide horizontally only the short distance needed. Avoid sweeping horizontally across the dock — each icon you pass over will magnify and push neighbors out of position.',

    'Context menus & submenus: Teleport is strongly preferred because submenu hover behavior is fragile. When a context menu is open and you need to reach a submenu item, a traveled path can sweep through other top-level items, open a different submenu, or collapse the intended one. Only if teleport is unsuitable should you choose a routed path. In that case, move horizontally into the submenu column first (horizontal-first) when the submenu extends sideways, or move horizontally along the menu bar to the correct parent item before going vertically into the dropdown. The rule is: if you must travel, enter the submenu corridor on the axis that keeps you inside it, then travel along that corridor to the item.',

    'Menu bars & cascading menus: Prefer teleport. If you intentionally use a traveled path, first move horizontally to the correct menu heading, then vertically into the dropdown. For cascading submenus that fly out to the side, move horizontally into the flyout first, then vertically to the item. Direct diagonal travel should be strongly avoided because it crosses intermediate menu items and can open the wrong submenu or collapse the intended target before the click lands.',

    'Hover-sensitive UI (popovers, tooltips, hover cards, toolbars with flyouts): Prefer teleport so you do not trigger unrelated hover targets while approaching the destination. If you must use a traveled path, prefer the axis order that keeps the cursor in "dead space" or along the edge of the container for as long as possible before entering the interactive zone.',

    'When to use each mode: Use teleport by default. Use horizontal-first or vertical-first only when you intentionally need hover-driven traversal through a safe corridor. Use direct only when a straight visible movement is clearly short, unobstructed, and preferable to teleport for the task. For all non-pointer actions (typeText, pressKeys, scroll, etc.), always use teleport.',
    'The response schema is strict. Always include complete, summary, nextSubgoal, and every action field. Use null for any field that does not apply to a given action.',
  ].filter(Boolean).join('\n\n');

  // Build message content with per-display images
  const displayFrames = session.latestFrame?.displayFrames;
  const contentParts: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer | URL; mediaType?: string }> = [
    { type: 'text' as const, text: promptParts },
  ];

  if (displayFrames && displayFrames.length > 1) {
    // Multi-display: send labeled images for each display
    for (const df of displayFrames) {
      contentParts.push({ type: 'text' as const, text: `[Display ${df.displayIndex}: "${df.displayName}" — ${df.width}x${df.height}]` });
      const img = toImageInput({ dataUrl: df.dataUrl, mimeType: 'image/jpeg' } as typeof frame);
      if (img) {
        contentParts.push({ type: 'image' as const, image: img.image, mediaType: img.mediaType });
      }
    }
  } else if (imageInput) {
    // Single display: send one image (original behavior)
    contentParts.push({ type: 'image' as const, image: imageInput.image, mediaType: imageInput.mediaType });
  }

  const message = [{ role: 'user' as const, content: contentParts }];

  const result = await generateObjectWithFallback(
    modelChain,
    maxRetries,
    () => ({
      output: 'object' as const,
      schema: actionSchema,
      messages: message,
    }),
    callbacks,
  );

  return {
    plannerState,
    summary: result.object.summary,
    complete: result.object.complete,
    currentSubgoal: result.object.nextSubgoal ?? currentSubgoal,
    actions: result.object.actions.map((action: z.infer<typeof actionSchema>['actions'][number]) => ({
      id: makeComputerUseId('action'),
      sessionId: session.id,
      createdAt: new Date().toISOString(),
      role,
      kind: action.kind,
      status: 'proposed',
      rationale: action.rationale,
      risk: action.risk,
      requiresApproval: action.risk !== 'low',
      selector: action.selector ?? undefined,
      elementId: action.elementId ?? undefined,
      x: action.x ?? undefined,
      y: action.y ?? undefined,
      endX: action.endX ?? undefined,
      endY: action.endY ?? undefined,
      url: action.url ?? undefined,
      text: action.text ?? undefined,
      keys: action.keys ?? undefined,
      deltaX: action.deltaX ?? undefined,
      deltaY: action.deltaY ?? undefined,
      appName: action.appName ?? undefined,
      waitMs: action.waitMs ?? undefined,
      movementPath: action.movementPath,
      displayIndex: action.displayIndex ?? undefined,
    })),
  };
}
