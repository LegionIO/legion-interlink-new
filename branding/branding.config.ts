/**
 * Legion Interlink branding configuration — white-label override.
 *
 * This file replaces `branding.config.ts` in the upstream repo at build
 * time. Every user-visible name, ID, slug, and string the app uses is defined
 * here. Values are injected at build time via Vite `define()` and also used by
 * the upstream packaging scripts.
 */
export const branding = {
  // Identity
  productName: 'Legion Interlink',
  appSlug: 'legionio',
  appId: 'com.legion.interlink',
  executableName: 'Legion Interlink',
  wordmark: 'INTERLINK',
  description: 'Legion Interlink - Local AI Assistant',

  // User-facing strings
  assistantName: 'Interlink',
  composerPlaceholder: 'Message Legion Interlink...',
  dropZoneText: 'Drop files for Legion Interlink',
  errorBoundaryText: 'Legion Interlink encountered an error',

  // Protocol & machine IDs
  mediaProtocol: 'legion-media',
  mcpClientName: 'legion',
  userAgent: '{productToken}/{version} ({osName} {osVersion}; {arch}) Electron/{electronVersion}',
  agentId: 'legion-interlink',
  resourceId: 'legion-local-user',
  jwtIssuer: 'legion',

  // Build / packaging
  artifactPrefix: 'Legion-Interlink',
  macCategory: 'public.app-category.developer-tools',

  // Theme / visual identity
  themeHue: '292',
  themeAccentLight: '#7f77dd',
  themeAccentDark: '#c5c2f5',
  themeBackground: 'matrix-rain',
  themeGradientText: 'true',

  // macOS permission-usage strings
  microphoneUsage:
    'Legion Interlink uses the microphone for voice dictation (speech-to-text).',
  appleEventsUsage:
    'Legion Interlink uses Apple Events to activate apps and inspect focused windows during local Mac computer control.',
  screenCaptureUsage:
    'Legion Interlink captures your screen to enable local Mac computer control and allow the AI to see what\'s on your display.',

  // Required plugins
  requiredPlugins: ['legion'] as ReadonlyArray<string>,
} as const;

export type Branding = typeof branding;
