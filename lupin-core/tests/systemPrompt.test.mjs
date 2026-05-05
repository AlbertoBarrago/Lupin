import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSystemPrompt } from "../src/prompt/systemPrompt.mjs";

const tools = [
	{
		name: "FileReadTool",
		description: "reads files",
		schema: { type: "object", properties: { path: { type: "string" } } },
	},
	{
		name: "BashTool",
		description: "runs shell commands",
		schema: { type: "object", properties: { command: { type: "string" } } },
	},
];

const workspaceContext = {
	projectRoot: "/tmp/test-project",
	gitRoot: "/tmp/test-project",
	markers: ["package.json"],
	topLevel: ["[dir] src", "[file] package.json"],
	readmeSummary: "A test project.",
	instructionFiles: [],
};

test("buildSystemPrompt: returns a non-empty string", () => {
	const prompt = buildSystemPrompt(tools, workspaceContext);
	assert.ok(typeof prompt === "string");
	assert.ok(prompt.length > 0);
});

test("buildSystemPrompt: includes tool names", () => {
	const prompt = buildSystemPrompt(tools, workspaceContext);
	assert.ok(prompt.includes("FileReadTool"));
	assert.ok(prompt.includes("BashTool"));
});

test("buildSystemPrompt: includes workspace root", () => {
	const prompt = buildSystemPrompt(tools, workspaceContext);
	assert.ok(prompt.includes("/tmp/test-project"));
});

test("buildSystemPrompt: includes JSON shape instructions", () => {
	const prompt = buildSystemPrompt(tools, workspaceContext);
	assert.ok(prompt.includes("tool_call"));
	assert.ok(prompt.includes("final"));
});

test("buildSystemPrompt: includes snapshot section when snapshot provided", () => {
	const snapshot = {
		stacks: ["node", "typescript"],
		frameworks: ["Express"],
		testFramework: "Vitest",
		packageManager: "npm",
		entrypoints: ["src/index.mjs"],
		hotspots: [],
		scripts: [],
		validationCommand: "npm test",
	};
	const prompt = buildSystemPrompt(tools, workspaceContext, snapshot);
	assert.ok(prompt.includes("Project shape"));
	assert.ok(prompt.includes("node"));
	assert.ok(prompt.includes("Vitest"));
});

test("buildSystemPrompt: includes preloaded files when provided", () => {
	const preloaded = [{ path: "src/foo.mjs", content: "export const x = 1" }];
	const prompt = buildSystemPrompt(tools, workspaceContext, null, preloaded);
	assert.ok(prompt.includes("src/foo.mjs"));
	assert.ok(prompt.includes("export const x = 1"));
});
