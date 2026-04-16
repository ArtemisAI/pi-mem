# Project Morpheus — Roadmap

> Memory intelligence layer for claude-mem. Clean-room implementation inspired by agentic memory consolidation patterns.

## Vision

Transform claude-mem from "store everything, query by recency" into a system that **learns what to remember** — filtering noise at write time, decaying stale observations, consolidating related memories, detecting contradictions, and eventually using reinforcement learning to optimize what gets injected into context.

## Architecture

Full analysis: [`docs/morpheus-architecture.md`](docs/morpheus-architecture.md)

```
Raw tool output → Date Normalization → Quality Gating → Storage
                                                          ↓
                                        Semantic Dedup (write-time merge)
                                        Contradiction Detection (supersede stale)
                                                          ↓
                                        Staleness Scoring (hourly decay job)
                                        Consolidation Job (batch merge clusters)
                                                          ↓
                                        Context Injection (relevance-ordered)
                                                          ↓
                                        Session Retrospective (meta-learning)
```

## Phases

### Phase A — Foundation (Low effort, immediate impact)

Features that filter and clean observations at write time. No schema changes for the first two; migration 28 for contradiction detection.

| # | Feature | Issue | Status | Migration |
|---|---------|-------|--------|-----------|
| 1 | **Date Normalization** | [#11](https://github.com/ArtemisAI/pi-mem-dev/issues/11) | DONE | None |
| 2 | **Quality Gating** | [#6](https://github.com/ArtemisAI/pi-mem-dev/issues/6) | TODO | None |
| 3 | **Contradiction Detection** | [#8](https://github.com/ArtemisAI/pi-mem-dev/issues/8) | TODO | 28 |

**Expected outcome:** ~30% reduction in observation noise, elimination of contradicted-fact poisoning in context injection.

### Phase B — Intelligence (Medium effort)

Features that add scoring and deduplication using Chroma vector similarity.

| # | Feature | Issue | Status | Migration |
|---|---------|-------|--------|-----------|
| 4 | **Staleness Scoring** | [#9](https://github.com/ArtemisAI/pi-mem-dev/issues/9) | TODO | 29 |
| 5 | **Semantic Dedup** | [#7](https://github.com/ArtemisAI/pi-mem-dev/issues/7) | TODO | 30 |

**Expected outcome:** Context injection returns 2-3x more relevant observations. Mature projects no longer dominated by stale week-1 observations.

### Phase C — Consolidation (High effort, capstone)

Background service that periodically clusters and merges related observations into rich digests.

| # | Feature | Issue | Status | Migration |
|---|---------|-------|--------|-----------|
| 6 | **Consolidation Job** | [#10](https://github.com/ArtemisAI/pi-mem-dev/issues/10) | TODO | 31 |

**Expected outcome:** 5-10x reduction in observation count for mature projects. Higher-quality context injection.

### Phase D — Meta-Learning (Independent track)

End-of-session analysis capturing wrong turns and reasoning failures for future sessions.

| # | Feature | Issue | Status | Migration |
|---|---------|-------|--------|-----------|
| 7 | **Session Retrospective** | [#12](https://github.com/ArtemisAI/pi-mem-dev/issues/12) | TODO | None |

**Expected outcome:** Agents learn from past mistakes. "Last time you went down path A before realizing path B was correct."

### Phase E — Reinforcement Learning (Future research)

Apply RL to optimize observation quality and context injection relevance using real session outcomes as reward signals.

| # | Feature | Issue | Status |
|---|---------|-------|--------|
| 8 | **RL Observation Scoring** | [#28](https://github.com/ArtemisAI/pi-mem-dev/issues/28) | Research |

**Research papers:** Tool-R1 (arXiv:2509.12867), MIRA (ICLR 2026), MemAgent, MEM1.

## Migration Numbering

Existing migrations on main go up to 25. The `feat/mem-net` branch claims migration 27 (node_source). Morpheus migrations start at **28**.

```
25  — platform_source (existing)
26  — generated_by_model (existing in SessionStore)
27  — node_source (feat/mem-net, other agent)
28  — Contradiction Detection: superseded_by, superseded_at, superseded_reason
29  — Staleness Scoring: relevance_score
30  — Semantic Dedup: updated_at, merge_count
31  — Consolidation: consolidated_into, is_consolidated_digest, consolidation_runs table
```

## Dependencies

```
Date Normalization ──────────────┐
Quality Gating ──────────────────┤
                                 ├── Contradiction Detection
                                 ├── Semantic Dedup
                                 ├── Staleness Scoring
                                 │
                                 └── Consolidation Job (builds on all above)

Session Retrospective ──────────── (independent, parallel track)
Phase E RL ─────────────────────── (requires all Phases A-D complete)
```

## Coordination

- **Branch:** `feat/morpheus` on both `origin` (ArtemisAI/pi-mem) and `pi-mem-dev` (ArtemisAI/pi-mem-dev)
- **Other agent:** Working on `feat/mem-net` (distributed memory network, node tagging)
- **Dev/prod separation:** See [DEV_SETUP.md](DEV_SETUP.md)
- **Naming:** Always "Morpheus" — never the upstream Claude Code feature name
