-- Boss! There's a situation! — database schema
-- Apply with: wrangler d1 execute boss-situation-db --remote --file=./schema.sql
--
-- NOTE ON UPGRADING AN EXISTING DEPLOYMENT:
-- If you already have this database from before accounts/rubric/classes
-- existed, running this whole file again is safe (all CREATE TABLE use
-- IF NOT EXISTS) EXCEPT for the two ALTER TABLE lines below, which only
-- need to run once. If they error with "duplicate column name", that just
-- means you already applied them — ignore the error.

CREATE TABLE IF NOT EXISTS cases (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  image_data    TEXT,              -- base64 data URL of the stimulus graphic
  task_text     TEXT NOT NULL,     -- the situational writing task/rubric text
  task_chunks   TEXT NOT NULL,     -- JSON array [{id,text,type}] type = purpose|audience|context|other
  formal        INTEGER NOT NULL DEFAULT 1, -- 1 = formal register, 0 = informal
  stimulus_points TEXT NOT NULL,   -- JSON array [{id,text,relevant}]
  own_content_prompt  TEXT,        -- the "own idea" question shown to pupils
  own_content_keywords TEXT,       -- JSON array of keyword-groups (arrays of synonyms)
  components    TEXT NOT NULL,     -- JSON array of letter-building blocks, see worker/index.js
  answer_key    TEXT NOT NULL,     -- JSON: correct option ids + correct paragraph breaks
  model_letter  TEXT NOT NULL,     -- full reference/model answer, used for AI similarity marking
  status        TEXT NOT NULL DEFAULT 'draft',    -- draft | published — AI-built cases start as draft
  created_by    TEXT,             -- username of the teacher/admin who built it
  approved_by   TEXT,             -- username of whoever published it (may differ from created_by)
  approved_at   TEXT,             -- when it was published
  created_at    TEXT DEFAULT (datetime('now'))
);
-- If upgrading an existing DB, run these three once (existing cases were
-- all auto-published, so backfill them as already-approved rather than
-- hiding them):
-- ALTER TABLE cases ADD COLUMN created_by TEXT;
-- ALTER TABLE cases ADD COLUMN approved_by TEXT;
-- ALTER TABLE cases ADD COLUMN approved_at TEXT;
-- UPDATE cases SET approved_by = 'legacy', approved_at = created_at WHERE status = 'published' AND approved_by IS NULL;

CREATE TABLE IF NOT EXISTS leaderboard (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  player_class TEXT NOT NULL DEFAULT '',   -- parsed from the launch screen, e.g. "5IG"
  case_id     TEXT NOT NULL,
  case_title  TEXT NOT NULL,
  score       INTEGER NOT NULL,
  max_score   INTEGER NOT NULL DEFAULT 100,
  breakdown   TEXT,               -- JSON score breakdown, for the pupil's own review
  device_id   TEXT NOT NULL DEFAULT '', -- random id stored in the pupil's browser — disambiguates same-name pupils
  created_at  TEXT DEFAULT (datetime('now'))
);
-- If upgrading an existing DB, run these three once:
-- ALTER TABLE leaderboard ADD COLUMN player_class TEXT NOT NULL DEFAULT '';
-- ALTER TABLE leaderboard ADD COLUMN max_score INTEGER NOT NULL DEFAULT 100;
-- ALTER TABLE leaderboard ADD COLUMN device_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_class ON leaderboard(player_class);


-- Global student access switch. Set to 0 to hide ALL cases from pupils,
-- including the built-in tutorial/sample cases; admin/teacher access remains.
--
-- tutorial_cases_enabled is a narrower switch: set to 0 to hide only the
-- two built-in tutorial/sample cases from pupils (teacher-uploaded
-- published cases are unaffected). Useful once a class has outgrown the
-- tutorial cases. Defaults to '1' (visible), matching pre-v1.9 behavior.
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('student_access_enabled', '1');
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('tutorial_cases_enabled', '1');

-- Accounts: one row per admin/teacher login. Passwords are stored as a
-- PBKDF2 hash + per-user salt (see hashPassword() in worker/index.js) —
-- never as plaintext.
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'teacher',  -- 'admin' | 'teacher'
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Which classes a teacher account is allowed to manage/view. Admins can
-- see every class, so this table is only consulted for role='teacher'.
CREATE TABLE IF NOT EXISTS teacher_classes (
  teacher_id  INTEGER NOT NULL,
  class_name  TEXT NOT NULL,
  PRIMARY KEY (teacher_id, class_name)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  role        TEXT NOT NULL,
  username    TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

-- Single-row table holding the editable marking rubric: how many points
-- each of the 6 scoring components is worth (their sum is "the total
-- marks it is graded upon"), and the mastery threshold for the
-- AI-rewritten "stronger version" feature.
CREATE TABLE IF NOT EXISTS rubric_config (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),
  mastery_threshold  INTEGER NOT NULL DEFAULT 85,
  weights            TEXT NOT NULL DEFAULT '{"taskIdentification":15,"stimulusKeyInfo":20,"ownContent":15,"letterChoices":30,"paragraphing":10,"overallQuality":10}'
);
INSERT OR IGNORE INTO rubric_config (id, mastery_threshold, weights) VALUES (
  1, 85, '{"taskIdentification":15,"stimulusKeyInfo":20,"ownContent":15,"letterChoices":30,"paragraphing":10,"overallQuality":10}'
);

-- One row per MCQ component choice a pupil makes on submission. Used to
-- surface common misconceptions per class (which WRONG option a
-- component gets picked most) on the admin dashboard — separate from
-- `leaderboard`, which only stores the final aggregate score.
CREATE TABLE IF NOT EXISTS option_picks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id        TEXT NOT NULL,
  case_title     TEXT NOT NULL,
  component_key  TEXT NOT NULL,
  option_id      TEXT NOT NULL,
  player_class   TEXT NOT NULL DEFAULT '',
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_option_picks_case_component ON option_picks(case_id, component_key);
CREATE INDEX IF NOT EXISTS idx_option_picks_class ON option_picks(player_class);


-- Login lockout: tracks failed /api/admin/login attempts per username so
-- the endpoint can't be brute-forced indefinitely. Successful logins
-- reset the counter.
CREATE TABLE IF NOT EXISTS login_attempts (
  username      TEXT PRIMARY KEY,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  locked_until  TEXT
);

-- Lightweight health log for the AI provider fallback chain — one row
-- per provider attempt (success or failure), so an admin can tell
-- whether the primary provider is actually answering or whether every
-- request is silently falling through to a backup.
CREATE TABLE IF NOT EXISTS ai_call_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_call_log_created ON ai_call_log(created_at);
