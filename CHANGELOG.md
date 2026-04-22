# Changelog

## [1.1.6] - 2026-04-22

### Changed
- Model catalog now fetched from daemon `/v1/models` endpoint instead of requiring manual config in `~/.legionio/config.json`; discovers all models the daemon has valid credentials for at runtime
- Falls back to `/api/llm/providers` (default model per provider) when `/v1/models` is unavailable, then to local config catalog if daemon is unreachable
- Exposed `daemon:llm-models` IPC handler for direct `/v1/models` access from renderer

## [1.1.5] - 2026-04-21

### Fixed
- `MessageTimestamp` crashes with `date.toDateString is not a function` when `message.createdAt` is a string or number instead of a `Date` object (e.g. after conversation restore from JSON persistence)
- `ProactiveMessage` timestamp rendering crashes on invalid date strings
- Proactive message fallback in `Thread.tsx` calls `.toISOString()` on string `createdAt` values from deserialized messages
- `ConversationList.formatRelativeTime` returns garbage on malformed timestamp strings

## [1.1.4] - 2026-04-17

### Performance
- Removed unused `ComposerBackdrop` dead code; no shipped runtime behavior change for composer backdrop handling (#24)
- `Thread`: matrix canvas animation now pauses on `visibilitychange`/window `blur` and resumes on focus; frame interval throttled from 65ms (~15fps) to 130ms (~8fps) (#25)
- `ConversationList`: replaced 1500ms `setInterval` polling with `conversations:changed` IPC push subscription — eliminates 40+ IPC round-trips/min for users with large conversation history (#26)
- `ConfigProvider`: context value wrapped in `useMemo`, `updateConfig` stabilized with `useCallback` — stops cascading re-renders across all settings consumers on every config update
- `ElapsedBadge`: replaced N independent 100ms per-badge intervals with a single shared 500ms module-level ticker — one `setInterval` for all running tool badges combined
- `GaiaPresenceIndicator`: GAIA status poll interval increased from 10s to 30s (always-mounted sidebar component; status changes infrequently)

### Security
- Replaced `Math.random()` with `crypto.getRandomValues()` for observer session IDs (`electron/ipc/agent.ts`) and computer-use session IDs (`shared/computer-use.ts`) — fixes insecure randomness in security-sensitive ID generation (#8, #9)
- Guarded `setNestedValue` (`electron/ipc/config.ts`) and `setNested` (`electron/tools/config-manage.ts`) against prototype pollution — path segments `__proto__`, `constructor`, and `prototype` are now rejected; traversal uses `hasOwnProperty` (#10, #11)
- Fixed incomplete HTML sanitization in `web-fetch` tool: script/style regexes now match whitespace before closing `>` (e.g. `</script  >`), and HTML comments are explicitly stripped before tag removal (#2, #3, #7)
- Fixed incomplete HTML sanitization in `web-search` tool: title/snippet stripping now uses a full pipeline (script → style → comments → tags) instead of a single tag-only pass (#4, #5)
- Fixed incomplete HTML comment stripping in `CodeBlock` HTML minification: added second pass to remove unclosed `<!--` fragments left by malformed HTML (#6)

## [1.1.3] - 2026-04-17

### Fixed
- `stringifyValue` in `electron/agent/app-runtime.ts` now passes string values through directly instead of calling `JSON.stringify` on them, preventing double-encoding artifacts (`\"some text\"`) in LLM context
- `formatResult` in `src/components/thread/ToolGroup.tsx` guards against the same double-encoding on the display path after `sanitizeResultForDisplay` unwrapping

## [1.1.2] - 2026-04-12

### Added
- `DaemonChatClient` — HTTP + SSE client for `/api/llm/inference` and `/api/skills/*` daemon endpoints, replacing direct local skill execution in Interlink

### Changed
- Skills IPC (`electron/ipc/skills.ts`) rewritten to delegate all skill operations to the Legion daemon instead of executing locally; list, show, and run now proxy through `DaemonChatClient`

## [1.1.0] - 2026-04-09

### Removed
- Standalone Mastra agent runtime — all inference now requires the Legion daemon
- Direct LLM provider integrations (OpenAI, Anthropic, Bedrock, Azure language-model factory)
- Client-side compaction, tokenization, and memory system (daemon handles its own context)
- Tool observer (secondary LLM monitoring tool execution)
- Title generation via direct LLM calls
- Mastra instance and workflow engine
- kai-desktop builder pattern and plugin files

### Added
- Daemon circuit breaker: when health check fails, all non-health requests short-circuit instantly for 10s, dramatically reducing idle CPU
- HUNG tool state: tools that never receive a result are marked with an amber "HUNG" badge instead of ticking RUNNING forever
- Persisted conversation repair: old conversations with stuck tools are fixed on load
- Thread archive: archive/unarchive threads instead of deleting them, with sidebar toggle to view archived
- Right-click context menu on threads: rename, archive, export, delete
- Inline thread rename from context menu or sidebar
- Export dialog accessible from context menu
- Drag-and-drop files now include full filesystem path in the message
- New conversations default working directory to user home (`~/`) instead of null
- Tool path resolution defaults to home directory when no cwd is set

### Changed
- CI/CD workflow: auto-build and release on push to main, run checks on PRs, skip release if tag exists
- Chat thread max-width widened from 1024px to 1600px to reduce wasted space on large screens
- Message spacing tightened (12px gaps instead of 24-32px) for denser thread view
- Settings panel: removed dead sections (Models, Profiles, Memory, Compaction, Advanced, Sub-Agents)
- Settings panel: flattened daemon settings to top-level — no more nested collapsible group

## [1.0.18] - 2026-04-07

### Added
- Server-computed `durationMs` for tool calls — eliminates 0ms display on sub-second tools
- Token usage extraction from daemon `done` payload, emitted as `context-usage` event
- `model-fallback` SSE event handling — model selector updates to reflect actual model used after pipeline fallback
- `conversation_id` forwarded to daemon SSE requests

### Changed
- Tool timing prefers explicit `startedAt`/`finishedAt`/`durationMs` from daemon over generic timestamp field
- Completed tools enforce minimum 1ms display instead of showing 0ms

## [1.0.17]

### Added
- 18 daemon IPC proxies for v1.7.0 endpoints (structural index, tool audit, state diff, session search, triggers CRUD, token budget, native dispatch, context curation)
- Zod config schemas for 7 daemon LLM settings (context curation, debate, prompt caching, token budget, provider layer, tier routing, escalation)
- GAIA presence indicator in sidebar (online/dream/offline status dot with tooltip)
- Token usage display on assistant messages (input/output/cache token counts, collapsible)
- Pipeline insights rendering for debate enrichments and context curation metadata
- LLM Pipeline settings panel with 7 collapsible sections and live daemon status
- Proactive messaging with layered delivery (toast notifications, inline injection, pinned GAIA thread)
- Native Electron notifications for proactive messages when app is backgrounded
- Pinned GAIA thread in sidebar for accumulating proactive messages and trigger observations
- Conditional message chain architecture (daemon mode uses legion-llm parent-link chains with sidechains, mastra mode keeps existing messageTree)
- Sidechain grouping and rendering for daemon-originated sub-agent messages
- Trigger dispatch system with rule-based triage (ignore/observe/act) and GAIA integration
- Trigger workflow sidebar section with source icons, status indicators, auto-dismiss
- Trigger rules settings panel with CRUD editor, concurrency control, approval mode
- Tool schema forwarding to daemon `/api/llm/inference` endpoint so daemon mode has access to interlink's file, shell, web, and MCP tools
- Triggers config schema with rule definitions and persistence

### Fixed
- Knowledge config (RAG Context, Knowledge Capture, Scope) not persisting — `knowledge` was missing from `desktopConfigPayload` allowlist
- New config sections (`daemonLlm`, `proactiveMessaging`, `messageChains`, `triggers`) added to persistence allowlist
- Conversation title not updating when switching conversations (showed "New Conversation" instead of actual title)
- GAIA thread IPC handlers not registered in main process
- GAIA thread and presence indicator not mounted in sidebar
- Governance approvals panel crashing when daemon returns non-array response
