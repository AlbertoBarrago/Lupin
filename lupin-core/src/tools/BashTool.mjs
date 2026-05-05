/** @module BashTool */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(execCb);

/**
 * Tool that executes arbitrary shell commands inside the workspace root directory.
 * Commands run via `/bin/zsh` with a 20-second timeout and a 2 MB stdout buffer cap.
 * stdout is capped at 16 000 characters and stderr at 8 000 characters in the returned result.
 * Non-zero exit codes are caught and returned as a structured result rather than thrown,
 * so the agent loop can inspect them gracefully.
 *
 * @type {{ name: string, description: string, schema: object, run: Function }}
 */
export const BashTool = {
	name: "BashTool",
	description:
		"Run a shell command in workspace root and capture stdout/stderr.",
	schema: {
		type: "object",
		properties: {
			command: { type: "string" },
		},
		required: ["command"],
	},
	/**
	 * Execute a shell command in the workspace root.
	 *
	 * @param {{ command: string }} args - Tool arguments.
	 * @param {string} args.command - The shell command to run.
	 * @param {{ projectRoot: string }} ctx - Execution context supplying the workspace root path.
	 * @param {string} ctx.projectRoot - Absolute path to the workspace root used as cwd.
	 * @returns {Promise<{ exitCode: number, stdout: string, stderr: string }>} Resolved with the
	 *   process exit code and the (truncated) stdout / stderr strings.
	 *   stdout is capped at 16 000 characters; stderr at 8 000 characters.
	 * @throws {Error} If `args.command` is empty or missing.
	 */
	async run(args, ctx) {
		const command = String(args?.command || "").trim();
		if (!command) {
			throw new Error("missing command");
		}
		try {
			const { stdout, stderr } = await execAsync(command, {
				cwd: ctx.projectRoot,
				timeout: 20000,
				maxBuffer: 2 * 1024 * 1024,
				shell: "/bin/zsh",
			});
			return {
				exitCode: 0,
				stdout: String(stdout || "").slice(0, 16000),
				stderr: String(stderr || "").slice(0, 8000),
			};
		} catch (error) {
			return {
				exitCode: Number.isFinite(error?.code) ? error.code : 1,
				stdout: String(error?.stdout || "").slice(0, 16000),
				stderr: String(error?.stderr || error?.message || "").slice(0, 8000),
			};
		}
	},
};
