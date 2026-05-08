/**
 * /api/sessions/om-observations route handler tests (U3).
 *
 * Validates request payload checking and persistence wire-up. The
 * underlying storage path is unit-tested separately in
 * tests/sqlite/observations-om-provenance.test.ts; this file focuses on
 * the route's input validation and DB hand-off.
 *
 * Mock Justification:
 * - Express req/res mocks: route handlers expect Express objects.
 * - In-memory ClaudeMemDatabase via mocked DatabaseManager: exercises the
 *   real storeOMObservation persistence path so the route's argument
 *   marshalling is validated end-to-end without a running worker.
 * - Logger spies: suppress noisy debug output during tests.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Request, Response } from 'express';

import { logger } from '../../../../src/utils/logger.js';

mock.module('../../../../src/shared/paths.js', () => ({
	getPackageRoot: () => '/tmp/test',
	DATA_DIR: '/tmp/test',
	DB_PATH: ':memory:',
	USER_SETTINGS_PATH: '/tmp/test/settings.json',
	ensureDir: () => {},
}));
mock.module('../../../../src/shared/worker-utils.js', () => ({
	getWorkerPort: () => 37777,
}));

import { ClaudeMemDatabase } from '../../../../src/services/sqlite/Database.js';
import { getObservationByOMId } from '../../../../src/services/sqlite/Observations.js';
import { SessionRoutes } from '../../../../src/services/worker/http/routes/SessionRoutes.js';

interface MockResponseLog {
	body: unknown;
	status: number;
}

function createMockReqRes(body: unknown): {
	req: Partial<Request>;
	res: Partial<Response>;
	log: MockResponseLog;
} {
	const log: MockResponseLog = { body: undefined, status: 200 };

	const json = mock((value: unknown) => {
		log.body = value;
		return undefined as unknown as Response;
	}) as unknown as Response['json'];

	const status = mock((code: number) => {
		log.status = code;
		return { json } as unknown as Response;
	}) as unknown as Response['status'];

	return {
		req: { body, path: '/api/sessions/om-observations', query: {} } as Partial<Request>,
		res: { json, status } as unknown as Partial<Response>,
		log,
	};
}

describe('SessionRoutes.handleOMObservation', () => {
	let database: ClaudeMemDatabase;
	let routes: SessionRoutes;
	let loggerSpies: ReturnType<typeof spyOn>[] = [];

	beforeEach(() => {
		loggerSpies = [
			spyOn(logger, 'info').mockImplementation(() => {}),
			spyOn(logger, 'debug').mockImplementation(() => {}),
			spyOn(logger, 'warn').mockImplementation(() => {}),
			spyOn(logger, 'error').mockImplementation(() => {}),
			spyOn(logger, 'failure').mockImplementation(() => {}),
		];

		database = new ClaudeMemDatabase(':memory:');

		const mockSessionStore = { db: database.db } as unknown as { db: typeof database.db };
		const mockDbManager = {
			getSessionStore: () => mockSessionStore,
		} as unknown as ConstructorParameters<typeof SessionRoutes>[1];

		routes = new SessionRoutes(
			{} as never,
			mockDbManager,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
			{} as never,
		);
	});

	afterEach(() => {
		loggerSpies.forEach((spy) => spy.mockRestore());
		database.db.close();
		mock.restore();
	});

	function call(body: unknown): MockResponseLog {
		const { req, res, log } = createMockReqRes(body);
		// `handleOMObservation` is private; the routes class exposes it via
		// setupRoutes binding. Cast to any to invoke directly.
		(routes as unknown as { handleOMObservation: (req: Request, res: Response) => void })
			.handleOMObservation(req as Request, res as Response);
		return log;
	}

	it('returns 400 when project is missing', () => {
		const log = call({ kind: 'observation', content: 'x' });
		expect(log.status).toBe(400);
	});

	it('returns 400 when kind is invalid', () => {
		const log = call({ project: 'pi-x', kind: 'sneeze', content: 'x' });
		expect(log.status).toBe(400);
	});

	it('returns 400 when content is empty', () => {
		const log = call({ project: 'pi-x', kind: 'observation', content: '   ' });
		expect(log.status).toBe(400);
	});

	it('stores a valid observation and returns id', () => {
		const log = call({
			project: 'pi-test',
			kind: 'observation',
			content: 'A first observation captured by the bridge.',
			om_id: '0123456789ab',
			om_relevance: 'high',
			om_timestamp: '2026-05-08 03:30',
			source_entry_ids: ['entry-1', 'entry-2'],
			session_file: '/tmp/sessions/foo.jsonl',
		});

		expect(log.status).toBe(200);
		expect(log.body).toMatchObject({ status: 'stored' });
		const id = (log.body as { id: number }).id;
		expect(typeof id).toBe('number');

		// Round-trip: retrieve via OM id helper and verify provenance.
		const row = getObservationByOMId(database.db, '0123456789ab', 'pi-test');
		expect(row).not.toBeNull();
		expect(row?.id).toBe(id);
		expect(row?.om_kind).toBe('observation');
		expect(row?.om_relevance).toBe('high');
		expect(row?.om_session_file).toBe('/tmp/sessions/foo.jsonl');
		expect(row?.om_source_entry_ids).toEqual(['entry-1', 'entry-2']);
	});

	it('repeated post returns deduped status', () => {
		const body = {
			project: 'pi-test',
			kind: 'observation',
			content: 'Repeat me.',
			om_id: 'aaaaaaaaaaaa',
			om_relevance: 'critical',
		};
		const first = call(body);
		const second = call(body);
		expect(first.body).toMatchObject({ status: 'stored' });
		expect(second.body).toMatchObject({ status: 'deduped', id: (first.body as { id: number }).id });
	});

	it('accepts om_source_entry_ids alias as well as source_entry_ids', () => {
		const log = call({
			project: 'pi-test',
			kind: 'observation',
			content: 'Field alias check.',
			om_id: 'eeeeeeeeeeee',
			om_source_entry_ids: ['e1', 'e2'],
		});
		expect(log.status).toBe(200);
		const row = getObservationByOMId(database.db, 'eeeeeeeeeeee');
		expect(row?.om_source_entry_ids).toEqual(['e1', 'e2']);
	});

	it('persists a reflection without an om_id (legacy)', () => {
		const log = call({
			project: 'pi-test',
			kind: 'reflection',
			content: 'A legacy reflection with no id.',
		});
		expect(log.status).toBe(200);
		expect(log.body).toMatchObject({ status: 'stored' });
	});

	it('rejects invalid om_relevance values silently (stored without relevance)', () => {
		const log = call({
			project: 'pi-test',
			kind: 'observation',
			content: 'Relevance type-laundering.',
			om_id: 'ffffffffffff',
			om_relevance: 'urgent', // not a valid OM relevance value
		});
		expect(log.status).toBe(200);
		const row = getObservationByOMId(database.db, 'ffffffffffff');
		expect(row?.om_relevance).toBeNull();
	});
});
