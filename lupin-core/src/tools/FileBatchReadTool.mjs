/** @module FileBatchReadTool */

import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
	resolveInsideWorkspace,
	toWorkspaceRelative,
} from "../core/fsSafety.mjs";

const execFileAsync = promisify(execFileCb);

/** Maximum number of characters read from a single file before truncation. */
const MAX_CHARS_PER_FILE = 8000;
/** Maximum number of files that can be read in a single batch operation. */
const MAX_FILES = 20;

/**
 * Tool that reads multiple files at once using a regex pattern.
 *
 * Runs `rg --files` in the project root to enumerate all tracked files, filters them
 * by the caller-supplied regex, and returns their contents in one response. Prefer this
 * over multiple sequential `FileReadTool` calls.
 *
 * @type {{
 *   name: string,
 *   description: string,
 *   schema: object,
 *   run: (args: object, ctx: {projectRoot: string}) => Promise<{files: Array<object>, note?: string}>
 * }}
 */
export const FileBatchReadTool = {
	name: "FileBatchReadTool",
	description:
		"Read multiple files at once using a glob/regex pattern. Returns all matching file contents in one call. Use this instead of multiple FileReadTool calls when you need to read several files (e.g. all markdown docs, all source files in a directory).",
	schema: {
		type: "object",
		properties: {
			pattern: {
				type: "string",
				description:
					'Regex pattern to match file paths (e.g. "\\.md$", "^docs/", "\\.(ts|js)$")',
			},
			max_files: {
				type: "number",
				description: `Max files to read (default ${MAX_FILES})`,
			},
		},
		required: ["pattern"],
	},
	/**
	 * Execute the batch-read operation.
	 *
	 * @param {object} args - Tool arguments supplied by the model.
	 * @param {string} args.pattern - Regex string used to filter file paths.
	 * @param {number} [args.max_files] - Upper bound on files to read (capped at {@link MAX_FILES}).
	 * @param {{projectRoot: string}} ctx - Runtime context supplied by the tool runner.
	 * @returns {Promise<{files: Array<{path: string, content?: string, truncated?: boolean, error?: string}>, note?: string}>}
	 *   Resolves with an object whose `files` array contains one entry per matched file.
	 *   Each entry has `path` plus either `content` (and optional `truncated` flag) or `error`.
	 * @throws {Error} If `pattern` is missing or is not a valid regular expression.
	 */
	async run(args, ctx) {
		const pattern = String(args?.pattern || "").trim();
		if (!pattern) throw new Error("pattern is required");

		let regex;
		try {
			regex = new RegExp(pattern);
		} catch {
			throw new Error(`invalid regex: ${pattern}`);
		}

		const limit = Math.min(Number(args?.max_files) || MAX_FILES, MAX_FILES);

		const { stdout } = await execFileAsync("rg", ["--files"], {
			cwd: ctx.projectRoot,
			timeout: 15000,
			maxBuffer: 2 * 1024 * 1024,
		});

		const matched = String(stdout || "")
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)
			.filter((f) => regex.test(f))
			.slice(0, limit);

		if (matched.length === 0) {
			return { files: [], note: "no files matched pattern" };
		}

		const results = await Promise.all(
			matched.map(async (rel) => {
				try {
					const abs = resolveInsideWorkspace(ctx.projectRoot, rel);
					const raw = await fs.promises.readFile(abs, "utf8");
					const content = raw.slice(0, MAX_CHARS_PER_FILE);
					return {
						path: toWorkspaceRelative(ctx.projectRoot, abs),
						content,
						truncated: raw.length > MAX_CHARS_PER_FILE,
					};
				} catch (err) {
					return { path: rel, error: String(err?.message || err) };
				}
			}),
		);

		return { files: results };
	},
};
