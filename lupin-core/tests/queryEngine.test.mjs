import assert from "node:assert/strict";
import { test } from "node:test";
import { isWeakFinalAnswer } from "../src/core/queryEngine.mjs";

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
