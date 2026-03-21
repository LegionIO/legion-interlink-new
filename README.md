# AITHENA

AITHENA is an Electron-based local AI assistant for coding and operator workflows. It pairs a React desktop UI with a local Electron runtime that can manage conversations, switch models, call tools, load skills, connect to MCP servers, and delegate work to sub-agents.

## What It Does

- Runs a desktop chat experience with persistent local conversations
- Supports multiple model providers, including OpenAI-compatible endpoints, Anthropic, Google, and Amazon Bedrock
- Exposes local tools for shell execution, file access, search, and settings management
- Loads user-installed skills as tools
- Connects to external MCP servers and adds their tools to the assistant
- Supports memory, context compaction, title generation, and sub-agent delegation
- Stores app data locally under `~/.legionio`

## Stack

- Electron
- React 19
- TypeScript
- Vite via `electron-vite`
- Tailwind CSS 4
- Mastra for agent orchestration and memory integration

## Project Layout

```text
legion-aithena/
├── electron/              # Electron main process, IPC handlers, tool registry, agent runtime
├── src/                   # React renderer app and settings UI
├── build/                 # App icons and packaging assets
├── scripts/               # Utility scripts
├── electron-builder.yml   # Packaging configuration
└── package.json           # Scripts and dependencies
```

## Getting Started

### Prerequisites

- Node.js 22+
- `pnpm` 10+

### Install

```bash
cd legion-aithena
pnpm install
```

### Run In Development

```bash
pnpm dev
```

This starts the Electron app with the renderer and main process in watch mode.

### Useful Commands

```bash
pnpm lint
pnpm type-check
pnpm build
pnpm preview
pnpm rebuild
```

### Packaging

```bash
pnpm build:mac
```

The current builder config is set up for macOS output in `legion-aithena/dist/`.

## Configuration

AITHENA creates and reads its local state from `~/.legionio`.

Important paths:

- `~/.legionio/config.json` - primary desktop configuration
- `~/.legionio/data/` - local app data
- `~/.legionio/skills/` - installed skills
- `~/.legionio/certs/` - certificates used by integrations
- `~/.legionio/settings/llm.json` - imported provider/model settings

On first run, the app falls back to built-in defaults and will create the required directories automatically.

## Key Features

### Models

The app maintains a model catalog plus provider settings. The current implementation supports:

- OpenAI-compatible providers
- Anthropic
- Google
- Amazon Bedrock

Users can choose a default model and switch models per conversation.

### Tools

The local tool registry can include:

- Shell execution
- File read, write, and edit
- File search and directory listing
- MCP management
- Memory and compaction settings management
- Model switching
- Sub-agent spawning
- Skill management

Tool availability is controlled by config.

### Skills

Skills are loaded from disk and can be enabled or disabled in the app. Enabled skills are exposed to the assistant as tools.

### MCP

MCP servers can be configured in settings or in `~/.legionio/config.json`. On config changes, AITHENA rebuilds the active MCP tool set.

### Memory And Compaction

The desktop runtime includes:

- Working memory
- Observational memory
- Semantic recall
- Tool output compaction
- Conversation compaction

These settings are configurable from the in-app settings panel.

### Sub-Agents

AITHENA can spawn child agents for delegated work. Limits such as nesting depth and concurrency are configurable.

## Architecture Notes

- `electron/main.ts` bootstraps the app window, menus, local directories, and IPC registration.
- `electron/ipc/` contains the bridge layer between the renderer and the main process.
- `electron/tools/registry.ts` builds the active tool set from config, skills, MCP servers, and built-in tools.
- `electron/agent/` contains model resolution, orchestration, memory helpers, and sub-agent execution.
- `src/App.tsx` defines the desktop shell, sidebar, conversation switching, and settings entry points.
- `src/components/settings/` contains the in-app configuration UI.

## Development Notes

- The app uses a preload bridge and keeps `contextIsolation` enabled.
- Renderer code talks to Electron through the `window.legion` API exposed in `electron/preload.ts`.
- Conversations and settings are persisted locally instead of relying on a hosted backend.
- External links are opened in the system browser.

## Current Status

This README reflects the app as currently wired in the repository:

- local-first desktop assistant
- configurable model catalog
- tool-enabled chat runtime
- skill loading
- MCP integration
- macOS packaging configuration

If you expand the packaging targets or add onboarding flows, this README should be updated alongside those changes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
