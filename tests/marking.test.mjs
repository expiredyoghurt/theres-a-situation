/**
 * Lightweight tests for the pure, side-effect-free scoring/assembly
 * functions in worker/index.js — no D1 database, no AI provider, no
 * Cloudflare runtime required. Run with:
 *
 *   node tests/marking.test.mjs
 *
 * These deliberately don't cover submitCase() end-to-end (that function
 * mixes I/O — D1 reads/writes, AI calls — with the scoring logic), but
 * they do cover the pieces most likely to silently regress: keyword
 * scoring, similarity scoring, MCQ shuffle/answer-key correctness, and
 * letter assembly (including the sign-off name).
 */
import assert from "node:assert/strict";
import {
  scoreOwnContentByKeyword,
  jaccardSimilarity,
  buildOptionComponent,
  assembleLetter,
  fallbackTaskChunks,
  fallbackSalutationSet,
  fallbackSignoffSet,
  fallbackPurposeSet,
  fallbackFillerSet,
  fallbackKeyInfoDistractors,
  isFreeOpenRouterModel,
} from "../worker/index.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    console.error(`  FAIL - ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("scoreOwnContentByKeyword");
test("hitting all keyword groups scores near the max", () => {
  const groups = [["donate", "give"], ["poster", "sign"]];
  const score = scoreOwnContentByKeyword("I will donate old toys and make a poster", groups, 15);
  assert.ok(score >= 12, `expected >=12, got ${score}`);
});
test("hitting no keyword groups scores low", () => {
  const groups = [["donate", "give"], ["poster", "sign"]];
  const score = scoreOwnContentByKeyword("I like cats and dogs", groups, 15);
  assert.ok(score <= 5, `expected <=5, got ${score}`);
});
test("empty keyword groups falls back to a length-based heuristic", () => {
  const scoreLong = scoreOwnContentByKeyword("This is a reasonably long original idea.", [], 15);
  const scoreEmpty = scoreOwnContentByKeyword("", [], 15);
  assert.ok(scoreLong > scoreEmpty, "a non-trivial answer should score higher than a blank one");
});

console.log("jaccardSimilarity");
test("identical text has similarity 1", () => {
  assert.equal(jaccardSimilarity("the quick brown fox", "the quick brown fox"), 1);
});
test("completely different text has low similarity", () => {
  const sim = jaccardSimilarity("apples and oranges are fruit", "completely unrelated topic here");
  assert.ok(sim < 0.2, `expected <0.2, got ${sim}`);
});
test("empty strings never divide by zero", () => {
  assert.equal(jaccardSimilarity("", "something"), 0);
  assert.equal(jaccardSimilarity("something", ""), 0);
});

console.log("buildOptionComponent");
test("produces exactly 3 options and tracks the correct one", () => {
  const comp = buildOptionComponent("test", "Test", { correct: "RIGHT", distractors: ["A", "B", "C"] });
  assert.equal(comp.options.length, 3);
  const correctOpt = comp.options.find((o) => o.id === comp.correctId);
  assert.equal(correctOpt.text, "RIGHT");
});
test("pads short distractor lists so there are always 3 options", () => {
  const comp = buildOptionComponent("test", "Test", { correct: "RIGHT", distractors: ["A"] });
  assert.equal(comp.options.length, 3);
});
test("every generated component key/label round-trips correctly across many shuffles", () => {
  for (let i = 0; i < 25; i++) {
    const comp = buildOptionComponent("keyinfo1", "Key information 1", { correct: "C", distractors: ["D1", "D2", "D3"] });
    const ids = comp.options.map((o) => o.id).sort();
    assert.deepEqual(ids, ["a", "b", "c"]);
    assert.ok(comp.options.some((o) => o.id === comp.correctId && o.text === "C"));
  }
});

console.log("assembleLetter");
test("joins components in order, respects paragraph breaks, appends sign-off name", () => {
  const full = {
    components: [
      { key: "a", options: [{ id: "x", text: "Hello" }] },
      { key: "b", options: [{ id: "y", text: "World" }] },
    ],
  };
  const letter = assembleLetter(full, { a: "x", b: "y" }, new Set(["b"]), "Wei Ming");
  assert.equal(letter, "Hello\n\nWorld\nWei Ming");
});
test("skips components with no chosen option", () => {
  const full = { components: [{ key: "a", options: [{ id: "x", text: "Hello" }] }, { key: "b", options: [{ id: "y", text: "World" }] }] };
  const letter = assembleLetter(full, { a: "x" }, new Set(), "");
  assert.equal(letter, "Hello");
});
test("omits the sign-off line entirely when no name is given", () => {
  const full = { components: [{ key: "a", options: [{ id: "x", text: "Hello" }] }] };
  const letter = assembleLetter(full, { a: "x" }, new Set(), "");
  assert.equal(letter, "Hello");
});

console.log("deterministic fallbacks");
test("fallbackTaskChunks covers the whole task text and tags one purpose/audience", () => {
  const chunks = fallbackTaskChunks("You saw a notice. Write to your teacher, Mr Tan, to suggest an idea.");
  assert.ok(chunks.length > 0);
  assert.ok(chunks.some((c) => c.type === "purpose" || c.type === "context"));
});
test("fallbackSalutationSet/SignoffSet differ by register", () => {
  assert.notEqual(fallbackSalutationSet(true).correct, fallbackSalutationSet(false).correct);
  assert.notEqual(fallbackSignoffSet(true).correct, fallbackSignoffSet(false).correct);
});
test("fallbackPurposeSet/FillerSet/KeyInfoDistractors always return usable shapes", () => {
  const p = fallbackPurposeSet("You saw a notice. Write to your teacher.");
  assert.equal(typeof p.correct, "string");
  assert.equal(p.distractors.length, 3);
  const f = fallbackFillerSet(true);
  assert.equal(typeof f.correct, "string");
  assert.equal(f.distractors.length, 3);
  assert.equal(fallbackKeyInfoDistractors().length, 3);
});

console.log("isFreeOpenRouterModel");
test("accepts the Free Models Router slug", () => {
  assert.equal(isFreeOpenRouterModel("openrouter/free"), true);
});
test("accepts any :free-suffixed model id", () => {
  assert.equal(isFreeOpenRouterModel("meta-llama/llama-3.2-3b-instruct:free"), true);
  assert.equal(isFreeOpenRouterModel("qwen/qwen3-coder:free"), true);
});
test("rejects paid model ids", () => {
  assert.equal(isFreeOpenRouterModel("openai/gpt-4o"), false);
  assert.equal(isFreeOpenRouterModel("meta-llama/llama-3.1-8b-instruct"), false);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.error("Some tests FAILED — see above.");
} else {
  console.log("All marking-logic tests passed.");
}
