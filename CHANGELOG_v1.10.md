# v1.10 change log

- New **"📥 Import case JSON"** file input on the admin "Add a new case"
  form. A teacher can now author a case entirely outside the app (e.g.
  with an external AI) and bring it in without ever opening the
  Cloudflare D1 Console:
  1. Copy `AI_CASE_TO_JSON_PROMPT.md` into an external AI, fill in the
     CASE BRIEF, and save the returned JSON to a file.
  2. On the case-creation form, choose that file under "Import case
     JSON" — this fills in the title/task/key info/model letter fields
     and opens the same 13-part manual editor used by "Create full case
     manually", pre-filled from the import instead of placeholder text.
  3. Attach the stimulus picture with the existing image upload field,
     review/edit any of the 13 parts, then save — the case is created as
     a **draft**, same as every other creation path, so nothing reaches
     pupils until a teacher publishes it.
  - Client-side validation checks the file has exactly 13 components
    (each with exactly 3 options and a valid `correctIndex`) and exactly
    5 `keyInfo` facts before opening the editor, with a clear error
    message if the shape is wrong.
- New **`AI_CASE_TO_JSON_PROMPT.md`** — a companion to the existing
  `AI_CASE_TO_D1_SQL_PROMPT.md`, with the same content/pedagogy rules
  (13 fixed parts, 5 key-info facts, register rules, distractor quality,
  etc.) but asking the AI for a plain JSON object matching the import
  shape above, instead of a raw SQL insert statement.
- `POST /api/admin/cases/manual` (used by both the manual-entry and new
  JSON-import paths) now optionally accepts `taskChunks` and
  `distractorStimulusPoints` in the request body, giving the JSON-import
  path the same fidelity as the SQL-import path (real task-chunk
  highlighting and 2 "unnecessary but plausible" evidence-board
  distractors, rather than always falling back to a naive task-text
  split with no stimulus distractors). Both fields are optional and
  backward-compatible — the existing "Create full case manually" flow
  never sends them and is unaffected.
- Tightened server-side validation on `/api/admin/cases/manual`: rejects
  a `keyInfo` that isn't exactly 5 non-empty strings, and rejects any of
  the 13 `components` that doesn't have exactly 3 non-empty options and
  a `correctId` of `a`/`b`/`c`. This matters more now that a file — not
  just the in-app editor — can be the source of this payload.
- Minor internal refactor: the 13-part editor's row markup and its save
  handler are now shared (`openManualEditor`) between "Create full case
  manually" and "Import case JSON" instead of being duplicated inline —
  no behavior change for the existing manual flow (verified with a
  scoring-logic smoke test).
- Version bumped to **v1.10**.
