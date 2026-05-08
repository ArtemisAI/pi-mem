/**
 * OM-provenance ingestion tests
 *
 * Covers U3 of the pi memory integration plan: storing already-compressed
 * pi-observational-memory records as first-class observations with
 * provenance metadata persisted in dedicated columns.
 *
 * Sources:
 * - Migration 26 in src/services/sqlite/migrations/runner.ts
 * - storeOMObservation / getObservationByOMId in observations module
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Database } from 'bun:sqlite';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import {
	storeOMObservation,
	getObservationByOMId,
} from '../../src/services/sqlite/Observations.js';
import type { OMObservationInput } from '../../src/services/sqlite/observations/types.js';

describe('OM provenance ingestion', () => {
	let db: Database;

	beforeEach(() => {
		db = new ClaudeMemDatabase(':memory:').db;
	});

	afterEach(() => {
		db.close();
	});

	function makeInput(overrides: Partial<OMObservationInput> = {}): OMObservationInput {
		return {
			project: 'pi-test-project',
			kind: 'observation',
			content: 'Discovered that observations table needs provenance columns.',
			om_id: 'aaaaaaaaaaaa',
			om_relevance: 'high',
			om_timestamp: '2026-05-08 03:00',
			om_source_entry_ids: ['entry-1', 'entry-2'],
			session_file: '/tmp/sessions/abc.jsonl',
			...overrides,
		};
	}

	describe('migration 26 schema', () => {
		it('adds OM provenance columns to observations', () => {
			const cols = db
				.query("PRAGMA table_info('observations')")
				.all() as Array<{ name: string }>;
			const names = new Set(cols.map((c) => c.name));
			expect(names.has('source')).toBe(true);
			expect(names.has('om_id')).toBe(true);
			expect(names.has('om_kind')).toBe(true);
			expect(names.has('om_relevance')).toBe(true);
			expect(names.has('om_timestamp')).toBe(true);
			expect(names.has('om_session_file')).toBe(true);
			expect(names.has('om_source_entry_ids')).toBe(true);
		});

		it('records the migration version 26', () => {
			const row = db
				.prepare('SELECT version FROM schema_versions WHERE version = ?')
				.get(26) as { version: number } | undefined;
			expect(row?.version).toBe(26);
		});

		it('creates an index on om_id', () => {
			const idx = db
				.query("PRAGMA index_list('observations')")
				.all() as Array<{ name: string }>;
			expect(idx.some((i) => i.name === 'idx_observations_om_id')).toBe(true);
		});

		it('defaults source to pi-mem for legacy rows (back-compat)', () => {
			// Seed an sdk_sessions row to satisfy the FK, then insert directly
			// without a `source` value to verify the column default.
			db.run(
				`INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
				VALUES ('legacy-content', 'legacy-session', 'pi-test-project', '2026-05-07', 0)`,
			);
			db.run(
				`INSERT INTO observations
				(memory_session_id, project, type, narrative, content_hash, created_at, created_at_epoch)
				VALUES ('legacy-session', 'pi-test-project', 'discovery', 'legacy', 'legacyhash00000', '2026-05-07', 0)`,
			);
			const row = db
				.prepare('SELECT source FROM observations WHERE memory_session_id = ?')
				.get('legacy-session') as { source: string };
			expect(row.source).toBe('pi-mem');
		});
	});

	describe('storeOMObservation', () => {
		it('persists an observation with all provenance fields', () => {
			const input = makeInput();
			const result = storeOMObservation(db, input);
			expect(result.deduped).toBe(false);
			expect(typeof result.id).toBe('number');

			const row = db
				.prepare('SELECT * FROM observations WHERE id = ?')
				.get(result.id) as {
					project: string;
					source: string;
					om_id: string;
					om_kind: string;
					om_relevance: string;
					om_timestamp: string;
					om_session_file: string;
					om_source_entry_ids: string;
					title: string | null;
					narrative: string | null;
				};

			expect(row.project).toBe('pi-test-project');
			expect(row.source).toBe('pi-observational-memory');
			expect(row.om_id).toBe('aaaaaaaaaaaa');
			expect(row.om_kind).toBe('observation');
			expect(row.om_relevance).toBe('high');
			expect(row.om_timestamp).toBe('2026-05-08 03:00');
			expect(row.om_session_file).toBe('/tmp/sessions/abc.jsonl');
			expect(JSON.parse(row.om_source_entry_ids)).toEqual(['entry-1', 'entry-2']);
			expect(row.narrative).toContain('observations table');
		});

		it('persists a reflection with kind=reflection', () => {
			const input = makeInput({ kind: 'reflection', om_id: 'bbbbbbbbbbbb', content: 'a reflection' });
			const result = storeOMObservation(db, input);
			const row = db
				.prepare('SELECT om_kind, source FROM observations WHERE id = ?')
				.get(result.id) as { om_kind: string; source: string };
			expect(row.om_kind).toBe('reflection');
			expect(row.source).toBe('pi-observational-memory');
		});

		it('is idempotent on the same om_id (kind+id key)', () => {
			const input = makeInput();
			const r1 = storeOMObservation(db, input);
			const r2 = storeOMObservation(db, input);
			expect(r2.id).toBe(r1.id);
			expect(r2.deduped).toBe(true);
		});

		it('different kinds with the same om_id do NOT collide', () => {
			const r1 = storeOMObservation(db, makeInput({ kind: 'observation' }));
			const r2 = storeOMObservation(db, makeInput({ kind: 'reflection' }));
			expect(r2.id).not.toBe(r1.id);
			expect(r2.deduped).toBe(false);
		});

		it('content-keyed dedupe for reflections without an om_id', () => {
			const r1 = storeOMObservation(db, {
				project: 'pi-x',
				kind: 'reflection',
				content: 'legacy reflection text',
			});
			const r2 = storeOMObservation(db, {
				project: 'pi-x',
				kind: 'reflection',
				content: 'legacy reflection text',
			});
			expect(r2.id).toBe(r1.id);
			expect(r2.deduped).toBe(true);
		});

		it('rejects empty content', () => {
			expect(() =>
				storeOMObservation(db, makeInput({ content: '' })),
			).toThrow();
		});

		it('rejects an unknown kind', () => {
			expect(() =>
				storeOMObservation(db, { ...makeInput(), kind: 'sneeze' as unknown as 'observation' }),
			).toThrow();
		});

		it('persists null session_file when provenance is unavailable', () => {
			const result = storeOMObservation(db, {
				...makeInput({ om_id: 'cccccccccccc' }),
				session_file: null,
			});
			const row = db
				.prepare('SELECT om_session_file FROM observations WHERE id = ?')
				.get(result.id) as { om_session_file: string | null };
			expect(row.om_session_file).toBeNull();
		});

		it('survives missing om_source_entry_ids', () => {
			const result = storeOMObservation(db, {
				...makeInput({ om_id: 'dddddddddddd' }),
				om_source_entry_ids: undefined,
			});
			const row = db
				.prepare('SELECT om_source_entry_ids FROM observations WHERE id = ?')
				.get(result.id) as { om_source_entry_ids: string | null };
			expect(row.om_source_entry_ids).toBeNull();
		});
	});

	describe('getObservationByOMId', () => {
		it('retrieves a stored OM observation by om_id', () => {
			const stored = storeOMObservation(db, makeInput());
			const row = getObservationByOMId(db, 'aaaaaaaaaaaa');
			expect(row).not.toBeNull();
			expect(row?.id).toBe(stored.id);
			expect(row?.om_id).toBe('aaaaaaaaaaaa');
			expect(row?.om_relevance).toBe('high');
			expect(row?.om_session_file).toBe('/tmp/sessions/abc.jsonl');
			expect(row?.om_source_entry_ids).toEqual(['entry-1', 'entry-2']);
		});

		it('scopes by project when provided', () => {
			storeOMObservation(db, makeInput({ project: 'pi-a', om_id: 'eeeeeeeeeeee' }));
			storeOMObservation(db, makeInput({ project: 'pi-b', om_id: 'ffffffffffff' }));
			expect(getObservationByOMId(db, 'eeeeeeeeeeee', 'pi-a')?.project).toBe('pi-a');
			expect(getObservationByOMId(db, 'eeeeeeeeeeee', 'pi-b')).toBeNull();
		});

		it('returns null for unknown om_id', () => {
			expect(getObservationByOMId(db, 'no-such-id-here')).toBeNull();
		});
	});
});
