# v2.0 — modular worker and versioned migrations
Parts 1-4 of the review plan are complete (v1.16 safety, v1.17 Step 4 stepper, v1.18 teacher tabs and graphics, v2.0 refactor).

## Worker split (no behaviour change)
`worker/index.js` was one 2,639-line file. It is now a 250-line router plus modules:
`config.js` (constants, version) · `common.js` (json helpers, password hashing) · `schema.js` (migrations) · `auth.js` (login, teachers, rubric) · `overview.js` (class overview, misconceptions, case images) · `casesPublic.js` (pupil case list/fetch, access switches) · `scoring.js` (submitCase and marking glue) · `ai.js` (provider chain) · `leaderboard.js` · `adminCases.js` · `adminSubmissions.js` · plus the existing `marking.js`, `validate.js`, `demoCases.js`.
The code was moved mechanically and each module exports every top-level function, so tests still import from `worker/index.js`. Verified: all 4 old suites pass unchanged (one source-text check now reads `config.js`), the browser tests pass against the new layout, and the Worker bundles with esbuild and answers a request.

## Versioned migrations
`schema_migrations` records which steps ran. A migrated database costs one SELECT per cold start (before: 3 PRAGMAs and an UPDATE). To change the schema, append a new entry to `MIGRATIONS` in `schema.js`; never edit an old one.
Behaviour change: the `format` backfill from the legacy `formal` flag now runs once, not on every cold start. A SQL import with a NULL `format` is therefore no longer silently rewritten; the structure validator reports a format/components mismatch instead, and `normaliseFormat` still falls back to `formal`.
Tested on a real SQLite engine: `node tests/v2_migrations.test.mjs` (needs Node 22+).

## Upgrading
Just deploy. The first request creates `schema_migrations` and applies the steps (all idempotent, so existing v1.x databases are fine).
