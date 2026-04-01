# Legion Interlink: Electron Desktop AI Assistant

**Parent**: `/Users/miverso2/rubymine/legion/CLAUDE.md`

## What Is This?

An Electron desktop app that provides a local-first AI chat experience with tool use, MCP integration, skills, sub-agents, and memory. Built with React 19 + TypeScript + Tailwind CSS 4, orchestrated by Mastra.

**Author**: Contributed by community member
**License**: MIT
**Package Manager**: pnpm 10+
**Node**: 22+

## Commands

```bash
pnpm install          # install dependencies
pnpm dev              # start electron in dev/watch mode
pnpm build            # build main + preload + renderer
pnpm build:mac        # build + package for macOS (arm64 + x64)
pnpm lint             # eslint (ts/tsx only)
pnpm type-check       # tsc --noEmit
pnpm preview          # preview production build
pnpm rebuild          # rebuild native deps (electron-builder install-app-deps)
```

## Architecture

Three Electron process layers with strict isolation:

```
electron/main.ts          <- Main process: window, menus, IPC registration, tool init
electron/preload.ts       <- Preload: exposes `window.legion` API via contextBridge
src/App.tsx               <- Renderer: React shell, sidebar, conversations, settings
```

### Main Process (`electron/`)

| Directory | Purpose |
|-----------|---------|
| `electron/agent/` | Mastra agent orchestration, model catalog, memory, sub-agents, tokenization |
| `electron/ipc/` | IPC handler registration (agent, config, conversations, mcp, memory, oauth, skills, gaia-thread, trigger-dispatch, daemon-api, daemon-settings) |
| `electron/tools/` | Tool implementations + registry builder |
| `electron/config/schema.ts` | Zod config schema (`LegionConfig`) - central to everything |
| `electron/main.ts` | App bootstrap, window creation, menu, hot-reload for MCP + skills |

### Renderer (`src/`)

| Directory | Purpose |
|-----------|---------|
| `src/components/thread/` | Chat thread, composer, markdown, code blocks, tool groups, sub-agent views, token usage, pipeline insights, proactive messages, sidechain groups |
| `src/components/settings/` | Settings panels (models, tools, MCP, memory, compaction, skills, advanced, LLM pipeline, triggers) |
| `src/components/conversations/` | Sidebar conversation list, sub-agent section, GAIA thread entry, GAIA presence indicator, trigger workflows |
| `src/components/skynet/` | Skynet OAuth auth banner |
| `src/providers/` | React context providers (Config, Runtime, Attachments) |
| `src/lib/` | IPC client wrapper, utilities |

## Key Files

- `electron/config/schema.ts` - Zod schema defining all config (`LegionConfig` type)
- `electron/tools/registry.ts` - Builds active tool set from config, skills, MCP servers
- `electron/preload.ts` - The `window.legion` IPC bridge (renderer's only way to talk to main)
- `electron/agent/mastra-agent.ts` - Mastra agent setup and streaming
- `src/providers/RuntimeProvider.tsx` - Manages conversation streaming state in renderer
- `src/providers/ConfigProvider.tsx` - Reads/writes config via IPC
- `electron-builder.yml` - macOS packaging config
- `electron.vite.config.ts` - Vite config for main, preload, and renderer builds

## Config

All app state lives under `~/.legionio/`:

| Path | Contents |
|------|----------|
| `~/.legionio/config.json` | Primary config (models, tools, MCP, memory, compaction, etc.) |
| `~/.legionio/data/` | Conversation persistence |
| `~/.legionio/skills/` | Installed skill directories |
| `~/.legionio/certs/` | TLS certificates for integrations |
| `~/.legionio/settings/llm.json` | Imported provider/model settings |

Config changes trigger hot-reload for MCP servers and skills (fingerprint diffing in `main.ts`).

## Code Style

ESLint enforces (see `eslint.config.js`):
- `consistent-type-imports` (error) - use `import type` for type-only imports
- `no-explicit-any` (warn)
- `no-unused-vars` (warn, `_` prefix ignored)
- `no-console` (warn, `console.warn/error/info` allowed)

Additional conventions:
- Tailwind CSS 4 (PostCSS plugin, not the old `tailwind.config.js` approach)
- Radix UI primitives for all interactive components
- `@/` path alias maps to `src/`
- Lucide React for icons

## IPC Boundary

Renderer code **never** accesses Node APIs directly. All communication goes through `window.legion` (defined in `preload.ts`):

- `window.legion.agent.*` - streaming, title generation, sub-agents
- `window.legion.config.*` - get/set config, change listeners
- `window.legion.conversations.*` - CRUD, active conversation tracking
- `window.legion.mcp.*` - test MCP connections
- `window.legion.memory.*` - clear memory stores
- `window.legion.skills.*` - list/get/delete/toggle skills
- `window.legion.skynet.*` - OAuth auth flow
- `window.legion.dialog.*` - native file picker
- `window.legion.image.*` - fetch/save images (bypasses CORS)
- `window.legion.gaiaThread.*` - GAIA proactive thread (ensure, append, onNewMessage)
- `window.legion.triggerDispatch.*` - trigger workflow tracking (activeWorkflows, onWorkflowUpdate)
- `window.legion.daemon.*` - 65+ daemon API proxies (extensions, tasks, workers, triggers, GAIA, metering, structural index, tool audit, state diff, token budget, etc.)

## Model Providers

Supported via Mastra + AI SDK:
- OpenAI-compatible (custom endpoints)
- Anthropic
- Amazon Bedrock (AWS credential chain)
- Google

Config schema: `models.providers` (keyed by name) + `models.catalog` (array of model entries).

## Gotchas

- **macOS only** for now - `electron-builder.yml` only targets `mac` with `dir` output (no DMG/installer)
- **contextIsolation is ON** - never try to use `require()` or Node APIs in renderer code
- **Tailwind v4** - uses `@tailwindcss/postcss` plugin, not the v3 `tailwind.config.js` pattern
- **No test suite** - no specs or test framework currently configured
- **`sandbox: false`** in webPreferences - needed for preload script to work with full Node access
- **Conversation cleanup** - the app auto-deletes empty/abandoned conversations on switch
- **Tool registry is async** - tools build after window creation; MCP connections happen at startup
- **Daemon tool forwarding** - when using daemon backend, interlink serializes its tool schemas and sends them in the `/api/llm/inference` request body; daemon only uses tools the caller provides
- **GAIA thread** - pinned conversation with ID `__gaia_proactive__`, auto-created on first use, accumulates proactive messages from GAIA and trigger observations
- **Config persistence allowlist** - `desktopConfigPayload()` in `electron/ipc/config.ts` is an explicit allowlist; new config sections MUST be added there or they won't persist

---

**Last Updated**: 2026-04-01
