/**
 * Type definitions for observation operations
 * Extracted from SessionStore.ts for modular organization
 */
import { logger } from '../../../utils/logger.js';

/**
 * Input type for storeObservation function
 */
export interface ObservationInput {
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string[];
  narrative: string | null;
  concepts: string[];
  files_read: string[];
  files_modified: string[];
}

/**
 * Result from storing an observation
 */
export interface StoreObservationResult {
  id: number;
  createdAtEpoch: number;
}

/**
 * Options for getObservationsByIds
 */
export interface GetObservationsByIdsOptions {
  orderBy?: 'date_desc' | 'date_asc';
  limit?: number;
  project?: string;
  type?: string | string[];
  concepts?: string | string[];
  files?: string | string[];
}

/**
 * Input type for storeOMObservation — ingestion path for already-compressed
 * pi-observational-memory observations and reflections (U3).
 *
 * Unlike `ObservationInput`, this represents a memory record that has
 * already been distilled by OM's reflector/pruner. It bypasses the
 * worker's LLM observation generator and is written directly to the
 * observations table with OM provenance metadata preserved.
 */
export interface OMObservationInput {
	/** pi-mem project name (e.g. 'pi-foo'); same scope used by raw tool capture. */
	project: string;
	/** Whether this OM record is an observation or a reflection. */
	kind: 'observation' | 'reflection';
	/** Plain-prose record text. */
	content: string;
	/** OM 12-char hex id when known. Legacy plain-string reflections may omit this. */
	om_id?: string | null;
	/** OM relevance for observations. Reflections may omit. */
	om_relevance?: 'low' | 'medium' | 'high' | 'critical' | null;
	/** OM timestamp string ('YYYY-MM-DD HH:MM'). */
	om_timestamp?: string | null;
	/** Absolute path to the source session JSONL, when available. */
	session_file?: string | null;
	/** OM source entry ids the observation was distilled from. */
	om_source_entry_ids?: string[] | null;
}

/**
 * Result of storeOMObservation. `deduped` is true when the input matched
 * an existing row (by (kind, om_id) for id-bearing inputs, or by content
 * for legacy reflections without an id).
 */
export interface StoreOMObservationResult {
	id: number;
	deduped: boolean;
}

/** Row shape returned by getObservationByOMId. */
export interface OMProvenanceObservation {
	id: number;
	project: string;
	source: string;
	om_id: string | null;
	om_kind: string | null;
	om_relevance: string | null;
	om_timestamp: string | null;
	om_session_file: string | null;
	om_source_entry_ids: string[] | null;
	content: string;
	created_at: string;
	created_at_epoch: number;
}

/**
 * Result type for getFilesForSession
 */
export interface SessionFilesResult {
  filesRead: string[];
  filesModified: string[];
}

/**
 * Simple observation row for getObservationsForSession
 */
export interface ObservationSessionRow {
  title: string;
  subtitle: string;
  type: string;
  prompt_number: number | null;
}

/**
 * Recent observation row type
 */
export interface RecentObservationRow {
  type: string;
  text: string;
  prompt_number: number | null;
  created_at: string;
}

/**
 * Full recent observation row (for web UI)
 */
export interface AllRecentObservationRow {
  id: number;
  type: string;
  title: string | null;
  subtitle: string | null;
  text: string;
  project: string;
  prompt_number: number | null;
  created_at: string;
  created_at_epoch: number;
}
