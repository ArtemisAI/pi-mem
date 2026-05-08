/**
 * Provenance-aware cross-session recall (U5).
 *
 * Pure decision logic for the `global_recall` tool. The Pi extension wires
 * this against the live worker fetch + OM bridge dynamic-import; tests
 * substitute deterministic fakes via the {@link GlobalRecallDeps} contract.
 *
 * Flow:
 *   1. Lookup the OM observation by 12-char hex id in the pi-mem worker
 *      (`GET /api/search/by-om-id/:omId`). Optional project scope.
 *   2. If found and the stored row carries an `om_session_file` that is
 *      readable on this machine, ask OM's bridge surface to recover
 *      exact source evidence from that session file.
 *   3. Return a structured result the tool serializer can stringify.
 *
 * Failure modes are explicit (`source-unavailable-...` reasons) so the
 * agent can present "exact source not available" honestly instead of
 * fabricating evidence.
 */

const OM_ID_PATTERN = /^[a-f0-9]{12}$/;

export interface OMProvenanceRow {
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

export interface RecallSourcesResult {
	/** Opaque pass-through from OM's recallMemorySources for downstream rendering. */
	[key: string]: unknown;
}

export type GlobalRecallStatus =
	| "found_with_sources"
	| "found_no_sources"
	| "not_found"
	| "invalid_om_id"
	| "worker_error";

export type SourceUnavailableReason =
	| "no-session-file"
	| "missing-session-file"
	| "unreadable-session-file"
	| "empty-session-file"
	| "om-bridge-unavailable";

export interface GlobalRecallResult {
	status: GlobalRecallStatus;
	om_id: string;
	project?: string;
	observation?: OMProvenanceRow;
	source_unavailable_reason?: SourceUnavailableReason;
	source_recall?: RecallSourcesResult;
	error?: string;
}

export interface FetchWorker {
	(path: string): Promise<{ status: number; body: unknown | null }>;
}

export interface OMBridgeRecaller {
	(sessionFile: string, omId: string): Promise<
		| {
				recall: RecallSourcesResult | null;
				unavailableReason?:
					| "missing-session-file"
					| "unreadable-session-file"
					| "empty-session-file";
		  }
		| null
	>;
}

export interface GlobalRecallDeps {
	fetchWorker: FetchWorker;
	/** Returns null when the OM bridge surface cannot be loaded. */
	loadOmBridgeRecall: () => Promise<OMBridgeRecaller | null>;
}

export interface GlobalRecallInputs {
	om_id: string;
	project?: string;
}

/**
 * Run the global_recall flow. Pure with respect to the supplied deps so
 * tests can drive it without a live worker or OM install.
 */
export async function runGlobalRecall(
	inputs: GlobalRecallInputs,
	deps: GlobalRecallDeps,
): Promise<GlobalRecallResult> {
	const omId = inputs.om_id?.trim() ?? "";
	if (!OM_ID_PATTERN.test(omId)) {
		return { status: "invalid_om_id", om_id: omId };
	}

	const projectQuery = inputs.project ? `?project=${encodeURIComponent(inputs.project)}` : "";
	const lookup = await deps.fetchWorker(`/api/search/by-om-id/${encodeURIComponent(omId)}${projectQuery}`);

	if (lookup.status === 404) {
		return { status: "not_found", om_id: omId, project: inputs.project };
	}
	if (lookup.status >= 400 || lookup.body === null || typeof lookup.body !== "object") {
		return {
			status: "worker_error",
			om_id: omId,
			project: inputs.project,
			error: `worker returned status ${lookup.status}`,
		};
	}

	const observation = lookup.body as OMProvenanceRow;

	if (!observation.om_session_file || observation.om_session_file.length === 0) {
		return {
			status: "found_no_sources",
			om_id: omId,
			project: inputs.project,
			observation,
			source_unavailable_reason: "no-session-file",
		};
	}

	const recall = await deps.loadOmBridgeRecall();
	if (!recall) {
		return {
			status: "found_no_sources",
			om_id: omId,
			project: inputs.project,
			observation,
			source_unavailable_reason: "om-bridge-unavailable",
		};
	}

	const recallResult = await recall(observation.om_session_file, omId);
	if (!recallResult) {
		return {
			status: "found_no_sources",
			om_id: omId,
			project: inputs.project,
			observation,
			source_unavailable_reason: "om-bridge-unavailable",
		};
	}

	if (recallResult.unavailableReason) {
		return {
			status: "found_no_sources",
			om_id: omId,
			project: inputs.project,
			observation,
			source_unavailable_reason: recallResult.unavailableReason,
		};
	}

	if (!recallResult.recall) {
		return {
			status: "found_no_sources",
			om_id: omId,
			project: inputs.project,
			observation,
			source_unavailable_reason: "om-bridge-unavailable",
		};
	}

	return {
		status: "found_with_sources",
		om_id: omId,
		project: inputs.project,
		observation,
		source_recall: recallResult.recall,
	};
}

/**
 * Format a GlobalRecallResult as the human-/agent-readable text body the
 * Pi tool wrapper returns. Keeps formatting in a pure function so it is
 * stable across rendering hosts and trivially unit-testable.
 */
export function formatGlobalRecallText(result: GlobalRecallResult): string {
	const lines: string[] = [];
	lines.push(`om_id: ${result.om_id}`);
	if (result.project) lines.push(`project: ${result.project}`);
	lines.push(`status: ${result.status}`);
	if (result.observation) {
		const obs = result.observation;
		lines.push(`kind: ${obs.om_kind ?? "?"}`);
		if (obs.om_relevance) lines.push(`relevance: ${obs.om_relevance}`);
		if (obs.om_timestamp) lines.push(`om_timestamp: ${obs.om_timestamp}`);
		if (obs.om_session_file) lines.push(`session_file: ${obs.om_session_file}`);
		if (obs.om_source_entry_ids && obs.om_source_entry_ids.length > 0) {
			lines.push(`source_entry_ids: ${obs.om_source_entry_ids.join(", ")}`);
		}
		lines.push("--- stored content ---");
		lines.push(obs.content);
	}
	if (result.source_unavailable_reason) {
		lines.push("--- exact source ---");
		lines.push(`unavailable: ${result.source_unavailable_reason}`);
	}
	if (result.source_recall) {
		lines.push("--- exact source ---");
		lines.push(JSON.stringify(result.source_recall, null, 2));
	}
	if (result.error) {
		lines.push(`error: ${result.error}`);
	}
	return lines.join("\n");
}

export const __internal = { OM_ID_PATTERN };
