/** @module FileReadTool */

import fs from "node:fs";
import {
	resolveInsideWorkspace,
	toWorkspaceRelative,
} from "../core/fsSafety.mjs";

/**
 * Prepends 1-based line numbers to every line of a string.
 * Line numbers are right-padded to a consistent width based on total line count.
 *
 * @param {string} content - Raw file content.
 * @returns {string} Content with each line prefixed by its line number, e.g. " 1: code here".
 */
function addLineNumbers(content) {
	const lines = content.split("\n");
	const width = String(lines.length).length;
	return lines
		.map((line, i) => `${String(i + 1).padStart(width)}: ${line}`)
		.join("\n");
}

/**
 * Tool that reads a UTF-8 text file from the workspace and returns its content
 * with line numbers prepended to every line. The line-number prefix format
 * (" N: ") must NOT be included when supplying `oldText` to FileEditTool.
 * Content is truncated at 24 000 characters; the `truncated` flag signals this.
 *
 * @type {{ name: string, description: string, schema: object, run: Function }}
 */
export const FileReadTool = {
	name: "FileReadTool",
	description:
		'Read a UTF-8 text file from workspace. Returns content with line numbers prepended (e.g. " 1: code here"). Use line numbers to target FileEditTool line-range edits. Do not include the "N: " prefix when writing oldText.',
	schema: {
		type: "object",
		properties: {
			path: { type: "string" },
		},
		required: ["path"],
	},
	/**
	 * Reads the file at the given workspace-relative path and returns its
	 * line-numbered content together with metadata.
	 *
	 * @async
	 * @param {{ path: string }} args - Tool arguments.
	 * @param {string} args.path - Workspace-relative path to the file to read.
	 * @param {{ projectRoot: string }} ctx - Execution context.
	 * @param {string} ctx.projectRoot - Absolute path to the workspace root.
	 * @returns {Promise<{ path: string, content: string, totalLines: number, truncated: boolean }>}
	 *   Resolved workspace-relative path, line-numbered content (possibly truncated),
	 *   total line count of the original file, and a flag indicating truncation.
	 * @throws {Error} If the path escapes the workspace or the file cannot be read.
	 */
	async run(args, ctx) {
		const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path);
		const raw = await fs.promises.readFile(abs, "utf8");
		const maxChars = 24000;
		const truncated = raw.length > maxChars;
		const sliced = raw.slice(0, maxChars);
		return {
			path: toWorkspaceRelative(ctx.projectRoot, abs),
			content: addLineNumbers(sliced),
			totalLines: raw.split("\n").length,
			truncated,
		};
	},
};
