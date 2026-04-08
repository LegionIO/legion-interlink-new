/**
 * Kai branding configuration — white-label override for Legion Interlink.
 *
 * This file replaces `branding.config.ts` in the legion-interlink repo at build
 * time.  Every user-visible name, ID, slug, and string the app uses is defined
 * here.  Values are injected at **build time** via Vite `define()` as
 * compile-time constants and also used by `scripts/generate-builder-config.ts`
 * to template `electron-builder.yml`.
 */
export const branding = {
  // ── Identity ──────────────────────────────────────────────────────────
  productName: 'Kai',
  appSlug: 'kai',
  appId: 'com.uhg.aidesktop',
  executableName: 'Kai',
  wordmark: 'KAI',
  description: 'Kai - AI Desktop Assistant',

  // ── User-facing strings ───────────────────────────────────────────────
  assistantName: 'Kai',
  composerPlaceholder: 'Message Kai...',
  dropZoneText: 'Drop files for Kai',
  errorBoundaryText: 'Kai encountered an error',

  // ── Protocol & machine IDs ────────────────────────────────────────────
  mediaProtocol: 'kai-media',
  mcpClientName: 'kai',
  userAgent: 'Kai/1.0',
  agentId: 'kai',
  resourceId: 'kai-local-user',
  jwtIssuer: 'kai',

  // ── Build / packaging ─────────────────────────────────────────────────
  artifactPrefix: 'Kai',
  macCategory: 'public.app-category.developer-tools',

  // ── Theme / visual identity ──────────────────────────────────────────
  /** OKLCh hue angle (0-360) used for the brand accent across the UI. */
  themeHue: '85',
  /** Fallback light-mode accent for contexts that need a hex color. */
  themeAccentLight: '#b8960f',
  /** Fallback dark-mode accent for contexts that need a hex color. */
  themeAccentDark: '#e8c94a',
  /** Empty-thread background treatment. */
  themeBackground: 'constellation',
  /** Whether to use the animated gradient wordmark text. */
  themeGradientText: 'true',

  // ── macOS permission-usage strings (shown in system dialogs) ──────────
  microphoneUsage:
    'Kai uses the microphone for voice dictation (speech-to-text).',
  appleEventsUsage:
    'Kai uses Apple Events to activate apps and inspect focused windows during computer control.',
  screenCaptureUsage:
    'Kai captures your screen to enable computer control and allow the AI to see what\'s on your display.',

  // ── Required Plugins ──────────────────────────────────────────────────
  /** Plugins bundled and mandated for the Kai deployment. */
  requiredPlugins: ['skynet'] as ReadonlyArray<string>,
} as const;

export type Branding = typeof branding;
