/**
 * /api/search/by-om-id/:omId route tests (U3 search exposure / U5 prep).
 *
 * Verifies the lookup route's input validation, project scoping, and the
 * 200/404 response shape used by the future global_recall tool.
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

import { SearchRoutes } from '../../../../src/services/worker/http/routes/SearchRoutes.js';
import type { OMProvenanceObservation } from '../../../../src/services/sqlite/observations/types.js';

interface ResponseLog {
	body: unknown;
	status: number;
}

function makeReqRes(params: Record<string, string>, query: Record<string, unknown> = {}): {
	req: Partial<Request>;
	res: Partial<Response>;
	log: ResponseLog;
} {
	const log: ResponseLog = { body: undefined, status: 200 };
	const json = mock((value: unknown) => {
		log.body = value;
		return undefined as unknown as Response;
	}) as unknown as Response['json'];
	const status = mock((code: number) => {
		log.status = code;
		return { json } as unknown as Response;
	}) as unknown as Response['status'];
	return {
		req: { params, query, path: '/api/search/by-om-id/' } as Partial<Request>,
		res: { json, status } as unknown as Partial<Response>,
		log,
	};
}

describe('SearchRoutes.handleSearchByOMId', () => {
	let routes: SearchRoutes;
	let mockFind: ReturnType<typeof mock>;
	let loggerSpies: ReturnType<typeof spyOn>[] = [];

	const sampleRow: OMProvenanceObservation = {
		id: 42,
		project: 'pi-foo',
		source: 'pi-observational-memory',
		om_id: '0123456789ab',
		om_kind: 'observation',
		om_relevance: 'high',
		om_timestamp: '2026-05-08 03:00',
		om_session_file: '/tmp/sessions/foo.jsonl',
		om_source_entry_ids: ['entry-1', 'entry-2'],
		content: 'a stored OM observation',
		created_at: '2026-05-08T03:00:00.000Z',
		created_at_epoch: 1_780_000_000_000,
	};

	beforeEach(() => {
		loggerSpies = [
			spyOn(logger, 'info').mockImplementation(() => {}),
			spyOn(logger, 'debug').mockImplementation(() => {}),
			spyOn(logger, 'warn').mockImplementation(() => {}),
			spyOn(logger, 'error').mockImplementation(() => {}),
			spyOn(logger, 'failure').mockImplementation(() => {}),
		];
		mockFind = mock(() => null);
		routes = new SearchRoutes({
			findObservationByOMId: mockFind as unknown as (
				omId: string,
				project?: string,
			) => OMProvenanceObservation | null,
		} as unknown as ConstructorParameters<typeof SearchRoutes>[0]);
	});

	afterEach(() => {
		loggerSpies.forEach((s) => s.mockRestore());
		mock.restore();
	});

	function call(omId: string, query: Record<string, unknown> = {}): ResponseLog {
		const { req, res, log } = makeReqRes({ omId }, query);
		(routes as unknown as { handleSearchByOMId: (req: Request, res: Response) => Promise<void> })
			.handleSearchByOMId(req as Request, res as Response);
		return log;
	}

	it('rejects malformed om_id with 400', async () => {
		const log = call('not-hex!');
		// allow micro-task to settle (handler is async)
		await Promise.resolve();
		expect(log.status).toBe(400);
	});

	it('returns 404 when SearchManager has no match', async () => {
		mockFind = mock(() => null);
		routes = new SearchRoutes({
			findObservationByOMId: mockFind as never,
		} as unknown as ConstructorParameters<typeof SearchRoutes>[0]);
		const log = call('aaaaaaaaaaaa');
		await Promise.resolve();
		expect(log.status).toBe(404);
		expect(log.body).toMatchObject({ error: 'not_found', om_id: 'aaaaaaaaaaaa' });
	});

	it('returns the row with provenance fields when found', async () => {
		mockFind = mock(() => sampleRow);
		routes = new SearchRoutes({
			findObservationByOMId: mockFind as never,
		} as unknown as ConstructorParameters<typeof SearchRoutes>[0]);
		const log = call('0123456789ab');
		await Promise.resolve();
		expect(log.status).toBe(200);
		expect(log.body).toMatchObject({
			id: 42,
			om_id: '0123456789ab',
			om_session_file: '/tmp/sessions/foo.jsonl',
			om_source_entry_ids: ['entry-1', 'entry-2'],
		});
	});

	it('forwards project query param to SearchManager', async () => {
		mockFind = mock(() => null);
		routes = new SearchRoutes({
			findObservationByOMId: mockFind as never,
		} as unknown as ConstructorParameters<typeof SearchRoutes>[0]);
		call('aaaaaaaaaaaa', { project: 'pi-foo' });
		await Promise.resolve();
		expect(mockFind).toHaveBeenCalledWith('aaaaaaaaaaaa', 'pi-foo');
	});
});
