import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FileEditTool } from "../src/tools/FileEditTool.mjs";

function makeTmpFile(content) {
	const p = path.join(
		os.tmpdir(),
		`lupin-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
	);
	fs.writeFileSync(p, content, "utf8");
	return p;
}

const ctx = (p) => ({ projectRoot: path.dirname(p) });

// LINE-RANGE mode

test("line-range: replaces target lines", async () => {
	const p = makeTmpFile("line1\nline2\nline3\n");
	const result = await FileEditTool.run(
		{ path: path.basename(p), lineStart: 2, lineEnd: 2, newText: "replaced" },
		ctx(p),
	);
	assert.equal(fs.readFileSync(p, "utf8"), "line1\nreplaced\nline3\n");
	assert.equal(result.replacedLines, 1);
	fs.unlinkSync(p);
});

test("line-range: lineStart out of range throws", async () => {
	const p = makeTmpFile("a\nb\n");
	await assert.rejects(
		() =>
			FileEditTool.run(
				{ path: path.basename(p), lineStart: 5, lineEnd: 5, newText: "x" },
				ctx(p),
			),
		/out of range/,
	);
	fs.unlinkSync(p);
});

test("line-range: lineEnd out of range throws", async () => {
	const p = makeTmpFile("a\nb\n");
	await assert.rejects(
		() =>
			FileEditTool.run(
				{ path: path.basename(p), lineStart: 1, lineEnd: 99, newText: "x" },
				ctx(p),
			),
		/out of range/,
	);
	fs.unlinkSync(p);
});

// TEXT-MATCH mode

test("text-match: replaces unique match", async () => {
	const p = makeTmpFile("hello world\n");
	const result = await FileEditTool.run(
		{ path: path.basename(p), oldText: "world", newText: "earth" },
		ctx(p),
	);
	assert.equal(fs.readFileSync(p, "utf8"), "hello earth\n");
	assert.equal(result.replacedOccurrences, 1);
	fs.unlinkSync(p);
});

test("text-match: throws when oldText not found", async () => {
	const p = makeTmpFile("hello world\n");
	await assert.rejects(
		() =>
			FileEditTool.run(
				{ path: path.basename(p), oldText: "missing", newText: "x" },
				ctx(p),
			),
		/oldText not found/,
	);
	fs.unlinkSync(p);
});

test("text-match: throws when oldText not unique and replaceAll omitted", async () => {
	const p = makeTmpFile("foo foo foo\n");
	await assert.rejects(
		() =>
			FileEditTool.run(
				{ path: path.basename(p), oldText: "foo", newText: "bar" },
				ctx(p),
			),
		/not unique/,
	);
	fs.unlinkSync(p);
});

test("text-match: replaceAll replaces all occurrences", async () => {
	const p = makeTmpFile("foo foo foo\n");
	const result = await FileEditTool.run(
		{
			path: path.basename(p),
			oldText: "foo",
			newText: "bar",
			replaceAll: true,
		},
		ctx(p),
	);
	assert.equal(fs.readFileSync(p, "utf8"), "bar bar bar\n");
	assert.equal(result.replacedOccurrences, 3);
	fs.unlinkSync(p);
});

// UNIFIED-DIFF mode

test("unified-diff: applies single hunk", async () => {
	const p = makeTmpFile("a\nb\nc\n");
	// Context lines (space-prefix) anchor the hunk; no trailing newline to avoid spurious empty context
	const diff = `@@ -1,3 +1,3 @@\n a\n-b\n+B\n c`;
	const result = await FileEditTool.run(
		{ path: path.basename(p), diff },
		ctx(p),
	);
	assert.equal(fs.readFileSync(p, "utf8"), "a\nB\nc\n");
	assert.equal(result.hunksApplied, 1);
	fs.unlinkSync(p);
});

test("unified-diff: throws when hunk context not found", async () => {
	const p = makeTmpFile("a\nb\nc\n");
	const diff = `@@ -1,1 +1,1 @@\n-missing\n+x\n`;
	await assert.rejects(
		() => FileEditTool.run({ path: path.basename(p), diff }, ctx(p)),
		/hunk context not found/,
	);
	fs.unlinkSync(p);
});
