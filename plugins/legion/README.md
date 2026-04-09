# Legion Plugin

Legion is a Kai plugin that exercises the generic plugin platform with:

- a validated settings section
- multiple docked panels for dashboard, notifications, operations, knowledge, GitHub, marketplace, and workflows
- a generic host-registered command shortcut that opens Legion Operations with `Cmd/Ctrl+K`
- live plugin state publishing and SSE event handling
- proactive conversation creation and thread decoration
- trigger workflow routing and daemon task inspection
- an optional plugin-provided `legion` backend that mirrors the old daemon runtime semantics

## Files

- `plugin.json`: Kai plugin manifest
- `main.mjs`: main-process integration layer, daemon client, SSE routing, workflows, proactive thread handling, and backend adapter
- `renderer.mjs`: renderer bundle for settings and all Legion control surfaces

## Install In Kai

Kai loads plugins from `~/.kai/plugins/<plugin-name>`.

For local development, symlink this folder into Kai's plugin directory:

```bash
mkdir -p ~/.kai/plugins
ln -sfn ~/neo/legion-plugin ~/.kai/plugins/legion
```

Then launch Kai. The plugin will appear in Settings and as a dock item.

## Config

- `daemonUrl`: base URL for the Legion daemon
- `configDir`: optional directory containing `crypt.json` for HMAC/JWT auth
- `apiKey`: optional manual bearer token override
- `readyPath`, `healthPath`, `streamPath`, `eventsPath`: daemon endpoint overrides
- `backendEnabled`, `daemonStreaming`: backend registration and runtime behavior toggles
- `notificationsEnabled`, `nativeNotifications`, `autoConnectEvents`, `openProactiveThread`: event and proactive-thread controls
- `workspaceThreadTitle`, `proactiveThreadTitle`, `bootstrapPrompt`, `proactivePromptPrefix`: thread and message defaults
- `knowledgeRagEnabled`, `knowledgeCaptureEnabled`, `knowledgeScope`: backend knowledge flags
- `triggersEnabled`, `autoTriage`, `triageModel`, `maxConcurrentWorkflows`, `triggerRules`: trigger workflow routing settings

## Backend Contract

When enabled, the plugin registers a backend with key `legion`.

The backend posts conversation payloads to:

`<daemonUrl><streamPath>`

It preserves the old daemon-mode behavior:

- checks daemon readiness before dispatch
- forwards conversation ids, cwd, tools, reasoning effort, and knowledge flags
- prefers SSE streaming when enabled
- falls back to sync JSON responses or async task polling when the daemon answers with `202 Accepted`

The Operations panel also includes a raw daemon API explorer so the broader `/api/*` surface remains reachable without adding Legion-specific routes to Kai core.

Kai-style events can include:

- `text-delta`
- `tool-call`
- `tool-result`
- `tool-progress`
- `context-usage`
- `model-fallback`
- `enrichment`
- `error`
- `done`

## Validation

```bash
cd ~/neo/legion-plugin
node --check main.mjs
node --check renderer.mjs
```
