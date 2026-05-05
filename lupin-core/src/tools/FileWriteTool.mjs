/** @module FileWriteTool */

import fs from "node:fs";
import path from "node:path";
import {
	resolveInsideWorkspace,
	toWorkspaceRelative,
} from "../core/fsSafety.mjs";

/**
 * Tool that writes a UTF-8 text file to a path within the workspace.
 * Parent directories are created automatically if they do not exist.
 *
 * @type {{ name: string, description: string, schema: object, run: Function }}
 */
export const FileWriteTool = {
	name: "FileWriteTool",
	description: "Write a UTF-8 text file within workspace.",
	schema: {
		type: "object",
		properties: {
			path: { type: "string" },
			content: { type: "string" },
		},
		required: ["path", "content"],
	},
	/**
	 * Write `args.content` to `args.path` inside the workspace root.
	 * Intermediate directories are created with `mkdir -p` semantics.
	 *
	 * @param {{ path: string, content: string }} args - Tool arguments.
	 * @param {string} args.path - Workspace-relative destination path.
	 * @param {string} args.content - UTF-8 text content to write.
	 * @param {{ projectRoot: string }} ctx - Runtime context.
	 * @param {string} ctx.projectRoot - Absolute path to the workspace root.
	 * @returns {Promise<{ path: string, bytes: number }>} Workspace-relative path and byte size of the written file.
	 * @throws {Error} If the resolved path escapes the workspace root (via resolveInsideWorkspace).
	 */
	async run(args, ctx) {
		const abs = resolveInsideWorkspace(ctx.projectRoot, args?.path);
		const content = String(args?.content ?? "");
		await fs.promises.mkdir(path.dirname(abs), { recursive: true });
		await fs.promises.writeFile(abs, content, "utf8");
		return {
			path: toWorkspaceRelative(ctx.projectRoot, abs),
			bytes: Buffer.byteLength(content),
		};
	},
};
