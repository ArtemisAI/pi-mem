/**
 * global_recall tool decision-logic tests (U5).
 *
 * Drives runGlobalRecall() against captured fakes for the worker fetch and
 * OM bridge recall surfaces. Covers id validation, found/not-found paths,
 * source-availability variants, and the formatter's text output shape.
 */

import { describe, expect, test } from "bun:test";

import {
	formatGlobalRecallText,
	runGlobalRecall,
	type FetchWorker,
	type GlobalRecallResult,
	type OMBridgeRecaller,
	type OMProvenanceRow,
} from "../pi-agent/extensions/global-recall.ts";

function row(over: Partial<OMProvenanceRow> = {}): OMProvenanceRow {
	return {
		id: 1,
		project: "pi-test",
		source: "pi-observational-memory",
		om_id: "0123456789ab",
		om_kind: "observation",
		om_relevance: "high",
		om_timestamp: "2026-05-08 03:00",
		om_session_file: "/tmp/sessions/foo.jsonl",
		om_source_entry_ids: ["entry-1"],
		content: "stored content",
		created_at: "2026-05-08T03:00:00.000Z",
		created_at_epoch: 1_780_000_000_000,
		...over,
	};
}

function fetcher(spec: { status: number; body: unknown }): FetchWorker {
	return async () => ({ status: spec.status, body: spec.body });
}

const omRecall = (impl: OMBridgeRecaller): OMBridgeRecaller => impl;

const noBridge: OMBridgeRecaller | null = null;

describe("runGlobalRecall", () => {
	test("invalid_om_id when id does not match 12-char hex", async () => {
		const result = await runGlobalRecall(
			{ om_id: "not-hex" },
			{
				fetchWorker: fetcher({ status: 200, body: row() }),
				loadOmBridgeRecall: async () => null,
			},
		);
		expect(result.status).toBe("invalid_om_id");
	});

	test("not_found when worker returns 404", async () => {
		const result = await runGlobalRecall(
			{ om_id: "0123456789ab" },
			{
				fetchWorker: fetcher({ status: 404, body: { error: "not_found" } }),
				loadOmBridgeRecall: async () => null,
			},
		);
		expect(result.status).toBe("not_found");
	});

	test("worker_error when worker returns 500", async () => {
		const result = await runGlobalRecall(
			{ om_id: "0123456789ab" },
			{
				fetchWorker: fetcher({ status: 500, body: null }),
				loadOmBridgeRecall: async () => null,
			},
		);
		expect(result.status).toBe("worker_error");
	});

	test("found_no_sources when stored row lacks a session file", async () => {
		const result = await runGlobalRecall(
			{ om_id: "0123456789ab" },
			{
				fetchWorker: fetcher({ status: 200, body: row({ om_session_file: null }) }),
				loadOmBridgeRecall: async () => omRecall(async () => ({ recall: null, unavailableReason: "missing-session-file" })),
			},
		);
		expect(result.status).toBe("found_no_sources");
		expect(result.source_unavailable_reason).toBe("no-session-file");
	});

	test("found_no_sources when OM bridge cannot load", async () => {
		const result = await runGlobalRecall(
			{ om_id: "0123456789ab" },
			{
				fetchWorker: fetcher({ status: 200, body: row() }),
				loadOmBridgeRecall: async () => noBridge,
			},
		);
		expect(result.status).toBe("found_no_sources");
		expect(result.source_unavailable_reason).toBe("om-bridge-unavailable");
	});

	test("found_no_sources when bridge reports unreadable session file", async () => {
		const result = await runGlobalRecall(
			{ om_id: "0123456789ab" },
			{
				fetchWorker: fetcher({ status: 200, body: row() }),
				loadOmBridgeRecall: async () =>
					omRecall(async () => ({ recall: null, unavailableReason: "unreadable-session-file" })),
			},
		);
		expect(result.status).toBe("found_no_sources");
		expect(result.source_unavailable_reason).toBe("unreadable-session-file");
	});

	test("found_with_sources when bridge returns a recall result", async () => {
		const recallResult = {
			memoryId: "0123456789ab",
			matches: [{ kind: "observation", entryId: "entry-1" }],
		};
		const result = await runGlobalRecall(
			{ om_id: "0123456789ab" },
			{
				fetchWorker: fetcher({ status: 200, body: row() }),
				loadOmBridgeRecall: async () => omRecall(async () => ({ recall: recallResult })),
			},
		);
		expect(result.status).toBe("found_with_sources");
		expect(result.source_recall).toEqual(recallResult);
		expect(result.observation?.om_session_file).toBe("/tmp/sessions/foo.jsonl");
	});

	test("project query parameter is forwarded to worker", async () => {
		let capturedPath = "";
		const capture: FetchWorker = async (path) => {
			capturedPath = path;
			return { status: 404, body: { error: "not_found" } };
		};
		await runGlobalRecall(
			{ om_id: "0123456789ab", project: "pi-foo" },
			{
				fetchWorker: capture,
				loadOmBridgeRecall: async () => null,
			},
		);
		expect(capturedPath).toBe("/api/search/by-om-id/0123456789ab?project=pi-foo");
	});
});

describe("formatGlobalRecallText", () => {
	test("invalid_om_id renders without observation block", () => {
		const text = formatGlobalRecallText({ status: "invalid_om_id", om_id: "garbage" });
		expect(text).toContain("status: invalid_om_id");
		expect(text).not.toContain("--- stored content ---");
	});

	test("found_with_sources includes both stored content and exact source", () => {
		const obs = row();
		const result: GlobalRecallResult = {
			status: "found_with_sources",
			om_id: obs.om_id ?? "0123456789ab",
			project: "pi-test",
			observation: obs,
			source_recall: { memoryId: obs.om_id, matches: [] },
		};
		const text = formatGlobalRecallText(result);
		expect(text).toContain("status: found_with_sources");
		expect(text).toContain("--- stored content ---");
		expect(text).toContain("--- exact source ---");
		expect(text).toContain("session_file: /tmp/sessions/foo.jsonl");
		expect(text).toContain("source_entry_ids: entry-1");
	});

	test("found_no_sources includes the unavailable reason", () => {
		const result: GlobalRecallResult = {
			status: "found_no_sources",
			om_id: "0123456789ab",
			observation: row(),
			source_unavailable_reason: "missing-session-file",
		};
		const text = formatGlobalRecallText(result);
		expect(text).toContain("unavailable: missing-session-file");
	});
});
