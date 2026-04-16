# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Claude-mem is a Claude Code plugin providing persistent memory across sessions. It captures tool usage, compresses observations using AI, and injects relevant context into future sessions. Supports Claude Code, Gemini CLI, Cursor, OpenClaw, and pi-agents.

## Build Commands

```bash
npm run build-and-sync        # Build TypeScript + hooks, sync to marketplace, restart worker
npm run build                 # Build only (no sync/restart)
bun test                      # Run test suite
npm run worker:start          # Start worker daemon
npm run worker:stop           # Stop worker daemon
npm run worker:restart        # Restart worker daemon
```

Single test: `bun test tests/path/to/test.test.ts`

## Architecture

### Data Flow: Hook → Worker → Database

```
Claude Code session
  │
  ├─ SessionStart hook ──→ GET /api/context/inject ──→ context injected to LLM
  ├─ UserPromptSubmit ───→ POST /api/sessions/init ──→ session created in SQLite
  ├─ PostToolUse ────────→ POST /api/sessions/observations ──→ queued for AI processing
  ├─ Stop ───────────────→ POST /api/sessions/summarize ──→ session summary generated
  └─ SessionEnd ─────────→ POST /api/sessions/complete ──→ session closed
```

Hooks (`src/cli/handlers/`) are TypeScript compiled to CJS, run by Bun. They communicate with the worker via HTTP on localhost:37777 (or remote worker in distributed mode).

### Worker Service

`src/services/worker-service.ts` — Express API orchestrator. Delegates to:

- **SessionRoutes** (`src/services/worker/http/routes/SessionRoutes.ts`) — session lifecycle, observation queueing
- **SearchRoutes** — hybrid FTS5 + Chroma search
- **SettingsRoutes** — user configuration CRUD with validation
- **DataRoutes, ViewerRoutes, LogsRoutes** — supporting endpoints

### AI Provider System (Observer Agents)

Three interchangeable providers process observations into structured XML:

| Provider | File | Binary needed? | Auth |
|---|---|---|---|
| Claude SDK | `src/services/worker/SDKAgent.ts` | Yes (`claude` binary) | CLI subscription or API key |
| Gemini | `src/services/worker/GeminiAgent.ts` | No | `GEMINI_API_KEY` |
| OpenRouter | `src/services/worker/OpenRouterAgent.ts` | No | `OPENROUTER_API_KEY` |

Selected via `CLAUDE_MEM_PROVIDER` setting. All agents are **observer-only** (no tool execution) to prevent loops.

OpenRouter supports configurable endpoint (`CLAUDE_MEM_OPENROUTER_BASE_URL`) and fallback chain (`CLAUDE_MEM_OPENROUTER_FALLBACK_URL/KEY/MODEL`) for resilience.

### Database Layer

`src/services/sqlite/SessionStore.ts` (~2400 lines) — core persistence with inline migrations (currently at migration 27). Uses `bun:sqlite` (not better-sqlite3).

Key tables: `sdk_sessions`, `observations`, `session_summaries`, `user_prompts`. Observations are joined to sessions via `memory_session_id` for platform/node source attribution.

### Context Injection Pipeline

`src/services/context/` — assembles context from observations + summaries:

1. **ObservationCompiler.ts** — SQL queries with type/concept/platform filtering
2. **AgentFormatter.ts** — compact flat-line format optimized for token efficiency
3. Progressive disclosure: IDs in timeline → `get_observations([IDs])` for details

### Build Pipeline

```
src/cli/handlers/*.ts ──→ esbuild ──→ plugin/scripts/*.cjs
src/services/worker-service.ts ──→ esbuild ──→ plugin/scripts/worker-service.cjs
src/servers/mcp-server.ts ──→ esbuild ──→ plugin/scripts/mcp-server.cjs
src/ui/viewer/ ──→ esbuild ──→ plugin/ui/viewer-bundle.js
```

Built artifacts in `plugin/` are committed (they ship to users). Always rebuild after source changes: `npm run build-and-sync`.

## Distributed Memory Network

Claude-mem supports a centralized worker serving multiple machines:

- **Server** (brain): runs worker on `0.0.0.0:37777` via systemd, stores SQLite + Chroma
- **Clients**: hooks send observations to remote worker via `CLAUDE_MEM_WORKER_HOST` setting
- **Node tagging**: observations tagged with `node_source` (hostname) via migration 27
- **Fallback chain**: primary endpoint → fallback endpoint → abandon (configurable)

Client setup: `CLAUDE_MEM_WORKER_HOST=<server-ip>` in `~/.claude-mem/settings.json`

## File Locations

- **Source**: `src/`
- **Built Plugin**: `plugin/`
- **Installed Plugin**: `~/.claude/plugins/marketplaces/thedotmack/` or `~/.claude/plugins/cache/thedotmack/claude-mem/<version>/`
- **Database**: `~/.claude-mem/claude-mem.db`
- **Credentials**: `~/.claude-mem/.env` (isolated from project .env — Issue #733)
- **Settings**: `~/.claude-mem/settings.json`
- **Logs**: `~/.claude-mem/logs/claude-mem-YYYY-MM-DD.log`
- **Chroma**: `~/.claude-mem/chroma/`

## Settings System

`src/shared/SettingsDefaultsManager.ts` — single source of truth for all defaults. Priority: environment variable > settings.json > hardcoded default.

All settings prefixed `CLAUDE_MEM_*`. Key groups: provider config, context display, feature toggles, process management, Chroma config.

Adding a new setting: update interface + DEFAULTS in SettingsDefaultsManager, add to settingKeys array + validation in SettingsRoutes.

## Privacy

`<private>content</private>` tags prevent storage. Stripping happens at hook layer (`src/utils/tag-stripping.ts`) before data reaches worker.

## Exit Codes

- **Exit 0**: Success or graceful shutdown
- **Exit 1**: Non-blocking error (shown to user)
- **Exit 2**: Blocking error (fed to Claude)

Worker/hook errors use exit 0 to prevent Windows Terminal tab accumulation.

## Key Conventions

- Changelog is auto-generated — never edit manually
- Database migrations are inline in SessionStore constructor, not separate files
- `memory_session_id` must NEVER equal `contentSessionId` (prevents transcript injection)
- Hooks run under Bun; Bun must be in `/usr/local/bin/` for non-interactive shells
- `plugin/scripts/*.cjs` are built artifacts — edit source in `src/`, then rebuild
- All provider credentials go in `~/.claude-mem/.env`, never in project .env files

## Pi-Agent Extension

`pi-agent/` — extends pi-mono agents with persistent memory. Published as `pi-agent-memory` on npm. Shares the same worker API as Claude Code hooks.

## Documentation

- **Public**: https://docs.claude-mem.ai (source: `docs/public/`, Mintlify)
- **Client guide**: `docs/mem-net-client-guide.md` (distributed setup)
