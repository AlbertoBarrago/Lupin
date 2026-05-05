/**
 * @module queryEngine
 * Agentic loop engine that drives multi-step tool-use tasks.
 * Manages workflow guards (inspect → edit → verify), web-query pre-fetching,
 * streaming model output, and loop detection.
 */

import {
	extractJsonObject,
	isValidFinalShape,
	isValidToolCallShape,
	normalizeShape,
} from "./jsonProtocol.mjs";
import { preloadWorkspaceFiles } from "./workspaceContext.mjs";

/**
 * Unescapes common JSON string escape sequences in a raw string.
 * Used to clean streamed content tokens before emitting them to the caller.
 *
 * @param {string} str - The string containing JSON escape sequences.
 * @returns {string} The unescaped string.
 */
function unescapeJson(str) {
	return str
		.replace(/\\n/g, "\n")
		.replace(/\\t/g, "\t")
		.replace(/\\r/g, "")
		.replace(/\\"/g, '"')
		.replace(/\\\\/g, "\\");
}

import { buildSystemPrompt } from "../prompt/systemPrompt.mjs";

/**
 * Strips a leading "assistant>" prefix from task text and normalizes internal
 * whitespace to a single space.
 *
 * @param {string} task - Raw task string, potentially prefixed with "assistant>".
 * @returns {string} Cleaned, trimmed task string.
 */
function normalizeTaskText(task) {
	return String(task || "")
		.replace(/^\s*assistant>\s*/i, "")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Keyword heuristic that detects whether a task is a question about the current
 * repository or codebase. Supports English and Italian phrases.
 *
 * @param {string} task - Raw task string.
 * @returns {boolean} `true` if the task looks like a project/repo question.
 */
function looksLikeProjectQuestion(task) {
	const value = normalizeTaskText(task).toLowerCase();
	if (!value) return false;
	return (
		value.includes("project") ||
		value.includes("repository") ||
		value.includes("repo") ||
		value.includes("codebase") ||
		value.includes("this code") ||
		value.includes("why is this") ||
		value.includes("what is this") ||
		value.includes("interesting") ||
		value.includes("good project") ||
		value.includes("bel progetto") ||
		value.includes("perché")
	);
}

/**
 * Keyword heuristic that detects whether a task requires real-time or web-sourced
 * information (weather, news, prices, etc.). Supports English and Italian phrases.
 *
 * @param {string} task - Raw task string.
 * @returns {boolean} `true` if the task looks like a web/real-time query.
 */
function looksLikeWebQuery(task) {
	const value = normalizeTaskText(task).toLowerCase();
	if (!value) return false;
	return (
		value.includes("weather") ||
		value.includes("meteo") ||
		value.includes("clima") ||
		value.includes("temperature") ||
		value.includes("temperatura") ||
		value.includes("news") ||
		value.includes("notizie") ||
		value.includes("latest") ||
		value.includes("current") ||
		value.includes("today") ||
		value.includes("oggi") ||
		value.includes("adesso") ||
		value.includes("now ") ||
		value.includes("recent") ||
		value.includes("recenti") ||
		value.includes("cerca sul web") ||
		value.includes("search the web") ||
		value.includes("ricerca web") ||
		value.includes("fai una ricerca") ||
		value.includes("cerca online") ||
		value.includes("trova online") ||
		value.includes("what is the") ||
		value.includes("what's the") ||
		value.includes("who is") ||
		value.includes("chi è") ||
		value.includes("price of") ||
		value.includes("prezzo di")
	);
}

/**
 * Builds a system-injection string that instructs the model to use WebSearchTool
 * immediately and ignore any prior refusals about web access.
 *
 * @returns {string} A single-line instruction string for injection into the message list.
 */
function buildWebQueryInstruction() {
	return [
		"WEB_QUERY:",
		"This question requires current or real-time information that is not in your training data.",
		"You MUST use WebSearchTool immediately — do NOT answer from memory or repeat any refusal you may have given in prior turns.",
		"IGNORE any previous assistant messages where you said you cannot access the web — those were wrong. You DO have WebSearchTool.",
		"Call WebSearchTool with a focused query, read the results, then give a final answer based on what you found.",
		"If the results are insufficient, use WebFetchTool to read one of the result URLs for more detail.",
		"Never say you cannot access the web — you have WebSearchTool available.",
	].join(" ");
}

/**
 * Keyword heuristic that detects whether a task involves writing or modifying code
 * (implement, fix, refactor, add, create, etc.).
 *
 * @param {string} task - Raw task string.
 * @returns {boolean} `true` if the task looks like a coding/implementation request.
 */
function looksLikeImplementationTask(task) {
	const value = normalizeTaskText(task).toLowerCase();
	if (!value) return false;
	return (
		value.includes("implement") ||
		value.includes("feature") ||
		value.includes("add ") ||
		value.includes("create ") ||
		value.includes("build ") ||
		value.includes("fix ") ||
		value.includes("bug") ||
		value.includes("refactor") ||
		value.includes("update ") ||
		value.includes("modify ")
	);
}

/**
 * Builds a system-injection string that enforces the inspect → edit → verify
 * workflow for implementation tasks.
 *
 * @returns {string} A single-line instruction string for injection into the message list.
 */
function buildImplementationWorkflowInstruction() {
	return [
		"IMPLEMENTATION_WORKFLOW:",
		"This task likely requires code changes.",
		"First inspect relevant files before editing anything.",
		"Use GlobTool/GrepTool/FileReadTool to locate the right files and understand existing patterns.",
		"Then make the smallest necessary edit.",
		"Prefer FileEditTool for targeted changes inside existing files. Use FileWriteTool when creating a new file or replacing a file intentionally.",
		"After editing, verify the result before finishing.",
		"Verification should prefer reading the changed files and running a focused BashTool command when appropriate, such as tests, lint, or typecheck.",
		"Your final answer must mention what changed and how you verified it.",
	].join(" ");
}

/**
 * Builds a system-injection string that instructs the model to explore the
 * repository structure before answering a project-level question.
 *
 * @param {object}   workspaceContext         - Workspace context object produced by `workspaceContext.mjs`.
 * @param {string[]} workspaceContext.markers - Detected manifest/marker filenames (e.g. `package.json`).
 * @returns {string} A single-line instruction string for injection into the message list.
 */
function buildProjectProbeInstruction(workspaceContext) {
	const targets = [
		"README.md",
		...workspaceContext.markers.filter((name) => name !== "README.md"),
	].slice(0, 6);

	return [
		"PROJECT_PROBE:",
		"This question is about the repository as a whole.",
		"Before answering, inspect the repo first.",
		`Start with GlobTool to inspect structure, then read the most relevant files such as: ${targets.length ? targets.join(", ") : "README.md and likely entry files"}.`,
		'Do not answer with "Unknown" or claim missing project information until you have inspected at least one structural source and one content source.',
	].join(" ");
}

/**
 * Detects whether a model answer is a refusal to access the web.
 * Matches common English and Italian refusal phrases.
 *
 * @param {string} answer - The model's proposed final answer text.
 * @returns {boolean} `true` if the answer looks like a web-access refusal.
 */
function isWebRefusal(answer) {
	const v = String(answer || "").toLowerCase();
	return (
		v.includes("non sono in grado") ||
		v.includes("non posso") ||
		v.includes("i'm unable") ||
		v.includes("i cannot") ||
		v.includes("i can't") ||
		v.includes("cannot access") ||
		v.includes("no access") ||
		v.includes("real-time") ||
		v.includes("in tempo reale") ||
		v.includes("ti consiglio di controllare") ||
		v.includes("check a weather") ||
		v.includes("consult a") ||
		v.includes("visit a")
	);
}

/**
 * Detects whether a model answer is vague, empty, or otherwise useless
 * (e.g. "Unknown", an apology, or a placeholder string).
 *
 * @param {string} answer - The model's proposed final answer text.
 * @returns {boolean} `true` if the answer should be treated as weak/unusable.
 */
export function isWeakFinalAnswer(answer) {
	const raw = String(answer || "").trim();
	if (!raw) return true;
	const value = raw.toLowerCase();
	if (value === "unknown") return true;
	if (value.startsWith("unknown.")) return true;
	if (value.includes("no information about the project is available yet"))
		return true;
	if (value.includes('inspected "init" file')) return true;
	if (value.includes("i apologize")) return true;
	if (value.includes("sorry")) return true;
	if (value.includes("let me try again")) return true;
	if (value.includes("let us try again")) return true;
	// Weak-model filler responses
	if (
		value === "ok" ||
		value === "okay" ||
		value === "sure" ||
		value === "got it"
	)
		return true;
	if (value.startsWith("i'll help you") || value.startsWith("i will help you"))
		return true;
	if (value.startsWith("of course") || value.startsWith("certainly"))
		return true;
	return false;
}

/**
 * Constructs a human-readable fallback answer derived purely from workspace
 * context signals (markers, README summary, top-level entries) when the model
 * fails to produce a useful response.
 *
 * @param {object}           workspaceContext                 - Workspace context object produced by `workspaceContext.mjs`.
 * @param {string[]}         workspaceContext.markers         - Detected manifest/marker filenames.
 * @param {string[]}         workspaceContext.topLevel        - Top-level directory/file entries.
 * @param {string|undefined} workspaceContext.readmeSummary   - Optional README summary text.
 * @returns {string} A fallback answer string safe to return directly to the user.
 */
function buildWorkspaceFallback(workspaceContext) {
	const markers = workspaceContext.markers.length
		? workspaceContext.markers.join(", ")
		: "no obvious manifest markers";
	const topLevel = workspaceContext.topLevel
		.slice(0, 8)
		.map((entry) => entry.replace(/^\[(dir|file)\]\s*/, ""))
		.join(", ");

	return [
		"I do not have enough inspected implementation detail for a strong answer yet, but this repository already looks structured rather than empty.",
		`I can see workspace signals like ${markers}.`,
		workspaceContext.readmeSummary
			? `The README suggests: ${workspaceContext.readmeSummary}`
			: "There is no useful README summary yet.",
		topLevel ? `Top-level entries include ${topLevel}.` : "",
		"Ask again after /init or tell Lupin to inspect the repository first, and it should answer with something more concrete.",
	]
		.filter(Boolean)
		.join(" ");
}

/**
 * Returns `true` if the given tool name is a read-only inspection tool
 * (GlobTool, GrepTool, or FileReadTool).
 *
 * @param {string} toolName - The tool name to test.
 * @returns {boolean} `true` for inspection-only tools.
 */
function isInspectionTool(toolName) {
	return (
		toolName === "GlobTool" ||
		toolName === "GrepTool" ||
		toolName === "FileReadTool"
	);
}

/**
 * Returns `true` if the given bash command string looks like a verification
 * command (test runner, linter, type-checker, etc.).
 *
 * @param {string} command - The shell command string to inspect.
 * @returns {boolean} `true` if the command is a recognized verification command.
 */
function isVerificationBash(command) {
	const value = String(command || "").toLowerCase();
	return (
		value.includes("test") ||
		value.includes("lint") ||
		value.includes("typecheck") ||
		value.includes("check") ||
		value.includes("vitest") ||
		value.includes("jest") ||
		value.includes("pytest") ||
		value.includes("tsc")
	);
}

/**
 * Drives the agentic loop for a single task. Orchestrates model calls,
 * tool execution, streaming, workflow guards, and loop detection.
 */
export class QueryEngine {
	/**
	 * @param {object}      options
	 * @param {object}      options.modelAdapter              - OllamaAdapter (or compatible) model client.
	 * @param {object}      options.toolRuntime               - ToolRuntime instance for tool execution and workspace context.
	 * @param {number}      [options.maxSteps=12]             - Maximum number of agentic loop steps before forcing a final answer.
	 * @param {boolean}     [options.debug=false]             - If `true`, emits verbose step/tool diagnostics to stderr.
	 * @param {object|null} [options.initSnapshot=null]       - Initial workspace snapshot injected into every system prompt.
	 */
	constructor({
		modelAdapter,
		toolRuntime,
		maxSteps = 12,
		debug = false,
		initSnapshot = null,
	}) {
		this.modelAdapter = modelAdapter;
		this.toolRuntime = toolRuntime;
		this.maxSteps = maxSteps;
		this.debug = debug;
		this.initSnapshot = initSnapshot;
	}

	/**
	 * Updates the stored workspace snapshot that is injected into every system prompt.
	 *
	 * @param {object} snapshot - New workspace snapshot produced by `workspaceInit.mjs`.
	 * @returns {void}
	 */
	setSnapshot(snapshot) {
		this.initSnapshot = snapshot;
	}

	/**
	 * Streams a model response, detects whether it is a `final` answer or a
	 * `tool_call`, and yields structured events for each content token.
	 *
	 * Yields:
	 * - `{type:'stream_start'}` — once, when answer content begins flowing.
	 * - `{type:'token', value: string}` — decoded content tokens.
	 * - `{type:'_raw', text: string}` — internal sentinel: the full raw response text
	 *   for JSON parsing. Always the last event yielded.
	 *
	 * Internal phases:
	 * - `detect`       — inspects the first `DETECT_LIMIT` characters to classify the response type.
	 * - `tool_call`    — drains the stream silently; no events emitted.
	 * - `final_seek`   — scans for the `"content":` key inside the JSON envelope.
	 * - `final_stream` — yields decoded content tokens while holding back `HOLD` chars
	 *                    to strip the closing `"}` artifact before flushing.
	 *
	 * @param {object[]} messages - Message array to send to the model.
	 * @param {object}   options  - Options forwarded verbatim to `modelAdapter.chatStream`.
	 * @yields {{ type: 'stream_start' | 'token' | '_raw', value?: string, text?: string }}
	 * @throws {Error} If the model returns an empty response.
	 */
	async *#streamStep(messages, options) {
		let fullText = "";
		let phase = "detect"; // detect | tool_call | final_seek | final_stream
		let held = "";
		const HOLD = 20;
		const DETECT_LIMIT = 80;
		let streamStarted = false;

		for await (const token of this.modelAdapter.chatStream(messages, options)) {
			fullText += token;

			if (phase === "detect") {
				if (
					fullText.includes('"type":"final"') ||
					fullText.includes('"type": "final"')
				) {
					phase = "final_seek";
				} else if (
					fullText.length > DETECT_LIMIT ||
					fullText.includes("tool_call") ||
					fullText.includes("file_write") ||
					fullText.includes("file_read") ||
					fullText.includes("file_delete") ||
					fullText.includes("bash")
				) {
					phase = "tool_call";
				}
			}

			if (phase === "final_seek") {
				const m = fullText.match(/"content"\s*:\s*"/);
				if (m) {
					phase = "final_stream";
					held = fullText.slice(m.index + m[0].length);
				}
			} else if (phase === "final_stream") {
				if (!streamStarted) {
					streamStarted = true;
					yield { type: "stream_start" };
				}
				held += token;
				if (held.length > HOLD) {
					const chunk = held.slice(0, held.length - HOLD);
					held = held.slice(held.length - HOLD);
					yield { type: "token", value: unescapeJson(chunk) };
				}
			}
		}

		if (phase === "final_stream") {
			if (!streamStarted) yield { type: "stream_start" };
			const clean = held.replace(/\\n$/, "").replace(/["}\s`]+$/, "");
			if (clean) yield { type: "token", value: unescapeJson(clean) };
		}

		if (!fullText.trim()) throw new Error("empty ollama response");
		yield { type: "_raw", text: fullText };
	}

	/**
	 * Main agentic loop. Builds the system prompt and message history, injects
	 * workflow instructions, pre-fetches web results when needed, then runs up to
	 * `maxSteps` iterations of: model call → JSON parse → tool execution or final answer.
	 *
	 * Workflow guards enforced during the loop:
	 * - Implementation tasks must inspect at least one file before finalizing.
	 * - Implementation tasks that edited files must verify before finalizing.
	 * - Web queries must attempt WebSearchTool before the model can produce a refusal.
	 * - Identical tool calls repeated 3 times in a row trigger a `LOOP_DETECTED` push-back.
	 *
	 * If `maxSteps` is exhausted, a forced final prompt is sent to the model. If that
	 * also fails to produce a valid final shape, a hard step-limit message is returned.
	 *
	 * @param {string}   task                 - The raw user task string.
	 * @param {object[]} [historyMessages=[]] - Previous conversation messages to prepend for context.
	 * @yields {{ type: 'tool_call',   tool: string, args: object }}
	 * @yields {{ type: 'tool_result', tool: string, args: object, result: object }}
	 * @yields {{ type: 'stream_start' }}
	 * @yields {{ type: 'token',  value: string }}
	 * @yields {{ type: 'done',   answer: string, transcript: object[], steps: number,
	 *            inspectedFiles: string[], changedFiles: string[],
	 *            toolLog: object[], tokenStats: { promptTokens: number, completionTokens: number } }}
	 */
	async *runTask(task, historyMessages = []) {
		const normalizedTask = normalizeTaskText(task);
		const workspaceContext = this.toolRuntime.getWorkspaceContext();
		const workspaceIsEmpty = workspaceContext.topLevel.length === 0;
		const implementationTask = looksLikeImplementationTask(normalizedTask);
		const webQuery = looksLikeWebQuery(normalizedTask);
		const preloadedFiles = preloadWorkspaceFiles(this.toolRuntime.projectRoot);
		const systemPrompt = buildSystemPrompt(
			this.toolRuntime.listTools(),
			workspaceContext,
			this.initSnapshot,
			preloadedFiles,
		);
		const messages = [
			{ role: "system", content: systemPrompt },
			...historyMessages,
		];

		let webSearchUsed = false;

		if (looksLikeProjectQuestion(normalizedTask)) {
			messages.push({
				role: "user",
				content: buildProjectProbeInstruction(workspaceContext),
			});
		}

		// For large repos (preload skipped), inject pre-analyzed structural summary so
		// the model has a starting map without burning steps on exploratory GlobTool calls.
		if (!preloadedFiles && !workspaceIsEmpty && this.initSnapshot) {
			const s = this.initSnapshot;
			const parts = [
				"REPO_SUMMARY (pre-analyzed):",
				s.stacks?.length ? `stack=${s.stacks.join("+")}` : null,
				s.frameworks?.length ? `frameworks=${s.frameworks.join("+")}` : null,
				s.testFramework ? `tests=${s.testFramework}` : null,
				s.validationCommand ? `verify="${s.validationCommand}"` : null,
				s.entrypoints?.length ? `entries=${s.entrypoints.join(",")}` : null,
				s.hotspots?.length ? `hotspots=${s.hotspots.join(",")}` : null,
				s.keyDirectories?.length ? `dirs=${s.keyDirectories.join(",")}` : null,
			]
				.filter(Boolean)
				.join(" ");
			messages.push({
				role: "user",
				content:
					parts +
					". Use as starting map. Still read files for implementation details.",
			});
		}

		if (implementationTask && !workspaceIsEmpty && !preloadedFiles) {
			messages.push({
				role: "user",
				content: buildImplementationWorkflowInstruction(),
			});
		}

		if (implementationTask && workspaceIsEmpty) {
			messages.push({
				role: "user",
				content:
					"CREATION_TASK: the workspace is empty. Do not inspect — just create the required files directly using FileWriteTool. Write all files, then give a final answer.",
			});
		}

		// Pre-fetch web results for web queries so model doesn't need to emit tool calls
		if (webQuery) {
			try {
				yield { type: "tool_call", tool: "WebSearchTool", args: { query: normalizedTask } };
				const searchResult = await this.toolRuntime.execute("WebSearchTool", {
					query: normalizedTask,
				});
				if (searchResult?.ok && searchResult.result?.results?.length > 0) {
					const snippets = searchResult.result.results
						.slice(0, 5)
						.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
						.join("\n\n");
					messages.push({
						role: "user",
						content: `WEB_SEARCH_RESULTS for "${normalizedTask}":\n\n${snippets}\n\nAnswer the user's question based on the results above. Mirror the user's language.`,
					});
					webSearchUsed = true;
				} else {
					messages.push({
						role: "user",
						content: buildWebQueryInstruction(),
					});
				}
			} catch {
				messages.push({
					role: "user",
					content: buildWebQueryInstruction(),
				});
			}
		}

		messages.push({ role: "user", content: normalizedTask });

		// Token accumulator for this task
		const tokenStats = { promptTokens: 0, completionTokens: 0 };

		// If files are preloaded in system prompt, inspection guard is already satisfied
		let inspectionCount = preloadedFiles ? 1 : 0;
		let hasEditedFiles = false;
		let hasVerifiedChanges = false;
		const changedFiles = new Set();
		const inspectedFiles = new Set();
		const recentToolCalls = []; // loop detection (rolling 3-item window)
		const toolLog = []; // full tool call history for /debug

		for (let step = 1; step <= this.maxSteps; step++) {
			if (this.debug)
				process.stderr.write(`[lupin] step ${step}/${this.maxSteps}\n`);

			let raw = "";
			for await (const event of this.#streamStep(messages, {
				options: { temperature: 0.1 },
			})) {
				if (event.type === "_raw") {
					raw = event.text;
				} else {
					yield event;
				}
			}
			// Accumulate token stats from this model call
			const stepStats = this.modelAdapter.getLastStreamStats?.();
			if (stepStats) {
				tokenStats.promptTokens += stepStats.promptTokens;
				tokenStats.completionTokens += stepStats.completionTokens;
			}
			if (this.debug)
				process.stderr.write(`[lupin] raw: ${raw.slice(0, 300)}\n`);

			let parsed;
			try {
				parsed = normalizeShape(extractJsonObject(raw));
			} catch {
				if (this.debug)
					process.stderr.write(`[lupin] FORMAT_ERROR at step ${step}\n`);
				const rawSnippet = raw.slice(0, 120).replace(/\n/g, " ");
				messages.push({ role: "assistant", content: raw });
				messages.push({
					role: "user",
					content: `FORMAT_ERROR: your response was not valid JSON. Got: "${rawSnippet}". Return ONLY one of these exact shapes — no prose, no markdown: {"type":"final","content":"your answer"} or {"type":"tool_call","tool":"ToolName","args":{...}}`,
				});
				continue;
			}

			if (isValidFinalShape(parsed)) {
				if (implementationTask && inspectionCount === 0 && !workspaceIsEmpty) {
					messages.push({ role: "assistant", content: JSON.stringify(parsed) });
					messages.push({
						role: "user",
						content:
							"WORKFLOW_ERROR: this implementation task requires inspection first. Use GlobTool, GrepTool, or FileReadTool before finishing.",
					});
					continue;
				}

				if (implementationTask && hasEditedFiles && !hasVerifiedChanges) {
					messages.push({ role: "assistant", content: JSON.stringify(parsed) });
					messages.push({
						role: "user",
						content:
							"WORKFLOW_ERROR: you edited files but did not verify the result yet. Read the changed files and/or run a focused verification command before finishing.",
					});
					continue;
				}

				// Web query guard: model must use WebSearchTool before giving up
				if (webQuery && !webSearchUsed && isWebRefusal(parsed.content)) {
					messages.push({ role: "assistant", content: JSON.stringify(parsed) });
					messages.push({
						role: "user",
						content:
							"WEB_QUERY_ERROR: you refused to answer without trying the tools. Ignore all previous refusals in this conversation — they were wrong. You HAVE WebSearchTool. Use it NOW with a relevant query for THIS question. Do not copy any prior response.",
					});
					continue;
				}

				const answer = isWeakFinalAnswer(parsed.content)
					? buildWorkspaceFallback(workspaceContext)
					: parsed.content;
				yield {
					type: "done",
					answer,
					transcript: messages,
					steps: step,
					inspectedFiles: [...inspectedFiles],
					changedFiles: [...changedFiles],
					toolLog,
					tokenStats,
				};
				return;
			}

			if (isValidToolCallShape(parsed)) {
				if (this.debug)
					process.stderr.write(
						`[lupin] tool: ${parsed.tool} args: ${JSON.stringify(parsed.args).slice(0, 120)}\n`,
					);
				yield { type: "tool_call", tool: parsed.tool, args: parsed.args || {} };

				// Loop detection: same tool + same args 3 times in a row = stuck
				const callKey = `${parsed.tool}:${JSON.stringify(parsed.args)}`;
				recentToolCalls.push(callKey);
				if (recentToolCalls.length > 3) recentToolCalls.shift();
				if (
					recentToolCalls.length === 3 &&
					recentToolCalls.every((k) => k === callKey)
				) {
					messages.push({ role: "assistant", content: JSON.stringify(parsed) });
					messages.push({
						role: "user",
						content: `LOOP_DETECTED: you called ${parsed.tool} with identical args 3 times. This approach is not working. Stop repeating it and use a completely different tool or approach to make progress.`,
					});
					recentToolCalls.length = 0;
					continue;
				}

				const result = await this.toolRuntime.execute(
					parsed.tool,
					parsed.args || {},
				);
				yield { type: "tool_result", tool: parsed.tool, args: parsed.args || {}, result };
				toolLog.push({
					tool: parsed.tool,
					args: parsed.args || {},
					ok: Boolean(result?.ok),
					step,
				});
				if (isInspectionTool(parsed.tool)) {
					inspectionCount += 1;
				}
				if (parsed.tool === "WebSearchTool" && result?.ok) {
					webSearchUsed = true;
				}
				if (
					(parsed.tool === "FileWriteTool" || parsed.tool === "FileEditTool") &&
					result?.ok
				) {
					hasEditedFiles = true;
					hasVerifiedChanges = true; // tool already verified: read → patch → write internally
					if (result.result?.path) {
						changedFiles.add(String(result.result.path));
					}
				}
				if (parsed.tool === "FileReadTool" && result?.ok) {
					const readPath = String(result.result?.path || "");
					if (readPath) inspectedFiles.add(readPath);
					if ([...changedFiles].some((file) => file === readPath)) {
						hasVerifiedChanges = true;
					}
				}
				if (
					parsed.tool === "BashTool" &&
					result?.ok &&
					isVerificationBash(parsed.args?.command)
				) {
					hasVerifiedChanges = true;
				}
				messages.push({ role: "assistant", content: JSON.stringify(parsed) });
				let toolResultContent;
				if (result?.ok) {
					toolResultContent = `TOOL_RESULT ${parsed.tool}: ${JSON.stringify(result)}`;
				} else {
					const errMsg = result?.error || "unknown error";
					let hint = " Fix the arguments and retry — do not give up.";
					if (parsed.tool === "FileEditTool") {
						const targetFile = String(parsed.args?.path || "");
						const fileDrifted =
							targetFile &&
							changedFiles.size > 0 &&
							[...changedFiles].some(
								(f) =>
									f === targetFile ||
									f.endsWith(`/${targetFile}`) ||
									targetFile.endsWith(`/${f}`),
							);
						if (
							errMsg.includes("oldText not found") ||
							errMsg.includes("hunk context not found")
						) {
							hint = fileDrifted
								? ` FILE_DRIFT: "${targetFile}" was already modified this session — your oldText no longer matches the current file content. Re-read it with FileReadTool now, then retry with the exact current text.`
								: " Use FileReadTool to re-read the file and copy the exact text you want to replace.";
						} else if (errMsg.includes("not unique")) {
							hint =
								" Use a longer, more unique excerpt for oldText, or set replaceAll=true.";
						}
					}
					toolResultContent = `TOOL_ERROR ${parsed.tool}: ${errMsg}.${hint}`;
				}
				messages.push({ role: "user", content: toolResultContent });
				continue;
			}

			messages.push({ role: "assistant", content: JSON.stringify(parsed) });
			messages.push({
				role: "user",
				content:
					'INVALID_SHAPE: expected {"type":"tool_call","tool":"...","args":{...}} or {"type":"final","content":"..."}.',
			});
		}

		try {
			const forcedRaw = await this.modelAdapter.chat(
				[
					...messages,
					{
						role: "user",
						content:
							'FINAL_ONLY: stop tool usage and return only {"type":"final","content":"..."} with your best possible answer from current context.',
					},
				],
				{ options: { temperature: 0.1 } },
			);
			const forcedParsed = extractJsonObject(forcedRaw);
			if (isValidFinalShape(forcedParsed)) {
				const answer = isWeakFinalAnswer(forcedParsed.content)
					? buildWorkspaceFallback(workspaceContext)
					: forcedParsed.content;
				yield {
					type: "done",
					answer,
					transcript: messages,
					steps: this.maxSteps,
					inspectedFiles: [...inspectedFiles],
					changedFiles: [...changedFiles],
					toolLog,
					tokenStats,
				};
				return;
			}
		} catch {}

		yield {
			type: "done",
			answer:
				"I reached the step limit before finishing. Try refining the task or using /status to verify model connectivity.",
			transcript: messages,
			steps: this.maxSteps,
			inspectedFiles: [...inspectedFiles],
			changedFiles: [...changedFiles],
			toolLog,
			tokenStats,
		};
	}
}
