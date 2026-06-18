/** @module config */

import path from "node:path";

/**
 * Parses the process argument vector for a `--project-root` or `--workspace`
 * flag and returns the value that follows it.
 *
 * Supports both space-separated (`--project-root /some/path`) and
 * equals-separated (`--project-root=/some/path`) forms.
 *
 * @param {string[]} [argv=process.argv.slice(2)] - Argument vector to inspect.
 * @returns {string} The resolved path string, or an empty string if the flag is
 *   absent or has no value.
 */
function resolveCliProjectRootArg(argv = process.argv.slice(2)) {
	for (let index = 0; index < argv.length; index += 1) {
		const value = String(argv[index] || "").trim();
		if (!value) continue;
		if (value === "--project-root" || value === "--workspace") {
			const next = String(argv[index + 1] || "").trim();
			if (next) return next;
		}
		if (value.startsWith("--project-root=")) {
			return value.slice("--project-root=".length).trim();
		}
		if (value.startsWith("--workspace=")) {
			return value.slice("--workspace=".length).trim();
		}
	}
	return "";
}

/**
 * Determines the project root directory using the following priority order:
 *
 * 1. A `--project-root` / `--workspace` CLI flag (via {@link resolveCliProjectRootArg}).
 * 2. The `INIT_CWD` environment variable (set by npm/yarn when running scripts
 *    from a subdirectory).
 * 3. A heuristic that walks one level up when the current directory is named
 *    `lupin-core` (guards against being run from inside the package itself).
 * 4. `process.cwd()` as the final fallback.
 *
 * @returns {string} Absolute path to the inferred project root.
 */
function inferProjectRoot() {
	const cwd = process.cwd();
	const cliProjectRoot = resolveCliProjectRootArg();
	if (cliProjectRoot) {
		return path.resolve(cwd, cliProjectRoot);
	}

	const initCwd = String(process.env.INIT_CWD || "").trim();
	if (initCwd && initCwd !== cwd) {
		return path.resolve(initCwd);
	}

	if (path.basename(cwd) === "lupin-core") {
		return path.resolve(cwd, "..");
	}
	return cwd;
}

/**
 * Builds and returns the runtime configuration object by merging environment
 * variables with sensible defaults.
 *
 * Environment variables recognised:
 * - `AGENT_PROJECT_ROOT` - overrides the inferred project root.
 * - `OLLAMA_BASE_URL` - Ollama API base URL (default: `http://127.0.0.1:11434`).
 * - `OLLAMA_MODEL` - model identifier (default: `qwen2.5-coder:7b`).
 * - `OLLAMA_TIMEOUT_MS` - request timeout in milliseconds (default: `60000`).
 * - `AGENT_MAX_STEPS` - maximum tool-use steps per task (default: `30`).
 * - `AGENT_MAX_HISTORY` - messages retained in session history (default: `16`).
 * - `AGENT_DENY_DANGEROUS_BASH` - set to `"0"` to permit dangerous shell commands.
 * - `DEBUG` - set to `"1"` to enable verbose debug output.
 *
 * @returns {{
 *   projectRoot: string,
 *   ollama: { baseUrl: string, model: string, timeoutMs: number },
 *   agent: { maxSteps: number, maxHistory: number },
 *   security: { denyDangerousBash: boolean },
 *   debug: boolean
 * }} The merged configuration object.
 */
export function loadConfig() {
	return {
		projectRoot: process.env.AGENT_PROJECT_ROOT || inferProjectRoot(),
		ollama: {
			baseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
			model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
			timeoutMs: Number.parseInt(process.env.OLLAMA_TIMEOUT_MS || "60000", 10),
		},
		agent: {
			maxSteps: Number.parseInt(process.env.AGENT_MAX_STEPS || "30", 10),
			maxHistory: Number.parseInt(process.env.AGENT_MAX_HISTORY || "16", 10),
		},
		security: {
			denyDangerousBash: process.env.AGENT_DENY_DANGEROUS_BASH !== "0",
		},
		debug: process.env.DEBUG === "1",
	};
}
