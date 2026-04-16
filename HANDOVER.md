# Project Morpheus — Agent Handover

## What Is This

Project Morpheus adds a post-storage memory intelligence layer to claude-mem. 7 features that improve observation quality, reduce noise, and consolidate accumulated memories. The name "Morpheus" is a pseudonym — never use the upstream Claude Code feature name.

## Current State

### Branch: `feat/morpheus` (pushed to both origin and pi-mem-dev)

**Completed:**
- Architecture doc: `docs/morpheus-architecture.md` (742 lines — full analysis + roadmap)
- 7 GitHub issues on ArtemisAI/pi-mem-dev (#6-#12, labeled `morpheus`)
- Phase E RL research issue (#28)
- **Step 1 DONE:** Date Normalization committed and pushed (`db6bc321`)

**In Progress (Step 2-7 not started):**
| Step | Feature | Status | Migration |
|------|---------|--------|-----------|
| 1 | Date Normalization (#11) | DONE | None |
| 2 | Quality Gating (#6) | Not started | None |
| 3 | Contradiction Detection (#8) | Not started | 28 |
| 4 | Staleness Scoring (#9) | Not started | 29 |
| 5 | Semantic Dedup (#7) | Not started | 30 |
| 6 | Consolidation Job (#10) | Not started | 31 |
| 7 | Retrospective (#12) | Not started | None (PendingMessageStore enum) |

### Copilot PRs (reference only — all have bugs)

7 PRs on pi-mem-dev with real code but all need fixes:

| PR | Feature | Key Bugs |
|----|---------|----------|
| #21 | Quality Gating | Dead code (`hasOnlyFileListings` unreachable), overly broad git log regex |
| #22 | Semantic Dedup | Migration collision (claims 26), sync→async signature change, transactions.ts gap |
| #23 | Contradiction Detection | Migration collision (claims 26), dead `supersededByObservationIndex` code |
| #24 | Staleness Scoring | Migration collision (claims 26), no tests for decay logic, full table scan |
| #25 | Consolidation Job | SessionSearch missing filter, no stale-lock recovery, no AI digest (mechanical merge only) |
| #26 | Date Normalization | Missing 4/6 patterns — **FIXED in feat/morpheus already** |
| #27 | Retrospective | **BLOCKER:** Feature non-functional (type not in mode config), ranking regression |

Old Copilot PRs (#13-19) are stale — just pi-agent rebrand diffs, no Morpheus code.

## Approved Plan

Full plan at: `/home/artemisai/.claude/plans/joyful-yawning-donut.md`

**Approach:** Cherry-pick Copilot commits onto feat/morpheus, fix bugs, renumber migrations, commit after each step.

## Critical Constraints

### 1. Dev DB Only — NEVER touch prod
- **Dev DB:** `~/.claude-mem-dev/claude-mem.db` (15MB writable snapshot)
- **Prod DB:** `~/.claude-mem/claude-mem.db` (READ-ONLY, chmod 444)
- **Prod worker:** brain at 100.89.23.33:37777 — do NOT connect
- Test all migrations against dev DB first

### 2. Migration Numbering
- **Existing:** 25 (platform_source) is latest in MigrationRunner
- **Migration 27 TAKEN** by node_source on `feat/mem-net` (other agent's work)
- **Morpheus migrations:** 28, 29, 30, 31
- Copilot PRs all claim migration 26 — must renumber to 28+

### 3. Another Agent Active on feat/mem-net
- Working on distributed memory network (node tagging, node-aware scoring)
- Filed issues #29 (node scoring), #31 (direct SQLite bypass), #32 (dev/prod mode)
- Their node-aware scoring (#29) should **compose** with our relevance_score, not compete
- Check `git fetch pi-mem-dev && git log pi-mem-dev/feat/mem-net --since="1 hour ago"` before pushing

### 4. All Work on pi-mem-dev
- ArtemisAI/pi-mem-dev is the private development repo — ALL work happens here
- ArtemisAI/pi-mem is the public fork (upstream PRs only)
- thedotmack/claude-mem is upstream (don't touch without explicit ask)

### 5. Naming Convention
- Always use "Morpheus" — never the upstream Claude Code feature name
- See memory: `feedback_morpheus_naming.md`

## Key Files

| File | Role |
|------|------|
| `src/services/worker/agents/ResponseProcessor.ts` | Main integration point — 4 features touch this |
| `src/sdk/prompts.ts` | Agent prompts — quality gating + contradiction instructions |
| `src/sdk/parser.ts` | XML parsing — needs `parseSupersedes()` for contradiction |
| `src/services/sqlite/migrations/runner.ts` | Schema migrations — add 28-31 |
| `src/services/sqlite/SessionStore.ts` | Observation storage — semantic dedup modifies this |
| `src/services/worker-service.ts` | Worker lifecycle — staleness decay + consolidation jobs register here |
| `src/services/context/ObservationCompiler.ts` | Context injection — all features add filters/ordering here |
| `src/services/worker/http/routes/SearchRoutes.ts` | Search API — needs superseded + consolidation filters |
| `src/services/sqlite/SessionSearch.ts` | FTS search — needs same filters |
| `src/utils/date-normalization.ts` | DONE — already committed |

## Merge Order (critical — dependencies exist)

```
Step 1: Date Normalization  ← DONE
Step 2: Quality Gating      ← no schema, touches ResponseProcessor + prompts
Step 3: Contradiction        ← migration 28, touches ResponseProcessor + parser + queries
Step 4: Staleness Scoring    ← migration 29, touches worker-service + queries
Step 5: Semantic Dedup       ← migration 30, touches SessionStore (sync→async)
Step 6: Consolidation        ← migration 31, new service + biggest PR
Step 7: Retrospective        ← needs most rework (non-functional as-is)
```

## Verification Checklist

After all 7 features:
- [ ] Run full test suite against dev DB
- [ ] Migrations 28-31 apply cleanly to fresh dev DB snapshot
- [ ] Existing observation count unchanged
- [ ] `npm run build-and-sync` succeeds
- [ ] Push feat/morpheus to pi-mem-dev
- [ ] Close stale Copilot PRs (#13-19)

## Memory Files (auto-memory)

Key memories for this project:
- `feedback_morpheus_naming.md` — Always Morpheus, never upstream name
- `feedback_dev_repo.md` — ALL work on pi-mem-dev
- `feedback_commit_conventions.md` — Author as ArtemisAI only
- `reference_pi_mem_dev_issues.md` — Issue tracker reference
- `reference_ai_automate_proxy.md` — OpenRouter proxy details
