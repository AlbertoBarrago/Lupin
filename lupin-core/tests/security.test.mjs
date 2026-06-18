import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { enforcePolicy, redirectBashToTool } from "../src/core/permissions.mjs";
import { resolveInsideWorkspace } from "../src/core/fsSafety.mjs";

test("resolveInsideWorkspace: rejects paths outside the workspace", () => {
	const root = path.resolve("/tmp/lupin-root");
	assert.throws(
		() => resolveInsideWorkspace(root, "../outside.txt"),
		/path outside workspace/,
	);
});

test("resolveInsideWorkspace: allows paths inside the workspace", () => {
	const root = path.resolve("/tmp/lupin-root");
	assert.equal(
		resolveInsideWorkspace(root, "src/index.mjs"),
		path.join(root, "src", "index.mjs"),
	);
});

test("enforcePolicy: blocks dangerous bash when denyDangerousBash is enabled", () => {
	const result = enforcePolicy(
		"BashTool",
		{ command: "rm -rf node_modules" },
		{ denyDangerousBash: true },
	);
	assert.equal(result.allowed, false);
	assert.equal(result.risk, "HIGH");
});

test("enforcePolicy: allows non-bash tools", () => {
	const result = enforcePolicy(
		"FileReadTool",
		{ path: "README.md" },
		{ denyDangerousBash: true },
	);
	assert.equal(result.allowed, true);
	assert.equal(result.risk, "LOW");
});

test("redirectBashToTool: redirects simple cat to FileReadTool", () => {
	assert.deepEqual(redirectBashToTool("cat README.md"), {
		tool: "FileReadTool",
		args: { path: "README.md" },
		note: "redirected: cat → FileReadTool (prefer FileReadTool directly)",
	});
});
