// v2.2 — Step 2 "what to look for" checklist: cleaning, suggestion, validation, public payload, API.
import assert from "node:assert/strict";
import fs from "node:fs";
import { cleanLookFor, parseLookFor, suggestLookFor, MAX_LOOK_FOR } from "../worker/lookfor.js";
import { validateCaseRow } from "../worker/validate.js";
import { DEMO_CASES } from "../worker/demoCases.js";
import worker from "../worker/index.js";
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("  ok - " + name); } catch (e) { console.log("  FAIL - " + name + "\n" + (e.stack || e)); process.exitCode = 1; } }

console.log("v2.2 look-for");
await test("cleanLookFor trims bullets, drops blanks and duplicates, caps length and count", () => {
  assert.deepEqual(cleanLookFor("- The date\n• The place\n\n 3. the date \nThe time"), ["The date", "The place", "The time"]);
  assert.equal(cleanLookFor(Array.from({ length: 20 }, (_, i) => "Label " + i)).length, MAX_LOOK_FOR);
  assert.equal(cleanLookFor(["x".repeat(200)])[0].length, 80);
  assert.deepEqual(cleanLookFor(undefined), []);
});
await test("parseLookFor never throws on bad stored data", () => {
  assert.deepEqual(parseLookFor('["A","B"]'), ["A", "B"]);
  for (const bad of [null, "", "not json", "{}", '"str"', 5]) assert.deepEqual(parseLookFor(bad), []);
});
await test("suggestLookFor names the kind of information and never leaks the value", () => {
  const out = suggestLookFor(["Date: Saturday, 14 March, 9am to 12pm", "Venue: School Hall", "Volunteers needed to man booths and sort recyclables", "Sign up with Mr Kumar by 7 March"]);
  assert.ok(out.includes("The date") && out.includes("The time") && out.includes("The place"));
  assert.ok(out.includes("The sign-up or reply deadline"), JSON.stringify(out));
  const blob = out.join(" ");
  for (const leak of ["14 March", "9am", "School Hall", "Kumar", "7 March"]) assert.ok(!blob.includes(leak), "leaked " + leak);
  assert.deepEqual(suggestLookFor([]), []);
  assert.equal(new Set(out).size, out.length, "no duplicates");
});
await test("every demo case has a checklist with no answer values in it", () => {
  for (const c of DEMO_CASES) {
    assert.ok(c.lookFor.length >= 4, c.id);
    const blob = c.lookFor.join(" ");
    assert.ok(!/\d/.test(blob), c.id + " labels must not contain numbers: " + blob);
  }
});
await test("validator: look_for must be a short JSON array", () => {
  const base = { id: "x", title: "t", task_text: "t", task_chunks: "[]", stimulus_points: "[]", components: "[]", answer_key: "{}" };
  const errs = (lf) => validateCaseRow({ ...base, look_for: lf }).errors.filter((e) => /look_for/.test(e));
  assert.equal(errs('["The date"]').length, 0);
  assert.equal(errs(null).length, 0);
  assert.ok(errs("not json").length >= 1);
  assert.ok(errs('{"a":1}').length >= 1);
  assert.ok(errs(JSON.stringify(Array(9).fill("x"))).length >= 1);
});
await test("pupil payload carries lookFor (no answers); the API route is auth-protected", async () => {
  const stmt = () => { const m = () => ({ run: async () => ({}), first: async () => null, all: async () => ({ results: [] }) }); return { bind: () => m(), ...m() }; };
  const env = { DB: { prepare: stmt, batch: async () => [] } };
  const r = await (await worker.fetch(new Request("http://x/api/cases/demo-1"), env, {})).json();
  assert.deepEqual(r.case.lookFor, DEMO_CASES[0].lookFor);
  assert.ok(!JSON.stringify(r).includes("relevant"));
  const noAuth = await worker.fetch(new Request("http://x/api/admin/look-for/suggest", { method: "POST", body: "{}" }), env, {});
  assert.equal(noAuth.status, 401);
});
await test("SQL prompt copies match and mention look_for; SQL example sets it", () => {
  const a = fs.readFileSync(new URL("../AI_CASE_TO_D1_SQL_PROMPT.md", import.meta.url), "utf8");
  assert.equal(a, fs.readFileSync(new URL("../public/AI_CASE_TO_D1_SQL_PROMPT.md", import.meta.url), "utf8"));
  assert.match(a, /approved_at, look_for/);
  assert.match(fs.readFileSync(new URL("../CASE_IMPORT_EXAMPLE.sql", import.meta.url), "utf8"), /approved_at, look_for/);
});
await test("the SQL example runs on a real SQLite built from schema.sql and passes the validator", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, ""));
  db.exec(fs.readFileSync(new URL("../CASE_IMPORT_EXAMPLE.sql", import.meta.url), "utf8"));
  const row = db.prepare("SELECT * FROM cases").get();
  const v = validateCaseRow(row);
  assert.deepEqual(v.errors, []);
  assert.equal(parseLookFor(row.look_for).length, 5);
});
await test("saving a case: blank lookFor is auto-suggested from key info; an explicit list or empty list is respected; the editor route updates it", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { saveBuiltCase, adminSaveCaseEvidence } = await import("../worker/adminCases.js");
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, ""));
  const d1 = { prepare: (sql) => { const mk = (a) => ({ run: async () => { db.prepare(sql).run(...a); return {}; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }); return { bind: (...a) => mk(a), ...mk([]) }; } };
  const env = { DB: d1 };
  const built = { taskChunks: [{ id: "t1", text: "x", type: "purpose" }], stimulusPoints: [{ id: "s1", text: "Venue: School Hall", relevant: true }], ownContentKeywords: [], components: [], answerKey: {} };
  const base = { title: "T", taskText: "task", modelLetter: "m", format: "informal_letter" };
  const get = (id) => JSON.parse(db.prepare("SELECT look_for FROM cases WHERE id=?").get(id).look_for);
  const a = await saveBuiltCase(env, { ...base, keyInfo: ["Date: Saturday, 14 March", "Venue: School Hall"] }, { username: "t" }, built);
  assert.deepEqual(get(a.id), ["The date", "The place"]);
  const b = await saveBuiltCase(env, { ...base, lookFor: ["Custom one", "Custom two"] }, { username: "t" }, built);
  assert.deepEqual(get(b.id), ["Custom one", "Custom two"]);
  const c = await saveBuiltCase(env, { ...base, lookFor: [] }, { username: "t" }, built);
  assert.deepEqual(get(c.id), []);
  const req = new Request("http://x", { method: "PUT", body: JSON.stringify({ tiles: [{ text: "Venue", correct: true }], lookFor: "New A\nNew B", requiredText: "" }) });
  const res = await adminSaveCaseEvidence(env, req, a.id, { username: "t" });
  assert.equal(res.status, 200);
  assert.deepEqual(get(a.id), ["New A", "New B"]);
  // omitting lookFor on the editor route leaves the stored list alone
  await adminSaveCaseEvidence(env, new Request("http://x", { method: "PUT", body: JSON.stringify({ tiles: [{ text: "Venue", correct: true }] }) }), a.id, { username: "t" });
  assert.deepEqual(get(a.id), ["New A", "New B"]);
});
console.log(`\n${passed} v2.2 test(s) passed.`);
