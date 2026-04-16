# Project Morpheus: Memory Intelligence Architecture

> Clean-room analysis of memory consolidation patterns in agentic systems.
> Source file paths reference the Claude Code March 2026 leak for architectural context only.

---

## Table of Contents

1. [Overview](#overview)
2. [The Five Mechanisms](#the-five-mechanisms)
3. [Memory Architecture: Two-Layer Pipeline](#memory-architecture-two-layer-pipeline)
4. [AutoDream: The Consolidation Engine](#autodream-the-consolidation-engine)
5. [Context Management for Perpetual Sessions](#context-management-for-perpetual-sessions)
6. [Coordinator Mode: Multi-Agent Orchestration](#coordinator-mode-multi-agent-orchestration)
7. [Feature Flags and Gating](#feature-flags-and-gating)
8. [Architectural Comparison with claude-mem](#architectural-comparison-with-claude-mem)
9. [Key Source Files](#key-source-files)

---

## Overview

Kairos is Claude Code's unreleased always-on autonomous agent mode. It transforms Claude Code from a reactive assistant (user asks, agent responds) into a proactive daemon that:

- **Runs continuously** via a tick-based heartbeat loop
- **Self-paces** using a Sleep tool with prompt-cache-aware economics
- **Auto-backgrounds** long-running commands (>15s) to stay responsive
- **Writes memories** to append-only daily logs
- **Consolidates memories** nightly via a forked "dream" subagent
- **Coordinates workers** through a multi-agent orchestration layer

The entire system is gated behind `feature('KAIROS')` build-time flags, meaning it is physically absent from production builds — the Bun bundler eliminates dead branches at compile time.

---

## The Five Mechanisms

### Mechanism 1: The Tick Loop

When the model finishes responding and no user messages are queued, the system injects a `<tick>` message containing the current local time.

**Source:** `cli/print.ts:1835-1856`

```typescript
setTimeout(() => {
  if (
    !proactiveModule?.isProactiveActive() ||
    proactiveModule.isProactivePaused() ||
    inputClosed
  ) {
    return
  }
  const tickContent = `<tick>${new Date().toLocaleTimeString()}</tick>`
  enqueue({
    mode: 'prompt' as const,
    value: tickContent,
    uuid: randomUUID(),
    priority: 'later',
    isMeta: true,
  })
  void run()
}, 0)
```

Key design choices:
- **`setTimeout(0)`** yields to the event loop, allowing user input to preempt autonomous turns
- **`priority: 'later'`** ensures user messages always process first
- **`isMeta: true`** flags ticks for transcript filtering (they don't clutter the UI)
- **Multiple ticks may batch** into a single message — the model processes only the latest

The system prompt instructs the model:

> "You are running autonomously. You will receive `<tick>` prompts that keep you alive between turns — just treat them as 'you're awake, what now?' The time in each `<tick>` is the user's current local time."

**Source:** `constants/prompts.ts:860-914`

### Mechanism 2: The Sleep Tool

When a tick arrives and the agent has nothing useful to do, it must explicitly yield control via the Sleep tool rather than waste an API call.

**Source:** `tools/SleepTool/prompt.ts`

```
Wait for a specified duration. The user can interrupt the sleep at any time.

You may receive <tick> prompts — these are periodic check-ins. Look for useful 
work to do before sleeping.

Each wake-up costs an API call, but the prompt cache expires after 5 minutes 
of inactivity — balance accordingly.
```

The cost model is baked directly into the prompt:
- Each wake-up = one API call
- Prompt cache TTL = 5 minutes
- Agent must balance responsiveness against cost

The system prompt enforces this with a hard rule:

> "If you have nothing useful to do on a tick, you MUST call Sleep. Never respond with only a status message like 'still waiting' — that wastes a turn and burns tokens for no reason."

### Mechanism 3: Blocking Budget (15-Second Auto-Background)

Commands running longer than 15 seconds are automatically moved to the background, keeping the agent responsive for tick processing.

**Source:** `tools/BashTool/BashTool.tsx:57, 973-983`

```typescript
const ASSISTANT_BLOCKING_BUDGET_MS = 15_000;

if (feature('KAIROS') && getKairosActive() && isMainThread && 
    !isBackgroundTasksDisabled && run_in_background !== true) {
  setTimeout(() => {
    if (shellCommand.status === 'running' && backgroundShellId === undefined) {
      assistantAutoBackgrounded = true;
      startBackgrounding('tengu_bash_command_assistant_auto_backgrounded');
    }
  }, ASSISTANT_BLOCKING_BUDGET_MS).unref();
}
```

- `.unref()` prevents the timer from keeping the Node process alive
- Only triggers in Kairos mode on the main thread
- The command continues running — no state is lost
- Agent gets a notification: "Command exceeded the assistant-mode blocking budget (15s) and was moved to background"

The same logic exists in `tools/PowerShellTool/PowerShellTool.tsx:162`.

### Mechanism 4: Append-Only Daily Logs

Instead of maintaining a single `MEMORY.md` file, Kairos sessions write memories as timestamped bullets appended to date-named log files.

**Source:** `memdir/memdir.ts:318-370`

```
Path pattern: <autoMemPath>/logs/YYYY/MM/YYYY-MM-DD.md
```

The system prompt for assistant-mode memory:

> "This session is long-lived. As you work, record anything worth remembering by **appending** to today's daily log file."
>
> "Do not rewrite or reorganize the log — it is append-only. A separate nightly process distills these logs into `MEMORY.md` and topic files."

**What to log:**
- User corrections and preferences ("use bun, not npm")
- Facts about the user, their role, or goals
- Project context not derivable from code (deadlines, incidents, decisions)
- Pointers to external systems (dashboards, Linear projects)
- Anything the user explicitly asks to remember

**What NOT to log** (same exclusions as standard auto-memory):
- Code patterns, architecture, file paths (derivable from codebase)
- Git history (git log/blame is authoritative)
- Debugging solutions (fix is in the code)
- Anything in CLAUDE.md files
- Ephemeral task state

**Cache-aware design:** The daily log path uses a pattern (`YYYY/MM/YYYY-MM-DD.md`) rather than today's literal date because this prompt is cached by `systemPromptSection('memory', ...)`. The model derives the current date from a `date_change` attachment appended at midnight rollover — the prompt itself stays stale to preserve the cache prefix.

### Mechanism 5: SendUserMessage

All user-facing output routes through `SendUserMessage`. Text outside this tool exists only in expandable detail views.

**Status field** distinguishes:
- `'normal'`: Replies to user messages
- `'proactive'`: Unsolicited background updates

The status drives notification behavior — whether to ping the user or silently log.

**Three-tier rendering:**
1. **Brief-only mode:** Only SendUserMessage blocks + user input visible
2. **Default mode:** Tool calls visible, but redundant assistant text dropped
3. **Transcript mode (ctrl+o):** Completely unfiltered

### How They Compose: The Runtime Cycle

The five mechanisms wire together via the system prompt:

```
1. Tick arrives → Agent checks for pending work
2. Work exists → Execute (blocking budget auto-backgrounds long ops)
3. Observations → Logged to daily append-only file
4. Results → Sent through SendUserMessage with status flag
5. No work → Invoke Sleep with cache-aware duration
6. Queue empties → Next tick scheduled
```

**Terminal focus calibration** adds a sixth dimension:
- **Unfocused**: Lean into autonomous action — make decisions, commit, push
- **Focused**: More collaborative — surface choices, ask before large changes

---

## Memory Architecture: Two-Layer Pipeline

Claude Code's memory system operates in two layers that run concurrently:

### Layer 1: Extract Memories (Per-Turn Background Agent)

Runs at the end of each query loop when the model produces a final response with no tool calls.

**Source:** `services/extractMemories/extractMemories.ts`

**Trigger:** Called from `handleStopHooks()` in `query/stopHooks.ts`

**Gate chain (cheapest first):**
1. GrowthBook flag `tengu_passport_quail` must be true
2. Auto-memory enabled
3. Not in remote mode
4. Only main agent, not subagents

**Throttle:** Runs every N turns (configured by `tengu_bramble_lintel`, default 1)

**Mutual exclusion with main agent:**
- If the main agent wrote memories this turn → skip extraction, advance cursor
- Main and background agents are mutually exclusive per turn

**Forked agent constraints:**
- Read-only bash only (ls, find, grep, cat, stat, wc, head, tail)
- Edit/Write restricted to memory directory only
- maxTurns = 5 (well-behaved extractions complete in 2-4)
- skipTranscript = true (no race conditions with main thread)
- Shares parent's prompt cache params

**Coalescing:** If extraction is already in progress when another fires, it stashes the context. After the current extraction finishes, it runs a trailing extraction with the latest stashed context only.

### Layer 2: AutoDream (Nightly Consolidation)

The heavier consolidation that synthesizes accumulated sessions into durable, organized memories.

**Source:** `services/autoDream/autoDream.ts`

**Gate chain (cheapest first):**
1. **Enable gate:** Not Kairos-active, not remote, auto-memory enabled, AutoDream feature enabled
2. **Time gate:** Hours since last consolidation >= minHours (default: 24)
3. **Scan throttle:** Don't rescan sessions within 10 minutes of last scan
4. **Session gate:** Session count since last consolidation >= minSessions (default: 5)
5. **Lock gate:** No other process mid-consolidation (PID-based, 1h stale threshold)

Note: The enable gate checks `!getKairosActive()` — Kairos mode uses a disk-skill `/dream` instead of the automatic trigger. AutoDream is for standard (non-perpetual) sessions.

---

## AutoDream: The Consolidation Engine

### The Four-Phase Pipeline

**Source:** `services/autoDream/consolidationPrompt.ts`

The consolidation prompt begins:

> "You are performing a dream — a reflective pass over your memory files. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly."

#### Phase 1 — Orient

```
- ls the memory directory to see what already exists
- Read MEMORY.md to understand the current index
- Skim existing topic files so you improve them rather than creating duplicates
- If logs/ or sessions/ subdirectories exist, review recent entries there
```

#### Phase 2 — Gather Recent Signal

```
Sources in rough priority order:
1. Daily logs (logs/YYYY/MM/YYYY-MM-DD.md) — the append-only stream
2. Existing memories that drifted — facts that contradict the codebase now
3. Transcript search — grep JSONL transcripts for narrow terms only
```

The prompt explicitly warns: "Don't exhaustively read transcripts. Look only for things you already suspect matter."

#### Phase 3 — Consolidate

```
- Merge new signal into existing topic files (no near-duplicates)
- Convert relative dates to absolute dates for durability
- Delete contradicted facts — fix at the source
```

Uses the memory file format with frontmatter:

```markdown
---
name: {{memory name}}
description: {{one-line description}}
type: {{user, feedback, project, reference}}
---

{{memory content}}
```

#### Phase 4 — Prune and Index

```
- Update MEMORY.md to stay under 200 lines AND under ~25KB
- Each entry: one line, ~150 chars: `- [Title](file.md) — one-line hook`
- Remove stale/wrong/superseded pointers
- Demote verbose entries (move detail to topic files)
- Resolve contradictions between files
```

### The Lock Mechanism

**Source:** `services/autoDream/consolidationLock.ts`

The lock file (`.consolidate-lock`) serves double duty:
- **Its mtime** = timestamp of last successful consolidation
- **Its content** = PID of the current holder

```
Lock lifecycle:
  Acquire → write PID, mtime = now
  Success → mtime stays (indicates when consolidation ran)
  Failure → rollbackConsolidationLock(priorMtime) rewinds mtime
  Crash   → mtime stuck, dead PID → next process reclaims after 1 hour
```

Race detection uses a two-phase write-then-verify pattern:

```typescript
// Two reclaimers both write → last wins the PID. Loser bails on re-read.
await writeFile(path, String(process.pid))
const verify = await readFile(path, 'utf8')
if (parseInt(verify.trim(), 10) !== process.pid) return null
```

### Execution as Forked Agent

When all gates pass, AutoDream spawns a forked subagent:

```typescript
const result = await runForkedAgent({
  promptMessages: [createUserMessage({ content: prompt })],
  cacheSafeParams: createCacheSafeParams(context),
  canUseTool: createAutoMemCanUseTool(memoryRoot),
  querySource: 'auto_dream',
  forkLabel: 'auto_dream',
  skipTranscript: true,
  overrides: { abortController },
  onMessage: makeDreamProgressWatcher(taskId, setAppState),
})
```

- **Read-only bash** (ls, find, grep, cat, stat, wc, head, tail)
- **Edit/Write** restricted to memory directory
- **skipTranscript = true** prevents race conditions with main thread
- **Progress watcher** extracts text blocks and tracks touched file paths
- **DreamTask** makes the process visible in the UI footer

On completion, an inline message surfaces what was consolidated:

```typescript
appendSystemMessage({
  ...createMemorySavedMessage(dreamState.filesTouched),
  verb: 'Improved',
})
```

On failure, the lock is rolled back so the time gate passes again on the next attempt. The scan throttle (10 minutes) acts as natural backoff.

---

## Context Management for Perpetual Sessions

Kairos sessions are effectively infinite, making aggressive context management critical. Claude Code uses a 4-tier compaction hierarchy:

### Tier 1: Snip Compact (Free, High Info Loss)

- Discards entire system/progress message blocks
- Feature-gated: `HISTORY_SNIP`
- Preserves prompt cache integrity

### Tier 2: Microcompact (Free, Medium Loss)

- Selectively clears individual tool result content
- **Cache edit block pinning**: Tracks which results fall within cached prefix ranges, defers clearing to later turns when cache positions shift
- Prevents unnecessary cache invalidation

### Tier 3: Context Collapse (Low Cost, Low Loss)

- Read-time projection model — original messages remain unchanged
- Collapsed summaries stored separately
- Triggers at 90% of autocompact threshold
- Blocks query at 95% to prevent API 413 errors
- Suppresses autocompact when active (owns the headroom)

### Tier 4: AutoCompact (High Cost, Lowest Loss)

- Full conversation AI summarization
- Triggers at `effectiveWindow - 13,000 tokens`
- Circuit breaker: stops retrying after 3 consecutive failures
- Kairos integration writes transcript segments for session recovery:

```typescript
if (feature('KAIROS')) {
  void sessionTranscriptModule?.writeSessionTranscriptSegment(messages)
}
```

### Diminishing Returns Detection

The loop detects when it's stuck producing minimal output:

```typescript
const isDiminishing =
  tracker.continuationCount >= 3 &&
  deltaSinceLastCheck < 500 &&  // DIMINISHING_THRESHOLD
  tracker.lastDeltaTokens < 500
```

If the model continues 3+ times producing under 500 tokens each, it terminates even with remaining budget.

---

## Coordinator Mode: Multi-Agent Orchestration

Kairos extends into multi-agent coordination through Coordinator Mode.

**Source:** `coordinator/coordinatorMode.ts`

### Architecture

- **Coordinator** (primary): Manages workers, synthesizes results, communicates with user
- **Workers** (spawned): Autonomous agents executing tasks in parallel via `AgentTool`
- Workers cannot see coordinator's conversation history

### Coordinator's Tool Set (Strictly Limited)

| Tool | Purpose |
|------|---------|
| `AgentTool` | Spawn worker agents |
| `TaskStopTool` | Cancel running workers |
| `SendMessageTool` | Continue/redirect workers, broadcast |
| `SyntheticOutputTool` | Internal output formatting |

### Worker Communication

Workers report back via `<task-notification>` XML blocks:

```xml
<task-notification>
  <task-id>{agentId}</task-id>
  <status>completed|failed|killed</status>
  <summary>{human-readable status}</summary>
  <result>{agent's final text response}</result>
  <usage>
    <total_tokens>N</total_tokens>
    <tool_uses>N</tool_uses>
    <duration_ms>N</duration_ms>
  </usage>
</task-notification>
```

### Scratchpad: Cross-Worker Knowledge

Feature-gated by `tengu_scratch`, the scratchpad provides durable cross-worker storage:

- Workers read/write without permission prompts
- Path injected via dependency injection from `QueryEngine.ts`
- Enables knowledge sharing between workers without going through the coordinator

### Agent Triggers (Cron-Based Autonomous Tasks)

**Source:** `utils/cronTasks.ts`

Stored in `.claude/scheduled_tasks.json`:

```json
{
  "tasks": [{
    "id": "task-uuid",
    "cron": "M H DoM Mon DoW",
    "prompt": "The prompt to enqueue when task fires",
    "recurring": true,
    "permanent": false
  }]
}
```

- One-shot tasks fire with backward jitter (up to 90s early)
- Recurring tasks spread with forward jitter (0.1 * interval, capped at 15min)
- Auto-expire after 7 days unless marked permanent
- Missed one-shot tasks surfaced to user on startup
- Max 50 jobs

### UDS Inbox: Multi-Device Messaging

Feature-gated by `UDS_INBOX`, enables cross-session and cross-device agent communication:

```typescript
// Address parsing
"uds:<socket-path>"    → Unix Domain Socket (local peer)
"bridge:<session-id>"  → Remote Control peer via bridge protocol
"<name>"               → In-process teammate
"*"                    → Broadcast to all
```

### Remote Triggers

Feature-gated by `tengu_surreal_dali`, enables scheduled agent execution on Anthropic's cloud infrastructure (CCR — Compute and Code Review).

---

## Feature Flags and Gating

| Flag | Purpose | Default |
|------|---------|---------|
| `KAIROS` | Master gate for autonomous mode | Build-time |
| `PROACTIVE` | Proactive tick loop + sleep | Build-time |
| `COORDINATOR_MODE` | Multi-agent orchestration | Env var |
| `KAIROS_GITHUB_WEBHOOKS` | GitHub PR subscription tool | Build-time |
| `KAIROS_PUSH_NOTIFICATION` | Push notification tool | Build-time |
| `KAIROS_BRIEF` | Brief mode proactive section | Build-time |
| `tengu_onyx_plover` | AutoDream enable + config (minHours, minSessions) | GrowthBook |
| `tengu_passport_quail` | Extract-memories background agent | false |
| `tengu_bramble_lintel` | Extract throttle (every N turns) | 1 |
| `tengu_scratch` | Cross-worker scratchpad | GrowthBook |
| `tengu_moth_copse` | Skip MEMORY.md in system prompt (use attachments) | false |
| `tengu_coral_fern` | Enable transcript search guidance | false |
| `tengu_herring_clock` | Team memory (shared across users) | GrowthBook |
| `tengu_ccr_bridge` | Remote bridge WebSocket tunnel | GrowthBook |
| `tengu_surreal_dali` | Remote triggers on CCR | GrowthBook |
| `AGENT_TRIGGERS` | Cron create/delete/list tools | Build-time |
| `UDS_INBOX` | Multi-device messaging | Build-time |

Build-time flags use Bun's `feature()` function — the bundler evaluates them at compile time and eliminates entire code branches. Runtime GrowthBook flags are server-controlled switches that can be toggled without client updates.

---

## Architectural Comparison with claude-mem

### The Same Core Pattern

Both systems converge on the same fundamental architecture:

```
Raw signals → Append-only log → AI consolidation → Indexed store → Context injection
```

| Aspect | Claude Code (Kairos) | claude-mem |
|--------|---------------------|------------|
| **Signal capture** | PostToolUse in-process | PostToolUse hook → HTTP POST |
| **Raw storage** | Daily log files (`logs/YYYY/MM/DD.md`) | PendingMessageStore queue |
| **AI consolidation** | AutoDream forked subagent (Orient→Gather→Consolidate→Prune) | OpenRouter/Nemotron agent extraction |
| **Indexed store** | Topic `.md` files + `MEMORY.md` index | SQLite + ChromaSync vector embeddings |
| **Context injection** | System prompt section from `claudemd.ts` | SessionStart hook injects timeline |
| **Dedup** | Merge into existing topic files | SHA256 content hash, 30s window |
| **Scope** | Single machine, single agent | Network, multi-agent |
| **Consolidation trigger** | 24h + 5 sessions gate | Every tool use (real-time) |
| **Search** | `grep` over `.md` files + JSONL transcripts | HTTP API + Chroma semantic search |

### Where They Diverge

**Scope:**
- Kairos solves **single-agent continuity** — one agent remembering across sessions on one machine
- claude-mem solves **multi-agent shared memory** — N agents contributing to and querying one pool

**Topology:**
- Kairos is **local-first** — everything runs in-process or as a forked subagent
- claude-mem is **network-first** — hub-and-spoke over Tailscale mesh

**Consolidation strategy:**
- Kairos uses **batch consolidation** — accumulate for 24h, then dream
- claude-mem uses **stream processing** — compress each observation in near-real-time

**Storage:**
- Kairos uses **flat files** — `.md` files with a `MEMORY.md` index, line-count capped at 200
- claude-mem uses **structured storage** — SQLite with typed columns + Chroma vector embeddings

### Lessons from Kairos for claude-mem

1. **The tick/sleep cost model**: The 5-minute prompt cache TTL awareness could apply to our worker — enter low-power mode after 270s idle, suspend agent after 20min

2. **Append-only daily logs as separate table**: Keep raw observations in addition to compressed ones — it's the write-ahead log that makes consolidation recoverable

3. **The 4-phase consolidation prompt**: Orient→Gather→Consolidate→Prune is a better-structured approach than our single-pass extraction. Could improve observation quality.

4. **Lock-based concurrency**: The PID-based lock with mtime-as-timestamp is elegant for preventing concurrent consolidation — simpler than our claim-confirm queue for the consolidation case

5. **Mutual exclusion between real-time and batch**: When the user writes memories directly, skip background extraction. Prevents conflicts.

### claude-mem's Advantages

1. **Network topology**: Already solves multi-node; Kairos is single-machine
2. **Vector search**: ChromaSync provides semantic retrieval; Kairos relies on grep
3. **Provider flexibility**: OpenRouter + fallback chain avoids Anthropic API lock-in
4. **Separation of concerns**: Standalone worker service vs. embedded in client
5. **Real-time processing**: ~8 second pipeline vs. 24-hour batch

---

## Key Source Files

### Kairos Core
| File | Lines | Purpose |
|------|-------|---------|
| `constants/prompts.ts:860-914` | 55 | Autonomous work system prompt |
| `tools/SleepTool/prompt.ts` | 18 | Sleep tool definition + cache cost model |
| `tools/BashTool/BashTool.tsx:57,973-983` | — | 15s blocking budget auto-background |
| `cli/print.ts:1835-1856` | 22 | Tick loop generation |
| `bootstrap/state.ts:1085-1091` | 7 | `getKairosActive()` / `setKairosActive()` |

### Memory System
| File | Lines | Purpose |
|------|-------|---------|
| `services/autoDream/autoDream.ts` | 326 | AutoDream orchestrator (gates, fork, progress) |
| `services/autoDream/consolidationPrompt.ts` | 67 | 4-phase dream prompt |
| `services/autoDream/consolidationLock.ts` | 142 | PID lock + mtime-as-timestamp |
| `services/autoDream/config.ts` | 23 | GrowthBook config reader |
| `services/extractMemories/extractMemories.ts` | 617 | Per-turn background extraction |
| `memdir/memdir.ts` | 509 | Memory prompt building + daily log prompt |
| `memdir/memoryTypes.ts` | 273 | 4-type taxonomy + frontmatter format |
| `memdir/paths.ts` | 280 | Path resolution + daily log pattern |
| `memdir/memoryScan.ts` | 96 | Memory directory scanning |
| `utils/claudemd.ts` | 1,481 | CLAUDE.md loading + memory injection |

### Context Management
| File | Lines | Purpose |
|------|-------|---------|
| `query.ts` | 1,730 | 6-stage per-turn pipeline |
| `QueryEngine.ts` | 1,298 | Session supervisor |
| `services/compact/autoCompact.ts` | 353 | AI summarization compaction |
| `services/compact/compact.ts` | ~900 | Full compaction preprocessing |
| `services/compact/microCompact.ts` | 531 | Cache-aware tool result clearing |
| `query/tokenBudget.ts` | 95 | Diminishing returns detection |

### Coordinator & Multi-Agent
| File | Lines | Purpose |
|------|-------|---------|
| `coordinator/coordinatorMode.ts` | ~370 | Coordinator system prompt + activation |
| `tools/AgentTool/AgentTool.tsx` | — | Worker spawning + background logic |
| `tools/SendMessageTool/SendMessageTool.ts` | — | Inter-agent + cross-device messaging |
| `utils/cronTasks.ts` | — | Cron-based autonomous triggers |
| `tools/RemoteTriggerTool/RemoteTriggerTool.ts` | — | Cloud-based scheduled agents |
| `tasks/DreamTask/DreamTask.ts` | 159 | Dream task UI state + kill handling |

---

## Project Morpheus: Implementation Roadmap

Project Morpheus brings clean-room memory intelligence to claude-mem, addressing the missing post-storage intelligence layer. All issues tracked at [ArtemisAI/pi-mem-dev](https://github.com/ArtemisAI/pi-mem-dev).

### Issue Map

| # | Issue | Concept Origin | Effort | Impact |
|---|-------|---------------|--------|--------|
| [#6](https://github.com/ArtemisAI/pi-mem-dev/issues/6) | Quality Gating | "What NOT to save" taxonomy | Low | High |
| [#7](https://github.com/ArtemisAI/pi-mem-dev/issues/7) | Semantic Dedup | Merge into existing rather than creating near-duplicates | Low | High |
| [#8](https://github.com/ArtemisAI/pi-mem-dev/issues/8) | Contradiction Detection | Delete contradicted facts, fix at source | Low | Medium |
| [#9](https://github.com/ArtemisAI/pi-mem-dev/issues/9) | Staleness Scoring | Time-aware relevance decay with type weighting | Medium | High |
| [#10](https://github.com/ArtemisAI/pi-mem-dev/issues/10) | Consolidation Job | Orient-Gather-Consolidate-Prune batch pipeline | High | Highest |
| [#11](https://github.com/ArtemisAI/pi-mem-dev/issues/11) | Date Normalization | Convert relative dates to absolute at storage time | Low | Low |
| [#12](https://github.com/ArtemisAI/pi-mem-dev/issues/12) | Session Retrospective | End-of-session "what went wrong" meta-learning | Medium | Medium |

### Dependency Graph

```
Quality Gating (#6) ──────────────┐
Date Normalization (#11) ─────────┤
                                  ├── Semantic Dedup (#7)
Contradiction Detection (#8) ─────┤
                                  ├── Staleness Scoring (#9)
                                  │
                                  └── Consolidation Job (#10)

Session Retrospective (#12) ──────── (independent, parallel track)
```

### Implementation Phases

**Phase A — Foundation (low effort, immediate gains):**
- #6 Quality Gating + #11 Date Normalization + #8 Contradiction Detection
- These are all changes to `ResponseProcessor.ts` and `sdk/prompts.ts`
- Can be implemented together in a single PR
- Expected: ~30% observation volume reduction, elimination of contradicted-fact poisoning

**Phase B — Intelligence (medium effort):**
- #7 Semantic Dedup + #9 Staleness Scoring
- Requires migration 26 (shared across both)
- Depends on Chroma being healthy (`queryChroma()` integration)
- Expected: context injection returns 2-3x more relevant observations

**Phase C — Consolidation (high effort, capstone):**
- #10 Periodic Consolidation Job
- New `ConsolidationService` with its own migration (27)
- Builds on all Phase A and B features
- Expected: 5-10x reduction in observation count for mature projects

**Phase D — Meta-Learning (parallel track):**
- #12 Session Retrospective
- Independent of Phases A-C, can be developed in parallel
- New observation type + prompt + PendingMessageStore extension

### Schema Migrations

**Migration 26** (shared across Phase A + B):
```sql
-- Contradiction Detection (#8)
ALTER TABLE observations ADD COLUMN superseded_by INTEGER REFERENCES observations(id);
ALTER TABLE observations ADD COLUMN superseded_at TEXT;
ALTER TABLE observations ADD COLUMN superseded_reason TEXT;

-- Staleness Scoring (#9)
ALTER TABLE observations ADD COLUMN relevance_score REAL DEFAULT 1.0;
CREATE INDEX idx_observations_relevance ON observations(relevance_score DESC);

-- Semantic Dedup (#7)
ALTER TABLE observations ADD COLUMN updated_at TEXT;
ALTER TABLE observations ADD COLUMN merge_count INTEGER DEFAULT 0;
```

**Migration 27** (Phase C):
```sql
ALTER TABLE observations ADD COLUMN consolidated_into INTEGER REFERENCES observations(id);
ALTER TABLE observations ADD COLUMN is_consolidated_digest BOOLEAN DEFAULT 0;

CREATE TABLE consolidation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  observations_input INTEGER NOT NULL,
  observations_output INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_at_epoch INTEGER NOT NULL
);
```

### Cross-References to Upstream

| Morpheus Issue | Upstream Issue | Relationship |
|---------------|----------------|--------------|
| #10 Consolidation | thedotmack/claude-mem#2005 Compiled Truth | Direct implementation path |
| #9 Staleness | thedotmack/claude-mem#2014 Thompson Sampling | Complementary scoring |
| #7 Semantic Dedup | thedotmack/claude-mem#2003 Entity Detection | Shared vector infrastructure |
