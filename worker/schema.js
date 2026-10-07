// v2.0 — extracted from the v1.x single-file worker without behaviour changes.


// ---------- self-migrating schema (v1.12) ----------
// v1.12 adds four columns to `cases` and a `submissions` table. Rather than
// make every existing deployment remember to run ALTER TABLE by hand, the
// Worker checks once per isolate and applies whatever is missing. schema.sql
// carries the same definitions for fresh installs. Failures are swallowed
// (and retried on the next request) so a hiccup here never takes the game down.
export const SUBMISSIONS_DDL = `CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leaderboard_id INTEGER,
  case_id TEXT NOT NULL,
  case_title TEXT NOT NULL,
  player_name TEXT NOT NULL,
  player_class TEXT NOT NULL DEFAULT '',
  device_id TEXT NOT NULL DEFAULT '',
  own_content TEXT,
  letter TEXT,
  letter_edited INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL,
  ai_score INTEGER NOT NULL,
  ai_breakdown TEXT NOT NULL,
  ai_failures TEXT,
  needs_review INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  moe_json TEXT,
  error_flags TEXT,
  final_moe_json TEXT,
  final_score INTEGER,
  final_breakdown TEXT,
  override_comment TEXT,
  overridden_by TEXT,
  overridden_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
)`;
export let schemaReady = null;

/** v2.0 — versioned migrations. `schema_migrations` records what has run, so a warm
 * database costs one SELECT per cold start instead of PRAGMAs and an UPDATE.
 * Every step is idempotent (safe on databases that pre-date this table).
 * To change the schema: append a new entry with the next version number. Never edit an old one. */
export const MIGRATIONS = [
  { version: 1, name: "submissions table", run: async (db) => { await db.prepare(SUBMISSIONS_DDL).run(); } },
  { version: 2, name: "add v1.12-v1.15 columns", run: async (db) => {
      const ADD = {
        cases: [["required_text", "TEXT"], ["required_image", "TEXT"], ["hunch_hint", "TEXT"], ["build_flags", "TEXT"], ["format", "TEXT"]],
        submissions: [["level", "INTEGER NOT NULL DEFAULT 1"], ["moe_json", "TEXT"], ["error_flags", "TEXT"], ["final_moe_json", "TEXT"]],
        leaderboard: [["hide_on_board", "INTEGER NOT NULL DEFAULT 0"]],
      };
      for (const [table, cols] of Object.entries(ADD)) {
        const info = await db.prepare(`PRAGMA table_info(${table})`).all();
        const have = new Set((info.results || []).map((r) => r.name));
        if (!have.size) continue; // table not created yet (older install that has not run schema.sql)
        for (const [col, type] of cols) {
          if (!have.has(col)) {
            try { await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run(); }
            catch (e) { /* another isolate added it first */ }
          }
        }
      }
    } },
  { version: 3, name: "backfill cases.format from legacy formal flag (one time)", run: async (db) => {
      try { await db.prepare("UPDATE cases SET format = CASE WHEN formal = 1 THEN 'formal_letter' ELSE 'informal_letter' END WHERE format IS NULL OR format = ''").run(); }
      catch (e) { /* cases table not created yet */ }
    } },
  { version: 4, name: "indexes", run: async (db) => {
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_review ON submissions(needs_review, created_at)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_class ON submissions(player_class)").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS idx_submissions_lb ON submissions(leaderboard_id)").run();
    } },
];

export function ensureSchema(env) {
  if (!env.DB) return Promise.resolve();
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = env.DB;
      await db.prepare("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)").run();
      const { results } = await db.prepare("SELECT version FROM schema_migrations").all();
      const done = new Set((results || []).map((r) => Number(r.version)));
      for (const m of MIGRATIONS) {
        if (done.has(m.version)) continue;
        await m.run(db);
        await db.prepare("INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").bind(m.version, m.name, new Date().toISOString()).run();
      }
    })().catch(() => { schemaReady = null; });
  }
  return schemaReady;
}
