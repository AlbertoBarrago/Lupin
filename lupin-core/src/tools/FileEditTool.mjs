/** @module FileEditTool */

import fs from "node:fs";
import {
	resolveInsideWorkspace,
	toWorkspaceRelative,
} from "../core/fsSafety.mjs";

/**
 * Parses a unified diff string into an array of hunks.
 * Each hunk contains the declared old-start line and an array of tagged lines.
 *
 * @param {string} diffText - Unified diff string (may or may not include file headers).
 * @returns {Array<{oldStart: number, lines: Array<{tag: ' '|'-'|'+', text: string}>}>}
 */
function parseDiffHunks(diffText) {
	const hunks = [];
	let current = null;

	for (const raw of String(diffText || "").split("\n")) {
		const headerMatch = raw.match(
			/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/,
		);
		if (headerMatch) {
			if (current) hunks.push(current);
			current = { oldStart: Number(headerMatch[1]), lines: [] };
			continue;
		}
		if (!current) continue;
		if (raw.startsWith("-")) {
			current.lines.push({ tag: "-", text: raw.slice(1) });
		} else if (raw.startsWith("+")) {
			current.lines.push({ tag: "+", text: raw.slice(1) });
		} else if (raw.startsWith(" ") || raw === "") {
			current.lines.push({
				tag: " ",
				text: raw.startsWith(" ") ? raw.slice(1) : "",
			});
		}
		// skip file headers (--- / +++) and other non-hunk lines
	}
	if (current) hunks.push(current);
	return hunks;
}

/**
 * Attempts to find the line index (0-based) in `fileLines` where a hunk's
 * context+removal sequence begins, searching near `declaredStart`.
 * Uses exact-text matching on trimmed context/removal lines.
 *
 * @param {string[]} fileLines - Current file lines.
 * @param {{ oldStart: number, lines: Array<{tag: string, text: string}> }} hunk
 * @returns {number} 0-based index of the match, or -1 if not found.
 */
function locateHunk(fileLines, hunk) {
	// Build the expected sequence of lines that must exist (context + removals).
	const expected = hunk.lines
		.filter((l) => l.tag === " " || l.tag === "-")
		.map((l) => l.text);

	if (expected.length === 0) {
		// Pure-insertion hunk: trust the declared position.
		return Math.max(0, hunk.oldStart - 1);
	}

	const maxSearch = fileLines.length;
	// Try increasingly wide offsets from the declared position.
	const declared = hunk.oldStart - 1;
	const offsets = [0];
	for (let d = 1; d <= Math.max(declared, maxSearch - declared); d++) {
		offsets.push(d, -d);
	}

	for (const offset of offsets) {
		const start = declared + offset;
		if (start < 0 || start + expected.length > fileLines.length) continue;
		let match = true;
		for (let i = 0; i < expected.length; i++) {
			if (fileLines[start + i].trimEnd() !== expected[i].trimEnd()) {
				match = false;
				break;
			}
		}
		if (match) return start;
	}
	return -1;
}

/**
 * Applies a single parsed hunk to a mutable array of file lines in-place.
 *
 * @param {string[]} fileLines - Mutable array of current file lines.
 * @param {{ oldStart: number, lines: Array<{tag: string, text: string}> }} hunk
 * @throws {Error} If the hunk cannot be located in the file.
 */
function applyHunk(fileLines, hunk) {
	const anchorIdx = locateHunk(fileLines, hunk);
	if (anchorIdx === -1) {
		const preview = hunk.lines
			.filter((l) => l.tag === " " || l.tag === "-")
			.slice(0, 3)
			.map((l) => `  "${l.text}"`)
			.join("\n");
		throw new Error(
			`hunk context not found near line ${hunk.oldStart}. Expected:\n${preview}`,
		);
	}

	const replacement = [];
	let filePos = anchorIdx;
	for (const line of hunk.lines) {
		if (line.tag === " ") {
			replacement.push(fileLines[filePos]);
			filePos++;
		} else if (line.tag === "-") {
			filePos++; // consume without keeping
		} else if (line.tag === "+") {
			replacement.push(line.text);
		}
	}

	fileLines.splice(anchorIdx, filePos - anchorIdx, ...replacement);
}

/**
 * Applies a unified diff patch to a file.
 * Hunks are applied in reverse order to preserve line numbers across multiple hunks.
 *
 * @async
 * @param {string} abs - Absolute path to the file.
 * @param {string} diffText - Unified diff string (standard format with @@ headers).
 * @returns {Promise<{hunksApplied: number}>}
 * @throws {Error} If no valid hunks are found, or if a hunk cannot be located.
 */
async function applyUnifiedDiff(abs, diffText) {
	const original = await fs.promises.readFile(abs, "utf8");
	const hunks = parseDiffHunks(diffText);
	if (hunks.length === 0) throw new Error("no valid hunks found in diff text");

	const lines = original.split("\n");
	// Apply hunks from last to first so earlier line positions stay valid.
	for (const hunk of [...hunks].reverse()) {
		applyHunk(lines, hunk);
	}

	const next = lines.join("\n");
	if (next === original) throw new Error("diff produced no changes");
	await fs.promises.writeFile(abs, next, "utf8");
	return { hunksApplied: hunks.length };
}

/**
 * Replaces a contiguous range of lines in a file with new text.
 *
 * @async
 * @param {string} abs - Absolute path to the file to edit.
 * @param {number} lineStart - 1-indexed first line to replace (inclusive).
 * @param {number} lineEnd - 1-indexed last line to replace (inclusive).
 * @param {string} newText - Replacement text (may contain newlines).
 * @returns {Promise<{replacedLines: number, newLines: number}>} Counts of replaced and inserted lines.
 * @throws {Error} If `lineStart` or `lineEnd` are out of range, or if the edit produces no changes.
 */
async function applyLineRangeEdit(abs, lineStart, lineEnd, newText) {
	const raw = await fs.promises.readFile(abs, "utf8");
	const lines = raw.split("\n");
	const total = lines.length;
	const start = Number(lineStart);
	const end = Number(lineEnd);

	if (!Number.isInteger(start) || start < 1 || start > total) {
		throw new Error(
			`lineStart ${start} out of range (file has ${total} lines)`,
		);
	}
	if (!Number.isInteger(end) || end < start || end > total) {
		throw new Error(
			`lineEnd ${end} out of range (must be >= lineStart and <= ${total})`,
		);
	}

	const replacement = String(newText ?? "").split("\n");
	const next = [
		...lines.slice(0, start - 1),
		...replacement,
		...lines.slice(end),
	].join("\n");

	if (next === raw) throw new Error("edit produced no changes");
	await fs.promises.writeFile(abs, next, "utf8");
	return { replacedLines: end - start + 1, newLines: replacement.length };
}

/**
 * Replaces occurrences of an exact string match within a file.
 *
 * @async
 * @param {string} abs - Absolute path to the file to edit.
 * @param {string} oldText - The exact string to search for (must match character-for-character).
 * @param {string} newText - The replacement string.
 * @param {boolean} replaceAll - When `true`, all occurrences are replaced; when `false`, only
 *   the first occurrence is replaced and the function throws if there is more than one match.
 * @returns {Promise<{replacedOccurrences: number}>} The number of occurrences that were replaced.
 * @throws {Error} If `oldText` is not found, if it is not unique and `replaceAll` is `false`,
 *   or if the edit produces no changes.
 */
async function applyTextEdit(abs, oldText, newText, replaceAll) {
	const original = await fs.promises.readFile(abs, "utf8");
	const occurrences = original.split(oldText).length - 1;

	if (occurrences === 0) {
		throw new Error("oldText not found in file");
	}
	if (!replaceAll && occurrences > 1) {
		throw new Error(
			"oldText is not unique; refine the match or set replaceAll=true",
		);
	}

	const next = replaceAll
		? original.split(oldText).join(newText)
		: original.replace(oldText, newText);

	if (next === original) throw new Error("edit produced no changes");
	await fs.promises.writeFile(abs, next, "utf8");
	return { replacedOccurrences: replaceAll ? occurrences : 1 };
}

/**
 * Tool that edits an existing UTF-8 file in one of two modes:
 *
 * 1. **LINE-RANGE** (preferred): provide `lineStart`, `lineEnd`, and `newText` to replace
 *    those lines. Use after `FileReadTool` to obtain exact line numbers.
 * 2. **TEXT-MATCH**: provide `oldText` and `newText` to replace an exact string match.
 *    `oldText` must match character-for-character, including all whitespace.
 *
 * @type {{
 *   name: string,
 *   description: string,
 *   schema: object,
 *   run: (args: object, ctx: {projectRoot: string}) => Promise<{path: string, bytes: number}>
 * }}
 */
export const FileEditTool = {
	name: "FileEditTool",
	description:
		"Edit an existing UTF-8 file. Three modes: " +
		"(1) LINE-RANGE (preferred): provide lineStart + lineEnd + newText — replaces those lines. Use after FileReadTool to get exact line numbers. " +
		"(2) TEXT-MATCH: provide oldText + newText — replaces exact string match. oldText must match character-for-character including whitespace. " +
		"(3) UNIFIED-DIFF: provide diff — a standard unified diff string with @@ hunk headers. Use for multi-hunk changes.",
	schema: {
		type: "object",
		properties: {
			path: { type: "string" },
			lineStart: {
				type: "number",
				description: "1-indexed first line to replace (inclusive)",
			},
			lineEnd: {
				type: "number",
				description: "1-indexed last line to replace (inclusive)",
			},
			oldText: { type: "string" },
			newText: { type: "string" },
			replaceAll: { type: "boolean" },
			diff: {
				type: "string",
				description:
					"Unified diff string with @@ hunk headers for multi-hunk edits",
			},
		},
		required: ["path"],
	},
	/**
	 * Executes the file edit using whichever mode is indicated by the supplied arguments.
	 *
	 * @async
	 * @param {object} args - Tool arguments.
	 * @param {string} args.path - Workspace-relative path to the file.
	 * @param {string} args.newText - Replacement text.
	 * @param {number} [args.lineStart] - 1-indexed first line to replace (LINE-RANGE mode).
	 * @param {number} [args.lineEnd] - 1-indexed last line to replace (LINE-RANGE mode).
	 * @param {string} [args.oldText] - Exact string to replace (TEXT-MATCH mode).
	 * @param {boolean} [args.replaceAll] - Replace all occurrences in TEXT-MATCH mode.
	 * @param {{projectRoot: string}} ctx - Execution context providing the workspace root.
	 * @returns {Promise<{path: string, bytes: number}>} Result object with the workspace-relative
	 *   path and final file size in bytes, merged with mode-specific edit metadata.
	 * @throws {Error} If neither a valid line range nor `oldText` is provided, or if the
	 *   underlying edit operation fails.
	 */
	async run(args, ctx) {
		const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path);

		let editInfo;
		if (args?.diff != null) {
			// Mode 3: unified diff
			editInfo = await applyUnifiedDiff(abs, String(args.diff));
		} else if (args?.lineStart != null && args?.lineEnd != null) {
			// Mode 1: line-range
			const newText = String(args?.newText ?? "");
			editInfo = await applyLineRangeEdit(
				abs,
				args.lineStart,
				args.lineEnd,
				newText,
			);
		} else {
			// Mode 2: text-match
			const newText = String(args?.newText ?? "");
			const oldText = String(args?.oldText ?? "");
			if (!oldText)
				throw new Error("provide diff, lineStart+lineEnd, or oldText+newText");
			editInfo = await applyTextEdit(
				abs,
				oldText,
				newText,
				Boolean(args?.replaceAll),
			);
		}

		const written = await fs.promises.readFile(abs, "utf8");
		return {
			path: toWorkspaceRelative(ctx.projectRoot, abs),
			...editInfo,
			bytes: Buffer.byteLength(written),
		};
	},
};
