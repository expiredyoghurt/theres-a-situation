// v2.3 — changing a case's format after it was built (real SQLite from schema.sql, fake AI).
import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { planFormatChange, adminSetCaseFormat } from "../worker/caseFormat.js";
import { validateCaseRow } from "../worker/validate.js";
import { LETTER_KEYS, ARTICLE_KEYS } from "../worker/validate.js";
import worker from "../worker/index.js";
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("  ok - " + name); } catch (e) { console.log("  FAIL - " + name + "\n" + (e.stack || e)); process.exitCode = 1; } }

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8").replace(/^\s*--.*$/gm, ""));
  db.exec(fs.readFileSync(new URL("../CASE_IMPORT_EXAMPLE.sql", import.meta.url), "utf8"));
  return db;
}
const d1 = (db) => ({ prepare: (sql) => { const mk = (a) => ({ run: async () => { db.prepare(sql).run(...a); return {}; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }) }); return { bind: (...a) => mk(a), ...mk([]) }; } });
const goodAi = { run: async () => ({ response: JSON.stringify({ correct: "A brand new AI sentence.", distractors: ["A wrong sentence one.", "A wrong sentence two."] }) }) };
const ID = "case_import_school_trip_001";
const call = (db, fmt, extra = {}, ai = goodAi) => adminSetCaseFormat({ DB: d1(db), AI: ai }, new Request("http://x", { method: "PUT", body: JSON.stringify({ format: fmt, ...extra }) }), ID, { username: "t" });
const row = (db) => db.prepare("SELECT * FROM cases WHERE id=?").get(ID);
const keys = (db) => JSON.parse(row(db).components).map((c) => c.key);
const optTexts = (db, k) => JSON.parse(row(db).components).find((c) => c.key === k).options.map((o) => o.text).sort();

console.log("v2.3 case format");
await test("plan: letter<->letter keeps everything; crossing rebuilds the differing parts", () => {
  assert.deepEqual(planFormatChange(LETTER_KEYS, "formal_letter").rebuild, []);
  assert.deepEqual(planFormatChange(LETTER_KEYS, "formal_letter", { rebuildRegister: true }).rebuild, ["salutation", "greeting", "closing", "signoff", "name"]);
  const toArticle = planFormatChange(LETTER_KEYS, "article");
  assert.deepEqual(toArticle.rebuild.sort(), ["context", "cta", "headline", "byline", "hook", "purpose", "thanks"].sort());
  assert.ok(["keyinfo1", "keyinfo5", "ownIdea"].every((k) => toArticle.keep.includes(k)));
  const toLetter = planFormatChange(ARTICLE_KEYS, "informal_letter");
  assert.ok(["salutation", "greeting", "closing", "signoff", "name", "purpose", "context"].every((k) => toLetter.rebuild.includes(k)));
  assert.equal(planFormatChange(ARTICLE_KEYS, "article").rebuild.length, 0);
});
await test("informal letter -> formal, keep parts: only format, flag and labels change", async () => {
  const db = freshDb(); const before = row(db);
  const res = await call(db, "formal_letter");
  const d = await res.json(); assert.equal(res.status, 200); assert.deepEqual(d.rebuilt, []);
  const r = row(db);
  assert.equal(r.format, "formal_letter"); assert.equal(r.formal, 1); assert.equal(r.status, "draft");
  assert.equal(r.answer_key, before.answer_key, "answers untouched");
  assert.equal(JSON.parse(r.components).find((c) => c.key === "greeting").label, "Introduction (formal)");
  assert.deepEqual(optTexts(db, "keyinfo1"), JSON.parse(before.components).find((c) => c.key === "keyinfo1").options.map((o) => o.text).sort());
  assert.deepEqual(validateCaseRow(r).errors, []);
});
await test("formal -> informal with rebuild: register parts regenerated, content parts kept", async () => {
  const db = freshDb(); await call(db, "formal_letter");
  const kept = optTexts(db, "keyinfo2");
  const d = await (await call(db, "informal_letter", { rebuildRegister: true })).json();
  assert.deepEqual(d.rebuilt.sort(), ["closing", "greeting", "name", "salutation", "signoff"]);
  assert.deepEqual(d.failedParts, []);
  assert.ok(optTexts(db, "salutation").includes("A brand new AI sentence."));
  assert.deepEqual(optTexts(db, "keyinfo2"), kept);
  assert.equal(row(db).format, "informal_letter");
});
await test("letter -> article: article parts, key info and own idea kept, default article breaks, valid row", async () => {
  const db = freshDb(); const ownBefore = optTexts(db, "ownIdea"), k3 = optTexts(db, "keyinfo3");
  const res = await call(db, "article"); const d = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(keys(db), ARTICLE_KEYS);
  assert.deepEqual(optTexts(db, "ownIdea"), ownBefore); assert.deepEqual(optTexts(db, "keyinfo3"), k3);
  const r = row(db); const ak = JSON.parse(r.answer_key);
  assert.deepEqual(ak.paragraphBreaks, ["hook", "keyinfo1", "cta"]);
  for (const k of ARTICLE_KEYS) assert.ok(JSON.parse(r.components).find((c) => c.key === k).options.some((o) => o.id === ak.components[k]), k);
  assert.equal(r.format, "article"); assert.equal(r.formal, 0);
  assert.deepEqual(validateCaseRow(r).errors, []);
  assert.deepEqual(d.failedParts, []);
  assert.ok(d.warnings.some((w) => /model answer/i.test(w)));
});
await test("AI down: parts are rebuilt from templates and flagged so Publish is blocked until fixed", async () => {
  const db = freshDb();
  const d = await (await call(db, "article", {}, { run: async () => { throw new Error("down"); } })).json();
  assert.deepEqual(keys(db), ARTICLE_KEYS);
  assert.deepEqual([...d.failedParts].sort(), [...d.rebuilt].sort());
  assert.ok(JSON.parse(row(db).build_flags).failedParts.includes("headline"));
  assert.deepEqual(validateCaseRow(row(db)).errors, []);
});
await test("article -> letter and back round-trips to a valid letter", async () => {
  const db = freshDb(); await call(db, "article"); await call(db, "formal_letter");
  assert.deepEqual(keys(db), LETTER_KEYS);
  assert.deepEqual(validateCaseRow(row(db)).errors, []);
  assert.deepEqual(JSON.parse(row(db).answer_key).paragraphBreaks, ["greeting", "keyinfo1", "closing", "signoff"]);
});
await test("a mislabelled SQL import (article parts, format missing) is fixed by relabelling only", async () => {
  const db = freshDb(); await call(db, "article");
  db.exec(`UPDATE cases SET format = NULL, formal = 0 WHERE id = '${ID}'`);
  assert.ok(validateCaseRow(row(db)).errors.some((e) => /format/i.test(e)), "validator flags the mismatch first");
  const before = row(db).components;
  const d = await (await call(db, "article")).json();
  assert.deepEqual(d.rebuilt, []);
  assert.equal(row(db).format, "article");
  assert.equal(JSON.parse(row(db).components).map((c) => c.options.map((o) => o.text).join("|")).join("#"), JSON.parse(before).map((c) => c.options.map((o) => o.text).join("|")).join("#"));
  assert.deepEqual(validateCaseRow(row(db)).errors, []);
});
await test("no-op, bad format, missing case, damaged data and auth", async () => {
  const db = freshDb();
  assert.equal((await (await call(db, "informal_letter")).json()).unchanged, true);
  assert.equal((await call(db, "poem")).status, 400);
  assert.equal((await adminSetCaseFormat({ DB: d1(db) }, new Request("http://x", { method: "PUT", body: JSON.stringify({ format: "article" }) }), "nope", { username: "t" })).status, 404);
  db.exec(`UPDATE cases SET components = 'not json' WHERE id = '${ID}'`);
  assert.equal((await call(db, "article")).status, 422);
  const noAuth = await worker.fetch(new Request(`http://x/api/admin/cases/${ID}/format`, { method: "PUT", body: "{}" }), { DB: d1(db) }, {});
  assert.equal(noAuth.status, 401);
});
console.log(`\n${passed} v2.3 test(s) passed.`);
