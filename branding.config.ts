/**
 * Central branding configuration for white-labeling.
 *
 * Every user-visible name, ID, slug, and string the app uses is defined here.
 * To rebrand the app, change the values below and rebuild.
 *
 * Values are injected at **build time** via Vite `define()` as compile-time
 * constants (e.g. `__BRAND_PRODUCT_NAME`). They are also used by the
 * `scripts/generate-builder-config.ts` pre-build step to template
 * `electron-builder.yml`.
 *
 * NOTE: Also update `name`, `productName`, and `description` in package.json
 * to match — those fields are not auto-generated from this config.
 */
export const branding = {
  // ── Identity ──────────────────────────────────────────────────────────
  /** Window title, macOS menu bar, dock name, and general display name. */
  productName: 'Legion Interlink',
  /** Lowercase slug used for the config directory (~/.legionio/), localStorage keys, temp dirs, etc. */
  appSlug: 'legionio',
  /** macOS bundle identifier / Windows app user model ID. */
  appId: 'com.legion.interlink',
  /** Executable / binary name on disk. */
  executableName: 'Legion Interlink',
  /** Short wordmark shown in the sidebar title bar (typically uppercased). */
  wordmark: 'INTERLINK',
  /** One-line description for package.json and store listings. */
  description: 'Legion Interlink - Local AI Assistant',

  // ── User-facing strings ───────────────────────────────────────────────
  /** Name used in the default system prompt: "You are {assistantName}, a powerful…" */
  assistantName: 'Interlink',
  /** Placeholder inside the message composer. */
  composerPlaceholder: 'Message Legion Interlink...',
  /** Text shown in the file drop zone overlay. */
  dropZoneText: 'Drop files for Legion Interlink',
  /** Heading shown in the error boundary fallback UI. */
  errorBoundaryText: 'Legion Interlink encountered an error',

  // ── Protocol & machine IDs ────────────────────────────────────────────
  /** Custom Electron protocol scheme for serving generated media (e.g. "legion-media://"). */
  mediaProtocol: 'legion-media',
  /** MCP client name sent during MCP handshake. */
  mcpClientName: 'legion',
  /** HTTP User-Agent header value. */
  userAgent: 'Legion-Interlink/1.0',
  /** Agent identifier sent to the daemon's knowledge / Apollo APIs. */
  agentId: 'legion-interlink',
  /** Mastra memory resource ID. */
  resourceId: 'legion-local-user',
  /** `iss` claim in JWTs issued for daemon auth. */
  jwtIssuer: 'legion',

  // ── Build / packaging ─────────────────────────────────────────────────
  /** Prefix for installer artifact filenames (e.g. "Legion-Interlink-1.0.0-arm64.dmg"). */
  artifactPrefix: 'Legion-Interlink',
  /** macOS app category. */
  macCategory: 'public.app-category.developer-tools',

  // ── macOS permission-usage strings (shown in system dialogs) ──────────
  microphoneUsage:
    'Legion Interlink uses the microphone for voice dictation (speech-to-text).',
  appleEventsUsage:
    'Legion Interlink uses Apple Events to activate apps and inspect focused windows during Local Mac computer control.',
  screenCaptureUsage:
    'Legion Interlink captures your screen to enable Local Mac computer control and allow the AI to see what\'s on your display.',
} as const;

export type Branding = typeof branding;
