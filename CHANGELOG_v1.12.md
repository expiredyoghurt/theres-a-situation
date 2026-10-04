# v1.12 — what changed

## Pupil screens
- **Step 2 (Evidence):** teachers can now show *required content points* as text, a picture, or both, in a highlighted box above the clue tiles. The stimulus picture is now optional, and tiles are shuffled each time.
- **Step 3 (Hunch):** a **💡 Hint** button reveals the teacher's pre-set hint. It only appears if the teacher wrote a hint.
- **Step 4:** a last name is no longer required for any entry (formal or informal). Part 13 (Name) accepts any non-blank name.
- **Step 4 Confirm:** once all 13 parts are done, a **Confirm my letter** button appears. After confirming, the Live Preview becomes an editable box. The edited text is what gets marked. "Change my choices" returns to the options (with a warning if hand edits would be lost).
- **Verdict / My Scores:** if the AI marker failed on a part, the pupil is told a teacher will check it, sees "estimated score" on that line, and later sees the teacher's comment on My Scores.

## Teacher / admin screens
- **Manual case builder and case editor** now share one set of per-step editors (the old "Edit 13 parts" panel is now **Edit case (Steps 1–4)**, with each step saved separately):
  - **Step 1 Briefing:** every chunk of the task can be set to Purpose / Audience / Context / **Optional** (never affects the score) / **Not needed**. Add, remove and reorder chunks.
  - **Step 2 Evidence:** required content points (text and/or picture) plus **up to 12 option tiles**, each marked Correct or Distractor.
  - **Step 3 Hint:** optional hint text (empty = no Hint button).
  - **Step 4:** the 13 parts, as before.
- **AI build failures are flagged.** If the AI builder cannot produce a part (any of the 13 Step 4 parts, the Step 1 tags, or the Step 2 distractors) the teacher sees a red warning listing exactly which parts now hold template text, a **Fix these parts now** button, a red badge on the case, and highlighted parts inside the editor. Publishing is blocked until they're fixed (or the teacher confirms "publish anyway"). Single-part regeneration reports failure the same way.
- **New "Pupil submissions & grading" panel.** Every submission now stores the pupil's letter, own idea and automatic score. If AI marking failed for a criterion, the submission is flagged **Needs grading**. Teachers can open any submission, enter fresh per-criterion scores, and **must** add a comment. The override updates the leaderboard and My Scores; **Revert** restores the automatic score. Teachers only see/grade their assigned classes.

## Marking
- Step 1 now scores every Purpose/Audience/Context chunk the teacher set; Optional chunks are ignored; "Not needed" chunks count only if tagged. Existing cases score exactly as before.
- Duplicate sign-off name fixed (the Name part and the sign-off line no longer both add the name to the marked letter).

## Upgrading
Just deploy. The Worker adds the four new `cases` columns and the `submissions` table automatically on the first request (`schema.sql` also has them for fresh installs). Existing cases, scores and accounts are untouched. Submissions made before v1.12 can't be reviewed in the grading panel (they have no stored letter).

## Tests
`node tests/marking.test.mjs` — 39 passing (21 new).
