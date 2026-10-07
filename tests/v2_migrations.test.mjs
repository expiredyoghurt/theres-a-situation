// v2.0 — migrations against a real SQLite engine (node:sqlite), upgrading a pre-v1.15 database.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log("  ok - " + name); } catch (e) { console.log("  FAIL - " + name + "\n" + (e.stack || e)); process.exitCode = 1; } }

function d1(db, log) {
  const mk = (sql, args) => ({
    run: async () => { log.push(sql); const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    first: async () => { log.push(sql); return db.prepare(sql).get(...args) || null; },
    all: async () => { log.push(sql); return { results: db.prepare(sql).all(...args) }; },
  });
  return { prepare: (sql) => ({ bind: (...a) => mk(sql, a), ...mk(sql, []) }) };
}
async function freshSchemaModule() { return import("../worker/schema.js?" + Math.random()); }

console.log("v2.0 migrations");
await test("upgrades an old database once, backfills format, records versions, and is cheap the second time", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cases (id TEXT PRIMARY KEY, title TEXT, formal INTEGER, status TEXT);
           CREATE TABLE leaderboard (id INTEGER PRIMARY KEY, player_name TEXT);
           INSERT INTO cases VALUES ('a','Formal one',1,'published'),('b','Informal one',0,'published');`);
  const log = [];
  let m = await freshSchemaModule();
  await m.ensureSchema({ DB: d1(db, log) });
  const cols = db.prepare("PRAGMA table_info(cases)").all().map((c) => c.name);
  assert.ok(cols.includes("format") && cols.includes("build_flags"));
  assert.ok(db.prepare("PRAGMA table_info(leaderboard)").all().some((c) => c.name === "hide_on_board"));
  assert.deepEqual(db.prepare("SELECT id, format FROM cases ORDER BY id").all().map((r) => [r.id, r.format]), [["a", "formal_letter"], ["b", "informal_letter"]]);
  assert.deepEqual(db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((r) => r.version), m.MIGRATIONS.map((x) => x.version));
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='submissions'").get());
  // A new isolate on a migrated database does one SELECT and no PRAGMA/ALTER/UPDATE.
  m = await freshSchemaModule(); log.length = 0;
  await m.ensureSchema({ DB: d1(db, log) });
  assert.ok(!log.some((s) => /PRAGMA|ALTER|UPDATE/.test(s)), "no schema work on a migrated database: " + log.join(" | "));
});

await test("an SQL-imported row with a NULL format after migration is not silently rewritten", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE cases (id TEXT PRIMARY KEY, title TEXT, formal INTEGER, status TEXT);`);
  const m = await freshSchemaModule();
  await m.ensureSchema({ DB: d1(db, []) });
  db.exec("INSERT INTO cases (id, title, formal, status) VALUES ('x','Imported',0,'draft')");
  const m2 = await freshSchemaModule();
  await m2.ensureSchema({ DB: d1(db, []) });
  assert.equal(db.prepare("SELECT format FROM cases WHERE id='x'").get().format, null);
  const { normaliseFormat } = await import("../worker/marking.js");
  assert.equal(normaliseFormat({ formal: 0, format: null }), "informal_letter");
});
console.log(`\n${passed} v2.0 migration test(s) passed.`);
