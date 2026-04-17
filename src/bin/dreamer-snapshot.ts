#!/usr/bin/env bun
/**
 * dreamer-snapshot — reset the Dreamer sub-sandbox DB from a seed fixture.
 *
 * Refuses to run unless CLAUDE_MEM_DATA_DIR ends with "-dreamer" to prevent
 * accidental execution against a non-sandbox data dir (including prod).
 *
 * Usage:
 *   CLAUDE_MEM_DATA_DIR=~/.claude-mem-dreamer \
 *   bun src/bin/dreamer-snapshot.ts --seed path/to/seed.db[.gz]
 */

import { existsSync, copyFileSync, statSync } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { join, resolve } from 'path';
import { DATA_DIR, DB_PATH, ensureDir, LOGS_DIR } from '../shared/paths.js';

interface Args {
  seed: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { seed: '', force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed' || a === '-s') {
      args.seed = argv[++i] ?? '';
    } else if (a === '--force' || a === '-f') {
      args.force = true;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: dreamer-snapshot --seed <path> [--force]');
      process.exit(0);
    }
  }
  return args;
}

function assertSandbox(): void {
  const dir = resolve(DATA_DIR);
  if (!dir.endsWith('-dreamer') && !dir.includes('-dreamer/')) {
    console.error(
      `[dreamer-snapshot] refusing to run: CLAUDE_MEM_DATA_DIR=${dir} does not look like a Dreamer sandbox (must end with "-dreamer")`
    );
    process.exit(2);
  }
}

async function decompress(src: string, dst: string): Promise<void> {
  await pipeline(createReadStream(src), createGunzip(), createWriteStream(dst));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertSandbox();
  if (!args.seed) {
    console.error('[dreamer-snapshot] --seed <path> is required');
    process.exit(1);
  }

  const seedPath = resolve(args.seed);
  if (!existsSync(seedPath)) {
    console.error(`[dreamer-snapshot] seed not found: ${seedPath}`);
    process.exit(1);
  }

  if (existsSync(DB_PATH) && !args.force) {
    console.error(
      `[dreamer-snapshot] ${DB_PATH} exists — pass --force to overwrite`
    );
    process.exit(1);
  }

  ensureDir(DATA_DIR);
  ensureDir(LOGS_DIR);

  const startedAt = Date.now();
  if (seedPath.endsWith('.gz')) {
    console.log(`[dreamer-snapshot] decompressing ${seedPath} → ${DB_PATH}`);
    await decompress(seedPath, DB_PATH);
  } else {
    console.log(`[dreamer-snapshot] copying ${seedPath} → ${DB_PATH}`);
    copyFileSync(seedPath, DB_PATH);
  }

  // Clear any WAL/SHM sidecars from the previous session to force a clean open
  for (const sidecar of [`${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
    if (existsSync(sidecar)) {
      copyFileSync(sidecar, `${sidecar}.pre-snapshot`);
    }
  }

  const size = statSync(DB_PATH).size;
  const dur = Date.now() - startedAt;
  const stamp = new Date(startedAt).toISOString();
  const log = {
    event: 'dreamer_snapshot',
    seed: seedPath,
    target: DB_PATH,
    bytes: size,
    duration_ms: dur,
    at: stamp
  };
  await Bun.write(join(LOGS_DIR, `dreamer-snapshot-${stamp.slice(0, 10)}.log`), JSON.stringify(log) + '\n');
  console.log(`[dreamer-snapshot] done in ${dur}ms — ${(size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((err) => {
  console.error('[dreamer-snapshot] failed:', err);
  process.exit(1);
});
