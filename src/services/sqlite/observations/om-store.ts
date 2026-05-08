/**
 * OM-provenance ingestion (U3).
 *
 * Writes already-compressed pi-observational-memory records directly into
 * the observations table with provenance metadata in dedicated columns.
 *
 * Design notes:
 *   - Bypasses the LLM observation generator: OM records are already
 *     distilled, so we treat them as authoritative and persist verbatim.
 *   - The legacy `narrative` column is reused as the public content
 *     surface (search and context routes already index it). `title` is
 *     synthesized from a content prefix so feed UIs render something.
 *   - `content_hash` keys on (kind, om_id) when an id is present, and
 *     falls back to content-only when not. This makes the route
 *     idempotent for repeated bridge exports without requiring a UNIQUE
 *     constraint on om_id (which would block legacy reflections sharing
 *     a null id).
 *   - `source` is set to 'pi-observational-memory' so existing search
 *     paths can distinguish OM-derived rows from raw tool capture.
 */

import { createHash } from 'crypto';
import type { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';
import type {
	OMObservationInput,
	OMProvenanceObservation,
	StoreOMObservationResult,
} from './types.js';

const VALID_KINDS = new Set<OMObservationInput['kind']>(['observation', 'reflection']);
const OM_PROVENANCE_SOURCE = 'pi-observational-memory';
const OM_MEMORY_SESSION_PREFIX = 'om-bridge-session-';

function shortHash(parts: string[]): string {
	return createHash('sha256').update(parts.join('\x00')).digest('hex').slice(0, 16);
}

/**
 * Stable content hash for OM records. id-bearing inputs collapse on
 * (kind, om_id); legacy reflections without an id fall back to a
 * (kind, content) hash.
 */
function omContentHash(input: OMObservationInput): string {
	if (input.om_id) {
		return shortHash([OM_PROVENANCE_SOURCE, input.kind, 'id', input.om_id]);
	}
	return shortHash([OM_PROVENANCE_SOURCE, input.kind, 'content', input.content]);
}

/**
 * Synthesize a short title from the OM content. The observations table
 * already requires title for some search/UI surfaces; we keep this
 * deterministic so search ranking stays stable across re-ingestion.
 */
function synthesizeTitle(content: string): string {
	const trimmed = content.trim().replace(/\s+/g, ' ');
	if (trimmed.length <= 90) return trimmed;
	return `${trimmed.slice(0, 87)}...`;
}

/**
 * Ensure a sentinel sdk_session row exists for OM-bridged observations.
 * The observations table FK references sdk_sessions(memory_session_id);
 * OM-bridge records do not belong to a real interactive session, so we
 * use a stable per-project sentinel id to satisfy the constraint without
 * polluting the live session feed.
 *
 * Returns the memory_session_id to attach to inserted rows.
 */
function ensureBridgeSession(db: Database, project: string): string {
	const memorySessionId = `${OM_MEMORY_SESSION_PREFIX}${project}`;
	const existing = db
		.prepare('SELECT memory_session_id FROM sdk_sessions WHERE memory_session_id = ?')
		.get(memorySessionId);
	if (existing) return memorySessionId;

	const nowIso = new Date().toISOString();
	const nowEpoch = Date.now();
	const contentSessionId = `${OM_MEMORY_SESSION_PREFIX}${project}-content`;
	db.run(
		`INSERT OR IGNORE INTO sdk_sessions
		(content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch, platform_source)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			contentSessionId,
			memorySessionId,
			project,
			'om-bridge sentinel',
			nowIso,
			nowEpoch,
			'om-bridge',
		],
	);
	return memorySessionId;
}

/**
 * Store an already-compressed OM record. Idempotent on (kind, om_id).
 *
 * @throws if `kind` is unknown or `content` is empty.
 */
export function storeOMObservation(
	db: Database,
	input: OMObservationInput,
): StoreOMObservationResult {
	if (!VALID_KINDS.has(input.kind)) {
		throw new Error(`storeOMObservation: invalid kind '${input.kind}'`);
	}
	const content = (input.content ?? '').trim();
	if (content.length === 0) {
		throw new Error('storeOMObservation: content is required');
	}
	if (!input.project || input.project.trim().length === 0) {
		throw new Error('storeOMObservation: project is required');
	}

	const project = input.project;
	const contentHash = omContentHash(input);

	const existing = db
		.prepare(
			`SELECT id FROM observations
			 WHERE source = ? AND content_hash = ? AND project = ?
			 LIMIT 1`,
		)
		.get(OM_PROVENANCE_SOURCE, contentHash, project) as { id: number } | undefined;

	if (existing) {
		logger.debug('DEDUP', 'Skipped duplicate OM observation', {
			contentHash,
			existingId: existing.id,
			om_id: input.om_id,
			kind: input.kind,
		});
		return { id: existing.id, deduped: true };
	}

	const memorySessionId = ensureBridgeSession(db, project);

	const nowIso = new Date().toISOString();
	const nowEpoch = Date.now();
	const title = synthesizeTitle(content);
	const sourceEntryIdsJson = input.om_source_entry_ids
		? JSON.stringify(input.om_source_entry_ids)
		: null;

	const stmt = db.prepare(`
		INSERT INTO observations (
			memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
			files_read, files_modified, prompt_number, discovery_tokens, content_hash,
			created_at, created_at_epoch,
			source, om_id, om_kind, om_relevance, om_timestamp, om_session_file, om_source_entry_ids
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const result = stmt.run(
		memorySessionId,
		project,
		input.kind === 'reflection' ? 'reflection' : 'observation',
		title,
		null, // subtitle
		'[]', // facts
		content,
		'[]', // concepts
		'[]', // files_read
		'[]', // files_modified
		null, // prompt_number
		0, // discovery_tokens
		contentHash,
		nowIso,
		nowEpoch,
		OM_PROVENANCE_SOURCE,
		input.om_id ?? null,
		input.kind,
		input.om_relevance ?? null,
		input.om_timestamp ?? null,
		input.session_file ?? null,
		sourceEntryIdsJson,
	);

	return { id: Number(result.lastInsertRowid), deduped: false };
}

/**
 * Look up an OM-derived observation row by its OM id. Optionally scoped to
 * a project. Returns null if no row matches.
 */
export function getObservationByOMId(
	db: Database,
	omId: string,
	project?: string,
): OMProvenanceObservation | null {
	if (!omId || omId.length === 0) return null;
	const sql = `SELECT id, project, source, om_id, om_kind, om_relevance, om_timestamp,
			om_session_file, om_source_entry_ids, narrative, created_at, created_at_epoch
			FROM observations
			WHERE source = ? AND om_id = ?` + (project ? ' AND project = ?' : '') + ' LIMIT 1';
	const row = project
		? (db.prepare(sql).get(OM_PROVENANCE_SOURCE, omId, project) as Record<string, unknown> | undefined)
		: (db.prepare(sql).get(OM_PROVENANCE_SOURCE, omId) as Record<string, unknown> | undefined);

	if (!row) return null;

	let sourceEntryIds: string[] | null = null;
	if (typeof row.om_source_entry_ids === 'string' && row.om_source_entry_ids.length > 0) {
		try {
			const parsed = JSON.parse(row.om_source_entry_ids);
			if (Array.isArray(parsed)) sourceEntryIds = parsed.filter((v) => typeof v === 'string');
		} catch {
			sourceEntryIds = null;
		}
	}

	return {
		id: row.id as number,
		project: row.project as string,
		source: row.source as string,
		om_id: (row.om_id as string | null) ?? null,
		om_kind: (row.om_kind as string | null) ?? null,
		om_relevance: (row.om_relevance as string | null) ?? null,
		om_timestamp: (row.om_timestamp as string | null) ?? null,
		om_session_file: (row.om_session_file as string | null) ?? null,
		om_source_entry_ids: sourceEntryIds,
		content: (row.narrative as string) ?? '',
		created_at: row.created_at as string,
		created_at_epoch: row.created_at_epoch as number,
	};
}
