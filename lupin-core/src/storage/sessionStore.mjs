/** @module sessionStore */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR_NAME = ".data";
const WORKSPACES_DIR_NAME = "workspaces";

/**
 * Derives a stable, filesystem-safe key for a given workspace root path.
 * The path is resolved to an absolute form before hashing so that equivalent
 * relative and absolute paths always produce the same key.
 *
 * @param {string} workspaceRoot - Absolute or relative path to the workspace root.
 * @returns {string} A 40-character lowercase SHA-1 hex digest.
 */
function toWorkspaceKey(workspaceRoot) {
	const normalized = path.resolve(String(workspaceRoot || "."));
	return crypto.createHash("sha1").update(normalized).digest("hex");
}

/**
 * Returns a fresh, empty session-data object with all required fields
 * initialised to their default values.
 *
 * @returns {{ createdAt: string, workspaceRoot: null, workspaceSnapshot: null, conversation: Array }} Default session data.
 */
function defaultData() {
	return {
		createdAt: new Date().toISOString(),
		workspaceRoot: null,
		workspaceSnapshot: null,
		conversation: [],
	};
}

/**
 * Persists and retrieves per-workspace chat and tool-use history to disk.
 *
 * Each workspace gets its own JSON file inside
 * `<projectDir>/.data/workspaces/<sha1>.json`, where the SHA-1 is derived
 * from the resolved workspace root path.
 */
export class SessionStore {
	/**
	 * Creates a new SessionStore instance.
	 *
	 * Note: {@link SessionStore#init} must be called before any read/write
	 * operations so that the storage directory is created and any existing
	 * state is loaded.
	 *
	 * @param {string} projectDir - Absolute path to the Lupin project directory
	 *   (where `.data/` will be created).
	 * @param {string} [workspaceRoot] - Absolute or relative path to the target
	 *   workspace root. Defaults to `projectDir`.
	 */
	constructor(projectDir, workspaceRoot) {
		this.projectDir = projectDir;
		this.workspaceRoot = path.resolve(String(workspaceRoot || projectDir));
		this.dataDir = path.join(projectDir, DATA_DIR_NAME);
		this.workspacesDir = path.join(this.dataDir, WORKSPACES_DIR_NAME);
		this.filePath = path.join(
			this.workspacesDir,
			`${toWorkspaceKey(this.workspaceRoot)}.json`,
		);
		this.state = defaultData();
	}

	/**
	 * Initialises the store: creates the storage directory if needed, then loads
	 * any previously persisted state from disk.
	 *
	 * If no persisted file exists (first run) a fresh default state is written to
	 * disk. Any JSON parse errors are treated the same way — the store starts
	 * clean and a new file is created.
	 *
	 * @returns {Promise<void>}
	 */
	async init() {
		await fs.promises.mkdir(this.workspacesDir, { recursive: true });
		try {
			const raw = await fs.promises.readFile(this.filePath, "utf8");
			const parsed = JSON.parse(raw);
			this.state = {
				createdAt: parsed.createdAt || new Date().toISOString(),
				workspaceRoot: parsed.workspaceRoot || this.workspaceRoot,
				workspaceSnapshot: parsed.workspaceSnapshot ?? null,
				conversation: Array.isArray(parsed.conversation)
					? parsed.conversation
					: [],
			};
		} catch {
			this.state = defaultData();
			this.state.workspaceRoot = this.workspaceRoot;
			await this.save();
		}
	}

	/**
	 * Appends a message to the conversation history with default metadata.
	 *
	 * Convenience wrapper around {@link SessionStore#appendWithMeta} that
	 * supplies an empty meta object, resulting in `kind: 'generic'` and
	 * `mode: null`.
	 *
	 * @param {string} role - Message role, e.g. `'user'` or `'assistant'`.
	 * @param {string} content - Message text content.
	 * @returns {void}
	 */
	append(role, content) {
		this.appendWithMeta(role, content, {});
	}

	/**
	 * Appends a message to the conversation history with explicit metadata.
	 *
	 * The conversation is capped at 400 entries; older messages are dropped
	 * when the limit is exceeded.
	 *
	 * @param {string} role - Message role, e.g. `'user'` or `'assistant'`.
	 * @param {string} content - Message text content.
	 * @param {{ kind?: string, mode?: string|null }} [meta={}] - Optional metadata.
	 *   - `kind` — Semantic category of the message (default: `'generic'`).
	 *   - `mode` — Agent mode active when the message was produced (default: `null`).
	 * @returns {void}
	 */
	appendWithMeta(role, content, meta = {}) {
		this.state.conversation.push({
			role,
			content,
			kind: meta.kind || "generic",
			mode: meta.mode || null,
			at: new Date().toISOString(),
		});
		if (this.state.conversation.length > 400) {
			this.state.conversation = this.state.conversation.slice(-400);
		}
	}

	/**
	 * Returns the cached workspace snapshot, or `null` if none has been stored.
	 *
	 * @returns {object|null} The workspace snapshot object, or `null`.
	 */
	getWorkspaceSnapshot() {
		return this.state.workspaceSnapshot ?? null;
	}

	/**
	 * Replaces the cached workspace snapshot.
	 *
	 * Pass `null` or `undefined` to clear the snapshot.
	 *
	 * @param {object|null|undefined} value - The new workspace snapshot to store.
	 * @returns {void}
	 */
	setWorkspaceSnapshot(value) {
		this.state.workspaceSnapshot = value ?? null;
	}

	/**
	 * Returns the most recent conversation turns in the format expected by the
	 * Ollama chat API (`{ role, content }` pairs).
	 *
	 * Only `'user'` and `'assistant'` roles are included. An optional `kinds`
	 * filter can restrict results to messages of specific semantic categories.
	 *
	 * @param {number} [limit=16] - Maximum number of turns to return (taken from
	 *   the tail of the conversation).
	 * @param {{ kinds?: string[] }} [options={}] - Filter options.
	 *   - `kinds` — When provided, only messages whose `kind` matches one of the
	 *     supplied strings are included.
	 * @returns {Array<{ role: string, content: string }>} Filtered, limited message list.
	 */
	getModelHistory(limit = 16, options = {}) {
		const allowedKinds =
			Array.isArray(options.kinds) && options.kinds.length
				? new Set(options.kinds)
				: null;

		return this.state.conversation
			.filter((item) => item.role === "user" || item.role === "assistant")
			.filter((item) => {
				if (!allowedKinds) return true;
				return allowedKinds.has(item.kind || "generic");
			})
			.slice(-limit)
			.map((item) => ({
				role: item.role,
				content: item.content,
			}));
	}

	/**
	 * Serialises the current in-memory state and writes it to the workspace JSON
	 * file, creating or overwriting it via `fs.promises.writeFile`.
	 *
	 * @returns {Promise<void>}
	 */
	async save() {
		await fs.promises.writeFile(
			this.filePath,
			`${JSON.stringify(this.state, null, 2)}\n`,
			"utf8",
		);
	}
}
