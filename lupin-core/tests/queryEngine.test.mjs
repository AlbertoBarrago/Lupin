import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isWeakFinalAnswer, QueryEngine } from "../src/core/queryEngine.mjs";

test("isWeakFinalAnswer: empty string is weak", () => {
	assert.equal(isWeakFinalAnswer(""), true);
	assert.equal(isWeakFinalAnswer("   "), true);
});

test('isWeakFinalAnswer: "unknown" variants are weak', () => {
	assert.equal(isWeakFinalAnswer("unknown"), true);
	assert.equal(isWeakFinalAnswer("Unknown"), true);
	assert.equal(isWeakFinalAnswer("Unknown. More text."), true);
});

test("isWeakFinalAnswer: apology phrases are weak", () => {
	assert.equal(isWeakFinalAnswer("I apologize for the confusion."), true);
	assert.equal(isWeakFinalAnswer("Sorry, I cannot help."), true);
});

test("isWeakFinalAnswer: retry phrases are weak", () => {
	assert.equal(isWeakFinalAnswer("Let me try again."), true);
	assert.equal(isWeakFinalAnswer("Let us try again."), true);
});

test("isWeakFinalAnswer: filler phrases are weak", () => {
	assert.equal(isWeakFinalAnswer("ok"), true);
	assert.equal(isWeakFinalAnswer("OK"), true);
	assert.equal(isWeakFinalAnswer("okay"), true);
	assert.equal(isWeakFinalAnswer("sure"), true);
	assert.equal(isWeakFinalAnswer("Sure"), true);
	assert.equal(isWeakFinalAnswer("got it"), true);
});

test('isWeakFinalAnswer: "I will help you" variants are weak', () => {
	assert.equal(isWeakFinalAnswer("I'll help you with that."), true);
	assert.equal(isWeakFinalAnswer("I will help you fix this."), true);
});

test('isWeakFinalAnswer: "of course" / "certainly" are weak', () => {
	assert.equal(isWeakFinalAnswer("Of course! Here is the answer."), true);
	assert.equal(isWeakFinalAnswer("Certainly, let me explain."), true);
});

test("isWeakFinalAnswer: real answers are not weak", () => {
	assert.equal(
		isWeakFinalAnswer(
			"The bug is in queryEngine.mjs at line 42 where the timeout is not cleared.",
		),
		false,
	);
	assert.equal(
		isWeakFinalAnswer(
			"Done. I edited src/index.mjs and verified with npm test.",
		),
		false,
	);
	assert.equal(
		isWeakFinalAnswer(
			"The function returns null when the file does not exist.",
		),
		false,
	);
});

test("runTask: implementation edits must be verified before final answer", async () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lupin-engine-"));
	fs.mkdirSync(path.join(tmp, "src"));
	fs.writeFileSync(path.join(tmp, "src", "a.js"), "const value = 1;\n", "utf8");

	const responses = [
		{
			type: "tool_call",
			tool: "FileEditTool",
			args: { path: "src/a.js", oldText: "1", newText: "2" },
		},
		{ type: "final", content: "Done without verification." },
		{ type: "tool_call", tool: "FileReadTool", args: { path: "src/a.js" } },
		{ type: "final", content: "Done after verification." },
	];
	const seenMessages = [];
	const modelAdapter = {
		async *chatStream(messages) {
			seenMessages.push(messages.map((m) => m.content));
			yield JSON.stringify(responses.shift());
		},
		getLastStreamStats() {
			return { promptTokens: 1, completionTokens: 1 };
		},
	};
	const toolRuntime = {
		projectRoot: tmp,
		listTools() {
			return [
				{ name: "FileEditTool", description: "", schema: { type: "object" } },
				{ name: "FileReadTool", description: "", schema: { type: "object" } },
			];
		},
		getWorkspaceContext() {
			return {
				projectRoot: tmp,
				gitRoot: null,
				markers: [],
				topLevel: ["[dir] src"],
				readmeSummary: null,
				instructionFiles: [],
			};
		},
		async execute(toolName) {
			if (toolName === "FileEditTool") {
				return { ok: true, result: { path: "src/a.js" } };
			}
			if (toolName === "FileReadTool") {
				return { ok: true, result: { path: "src/a.js", content: "1: const value = 2;" } };
			}
			return { ok: false, error: `unexpected tool: ${toolName}` };
		},
	};

	try {
		const engine = new QueryEngine({ modelAdapter, toolRuntime, maxSteps: 6 });
		let done;
		for await (const event of engine.runTask("fix the value bug")) {
			if (event.type === "done") done = event;
		}

		assert.equal(done?.answer, "Done after verification.");
		assert.deepEqual(done?.changedFiles, ["src/a.js"]);
		assert.deepEqual(done?.inspectedFiles, ["src/a.js"]);
		assert.equal(done?.toolLog.length, 2);
		assert.ok(
			seenMessages.some((contents) =>
				contents.some((content) =>
					String(content).includes("WORKFLOW_ERROR: you edited files but did not verify"),
				),
			),
		);
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});
