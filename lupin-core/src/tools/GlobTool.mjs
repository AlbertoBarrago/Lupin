/** @module GlobTool */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

/**
 * Compiles an optional regex pattern string into a RegExp instance.
 * Returns `null` if the pattern is empty or falsy.
 *
 * @param {string|null|undefined} pattern - A JavaScript regex pattern string.
 * @returns {RegExp|null} The compiled RegExp, or `null` if no pattern was provided.
 * @throws {Error} If the pattern string is not a valid regular expression.
 */
function compileOptionalRegex(pattern) {
	const raw = String(pattern || "").trim();
	if (!raw) return null;
	try {
		return new RegExp(raw);
	} catch (error) {
		throw new Error(
			`invalid regex pattern: ${String(error?.message || error)}`,
		);
	}
}

/**
 * Tool that lists all files in the workspace using ripgrep (`rg --files`)
 * and optionally filters the results by a JavaScript regular expression.
 * Pattern syntax is plain JavaScript regex — NOT shell glob syntax.
 * Examples: `"\\.html$"` matches `.html` files; `"\\.(js|ts)$"` matches `.js` or `.ts` files.
 * Results are capped at 400 entries.
 *
 * @type {{ name: string, description: string, schema: object, run: Function }}
 */
export const GlobTool = {
	name: "GlobTool",
	description:
		'List workspace files and optionally filter by a JavaScript regex (NOT glob). Examples: pattern "\\.html$" matches .html files, "\\.(js|ts)$" matches .js or .ts files. Do not use glob syntax like *.html.',
	schema: {
		type: "object",
		properties: {
			pattern: { type: "string" },
		},
		required: [],
	},
	/**
	 * Lists files in the workspace root, optionally filtered by a regex pattern.
	 * Results are capped at 400 entries.
	 *
	 * @param {{ pattern?: string }} args - Tool arguments.
	 * @param {string} [args.pattern] - Optional JavaScript regex string used to filter file paths.
	 * @param {{ projectRoot: string }} ctx - Execution context.
	 * @param {string} ctx.projectRoot - Absolute path to the workspace root.
	 * @returns {Promise<{ count: number, files: string[] }>} Matched file count and workspace-relative paths.
	 * @throws {Error} If `args.pattern` is provided but is not a valid regular expression.
	 * @throws {Error} If the `rg` process fails unexpectedly.
	 */
	async run(args, ctx) {
		const regex = compileOptionalRegex(args?.pattern);
		const { stdout } = await execFileAsync("rg", ["--files"], {
			cwd: ctx.projectRoot,
			timeout: 15000,
			maxBuffer: 2 * 1024 * 1024,
		});
		let files = String(stdout || "")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		if (regex) {
			files = files.filter((file) => regex.test(file));
		}
		files = files.slice(0, 400);
		return {
			count: files.length,
			files,
		};
	},
};
