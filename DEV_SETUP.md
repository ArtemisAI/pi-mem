# Development Environment Setup

> Morpheus development MUST be sandboxed from the production memory network.

## The Problem

This machine is a client in the centralized memory network (brain at 100.89.23.33:37777). Development code that writes directly to the local DB or connects to the production worker can:

1. Leak test observations into the shared production database
2. Run experimental migrations that corrupt the shared schema
3. Cause the worker to restart with untested code, breaking all clients

See [pi-mem-dev#31](https://github.com/ArtemisAI/pi-mem-dev/issues/31) and [pi-mem-dev#32](https://github.com/ArtemisAI/pi-mem-dev/issues/32).

## Dev vs Prod

| | Dev | Prod |
|---|---|---|
| **Database** | `~/.claude-mem-dev/claude-mem.db` | `~/.claude-mem/claude-mem.db` |
| **DB permissions** | Read-write (644) | Read-only (444) |
| **Worker** | Local (localhost:37778 or test harness) | brain:37777 |
| **Migrations** | Safe to experiment | Never run untested |
| **Observations** | Disposable test data | Shared across all nodes |

## Setup

### 1. Create dev DB snapshot

```bash
mkdir -p ~/.claude-mem-dev
cp ~/.claude-mem/claude-mem.db ~/.claude-mem-dev/claude-mem.db
chmod 644 ~/.claude-mem-dev/claude-mem.db
```

### 2. Verify prod DB is locked

```bash
ls -la ~/.claude-mem/claude-mem.db
# Should show: -r--r--r-- (444)
```

If not locked:
```bash
chmod 444 ~/.claude-mem/claude-mem.db
```

### 3. Run tests against dev DB

Set the data dir to the dev path when running tests:

```bash
CLAUDE_MEM_DATA_DIR=~/.claude-mem-dev npm test
```

Or for specific test files:
```bash
CLAUDE_MEM_DATA_DIR=~/.claude-mem-dev npx bun test tests/utils/date-normalization.test.ts
```

### 4. Test migrations

```bash
# Fresh snapshot for migration testing
cp ~/.claude-mem/claude-mem.db ~/.claude-mem-dev/claude-mem-migration-test.db
chmod 644 ~/.claude-mem-dev/claude-mem-migration-test.db

# Run migration against test copy
CLAUDE_MEM_DATA_DIR=~/.claude-mem-dev CLAUDE_MEM_DB=claude-mem-migration-test.db npm run build
```

## Rules

1. **NEVER** run `npm run build-and-sync` against production settings
2. **NEVER** connect to brain:37777 during development
3. **ALWAYS** verify `chmod 444` on prod DB before starting dev work
4. **ALWAYS** test migrations on a fresh dev DB snapshot before committing
5. **ALWAYS** use the `feat/morpheus` branch for all Morpheus work

## Branch Strategy

```
main                    — stable, production-ready
feat/mem-net            — distributed memory network (other agent)
feat/morpheus           — memory intelligence features (this project)
```

All Morpheus work happens on `feat/morpheus`. Push to both:
```bash
git push origin feat/morpheus
git push pi-mem-dev feat/morpheus
```
