/**
 * Pi-Mem — claude-mem extension for pi-mono agents
 *
 * Gives pi-agents (pi-coding-agent, custom pi-mono runtimes) persistent
 * cross-session memory by connecting to the claude-mem worker HTTP API.
 *
 * Derived from the OpenClaw plugin (claude-mem/openclaw/src/index.ts) which
 * is a proven integration pattern for pi-mono-based runtimes.
 *
 * Install:
 *   pi install npm:pi-agent-memory
 *   — or —
 *   pi install git:github.com/thedotmack/claude-mem --extensions pi-agent/extensions
 *
 * Requires: claude-mem worker running on localhost:37777
 */

import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { loadConfig, type PiMemConfig } from "./config.js";
import {
	formatGlobalRecallText,
	runGlobalRecall,
	type OMBridgeRecaller,
} from "./global-recall.js";

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_WORKER_PORT = 37777;

function discoverWorkerHost(): string {
  if (process.env.CLAUDE_MEM_HOST) return process.env.CLAUDE_MEM_HOST;
  const settingsDir = process.env.CLAUDE_MEM_DATA_DIR || join(homedir(), ".claude-mem");
  const settingsPath = join(settingsDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (typeof settings.CLAUDE_MEM_WORKER_HOST === "string") return settings.CLAUDE_MEM_WORKER_HOST;
    } catch { /* ignore parse/read errors */ }
  }
  return "127.0.0.1";
}

function discoverWorkerPort(): number {
  if (process.env.CLAUDE_MEM_PORT) {
    const parsed = parseInt(process.env.CLAUDE_MEM_PORT, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  const settingsDir = process.env.CLAUDE_MEM_DATA_DIR || join(homedir(), ".claude-mem");
  const settingsPath = join(settingsDir, "settings.json");
  if (existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
      if (typeof settings.CLAUDE_MEM_WORKER_PORT === "number" && Number.isFinite(settings.CLAUDE_MEM_WORKER_PORT)) {
        return settings.CLAUDE_MEM_WORKER_PORT;
      }
    } catch { /* ignore parse/read errors */ }
  }
  return DEFAULT_WORKER_PORT;
}

const WORKER_PORT = discoverWorkerPort();
const WORKER_HOST = discoverWorkerHost();
const PLATFORM_SOURCE = "pi-agent";
const MAX_TOOL_RESPONSE_LENGTH = 1000;
const SESSION_COMPLETE_DELAY_MS = 3000;
const WORKER_FETCH_TIMEOUT_MS = 10_000;
const MAX_SEARCH_LIMIT = 100;

// =============================================================================
// HTTP Helpers
//
// Mirrors the pattern from openclaw/src/index.ts (lines 267-340).
// Three variants: awaited POST, fire-and-forget POST, awaited GET.
// All awaited calls use AbortController for timeout protection.
// =============================================================================

function workerUrl(path: string): string {
	return `http://${WORKER_HOST}:${WORKER_PORT}${path}`;
}

/** Create an AbortController that auto-aborts after the configured timeout. */
function createTimeoutController(): { controller: AbortController; clear: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), WORKER_FETCH_TIMEOUT_MS);
	return { controller, clear: () => clearTimeout(timer) };
}

async function workerPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
	const { controller, clear } = createTimeoutController();
	try {
		const response = await fetch(workerUrl(path), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		if (!response.ok) {
			console.error(`[pi-mem] Worker POST ${path} returned ${response.status}`);
			return null;
		}
		return (await response.json()) as Record<string, unknown>;
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === "AbortError") {
			console.error(`[pi-mem] Worker POST ${path} timed out after ${WORKER_FETCH_TIMEOUT_MS}ms`);
			return null;
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[pi-mem] Worker POST ${path} failed: ${message}`);
		return null;
	} finally {
		clear();
	}
}

function workerPostFireAndForget(path: string, body: Record<string, unknown>): void {
	fetch(workerUrl(path), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	}).catch((error: unknown) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[pi-mem] Worker POST ${path} failed: ${message}`);
	});
}

async function workerGetJson<T = Record<string, unknown>>(path: string): Promise<{ status: number; body: T | null }> {
	const { controller, clear } = createTimeoutController();
	try {
		const response = await fetch(workerUrl(path), { signal: controller.signal });
		let body: T | null = null;
		try {
			body = (await response.json()) as T;
		} catch {
			body = null;
		}
		return { status: response.status, body };
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === "AbortError") {
			console.error(`[pi-mem] Worker GET ${path} timed out after ${WORKER_FETCH_TIMEOUT_MS}ms`);
			return { status: 0, body: null };
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[pi-mem] Worker GET ${path} failed: ${message}`);
		return { status: 0, body: null };
	} finally {
		clear();
	}
}

async function workerGetText(path: string): Promise<string | null> {
	const { controller, clear } = createTimeoutController();
	try {
		const response = await fetch(workerUrl(path), { signal: controller.signal });
		if (!response.ok) {
			console.error(`[pi-mem] Worker GET ${path} returned ${response.status}`);
			return null;
		}
		return await response.text();
	} catch (error: unknown) {
		if (error instanceof DOMException && error.name === "AbortError") {
			console.error(`[pi-mem] Worker GET ${path} timed out after ${WORKER_FETCH_TIMEOUT_MS}ms`);
			return null;
		}
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[pi-mem] Worker GET ${path} failed: ${message}`);
		return null;
	} finally {
		clear();
	}
}

// =============================================================================
// OM bridge recall loader (U5)
//
// Loads pi-observational-memory's recallSourcesFromSessionFile lazily so
// installations without OM still load this extension cleanly. Returns null
// when neither the U4 bridge surface nor a backwards-compatible fallback
// resolves — callers degrade to provenance-only recall in that case.
// =============================================================================

async function loadBridgeRecall(): Promise<OMBridgeRecaller | null> {
	try {
		const mod = (await import("pi-observational-memory/src/bridge.js")) as {
			recallSourcesFromSessionFile?: (
				sessionFile: string,
				omId: string,
			) => {
				recall: unknown;
				unavailableReason?: "missing-session-file" | "unreadable-session-file" | "empty-session-file";
			};
		};
		if (typeof mod.recallSourcesFromSessionFile === "function") {
			const fn = mod.recallSourcesFromSessionFile;
			return async (sessionFile, omId) => {
				const out = fn(sessionFile, omId);
				return {
					recall: (out.recall as Record<string, unknown> | null) ?? null,
					unavailableReason: out.unavailableReason,
				};
			};
		}
	} catch {
		/* fall through */
	}
	return null;
}

// =============================================================================
// Project Name Derivation
//
// Scopes observations by project. Uses PI_MEM_PROJECT env var if set,
// otherwise derives from the working directory basename with a "pi-" prefix.
// =============================================================================

function deriveProjectName(cwd: string): string {
	if (process.env.PI_MEM_PROJECT) {
		return process.env.PI_MEM_PROJECT;
	}
	const dir = basename(cwd);
	return `pi-${dir}`;
}

// =============================================================================
// Extension Factory
// =============================================================================

export default function piMemExtension(pi: ExtensionAPI) {
	// --- Extension state ---
	let contentSessionId: string | null = null;
	let projectName = "pi-agent";
	let sessionCwd = process.cwd();
	// Loaded once per session_start so project-local settings.json takes effect
	// without requiring a Pi reload between projects.
	let cfg: PiMemConfig = loadConfig();
	// Tracks whether the cross-session pi-mem context has been injected this
	// session (or this post-compaction window). Used by the "session-start"
	// contextInjection mode to inject exactly once per logical session.
	let contextInjected = false;

	// Check kill switch
	if (process.env.PI_MEM_DISABLED === "1") {
		return;
	}

	// =========================================================================
	// Event: session_start
	//
	// Initialize local state only. The worker init happens in
	// before_agent_start (which has the user prompt). We set up the session ID
	// here so tool_result handlers have a target from the first turn.
	// =========================================================================

	pi.on("session_start", async (_event, ctx) => {
		sessionCwd = ctx.cwd;
		projectName = deriveProjectName(sessionCwd);
		contentSessionId = `pi-${projectName}-${Date.now()}`;
		// Re-load config now that we know the project cwd, so project-local
		// .pi/settings.json can override the globally cached values picked up at
		// extension load.
		cfg = loadConfig({ cwd: sessionCwd });
		contextInjected = false;

		// Persist session ID into the session file for compaction recovery
		pi.appendEntry("pi-mem-session", { contentSessionId, projectName });
	});

	// =========================================================================
	// Event: before_agent_start
	//
	// Initialize the session in the worker with the user's prompt.
	// The worker needs the prompt for privacy filtering — observations are
	// queued until a prompt is registered.
	//
	// Mirrors openclaw/src/index.ts lines 722-741.
	// =========================================================================

	pi.on("before_agent_start", async (event) => {
		if (!contentSessionId) return;

		await workerPost("/api/sessions/init", {
			contentSessionId,
			project: projectName,
			prompt: event.prompt || "pi-agent session",
			platformSource: PLATFORM_SOURCE,
		});

		return undefined;
	});

	// =========================================================================
	// Event: context
	//
	// Inject past observations into the LLM context. Calls the worker's
	// context injection endpoint which returns a formatted timeline of
	// relevant past work.
	//
	// Does NOT filter by platform_source so that pi-agents see observations
	// from Claude Code, Cursor, OpenClaw, etc. — enabling cross-engine memory.
	//
	// Mirrors openclaw/src/index.ts lines 743-759, but uses pi-mono's
	// ContextEventResult (returning messages array) instead of OpenClaw's
	// appendSystemContext.
	// =========================================================================

	pi.on("context", async (event) => {
		if (!contentSessionId) return;

		// contextInjection cadence:
		//   - "disabled":      never inject
		//   - "session-start": inject exactly once per session (and once per
		//                      post-compaction window, see session_compact below)
		//   - "every-turn":    inject on every context event (default; legacy)
		if (cfg.contextInjection === "disabled") return;
		if (cfg.contextInjection === "session-start" && contextInjected) return;

		const projects = encodeURIComponent(projectName);
		const contextText = await workerGetText(`/api/context/inject?projects=${projects}`);

		if (!contextText || contextText.trim().length === 0) return;
		contextInjected = true;

		// Inject as a user message with XML tags to delineate memory context
		return {
			messages: [
				...event.messages,
				{
					role: "user" as const,
					content: [
						{
							type: "text" as const,
							text: `<pi-mem-context>\n${contextText}\n</pi-mem-context>`,
						},
					],
				},
			],
		};
	});

	// =========================================================================
	// Event: tool_result
	//
	// Capture tool observations. Fire-and-forget to avoid slowing down the
	// agent loop. Skips memory_recall to prevent recursive observation loops.
	//
	// Mirrors openclaw/src/index.ts lines 764-808.
	// =========================================================================

	pi.on("tool_result", (event) => {
		if (!contentSessionId) return;
		if (!cfg.captureToolResults) return;

		const toolName = event.toolName;
		if (!toolName) return;

		// Skip memory tools to prevent recursive observation loops
		if (toolName === "memory_recall") return;

		// Extract result text from content blocks
		let toolResponseText = "";
		if (Array.isArray(event.content)) {
			toolResponseText = event.content
				.filter((block): block is { type: "text"; text: string } => block.type === "text" && "text" in block)
				.map((block) => block.text)
				.join("\n");
		}

		// Truncate to prevent oversized payloads
		if (toolResponseText.length > MAX_TOOL_RESPONSE_LENGTH) {
			toolResponseText = toolResponseText.slice(0, MAX_TOOL_RESPONSE_LENGTH - 12) + " [truncated]";
		}

		workerPostFireAndForget("/api/sessions/observations", {
			contentSessionId,
			tool_name: toolName,
			tool_input: event.input || {},
			tool_response: toolResponseText,
			cwd: sessionCwd,
			platformSource: PLATFORM_SOURCE,
		});

		return undefined;
	});

	// =========================================================================
	// Event: agent_end
	//
	// Summarize the session and schedule completion. Uses await for summarize
	// to ensure the worker processes it before the completion call. Completion
	// is delayed to let in-flight fire-and-forget observations land.
	//
	// Mirrors openclaw/src/index.ts lines 813-845.
	// =========================================================================

	pi.on("agent_end", async (event) => {
		if (!contentSessionId) return;

		// Extract last assistant message for summarization
		let lastAssistantMessage = "";
		if (Array.isArray(event.messages)) {
			for (let i = event.messages.length - 1; i >= 0; i--) {
				const msg = event.messages[i];
				if (msg?.role === "assistant") {
					if (typeof msg.content === "string") {
						lastAssistantMessage = msg.content;
					} else if (Array.isArray(msg.content)) {
						lastAssistantMessage = msg.content
							.filter((block): block is { type: "text"; text: string } => block.type === "text" && "text" in block)
							.map((block) => block.text)
							.join("\n");
					}
					break;
				}
			}
		}

		// Await summarize so the worker receives it before complete
		await workerPost("/api/sessions/summarize", {
			contentSessionId,
			last_assistant_message: lastAssistantMessage,
			platformSource: PLATFORM_SOURCE,
		});

		// Delay completion to let in-flight observations arrive
		const sid = contentSessionId;
		setTimeout(() => {
			workerPostFireAndForget("/api/sessions/complete", {
				contentSessionId: sid,
				platformSource: PLATFORM_SOURCE,
			});
		}, SESSION_COMPLETE_DELAY_MS);
	});

	// =========================================================================
	// Event: session_compact
	//
	// Preserve session state across context compaction. The LLM's context
	// window was trimmed, but our session continues — do NOT create a new
	// session or re-init the worker.
	//
	// Mirrors openclaw/src/index.ts lines 714-717.
	// =========================================================================

	pi.on("session_compact", () => {
		// contentSessionId persists in extension state — do NOT re-init the
		// worker session. After compaction the LLM context window has been
		// trimmed, so for cadence "session-start" we re-arm the one-shot
		// injection so the next context event re-supplies cross-session memory
		// once. "every-turn" and "disabled" cadences are unaffected.
		if (cfg.contextInjection === "session-start") {
			contextInjected = false;
		}
	});

	// =========================================================================
	// Event: session_shutdown
	//
	// Clean up local state on process exit.
	// =========================================================================

	pi.on("session_shutdown", () => {
		contentSessionId = null;
	});

	// =========================================================================
	// Tool: memory_recall
	//
	// Registered tool that lets the LLM explicitly search past work sessions.
	// Uses the worker's search API (hybrid FTS5 + Chroma).
	// Does NOT filter by platform_source — returns results from all engines.
	// =========================================================================

	pi.registerTool({
		name: "memory_recall",
		label: "Memory Recall",
		description:
			"Search past work sessions for relevant context. Use when the user asks about previous work, or when you need context about how something was done before.",
		parameters: Type.Object({
			query: Type.String({ description: "Natural language search query" }),
			limit: Type.Optional(Type.Number({ description: "Max results to return (default: 5, max: 100)" })),
		}),

		async execute(_toolCallId, params) {
			const query = encodeURIComponent(String(params.query));
			const limit = Math.max(1, Math.min(typeof params.limit === "number" ? Math.floor(params.limit) : 5, MAX_SEARCH_LIMIT));
			const project = encodeURIComponent(projectName);

			const result = await workerGetText(`/api/search?query=${query}&limit=${limit}&project=${project}`);

			const text = result || "No matching memories found.";
			return {
				content: [{ type: "text" as const, text }],
				details: undefined,
			};
		},
	});

	// =========================================================================
	// Command: /memory-status
	//
	// Quick health check — verifies the worker is reachable and shows
	// current session state.
	// =========================================================================

	// =========================================================================
	// Tool: global_recall
	//
	// Provenance-aware cross-session recall (U5). Maps a known OM 12-char hex
	// id back to its stored long-term observation in the pi-mem worker, and
	// when the original session file is still available, recovers exact
	// source evidence via OM's bridge surface (recallSourcesFromSessionFile).
	//
	// Distinct from `memory_recall` (semantic search) and OM's session-local
	// `recall` tool. Use `memory_recall` to discover ids; use this tool to
	// retrieve provenance and exact evidence for a known id.
	// =========================================================================

	pi.registerTool({
		name: "global_recall",
		label: "Global Recall",
		description:
			"Recover the long-term pi-mem record for a known observational-memory id (12-char hex). Returns the stored observation/reflection plus exact source evidence when the original session file is available. Use after `memory_recall` surfaces an om_id that needs deeper context.",
		parameters: Type.Object({
			om_id: Type.String({ description: "12-character hex OM id (e.g. '0123456789ab')" }),
			project: Type.Optional(Type.String({ description: "Optional project scope; defaults to all projects" })),
		}),

		async execute(_toolCallId, params) {
			const result = await runGlobalRecall(
				{
					om_id: String(params.om_id ?? ""),
					project: typeof params.project === "string" ? params.project : undefined,
				},
				{
					fetchWorker: async (path) => workerGetJson(path),
					loadOmBridgeRecall: loadBridgeRecall,
				},
			);
			return {
				content: [{ type: "text" as const, text: formatGlobalRecallText(result) }],
				details: result,
			};
		},
	});

	pi.registerCommand("memory-status", {
		description: "Show pi-mem connection status and current session info",
		handler: async (_args, ctx) => {
			const { controller, clear } = createTimeoutController();
			try {
				const response = await fetch(workerUrl("/api/health"), { signal: controller.signal });
				if (response.ok) {
					const data = (await response.json()) as Record<string, unknown>;
					ctx.ui.notify(
						`pi-mem: connected to worker v${data.version || "?"} | session: ${contentSessionId || "none"} | project: ${projectName}`,
						"info",
					);
				} else {
					ctx.ui.notify(`pi-mem: worker returned HTTP ${response.status}`, "warning");
				}
			} catch {
				ctx.ui.notify("pi-mem: worker not reachable at " + workerUrl("/api/health"), "error");
			} finally {
				clear();
			}
		},
	});
}
