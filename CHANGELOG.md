# Changelog

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
