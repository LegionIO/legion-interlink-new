/**
 * Global compile-time constants injected by Vite's `define()` from branding.config.ts.
 *
 * Each constant corresponds to a key in `branding.config.ts`.
 * They are replaced with literal string values at build time – no runtime cost.
 */

// ── Identity ──────────────────────────────────────────────────────────────
declare const __BRAND_PRODUCT_NAME: string;
declare const __BRAND_APP_SLUG: string;
declare const __BRAND_APP_ID: string;
declare const __BRAND_EXECUTABLE_NAME: string;
declare const __BRAND_WORDMARK: string;
declare const __BRAND_DESCRIPTION: string;

// ── User-facing strings ───────────────────────────────────────────────────
declare const __BRAND_ASSISTANT_NAME: string;
declare const __BRAND_COMPOSER_PLACEHOLDER: string;
declare const __BRAND_DROP_ZONE_TEXT: string;
declare const __BRAND_ERROR_BOUNDARY_TEXT: string;

// ── Protocol & machine IDs ────────────────────────────────────────────────
declare const __BRAND_MEDIA_PROTOCOL: string;
declare const __BRAND_MCP_CLIENT_NAME: string;
declare const __BRAND_USER_AGENT: string;
declare const __BRAND_AGENT_ID: string;
declare const __BRAND_RESOURCE_ID: string;
declare const __BRAND_JWT_ISSUER: string;

// ── Build / packaging ─────────────────────────────────────────────────────
declare const __BRAND_ARTIFACT_PREFIX: string;
declare const __BRAND_MAC_CATEGORY: string;
declare const __APP_VERSION: string;

// ── Theme / visual identity ───────────────────────────────────────────────
declare const __BRAND_THEME_HUE: string;
declare const __BRAND_THEME_ACCENT_LIGHT: string;
declare const __BRAND_THEME_ACCENT_DARK: string;
declare const __BRAND_THEME_BACKGROUND: string;
declare const __BRAND_THEME_GRADIENT_TEXT: string;

// ── macOS permission-usage strings ────────────────────────────────────────
declare const __BRAND_MICROPHONE_USAGE: string;
declare const __BRAND_APPLE_EVENTS_USAGE: string;
declare const __BRAND_SCREEN_CAPTURE_USAGE: string;

// ── Required Plugins ─────────────────────────────────────────────────────
declare const __BRAND_REQUIRED_PLUGINS: ReadonlyArray<string>;
