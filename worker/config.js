// v2.0 — extracted from the v1.x single-file worker without behaviour changes.


export const APP_VERSION = "v2.1";
export const SUBMIT_BURST_LIMIT = 5;
export const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const AI_TIMEOUT_MS = 9000; // per-provider timeout before falling through the chain
export const REVIEW_COOLDOWN_HOURS = 20; // spaced-review: don't re-suggest a below-threshold case sooner than this

// Fallback rubric, used only if rubric_config hasn't been created yet
// (e.g. schema.sql not re-run against an older database).
export const DEFAULT_WEIGHTS = {
  taskIdentification: 15,
  stimulusKeyInfo: 20,
  ownContent: 15,
  letterChoices: 30,
  paragraphing: 10,
  overallQuality: 10,
};
export const DEFAULT_MASTERY_THRESHOLD = 85;

// v1.12 limits / vocab
export const TASK_CHUNK_TYPES = ["purpose", "audience", "context", "optional", "other"]; // "other" = Not needed
export const MAX_TASK_CHUNKS = 20;
export const MAX_STIMULUS_TILES = 12;
export const MAX_HINT_LEN = 500;
export const MAX_REQUIRED_TEXT_LEN = 2000;
export const MAX_FINAL_LETTER_LEN = 4000;
export const MAX_OVERRIDE_COMMENT_LEN = 1000;
export const BREAKDOWN_KEYS = ["taskIdentification", "stimulusKeyInfo", "ownContent", "letterChoices", "paragraphing", "overallQuality"];

