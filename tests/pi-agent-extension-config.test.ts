/**
 * Unit tests for pi-agent/extensions/config.ts.
 *
 * Targets the loadConfig() merge precedence and validation. Does NOT exercise
 * the live ExtensionAPI — those behaviors are covered by the extension
 * itself once an integration harness exists.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DEFAULTS,
	loadConfig,
	type PiMemConfig,
} from "../pi-agent/extensions/config.ts";

let agentDir: string;
let cwd: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "pi-mem-agent-"));
	cwd = mkdtempSync(join(tmpdir(), "pi-mem-cwd-"));
});

afterEach(() => {
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
});

function writeGlobal(config: unknown): void {
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify(config, null, 2));
}

function writeProject(config: unknown): void {
	const dir = join(cwd, ".pi");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "settings.json"), JSON.stringify(config, null, 2));
}

describe("loadConfig", () => {
	test("returns DEFAULTS when no settings files exist", () => {
		const cfg = loadConfig({ cwd, agentDir, env: {} });
		expect(cfg).toEqual(DEFAULTS);
	});

	test("preserves backward-compatible defaults", () => {
		// Sanity gate so a future doc/code change to DEFAULTS surfaces here.
		expect(DEFAULTS.captureToolResults).toBe(true);
		expect(DEFAULTS.contextInjection).toBe("every-turn");
	});

	test("reads global settings under 'pi-mem' key", () => {
		writeGlobal({
			"pi-mem": {
				captureToolResults: false,
				contextInjection: "session-start",
			},
		});
		const cfg = loadConfig({ cwd, agentDir, env: {} });
		expect(cfg.captureToolResults).toBe(false);
		expect(cfg.contextInjection).toBe("session-start");
	});

	test("ignores unrelated keys in settings.json", () => {
		writeGlobal({
			"observational-memory": { passive: true },
			"pi-mem": { contextInjection: "disabled" },
		});
		const cfg = loadConfig({ cwd, agentDir, env: {} });
		expect(cfg.contextInjection).toBe("disabled");
		expect(cfg.captureToolResults).toBe(true); // default
	});

	test("project settings override global settings", () => {
		writeGlobal({ "pi-mem": { contextInjection: "every-turn", captureToolResults: false } });
		writeProject({ "pi-mem": { contextInjection: "session-start" } });
		const cfg = loadConfig({ cwd, agentDir, env: {} });
		// project wins on contextInjection; global captureToolResults survives
		expect(cfg.contextInjection).toBe("session-start");
		expect(cfg.captureToolResults).toBe(false);
	});

	test("rejects invalid contextInjection value and falls back to default", () => {
		writeGlobal({ "pi-mem": { contextInjection: "every-keystroke" } });
		const cfg = loadConfig({ cwd, agentDir, env: {} });
		expect(cfg.contextInjection).toBe(DEFAULTS.contextInjection);
	});

	test("rejects non-boolean captureToolResults and falls back to default", () => {
		writeGlobal({ "pi-mem": { captureToolResults: "yes" } });
		const cfg = loadConfig({ cwd, agentDir, env: {} });
		expect(cfg.captureToolResults).toBe(DEFAULTS.captureToolResults);
	});

	test("malformed JSON does not throw — returns defaults", () => {
		writeFileSync(join(agentDir, "settings.json"), "{ this is not json");
		expect(() => loadConfig({ cwd, agentDir, env: {} })).not.toThrow();
		const cfg = loadConfig({ cwd, agentDir, env: {} });
		expect(cfg).toEqual(DEFAULTS);
	});

	test("non-object 'pi-mem' value (e.g. array) is ignored", () => {
		writeGlobal({ "pi-mem": [1, 2, 3] });
		const cfg = loadConfig({ cwd, agentDir, env: {} });
		expect(cfg).toEqual(DEFAULTS);
	});

	test("PI_CODING_AGENT_DIR overrides default global path", () => {
		// Put a config under a custom agent dir, point env at it, and verify
		// loadConfig finds it without an explicit agentDir option.
		const customAgentDir = mkdtempSync(join(tmpdir(), "pi-mem-custom-agent-"));
		try {
			writeFileSync(
				join(customAgentDir, "settings.json"),
				JSON.stringify({ "pi-mem": { contextInjection: "disabled" } }, null, 2),
			);

			const cfg: PiMemConfig = loadConfig({
				cwd,
				env: { PI_CODING_AGENT_DIR: customAgentDir },
			});
			expect(cfg.contextInjection).toBe("disabled");
		} finally {
			rmSync(customAgentDir, { recursive: true, force: true });
		}
	});
});
