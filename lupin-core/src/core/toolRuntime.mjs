/** @module toolRuntime */

import { enforcePolicy, redirectBashToTool } from "./permissions.mjs";
import { buildWorkspaceContext } from "./workspaceContext.mjs";

/**
 * Manages the registry of available tools, enforces security policy,
 * and dispatches execution requests to individual tool implementations.
 */
export class ToolRuntime {
	/**
	 * Creates a new ToolRuntime instance.
	 *
	 * @param {object}  options
	 * @param {string}  options.projectRoot     - Absolute path to the workspace root.
	 * @param {Array<{name: string, description: string, schema: object, run: Function}>} options.tools
	 *   Array of tool descriptors to register.
	 * @param {object}  options.securityConfig  - Security/policy configuration passed to {@link enforcePolicy}.
	 * @param {boolean} [options.debug=false]   - When true, enables verbose debug output.
	 */
	constructor({ projectRoot, tools, securityConfig, debug = false }) {
		this.projectRoot = projectRoot;
		this.tools = new Map(tools.map((tool) => [tool.name, tool]));
		this.securityConfig = securityConfig;
		this.debug = debug;
		this.workspaceContext = buildWorkspaceContext(projectRoot);
	}

	/**
	 * Returns a serialisable list of all registered tools.
	 *
	 * @returns {Array<{name: string, description: string, schema: object}>}
	 */
	listTools() {
		return [...this.tools.values()].map((tool) => ({
			name: tool.name,
			description: tool.description,
			schema: tool.schema,
		}));
	}

	/**
	 * Returns the current workspace context object.
	 *
	 * @returns {object} The workspace context as produced by {@link buildWorkspaceContext}.
	 */
	getWorkspaceContext() {
		return this.workspaceContext;
	}

	/**
	 * Re-builds the workspace context from disk and caches the result.
	 * Useful after file-system changes that may affect markers or top-level entries.
	 *
	 * @returns {object} The freshly built workspace context.
	 */
	refreshWorkspaceContext() {
		this.workspaceContext = buildWorkspaceContext(this.projectRoot);
		return this.workspaceContext;
	}

	/**
	 * Looks up a tool by name, checks it against the security policy, and runs it.
	 *
	 * @param {string} toolName  - The registered name of the tool to execute.
	 * @param {object} [args={}] - Arguments to pass to the tool's `run` function.
	 * @returns {Promise<{ok: boolean, tool?: string, risk?: string, result?: *, error?: string}>}
	 *   Resolves with an outcome object:
	 *   - `ok: true`  — tool ran successfully; includes `result` and optional `risk`.
	 *   - `ok: false` — tool unknown, blocked by policy, or threw; includes `error` and optional `risk`.
	 */
	async execute(toolName, args = {}) {
		const tool = this.tools.get(toolName);
		if (!tool) {
			return { ok: false, error: `unknown tool: ${toolName}` };
		}

		const policy = enforcePolicy(toolName, args, this.securityConfig);
		if (!policy.allowed) {
			return {
				ok: false,
				error: policy.reason || "blocked by policy",
				risk: policy.risk,
			};
		}

		// Transparent redirect: intercept bash calls that should use a native tool.
		// Falls through to real BashTool if the redirect target fails.
		if (toolName === "BashTool") {
			const redirect = redirectBashToTool(args?.command);
			if (redirect) {
				const nativeTool = this.tools.get(redirect.tool);
				if (nativeTool) {
					try {
						const result = await nativeTool.run(redirect.args, {
							projectRoot: this.projectRoot,
						});
						return {
							ok: true,
							tool: redirect.tool,
							risk: "LOW",
							result,
							redirectNote: redirect.note,
						};
					} catch {
						// redirect failed — fall through to actual BashTool below
					}
				}
			}
		}

		try {
			const result = await tool.run(args, {
				projectRoot: this.projectRoot,
			});
			return {
				ok: true,
				tool: toolName,
				risk: policy.risk,
				result,
			};
		} catch (error) {
			return {
				ok: false,
				tool: toolName,
				risk: policy.risk,
				error: String(error?.message || error),
			};
		}
	}
}
