/**
 * pi-mem extension configuration loader.
 *
 * Reads the "pi-mem" namespace from Pi's settings.json files (global and
 * project), with project settings winning over global settings. Mirrors the
 * settings-loader pattern used by pi-observational-memory's src/config.ts so
 * the two extensions feel consistent when used together.
 *
 * Config keys (under the "pi-mem" object in settings.json):
 *   - captureToolResults: boolean — when false, the tool_result handler does
 *     NOT post observations to the worker. Useful when running combined with
 *     pi-observational-memory and an OM-to-pi-mem bridge that exports
 *     compacted high-signal observations on its own.
 *   - contextInjection: "every-turn" | "session-start" | "disabled" — controls
 *     how often the context handler injects pi-mem worker context into the
 *     LLM turn. Default "every-turn" preserves existing behavior. "session-start"
 *     injects once per session (and once after each compaction). "disabled"
 *     never injects.
 *
 * Defaults match pre-config behavior so installs that do not configure
 * "pi-mem" continue to behave exactly as they did before.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ContextInjectionMode = "every-turn" | "session-start" | "disabled";

export interface PiMemConfig {
	captureToolResults: boolean;
	contextInjection: ContextInjectionMode;
}

export const DEFAULTS: PiMemConfig = {
	captureToolResults: true,
	contextInjection: "every-turn",
};

const SETTINGS_KEY = "pi-mem";

const VALID_CONTEXT_INJECTION: ReadonlySet<ContextInjectionMode> = new Set<ContextInjectionMode>([
	"every-turn",
	"session-start",
	"disabled",
]);

/**
 * Replicates pi-coding-agent's getAgentDir() without taking a hard import
 * dependency on @mariozechner/pi-coding-agent. This keeps the config module
 * unit-testable and preserves the existing .pi-agent peerDependency model.
 *
 * Honors PI_CODING_AGENT_DIR for CI / sandbox overrides, expands a leading
 * "~" the same way pi-coding-agent does, and otherwise falls back to
 * ~/.pi/agent.
 */
function defaultAgentDir(env: NodeJS.ProcessEnv): string {
	const envDir = env.PI_CODING_AGENT_DIR;
	if (envDir && envDir.length > 0) {
		if (envDir === "~") return homedir();
		if (envDir.startsWith("~/")) return homedir() + envDir.slice(1);
		return envDir;
	}
	return join(homedir(), ".pi", "agent");
}

function normalize(value: Partial<PiMemConfig>): Partial<PiMemConfig> {
	const out: Partial<PiMemConfig> = {};
	if (typeof value.captureToolResults === "boolean") {
		out.captureToolResults = value.captureToolResults;
	}
	if (
		typeof value.contextInjection === "string" &&
		VALID_CONTEXT_INJECTION.has(value.contextInjection as ContextInjectionMode)
	) {
		out.contextInjection = value.contextInjection as ContextInjectionMode;
	}
	return out;
}

function readNamespacedConfig(path: string): Partial<PiMemConfig> {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		const nested = raw[SETTINGS_KEY];
		return nested && typeof nested === "object" && !Array.isArray(nested)
			? normalize(nested as Partial<PiMemConfig>)
			: {};
	} catch {
		// Malformed JSON or unreadable file — fall back to defaults rather than
		// crash the extension. pi-observational-memory's loader does the same.
		return {};
	}
}

export interface LoadConfigOptions {
	/** Project working directory; defaults to process.cwd(). */
	cwd?: string;
	/** Override for the global Pi agent dir (defaults to PI_CODING_AGENT_DIR or ~/.pi/agent). */
	agentDir?: string;
	/** Process env override; mainly for tests. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Load the merged pi-mem extension config.
 *
 * Precedence (later wins):
 *   1. DEFAULTS
 *   2. <agentDir>/settings.json  ("pi-mem" namespace)
 *   3. <cwd>/.pi/settings.json   ("pi-mem" namespace)
 */
export function loadConfig(opts: LoadConfigOptions = {}): PiMemConfig {
	const env = opts.env ?? process.env;
	const cwd = opts.cwd ?? process.cwd();
	const agentDir = opts.agentDir ?? defaultAgentDir(env);

	const globalPath = join(agentDir, "settings.json");
	const projectPath = join(cwd, ".pi", "settings.json");

	return {
		...DEFAULTS,
		...readNamespacedConfig(globalPath),
		...readNamespacedConfig(projectPath),
	};
}
