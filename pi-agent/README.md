# pi-agent-memory

<p align="center">
  <img src="https://raw.githubusercontent.com/ArtemisAI/pi-mem/main/pi-agent/banner.png" alt="Pi-agent-memory banner" width="600">
</p>

<p align="center">
  <a href="https://github.com/thedotmack/claude-mem">
    <img src="https://img.shields.io/github/stars/thedotmack/claude-mem?style=social&label=claude-mem" alt="GitHub Stars">
  </a>
  <a href="https://github.com/thedotmack/claude-mem/network/members">
    <img src="https://img.shields.io/github/forks/thedotmack/claude-mem?style=social" alt="GitHub Forks">
  </a>
  <a href="https://www.npmjs.com/package/pi-agent-memory">
    <img src="https://img.shields.io/npm/v/pi-agent-memory.svg" alt="npm version">
  </a>
  <a href="https://github.com/thedotmack/claude-mem/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-AGPL%203.0-blue.svg" alt="License">
  </a>
</p>

> **Fork & adaptation of [claude-mem](https://github.com/thedotmack/claude-mem)** (55k+ stars, 4.4k+ forks) — the most popular persistent memory system for AI coding agents — now available as a native pi-mono extension.

Gives pi-coding-agent and any pi-mono-based runtime cross-session, cross-engine memory by connecting to claude-mem's battle-tested worker service. Same compressed memory, same hybrid search (FTS5 + Chroma vector embeddings), same cross-engine sharing — built for pi-agents.

## Why pi-agent-memory?

- **Backed by claude-mem** — the #1 memory system for AI coding agents, trusted by 55k+ developers
- **Cross-engine memory** — your pi-agent shares memory with Claude Code, Cursor, Codex, and OpenClaw sessions
- **Hybrid search** — FTS5 full-text + Chroma vector embeddings for precise memory recall
- **Zero config** — installs with one command, auto-connects to the claude-mem worker
- **Battle-tested** — built on the same worker API powering thousands of daily sessions

## Installation

Requires the claude-mem worker running on `localhost:37777`. Install claude-mem first via `npx claude-mem install` or run the worker from source.

### From npm (recommended)

```bash
pi install npm:pi-agent-memory
```

### From git

```bash
pi install git:github.com/thedotmack/claude-mem
```

### Manual

```bash
cp extensions/pi-mem.ts ~/.pi/agent/extensions/pi-mem.ts
```

### Verify

```bash
# Start pi — the extension auto-loads
pi

# Check connectivity
/memory-status
```

## What It Does

- **Captures observations** — every tool call your pi-agent makes is recorded to claude-mem's database
- **Injects context** — relevant past observations are automatically injected into the LLM context each turn
- **Memory search** — a `memory_recall` tool is registered for the LLM to explicitly search past work
- **Cross-engine sharing** — pi-agent observations live alongside Claude Code, Cursor, Codex, and OpenClaw memories in the same database

## Architecture

```text
Pi-Agent (pi-coding-agent / OpenClaw / custom)
    │
    ├── pi-mem extension (this package)
    │   ├── session_start      ──→  (local state init only)
    │   ├── before_agent_start ──→  POST /api/sessions/init (with prompt)
    │   ├── context            ──→  GET  /api/context/inject
    │   ├── tool_result        ──→  POST /api/sessions/observations
    │   ├── agent_end          ──→  POST /api/sessions/summarize
    │   │                           POST /api/sessions/complete
    │   ├── session_compact    ──→  (preserve session state)
    │   └── session_shutdown   ──→  (cleanup)
    │
    └── memory_recall tool     ──→  GET  /api/search
                                         │
                                         ▼
                            claude-mem worker (port 37777)
                            SQLite + FTS5 + Chroma
                            Shared across all engines
```

## Event Mapping

| Pi-Mono Event | Worker API | Purpose |
|---|---|---|
| `session_start` | — (local state only) | Derive project name, generate session ID |
| `before_agent_start` | `POST /api/sessions/init` | Capture user prompt for privacy filtering |
| `context` | `GET /api/context/inject` | Inject past observations into LLM context |
| `tool_result` | `POST /api/sessions/observations` | Record what tools did (fire-and-forget) |
| `agent_end` | `POST /api/sessions/summarize` + `complete` | AI-compress the session |
| `session_compact` | — | Preserve session ID across context compaction |
| `session_shutdown` | — | Clean up local state |

Derived from the OpenClaw plugin (`claude-mem/openclaw/src/index.ts`), which is a proven integration of claude-mem into a pi-mono-based runtime.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CLAUDE_MEM_PORT` | `37777` | Worker service port |
| `CLAUDE_MEM_HOST` | `127.0.0.1` | Worker service host |
| `PI_MEM_PROJECT` | (derived from cwd) | Project name for scoping observations |
| `PI_MEM_DISABLED` | — | Set to `1` to disable the extension |

## Cross-Engine Memory

All engines write to the same `~/.claude-mem/claude-mem.db`, tagged by `platform_source`:

| Engine | Platform Source |
|---|---|
| Claude Code | `claude` |
| OpenClaw | `openclaw` |
| Pi-Agent | `pi-agent` |
| Cursor | `cursor` |
| Codex | `codex` |

Context injection returns observations from all engines for the same project by default. Pass `platformSource` to filter by engine.

## Related Packages

Other independent claude-mem adapters published to npm:

- [`@ephemushroom/opencode-claude-mem`](https://www.npmjs.com/package/@ephemushroom/opencode-claude-mem) — OpenCode adapter (MIT)
- [`opencode-cmem`](https://www.npmjs.com/package/opencode-cmem) — OpenCode adapter (MIT)

Other pi memory extensions (standalone, not claude-mem based):

- [`@samfp/pi-memory`](https://www.npmjs.com/package/@samfp/pi-memory) — Learns corrections/preferences from sessions
- [`@zhafron/pi-memory`](https://www.npmjs.com/package/@zhafron/pi-memory) — Memory management + identity
- [`@db0-ai/pi`](https://www.npmjs.com/package/@db0-ai/pi) — Auto fact extraction, local SQLite

## Development

```bash
# Edit the extension
vim extensions/pi-mem.ts

# Test locally
pi -e ./extensions/pi-mem.ts

# Or install from local path
pi install ./pi-agent
```

## Credits

This package is a fork and adaptation of [**claude-mem**](https://github.com/thedotmack/claude-mem) by [@thedotmack](https://github.com/thedotmack) — the leading persistent memory system for AI coding agents. All core memory infrastructure (worker service, SQLite + FTS5 database, Chroma vector embeddings, AI-powered compression) is provided by claude-mem.

## License

AGPL-3.0 — same as [claude-mem](https://github.com/thedotmack/claude-mem/blob/main/LICENSE).
