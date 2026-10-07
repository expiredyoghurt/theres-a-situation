/**
 * v1.15 tests: the article format and the teacher-supplied mark scheme
 * (Task Fulfilment /6, Language & Organisation /8).
 *   node tests/marking_v115.test.mjs
 */
import assert from "node:assert/strict";
import * as M from "../worker/marking.js";
import { submitCase, assembleLetter, fixCheck } from "../worker/index.js";
import { DEMO_CASES } from "../worker/demoCases.js";

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok - ${name}`); }
  catch (e) { console.error(`  FAIL - ${name}\n    ${e.stack || e.message}`); process.exitCode = 1; }
}

const art = DEMO_CASES.find((c) => c.id === "demo-3");
const pts = art.stimulusPoints.filter((p) => p.relevant).map((p) => ({ id: p.id, text: p.text }));
const known = [...art.stimulusPoints.map((p) => p.text), art.taskText, art.model_letter];
const OWN = "set a daily phone reminder to water it";
const ctx = (extra = {}) => ({ relevantPoints: pts, knownTexts: known, ownContent: OWN, format: "article", level: 3, ...extra });
const MODEL = art.model_letter;

// ---- minimal fake analysis for the scheme table ----------------------------------------
const fake = ({ found = 5, k = 5, own = true, words = 150, paras = 3, mech = 0 } = {}) => ({
  coverage: Array.from({ length: k }, (_, i) => ({ status: i < found ? "found" : "missing" })),
  ownInLetter: own, words, paraCount: paras, mech: { count: mech },
});
const PAC = { all: { purpose: true, audience: true, context: true }, two: { purpose: true, audience: true, context: false }, one: { purpose: true, audience: false, context: false }, none: { purpose: false, audience: false, context: false } };
const LO = { language: 5, organisation: 3 };
const tf = (a, own, pac) => M.computeMoe({ analysis: a, ownFraction: own, pac, lo: LO }).taskFulfilment.score;

console.log("teacher mark scheme: Task Fulfilment /6");
await test("6/6 only with every content point (incl. own idea) and fully accurate PAC", () => {
  assert.equal(tf(fake(), 1, PAC.all), 6);
  assert.equal(tf(fake(), 1, PAC.two), 5, "one PAC error costs a mark");
  assert.equal(tf(fake({ found: 4 }), 1, PAC.all), 5, "one content point missing, no PAC error");
});
await test("5/6 = all content but ONE PAC error, OR one content point missing with NO PAC error", () => {
  assert.equal(tf(fake(), 1, PAC.two), 5);
  assert.equal(tf(fake({ found: 4 }), 1, PAC.all), 5);
  assert.equal(tf(fake(), 0.3, PAC.all), 5, "an unusable own idea counts as the missing point");
  assert.equal(tf(fake({ own: false }), 1, PAC.all), 5, "an own idea that never reaches the writing counts as missing");
});
await test("3-4/6 otherwise, depending on content and PAC (floor of 3 while >=3 points and some PAC)", () => {
  assert.equal(tf(fake({ found: 4 }), 1, PAC.two), 4);
  assert.equal(tf(fake({ found: 3 }), 1, PAC.all), 4);
  assert.equal(tf(fake({ found: 3 }), 1, PAC.two), 3);
  assert.equal(tf(fake({ found: 2 }), 1, PAC.one), 3, "3 of 6 points (2 + own idea) is not 'fewer than 3'");
  assert.equal(tf(fake({ found: 3 }), 0, PAC.one), 3, "never below 3 while 3+ points and some accurate PAC");
});
await test("1-2/6 for fewer than 3 content points, or NO accurate PAC", () => {
  assert.equal(tf(fake({ found: 1 }), 0, PAC.all), 2);
  assert.equal(tf(fake(), 1, PAC.none), 2);
  assert.equal(tf(fake({ found: 1 }), 0, PAC.none), 1);
  assert.equal(tf(fake({ found: 0 }), 0, PAC.all), 1);
  assert.ok(tf(fake({ found: 2 }), 0, PAC.all) <= 2);
});
await test("an empty or near-empty answer scores 0 task fulfilment", () => {
  assert.equal(tf(fake({ words: 5 }), 1, PAC.all), 0);
});

console.log("teacher mark scheme: Language & Organisation /8");
await test("8/8 for perfect language and excellent organisation", () => {
  assert.equal(M.computeMoe({ analysis: fake(), ownFraction: 1, pac: PAC.all, lo: LO }).languageOrg.score, 8);
});
await test("capped at 6/8 when there is no paragraphing", () => {
  const one = M.computeMoe({ analysis: fake({ paras: 1 }), ownFraction: 1, pac: PAC.all, lo: LO });
  assert.equal(one.languageOrg.score, 6);
  assert.equal(one.languageOrg.capped, "no-paragraphing");
  assert.equal(M.computeMoe({ analysis: fake({ paras: 0 }), ownFraction: 1, pac: PAC.all, lo: LO }).languageOrg.score, 6);
  assert.equal(M.computeMoe({ analysis: fake({ paras: 2 }), ownFraction: 1, pac: PAC.all, lo: LO }).languageOrg.score, 8);
});
await test("visible mechanical slips still cap language, and the cap stacks with the paragraph cap", () => {
  const r = M.computeMoe({ analysis: fake({ mech: 6, paras: 1 }), ownFraction: 1, pac: PAC.all, lo: LO });
  assert.ok(r.languageOrg.score <= 4, `got ${r.languageOrg.score}`);
});
await test("a modest generous-AI language score is respected below the caps", () => {
  assert.equal(M.computeMoe({ analysis: fake(), ownFraction: 1, pac: PAC.all, lo: { language: 3, organisation: 2 } }).languageOrg.score, 5);
});

console.log("formats");
await test("normaliseFormat accepts strings, legacy booleans and case-like objects", () => {
  assert.equal(M.normaliseFormat("article"), "article");
  assert.equal(M.normaliseFormat(true), "formal_letter");
  assert.equal(M.normaliseFormat(false), "informal_letter");
  assert.equal(M.normaliseFormat({ formal: 0 }), "informal_letter");
  assert.equal(M.normaliseFormat({ format: "article", formal: 1 }), "article");
  assert.equal(M.normaliseFormat({ format: "nonsense", formal: 1 }), "formal_letter");
  assert.equal(M.normaliseFormat(undefined), "formal_letter");
});
await test("every existing letter case keeps working (legacy `formal` flag) and tutorials declare a format", () => {
  assert.deepEqual(DEMO_CASES.map((c) => M.normaliseFormat(c)), ["formal_letter", "informal_letter", "article"]);
});

console.log("article parsing and checks");
await test("layout 1: headline, body, byline at the end", () => {
  const p = M.parseArticle("Why We Should Recycle\nRecycling matters to all of us. Let us start today.\n\nWe can all help.\nThank you for reading!\nWei Ming Tan");
  assert.equal(p.title, "Why We Should Recycle");
  assert.equal(p.byline, "Wei Ming Tan");
  assert.equal(p.bodyParas.length, 3);
});
await test("layout 2: headline, byline right under it, then the body", () => {
  const p = M.parseArticle(MODEL);
  assert.equal(p.title, "Come and Grow with Us at the Garden Club Open House!");
  assert.equal(p.byline, "Wei Ming Tan");
  assert.equal(p.bodyParas.length, 3);
});
await test("layout 3: greeting-style opening and a closing signature are tolerated, not required", () => {
  const p = M.parseArticle("Dear Schoolmates,\nHave you tried gardening? Join us on Wednesday.\n\nThank you for reading.\nYours sincerely,\nWei Ming Tan");
  assert.equal(p.salutation, "Dear Schoolmates,");
  assert.equal(p.signoff.toLowerCase(), "yours sincerely");
  assert.equal(p.byline, "Wei Ming Tan");
  const fc = M.formatChecks("Dear Schoolmates,\nHave you tried gardening? Join us on Wednesday.\n\nThank you for reading.\nYours sincerely,\nWei Ming Tan", "article");
  assert.ok(!fc.issues.some((i) => i.code === "pair-mismatch" || i.code === "register-slip"));
});
await test("the model article passes every article check with no issues", () => {
  const fc = M.formatChecks(MODEL, "article");
  assert.deepEqual(fc.issues, []);
  assert.ok(fc.hasTitle && fc.hasByline && fc.bylineFull && fc.hasHook && fc.hasCta && fc.hasThanks && !fc.listLike);
});
await test("missing headline, byline, call to action and thanks are each reported", () => {
  const body = "I would like to share news about the open house on Wednesday, 18 March, at the Rooftop Garden.";
  const codes = M.formatChecks(body + " It was fun.\n\nSeedlings are lovely plants.", "article").issues.map((i) => i.code);
  for (const c of ["no-title", "no-byline", "no-cta", "no-thanks"]) assert.ok(codes.includes(c), c);
});
await test("a first-name-only byline is flagged (the byline must be a full name)", () => {
  const fc = M.formatChecks(MODEL.replace("By Wei Ming Tan", "By Wei"), "article");
  assert.ok(fc.hasByline && !fc.bylineFull);
  assert.ok(fc.issues.some((i) => i.code === "byline-first-name"));
});
await test("points listed like a checklist are flagged; text-speak is a register slip", () => {
  const list = "Open House\nBy Wei Ming Tan\n- Date is 18 March\n- Venue is the Rooftop Garden\n- Plant a seedling\n- Bring a pot\nJoin us! Thank you for reading.";
  assert.ok(M.formatChecks(list, "article").issues.some((i) => i.code === "list-like"));
  const speak = M.formatChecks(MODEL.replace("Thank you for reading", "Thx 4 reading"), "article");
  assert.ok(speak.issues.some((i) => i.code === "register-slip"));
});
await test("articles are NOT penalised for lacking a salutation or sign-off (letter-only flags stay off)", () => {
  const a = M.analyseLetter(MODEL, ctx());
  const flags = M.deriveErrorFlags(a, { ownFraction: 1, expectedBody: 3 });
  for (const bad of ["no-salutation", "no-signoff", "pair-mismatch"]) assert.ok(!flags.includes(bad), bad);
  assert.equal(flags.length, 0, flags.join(","));
});
await test("AI-down fallbacks treat a good article fairly (no salutation needed for audience/organisation)", () => {
  const a = M.analyseLetter(MODEL, ctx());
  assert.equal(M.fallbackPac(a).audience, true);
  assert.equal(M.fallbackLanguageOrg(MODEL, "article").organisation, 3);
  // the same words as a LETTER would lose the organisation point for the missing salutation/sign-off
  assert.ok(M.fallbackLanguageOrg(MODEL, "formal_letter").organisation < 3);
});
await test("the model article earns full content marks, full paragraphing and 14/14", () => {
  const a = M.analyseLetter(MODEL, ctx());
  assert.ok(a.coverage.every((c) => c.status === "found"));
  assert.equal(a.unknownNumbers.length, 0, "numbers in the headline/byline must not be flagged as invented");
  assert.equal(M.scoreLetterContent(a, 30).score, 30);
  assert.equal(M.scoreParagraphing(a, 3, 10).score, 10);
  assert.equal(M.computeMoe({ analysis: a, ownFraction: 1, pac: PAC.all, lo: LO }).total, 14);
});
await test("a one-block article with no headline loses paragraphing, and Language & Organisation is capped at 6", () => {
  const block = MODEL.split("\n").filter(Boolean).slice(2).join(" ");
  const a = M.analyseLetter(block, ctx());
  assert.ok(a.paraCount <= 1);
  assert.ok(M.scoreParagraphing(a, 3, 10).score < 6);
  assert.ok(M.computeMoe({ analysis: a, ownFraction: 1, pac: PAC.all, lo: LO }).languageOrg.score <= 6);
});

console.log("prompts and fix-it");
await test("the examiner prompt is article-specific for articles and unchanged in spirit for letters", () => {
  const p = M.buildLetterExaminerPrompt({ ...art, taskChunks: art.taskChunks, stimulusPoints: art.stimulusPoints }, MODEL, { format: "article" });
  assert.ok(/ARTICLE/.test(p) && /does NOT need a salutation/.test(p) && /"cta"/.test(p) && /"headline"/.test(p));
  const l = M.buildLetterExaminerPrompt({ ...DEMO_CASES[0], taskChunks: DEMO_CASES[0].taskChunks, stimulusPoints: DEMO_CASES[0].stimulusPoints }, "Dear Mr Kumar,\nhi", { formal: true });
  assert.ok(/FORMAL letter/.test(l) && !/"cta"/.test(l));
});
await test("the examiner parser keeps optional article booleans and still accepts letter replies", () => {
  const j = M.parseLetterJudgement('{"purpose":true,"audience":true,"context":true,"headline":true,"flow":false,"cta":false,"language":4,"organisation":2,"errors":[],"note":"ok"}');
  assert.equal(j.cta, false); assert.equal(j.flow, false); assert.equal(j.headline, true);
  const old = M.parseLetterJudgement('{"purpose":true,"audience":true,"context":true,"language":4,"organisation":2,"errors":[],"note":"ok"}');
  assert.equal(old.cta, undefined); assert.equal(old.language, 4);
});
await test("article fix-it tasks: call to action, headline, byline", () => {
  const noCta = MODEL.replace("So why not join us at the Rooftop Garden and register with Ms Lim today? ", "");
  assert.ok(!M.formatChecks(noCta, "article").hasCta, "'I hope to see you there' alone is a pleasantry, not a call to action");
  const a = M.analyseLetter(noCta, ctx());
  const flags = M.deriveErrorFlags(a, { ownFraction: 1, expectedBody: 3 });
  assert.ok(flags.includes("no-cta"));
  const task = M.pickFixTask(a, flags, null);
  assert.equal(task.kind, "cta");
  assert.equal(M.checkFix(task, "Remember to register with Ms Lim by 11 March.", { format: "article" }).ok, true);
  assert.equal(M.checkFix(task, "It was a nice day for everyone here.", { format: "article" }).ok, false);
  assert.equal(M.checkFix({ kind: "title" }, "Grow Your Own Herbs!", { format: "article" }).ok, true);
  assert.equal(M.checkFix({ kind: "title" }, "This is a whole sentence that ends here.", { format: "article" }).ok, false);
  assert.equal(M.checkFix({ kind: "byline" }, "By Wei Ming Tan", { format: "article" }).ok, true);
  assert.equal(M.checkFix({ kind: "byline" }, "Wei", { format: "article" }).ok, false);
});

console.log("assembly + case payloads");
await test("assembleLetter puts the headline and byline on their own lines and never repeats the byline", () => {
  const choices = {}; const breaks = new Set(art.answerKey.paragraphBreaks);
  for (const c of art.components) choices[c.key] = "a";
  const out = assembleLetter(art, choices, breaks, "By Wei Ming Tan", {});
  assert.equal(out, MODEL);
  assert.equal(out.split("By Wei Ming Tan").length, 2);
  assert.ok(out.startsWith("Come and Grow with Us at the Garden Club Open House!\nBy Wei Ming Tan\n\nHave you ever"));
});
await test("letters still assemble exactly as before (salutation / sign-off / name on their own lines)", () => {
  const l = DEMO_CASES[0]; const choices = {};
  for (const c of l.components) choices[c.key] = "a";
  assert.equal(assembleLetter(l, choices, new Set(l.answerKey.paragraphBreaks), "Wei Ming Tan", {}), l.model_letter);
});

// ---------- end-to-end ----------
function fakeEnv({ aiReply } = {}) {
  const writes = [];
  const stmt = (sql) => {
    const mk = (args) => ({
      run: async () => { writes.push({ sql, args }); return { meta: { last_row_id: 9 } }; },
      first: async () => null,
      all: async () => ({ results: [] }),
    });
    return { bind: (...args) => mk(args), ...mk([]) };
  };
  const env = { DB: { prepare: stmt, batch: async () => [] }, writes };
  if (aiReply) env.AI = { run: async (_m, { messages }) => ({ response: aiReply(messages[0].content) }) };
  return env;
}
const callCase = async (env, id, body) => {
  const res = await submitCase(env, new Request(`http://x/api/cases/${id}/submit`, { method: "POST", body: JSON.stringify(body) }), id);
  return { status: res.status, data: await res.json() };
};
const level1 = (over = {}) => {
  const choices = {};
  for (const c of art.components) choices[c.key] = M.publicOptionId("demo-3", c.key, "a");
  return {
    name: "Mei", playerClass: "5IG", deviceId: "d1", level: 1,
    taskAnswers: { c1: "context", c2: "audience", c3: "purpose" },
    stimulusSelected: ["s1", "s2", "s3", "s4", "s5"], ownContent: OWN + " every evening",
    componentChoices: choices, componentResponses: {}, paragraphBreaks: art.answerKey.paragraphBreaks, signOffName: "By Wei Ming Tan", ...over,
  };
};
const goodAi = (prompt) => prompt.includes("OWN SUGGESTION")
  ? '{"relevant":true,"logical":true,"clue":true,"note":"Lovely link to the pot."}'
  : '{"purpose":true,"audience":true,"context":true,"headline":true,"flow":true,"cta":true,"language":5,"organisation":3,"errors":[],"note":"A lively article."}';

console.log("submitCase end-to-end (article)");
await test("guided article, AI working: format returned, MOE 14/14, no letter-only flags, no review needed", async () => {
  const { status, data } = await callCase(fakeEnv({ aiReply: goodAi }), "demo-3", level1());
  assert.equal(status, 200);
  assert.equal(data.format, "article");
  assert.ok(data.score >= 95, `score ${data.score}`);
  assert.equal(data.moe.total, 14);
  assert.equal(data.moe.scheme, "v1.15");
  assert.equal(data.needsTeacherReview, false);
  assert.equal(data.fixTask, null);
  assert.deepEqual(data.flags, []);
  assert.ok(data.checklist.format.some((f) => f.label === "Headline" && f.ok));
  assert.ok(!data.checklist.format.some((f) => /Salutation|Sign-off/.test(f.label)), "no letter-only items in an article checklist");
  assert.equal(data.assembledLetter, MODEL);
});
await test("same article with the AI down: sensible score, flagged for a teacher", async () => {
  const { data } = await callCase(fakeEnv(), "demo-3", level1());
  assert.equal(data.needsTeacherReview, true);
  assert.equal(data.moe.estimate, true);
  assert.ok(data.moe.languageOrg.score >= 6, `L&O ${data.moe.languageOrg.score}`);
});
await test("picking the first-name-only byline option is NOT blocked: the kept wrong option is flagged and marks drop", async () => {
  const choices = level1().componentChoices;
  const wrong = art.components.find((c) => c.key === "byline").options.find((o) => o.text === "By Wei Ming");
  choices.byline = M.publicOptionId("demo-3", "byline", wrong.id);
  const { status, data } = await callCase(fakeEnv({ aiReply: goodAi }), "demo-3", level1({ componentChoices: choices, signOffName: "By Wei Ming" }));
  assert.equal(status, 200);
  assert.ok(data.flags.some((f) => f.code === "distractor-kept"));
  assert.ok(data.breakdown.letterChoices.score < 30);
});
await test("the examiner can flag a two-part given name that the heuristics cannot tell from a full name (Level 2/3)", async () => {
  const noFullName = (p) => p.includes("OWN SUGGESTION") ? '{"relevant":true,"logical":true,"clue":true,"note":"ok"}'
    : '{"purpose":true,"audience":true,"context":true,"headline":true,"flow":true,"cta":true,"byline":false,"language":5,"organisation":3,"errors":[],"note":"ok"}';
  const text = MODEL.replace("By Wei Ming Tan", "By Wei Ming");
  const { data } = await callCase(fakeEnv({ aiReply: noFullName }), "demo-3", { ...level1(), level: 3, componentChoices: {}, finalLetter: text, signOffName: "" });
  assert.ok(data.flags.some((f) => f.code === "byline-first-name"));
});
await test("a blank byline at Level 1 is rejected with a helpful message", async () => {
  const { status, data } = await callCase(fakeEnv({ aiReply: goodAi }), "demo-3", level1({ signOffName: "  " }));
  assert.equal(status, 400);
  assert.ok(/byline/i.test(data.error));
});
await test("Level 3 free-write: a bare list with no headline scores low and shows the article flags", async () => {
  const bad = "the open house is on 18 march\n- rooftop garden\n- bring pot\n- register by 11 march";
  const { status, data } = await callCase(fakeEnv({ aiReply: (p) => p.includes("OWN SUGGESTION") ? '{"relevant":false,"logical":false,"clue":false,"note":"x"}' : '{"purpose":false,"audience":false,"context":false,"headline":false,"flow":false,"cta":false,"language":1,"organisation":0,"errors":[],"note":"Needs work."}' }),
    "demo-3", { ...level1(), level: 3, componentChoices: {}, finalLetter: bad, signOffName: "", ownContent: "pizza" });
  assert.equal(status, 200);
  assert.ok(data.score < 50);
  const codes = data.flags.map((f) => f.code);
  for (const c of ["no-title", "no-cta", "no-thanks"]) assert.ok(codes.includes(c), c);
  assert.ok(data.moe.taskFulfilment.score <= 2);
});
await test("the article check-fix endpoint accepts the new fix kinds", async () => {
  const res = await fixCheck(fakeEnv(), new Request("http://x/api/cases/demo-3/check-fix", { method: "POST", body: JSON.stringify({ task: { kind: "cta" }, text: "Join us on Wednesday and sign up with Ms Lim." }) }), "demo-3");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});
await test("letters still return their format and the same flags; MOE now uses the teacher scheme", async () => {
  const d1 = DEMO_CASES[0];
  const choices = {}; for (const c of d1.components) choices[c.key] = M.publicOptionId("demo-1", c.key, "a");
  const { data } = await callCase(fakeEnv({ aiReply: (p) => p.includes("OWN SUGGESTION") ? '{"relevant":true,"logical":true,"clue":true,"note":"ok"}' : '{"purpose":true,"audience":true,"context":true,"language":5,"organisation":3,"errors":[],"note":"ok"}' }), "demo-1",
    { name: "Mei", playerClass: "5IG", deviceId: "d1", level: 1, taskAnswers: {}, stimulusSelected: ["s1", "s2", "s3", "s4"], ownContent: "I could design publicity posters before 7 March.", componentChoices: choices, componentResponses: {}, paragraphBreaks: d1.answerKey.paragraphBreaks, signOffName: "Wei Ming Tan" });
  assert.equal(data.format, "formal_letter");
  assert.equal(data.moe.total, 14);
  assert.ok(data.checklist.format.some((f) => f.label === "Salutation"));
});

console.log("plumbing");
await test("the cases list and public case payload carry the format; the schema migration backfills it", async () => {
  const { default: worker } = await import("../worker/index.js");
  const env = fakeEnv();
  const list = await (await worker.fetch(new Request("http://x/api/cases"), env, {})).json();
  assert.deepEqual(list.cases.map((c) => c.format), ["formal_letter", "informal_letter", "article"]);
  const one = await (await worker.fetch(new Request("http://x/api/cases/demo-3"), env, {})).json();
  assert.equal(one.case.format, "article");
  assert.deepEqual(one.case.components.map((c) => c.label)[0], "Headline");
  assert.equal(one.case.components.length, 13);
  assert.ok(!JSON.stringify(one).includes("answerKey"));
  assert.ok(env.writes.some((w) => /UPDATE cases SET format/.test(w.sql)), "legacy rows are backfilled from `formal`");
});

console.log("v1.15.1 backend upload");
await test("SIGNOFF_RE accepts 'Written by' and the SQL prompt copies match", async () => {
  const fs = await import("node:fs");
  assert.ok(fs.readFileSync(new URL("../worker/marking.js", import.meta.url), "utf8").includes("written\\s+by"));
  const a = fs.readFileSync(new URL("../AI_CASE_TO_D1_SQL_PROMPT.md", import.meta.url), "utf8");
  const b = fs.readFileSync(new URL("../public/AI_CASE_TO_D1_SQL_PROMPT.md", import.meta.url), "utf8");
  assert.equal(a, b, "root and public prompt copies must be identical");
  const sql = fs.readFileSync(new URL("../CASE_IMPORT_EXAMPLE.sql", import.meta.url), "utf8");
  assert.match(sql, /formal, format,/);
  assert.match(sql, /'informal_letter'/);
  assert.match(sql, /'draft'/);
});

console.log(`\n${passed} v1.15 test(s) passed.`);
