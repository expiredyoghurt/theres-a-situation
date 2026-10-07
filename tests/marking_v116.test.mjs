// v1.16 tests: case validation, playable-case gating, image route, submit rate limit.
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateCaseRow } from "../worker/validate.js";
import worker from "../worker/index.js";
import { DEMO_CASES } from "../worker/demoCases.js";

let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("  ok -", name); } catch (e) { console.log("  FAIL -", name, "\n", e); process.exitCode = 1; } }

// Build a valid row from a demo case.
function rowFrom(d, over = {}) {
  return {
    id: "sql_case_1", title: d.title, image_data: null, task_text: d.taskText, task_chunks: JSON.stringify(d.taskChunks),
    formal: d.formal ? 1 : 0, format: d.format || (d.formal ? "formal_letter" : "informal_letter"),
    stimulus_points: JSON.stringify(d.stimulusPoints), own_content_prompt: d.ownContentPrompt,
    own_content_keywords: JSON.stringify(d.ownContentKeywords || []), components: JSON.stringify(d.components),
    answer_key: JSON.stringify(d.answerKey), model_letter: d.modelLetter || "x", status: "published", ...over,
  };
}
const art = DEMO_CASES.find((c) => c.id === "demo-3"), let1 = DEMO_CASES.find((c) => c.id === "demo-1");
const PNG = "data:image/png;base64,iVBORw0KGgo=";

console.log("validateCaseRow");
await test("valid letter and article rows pass", () => {
  assert.deepEqual(validateCaseRow(rowFrom(let1)).errors, []);
  assert.deepEqual(validateCaseRow(rowFrom(art)).errors, []);
});
await test("bad JSON, wrong keys, missing answer, bad image are all caught", () => {
  assert.ok(validateCaseRow(rowFrom(let1, { components: "{oops" })).errors.some((e) => /components is not valid JSON/.test(e)));
  assert.ok(validateCaseRow(rowFrom(let1, { format: "article" })).errors.some((e) => /format is 'article'/.test(e)));
  const ak = JSON.parse(rowFrom(let1).answer_key); ak.components.keyinfo1 = "z";
  assert.ok(validateCaseRow(rowFrom(let1, { answer_key: JSON.stringify(ak) })).errors.some((e) => /keyinfo1/.test(e)));
  assert.ok(validateCaseRow(rowFrom(let1, { image_data: "javascript:alert(1)" })).errors.some((e) => /image_data/.test(e)));
  assert.ok(validateCaseRow(rowFrom(let1, { image_data: 'data:image/png;base64,AAA" onerror="x' })).errors.length > 0);
  assert.ok(validateCaseRow(rowFrom(let1, { id: "bad id!" })).errors.length > 0);
  const comps = JSON.parse(rowFrom(let1).components); comps[0].options.pop();
  assert.ok(validateCaseRow(rowFrom(let1, { components: JSON.stringify(comps) })).errors.some((e) => /3 options/.test(e)));
});
await test("a valid image passes; no image only warns", () => {
  assert.equal(validateCaseRow(rowFrom(let1, { image_data: PNG })).ok, true);
  assert.ok(validateCaseRow(rowFrom(let1)).warnings.some((w) => /picture/.test(w)));
});

// Fake D1 holding a few rows.
function env(rows, { burst = 0 } = {}) {
  const db = (sql) => {
    const mk = (args) => ({
      run: async () => ({ meta: {} }),
      first: async () => {
        if (/COUNT\(\*\) AS n FROM submissions/.test(sql)) return { n: burst };
        if (/FROM cases WHERE id/.test(sql)) return rows.find((r) => r.id === args[0]) || null;
        return null;
      },
      all: async () => ({ results: /FROM cases/.test(sql) ? rows.filter((r) => !/status = 'published'/.test(sql) || r.status === "published") : [] }),
    });
    return { bind: (...a) => mk(a), ...mk([]) };
  };
  return { DB: { prepare: db, batch: async () => [] } };
}
const get = async (e, path, init) => worker.fetch(new Request("http://x" + path, init), e, {});

console.log("pupil routes");
await test("draft and invalid cases are not playable; published valid case is", async () => {
  const e = env([rowFrom(let1, { id: "draft1", status: "draft" }), rowFrom(let1, { id: "bad1", components: "{" }), rowFrom(let1, { id: "ok1" })]);
  assert.equal((await get(e, "/api/cases/draft1")).status, 404);
  assert.equal((await get(e, "/api/cases/bad1")).status, 404);
  assert.equal((await get(e, "/api/cases/ok1")).status, 200);
  const list = await (await get(e, "/api/cases")).json();
  const ids = list.cases.map((c) => c.id);
  assert.ok(ids.includes("ok1") && !ids.includes("draft1") && !ids.includes("bad1"));
});
await test("case menu carries an image URL, never base64 for DB cases", async () => {
  const e = env([rowFrom(let1, { id: "ok2", image_data: PNG })]);
  const list = await (await get(e, "/api/cases")).json();
  const c = list.cases.find((x) => x.id === "ok2");
  assert.equal(c.imageUrl, "/api/cases/ok2/image");
  assert.equal(c.imageData, undefined);
  const img = await get(e, "/api/cases/ok2/image");
  assert.equal(img.status, 200);
  assert.equal(img.headers.get("content-type"), "image/png");
  assert.match(img.headers.get("cache-control"), /max-age/);
  assert.equal((await get(env([rowFrom(let1, { id: "d", status: "draft", image_data: PNG })]), "/api/cases/d/image")).status, 404);
});
await test("submit is rate limited per device", async () => {
  const body = JSON.stringify({ name: "Mei", deviceId: "dev1", level: 2 });
  const r = await get(env([rowFrom(let1, { id: "ok3" })], { burst: 5 }), "/api/cases/ok3/submit", { method: "POST", body });
  assert.equal(r.status, 429);
});

console.log("source checks");
await test("version strings and prompt copies agree", () => {
  const w = fs.readFileSync(new URL("../worker/config.js", import.meta.url), "utf8");
  assert.match(w, /APP_VERSION = "v1\.1[6-9]|APP_VERSION = "v2/);
  assert.equal(fs.readFileSync(new URL("../AI_CASE_TO_D1_SQL_PROMPT.md", import.meta.url), "utf8"), fs.readFileSync(new URL("../public/AI_CASE_TO_D1_SQL_PROMPT.md", import.meta.url), "utf8"));
});
console.log(`\n${passed} v1.16 test(s) passed.`);
