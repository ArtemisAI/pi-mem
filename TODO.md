# Project Morpheus — TODO

> Implementation checklist. Each item maps to a GitHub issue on [ArtemisAI/pi-mem-dev](https://github.com/ArtemisAI/pi-mem-dev).

## Merge Order (must follow — dependencies exist)

### Step 1: Date Normalization — DONE
- [x] `src/utils/date-normalization.ts` — 7 regex patterns (yesterday, today, tomorrow, last week, this morning, this afternoon, earlier today)
- [x] Integration in `ResponseProcessor.ts` — applied before quality gating
- [x] Tests: null, empty, case-insensitive, word boundaries, multi-pattern
- [x] Committed: `db6bc321`
- **Issue:** [pi-mem-dev#11](https://github.com/ArtemisAI/pi-mem-dev/issues/11)

### Step 2: Quality Gating — TODO
- [ ] Add `filterObservationsByQuality()` in `ResponseProcessor.ts` (after parse, before store)
- [ ] Add "what NOT to extract" guidance to `sdk/prompts.ts` (buildInitPrompt + buildObservationPrompt)
- [ ] Filter rules: skip empty observations, skip raw git log dumps
- [ ] Log metrics: filtered count, stored/filtered ratio
- [ ] Tests for each filter rule
- **Copilot ref:** PR #21 — fix dead code (`hasOnlyFileListings` unreachable), tighten git log regex (`^Author:\s` not `author:`)
- **Issue:** [pi-mem-dev#6](https://github.com/ArtemisAI/pi-mem-dev/issues/6)

### Step 3: Contradiction Detection — TODO (migration 28)
- [ ] Add `<supersedes>` output tag instruction to agent prompt in `sdk/prompts.ts`
- [ ] Add `parseSupersedes()` to `sdk/parser.ts`
- [ ] Migration 28: `superseded_by INTEGER`, `superseded_at TEXT`, `superseded_reason TEXT` on observations
- [ ] Process supersedes in `ResponseProcessor.ts` after storing new observations
- [ ] Add `WHERE superseded_by IS NULL` filter to `ObservationCompiler.ts`, `SessionSearch.ts`, `SearchRoutes.ts`
- [ ] Tests for parser, migration, and end-to-end supersession
- **Copilot ref:** PR #23 — renumber migration from 26→28, remove dead `supersededByObservationIndex` code
- **Issue:** [pi-mem-dev#8](https://github.com/ArtemisAI/pi-mem-dev/issues/8)

### Step 4: Staleness Scoring — TODO (migration 29)
- [ ] Migration 29: `relevance_score REAL NOT NULL DEFAULT 1.0` + index
- [ ] Hourly decay job in `worker-service.ts` (alongside staleSessionReaper)
- [ ] Formula: `0.98^days * type_weight * file_modifier`
- [ ] Wrap UPDATE loop in transaction, add `WHERE relevance_score > 0.01` cutoff
- [ ] ORDER BY relevance_score in `ObservationCompiler.ts` and `SearchRoutes.ts`
- [ ] Include relevance_score in Chroma metadata
- [ ] Settings: `CLAUDE_MEM_RELEVANCE_DECAY_RATE`, `CLAUDE_MEM_RELEVANCE_DECAY_INTERVAL_MS`
- [ ] Tests for decay formula, type weights, file modifier
- **Copilot ref:** PR #24 — renumber migration 26→29, type as non-optional, add decay tests
- **Issue:** [pi-mem-dev#9](https://github.com/ArtemisAI/pi-mem-dev/issues/9)

### Step 5: Semantic Dedup — TODO (migration 30)
- [ ] Migration 30: `updated_at TEXT`, `merge_count INTEGER DEFAULT 0`
- [ ] Pre-INSERT Chroma similarity check in `SessionStore.storeObservations()`
- [ ] Merge logic: union concepts/files, append facts, bump updated_at, increment merge_count
- [ ] Settings: `CLAUDE_MEM_SEMANTIC_DEDUP_THRESHOLD` (0.08), `CLAUDE_MEM_SEMANTIC_DEDUP_ENABLED`
- [ ] Update standalone `transactions.ts` to include new columns
- [ ] Tests with mock ChromaSync
- **Copilot ref:** PR #22 — renumber migration 26→30, cache settings (not readFileSync per call), fix sync→async
- **Issue:** [pi-mem-dev#7](https://github.com/ArtemisAI/pi-mem-dev/issues/7)

### Step 6: Consolidation Job — TODO (migration 31)
- [ ] Migration 31: `consolidated_into INTEGER`, `is_consolidated_digest BOOLEAN`, `consolidation_runs` table
- [ ] `ConsolidationService.ts` (new file) with gate system: observations >= 50, hours >= 12, advisory lock
- [ ] `ConsolidationGates.ts` (new file)
- [ ] Pipeline: Group (Chroma clusters) → Merge (mechanical v1, AI digest v2) → Re-embed → Log
- [ ] Register in `worker-service.ts` (setInterval + shutdown cleanup)
- [ ] Add stale-lock recovery (4-hour timeout for stuck `running` rows)
- [ ] Add consolidation filter to `SessionSearch.ts` (4 query paths)
- [ ] Add filter to `ObservationCompiler.ts`: `WHERE (consolidated_into IS NULL OR is_consolidated_digest = 1)`
- [ ] Settings: enabled, min_observations, min_hours, cluster_threshold
- **Copilot ref:** PR #25 — renumber migration 27→31, add SessionSearch filters, stale-lock recovery, use existing DB connection
- **Issue:** [pi-mem-dev#10](https://github.com/ArtemisAI/pi-mem-dev/issues/10)

### Step 7: Session Retrospective — TODO (needs rework)
- [ ] New `buildRetrospectivePrompt()` in `sdk/prompts.ts`
- [ ] Queue retrospective in `cli/handlers/summarize.ts` AFTER summary completes (not before)
- [ ] Add `retrospective` to mode `observation_types` in code.json (or inject in ContextConfigLoader)
- [ ] Add `message_type: 'retrospective'` to `PendingMessageStore` enum
- [ ] Relevance boost: retrospective rows only, do NOT change ORDER BY for all observations
- [ ] Settings: `CLAUDE_MEM_RETROSPECTIVE_ENABLED`, `CLAUDE_MEM_RETROSPECTIVE_MAX_PER_SESSION`
- [ ] Remove duplicate migration code (DRY — don't copy into both SessionStore + MigrationRunner)
- **Copilot ref:** PR #27 — BLOCKER: feature non-functional (type not in mode config), ranking regression (ORDER BY change affects all observations)
- **Issue:** [pi-mem-dev#12](https://github.com/ArtemisAI/pi-mem-dev/issues/12)

## Copilot PRs to Close (stale first attempt)

- [ ] Close #13, #14, #15, #16, #17, #18, #19 — all contain only pi-agent rebrand diff, no Morpheus code
- [ ] Close #30 — Phase E is research only, not implementation

## Dev Environment

- **Dev DB:** `~/.claude-mem-dev/claude-mem.db` (15MB writable snapshot)
- **Prod DB:** `~/.claude-mem/claude-mem.db` (READ-ONLY chmod 444, do NOT touch)
- **Prod worker:** brain 100.89.23.33:37777 (do NOT connect during dev)
- **Test all migrations against dev DB before committing**
- See [DEV_SETUP.md](DEV_SETUP.md) for full setup instructions

## Verification (after all steps complete)

- [ ] Full test suite passes against dev DB
- [ ] Migrations 28-31 apply cleanly to fresh dev DB snapshot
- [ ] Existing observation count unchanged after migrations
- [ ] `npm run build-and-sync` succeeds
- [ ] Push feat/morpheus to pi-mem-dev
- [ ] Close stale Copilot PRs
