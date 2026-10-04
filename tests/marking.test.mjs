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
  buildManualCaseFromComponents,
  scoreTaskIdentification,
  validateSignOffName,
  detectAiFailures,
  applyTeacherScores,
  normaliseTaskChunks,
  buildStimulusPointsFromTiles,
  parseBuildFlags,
  buildFlagsJsonWithout,
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

test("does not repeat the name when the 'Name' part already ends the letter", () => {
  const full = { components: [
    { key: "signoff", options: [{ id: "x", text: "Yours sincerely," }] },
    { key: "name", options: [{ id: "y", text: "Wei Ming" }] },
  ] };
  const letter = assembleLetter(full, { signoff: "x", name: "y" }, new Set(), "Wei Ming");
  assert.equal(letter, "Yours sincerely,\nWei Ming"); // v1.14: signature on its own line
  assert.equal(letter.split("Wei Ming").length - 1, 1);
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

// ---------------------------------------------------------------------------
// v1.12
// ---------------------------------------------------------------------------

console.log("scoreTaskIdentification (Step 1: purpose / audience / context / optional / not needed)");
const chunks = [
  { id: "c1", text: "context bit", type: "context" },
  { id: "c2", text: "audience bit", type: "audience" },
  { id: "c3", text: "purpose bit", type: "purpose" },
  { id: "c4", text: "optional bit", type: "optional" },
  { id: "c5", text: "filler bit", type: "other" },
];
test("all three key chunks right = full marks; untagged filler is ignored", () => {
  const r = scoreTaskIdentification(chunks, { c1: "context", c2: "audience", c3: "purpose" }, 15);
  assert.equal(r.score, 15);
});
test("optional chunks never affect the score, whatever the pupil tags them", () => {
  const base = scoreTaskIdentification(chunks, { c1: "context", c2: "audience", c3: "purpose" }, 15).score;
  for (const tag of ["purpose", "audience", "context", "other"]) {
    assert.equal(scoreTaskIdentification(chunks, { c1: "context", c2: "audience", c3: "purpose", c4: tag }, 15).score, base);
  }
  assert.equal(scoreTaskIdentification(chunks, {}, 15).score, 0); // nothing tagged: optional is not a free point
});
test("a 'Not needed' chunk tagged as something else is penalised; tagged correctly it counts", () => {
  const wrong = scoreTaskIdentification(chunks, { c1: "context", c2: "audience", c3: "purpose", c5: "purpose" }, 20);
  assert.equal(wrong.score, 15); // 3 of 4 counted = 75% of 20
  const right = scoreTaskIdentification(chunks, { c1: "context", c2: "audience", c3: "purpose", c5: "other" }, 20);
  assert.equal(right.score, 20);
});
test("several chunks of the same type are each required", () => {
  const multi = [
    { id: "a", text: "p1", type: "purpose" }, { id: "b", text: "p2", type: "purpose" },
    { id: "c", text: "aud", type: "audience" }, { id: "d", text: "ctx", type: "context" },
  ];
  assert.equal(scoreTaskIdentification(multi, { a: "purpose", b: "context", c: "audience", d: "context" }, 20).score, 15);
});
test("legacy 4-chunk cases (one chunk per type + filler) score exactly as before", () => {
  const legacy = [
    { id: "c1", type: "context" }, { id: "c2", type: "audience" }, { id: "c3", type: "purpose" }, { id: "c4", type: "other" },
  ];
  assert.equal(scoreTaskIdentification(legacy, { c1: "context", c2: "audience" }, 15).score, 10);
});

console.log("validateSignOffName (Step 4 part 13: no last name required)");
test("a single first name is accepted for formal and informal alike", () => {
  assert.deepEqual(validateSignOffName("Wei Ming"), { ok: true, name: "Wei Ming" });
  assert.deepEqual(validateSignOffName("  Mei  "), { ok: true, name: "Mei" });
});
test("a blank name is still rejected", () => {
  assert.equal(validateSignOffName("   ").ok, false);
  assert.equal(validateSignOffName(undefined).ok, false);
});

console.log("detectAiFailures (AI grading must be flagged)");
test("flags a criterion where AI was needed but returned nothing", () => {
  const f = detectAiFailures({ ownNeedsAi: true, ownAiResult: null, holisticNeedsAi: true, holisticAiResult: { score: 5 } });
  assert.deepEqual(f.map((x) => x.part), ["ownContent"]);
  const both = detectAiFailures({ ownNeedsAi: true, ownAiResult: null, holisticNeedsAi: true, holisticAiResult: null });
  assert.deepEqual(both.map((x) => x.part), ["ownContent", "overallQuality"]);
});
test("does not flag when AI was not needed or succeeded", () => {
  assert.equal(detectAiFailures({ ownNeedsAi: false, ownAiResult: null, holisticNeedsAi: false, holisticAiResult: null }).length, 0);
  assert.equal(detectAiFailures({ ownNeedsAi: true, ownAiResult: { score: 3 }, holisticNeedsAi: true, holisticAiResult: { score: 4 } }).length, 0);
});

console.log("applyTeacherScores (teacher override)");
const auto = {
  taskIdentification: { score: 10, max: 15 }, stimulusKeyInfo: { score: 12, max: 20 },
  ownContent: { score: 5, max: 15, aiFailed: true }, letterChoices: { score: 20, max: 30 },
  paragraphing: { score: 6, max: 10 }, overallQuality: { score: 4, max: 10, aiFailed: true },
};
test("recomputes the total from fresh scores and marks which criteria the teacher changed", () => {
  const r = applyTeacherScores(auto, { ownContent: 12, overallQuality: 8 });
  assert.equal(r.total, 10 + 12 + 12 + 20 + 6 + 8);
  assert.equal(r.max, 100);
  assert.equal(r.breakdown.ownContent.teacherScored, true);
  assert.equal(r.breakdown.taskIdentification.teacherScored, false);
  assert.equal(r.breakdown.ownContent.aiFailed, undefined, "the AI-failed flag clears once a teacher has graded");
});
test("rejects scores outside 0..max or non-numeric", () => {
  assert.ok(applyTeacherScores(auto, { ownContent: 16 }).error);
  assert.ok(applyTeacherScores(auto, { ownContent: -1 }).error);
  assert.ok(applyTeacherScores(auto, { ownContent: "abc" }).error);
});
test("does not mutate the stored automatic breakdown", () => {
  applyTeacherScores(auto, { ownContent: 12 });
  assert.equal(auto.ownContent.score, 5);
  assert.equal(auto.ownContent.aiFailed, true);
});

console.log("normaliseTaskChunks (Step 1 editor)");
test("accepts all five chunk types and renumbers ids", () => {
  const r = normaliseTaskChunks([
    { text: "a", type: "context" }, { text: "b", type: "audience" }, { text: "c", type: "purpose" },
    { text: "d", type: "optional" }, { text: "e", type: "other" }, { text: "   ", type: "other" },
  ]);
  assert.equal(r.chunks.length, 5);
  assert.deepEqual(r.chunks.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5"]);
});
test("requires a Purpose and an Audience, and a valid type", () => {
  assert.ok(normaliseTaskChunks([{ text: "x", type: "audience" }]).error);
  assert.ok(normaliseTaskChunks([{ text: "x", type: "purpose" }]).error);
  assert.ok(normaliseTaskChunks([{ text: "x", type: "bogus" }]).error);
  assert.ok(normaliseTaskChunks([]).error);
});

console.log("buildStimulusPointsFromTiles (Step 2 editor: up to 12 tiles)");
test("builds relevant / distractor points from correct flags", () => {
  const r = buildStimulusPointsFromTiles([
    { text: "Date", correct: true }, { text: "Free popcorn", correct: false }, { text: "Venue", correct: true },
  ]);
  assert.deepEqual(r.points.map((p) => [p.id, p.relevant]), [["s1", true], ["sx1", false], ["s2", true]]);
});
test("allows exactly 12 tiles but rejects 13", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ({ text: "t" + i, correct: i < 5 }));
  assert.equal(buildStimulusPointsFromTiles(twelve).points.length, 12);
  assert.ok(buildStimulusPointsFromTiles([...twelve, { text: "t13", correct: false }]).error);
});
test("needs at least one correct tile; blank tiles are dropped", () => {
  assert.ok(buildStimulusPointsFromTiles([{ text: "a", correct: false }]).error);
  assert.equal(buildStimulusPointsFromTiles([{ text: "a", correct: true }, { text: "  ", correct: true }]).points.length, 1);
});

console.log("build flags (AI build failures)");
test("parseBuildFlags tolerates null/garbage and buildFlagsJsonWithout removes resolved parts", () => {
  assert.deepEqual(parseBuildFlags(null).failedParts, []);
  assert.deepEqual(parseBuildFlags("not json").failedParts, []);
  const raw = JSON.stringify({ failedParts: ["purpose", "context", "stimulus"], at: "x" });
  const left = buildFlagsJsonWithout(raw, ["purpose", "stimulus"]);
  assert.deepEqual(parseBuildFlags(left).failedParts, ["context"]);
  assert.equal(buildFlagsJsonWithout(left, ["context"]), null, "no flags left => stored as NULL");
});

console.log("buildManualCaseFromComponents (v1.12 payloads)");
const KEYS13 = ["salutation","greeting","purpose","context","keyinfo1","keyinfo2","keyinfo3","keyinfo4","keyinfo5","ownIdea","closing","signoff","name"];
const comps13 = KEYS13.map((k) => ({ label: k, options: [{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }], correctId: "a" }));
test("uses editor-supplied chunks (incl. optional) and up-to-12 tiles", () => {
  const body = {
    taskText: "Task. Write to Sir.", keyInfo: ["1", "2", "3", "4", "5"],
    taskChunks: [{ text: "x", type: "optional" }, { text: "y", type: "audience" }, { text: "z", type: "purpose" }],
    stimulusTiles: [{ text: "p", correct: true }, { text: "q", correct: false }],
  };
  const built = buildManualCaseFromComponents(body, true, comps13);
  assert.deepEqual(built.taskChunks.map((c) => c.type), ["optional", "audience", "purpose"]);
  assert.equal(built.stimulusPoints.length, 2);
});
test("without tiles/chunks it behaves as before (5 relevant + 2 distractors)", () => {
  const body = { taskText: "A task. Write to Sir.", keyInfo: ["1", "2", "3", "4", "5"], distractorStimulusPoints: ["d1", "d2"] };
  const built = buildManualCaseFromComponents(body, true, comps13);
  assert.equal(built.stimulusPoints.length, 7);
  assert.ok(built.taskChunks.length >= 1);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.error("Some tests FAILED — see above.");
} else {
  console.log("All marking-logic tests passed.");
}

// v1.14 tests (final-letter marking engine + end-to-end submitCase)
await import("./marking_v114.test.mjs");
