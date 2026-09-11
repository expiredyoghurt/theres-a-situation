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
  status        TEXT NOT NULL DEFAULT 'published', -- published | draft
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leaderboard (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  player_class TEXT NOT NULL DEFAULT '',   -- parsed from the launch screen, e.g. "5IG"
  case_id     TEXT NOT NULL,
  case_title  TEXT NOT NULL,
  score       INTEGER NOT NULL,
  max_score   INTEGER NOT NULL DEFAULT 100,
  breakdown   TEXT,               -- JSON score breakdown, for the pupil's own review
  created_at  TEXT DEFAULT (datetime('now'))
);
-- If upgrading an existing DB, run these two once:
-- ALTER TABLE leaderboard ADD COLUMN player_class TEXT NOT NULL DEFAULT '';
-- ALTER TABLE leaderboard ADD COLUMN max_score INTEGER NOT NULL DEFAULT 100;

CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard(score DESC);
CREATE INDEX IF NOT EXISTS idx_leaderboard_class ON leaderboard(player_class);

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
