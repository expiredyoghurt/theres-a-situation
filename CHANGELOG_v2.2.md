# v2.2 — Step 2 "What to look for" checklist
- **New per-case field `look_for`**: up to 8 short labels (80 characters each) naming the KIND of information pupils must find in the stimulus, such as "The date", "The place", "Who to sign up with and by when". Labels never contain the answer.
- **Pupil Step 2:** a "🔎 What to look for" card above the evidence board with a tickable list and an "x of N found" counter. Ticks survive re-renders when pupils pin tiles. Cases without a checklist look exactly as before. It sits beside the existing free-text "Required content points" box, which is unchanged.
- **Teacher editor** (Step 2 of the case editor and of the manual case builder): one label per line plus a **✨ Suggest from the correct tiles** button. Blank means no checklist. JSON import accepts `lookFor`.
- **Auto-suggest on build:** cases built with AI or created without a list get labels suggested from their key-information points (deterministic rules, no extra AI call: date, time, place, deadline, contact, what to bring or wear, cost, otherwise a generic label). Existing cases are not changed.
- **Tutorial cases** have checklists.
- **Database:** migration 5 adds `cases.look_for` (applies automatically; `schema.sql` updated). **SQL import:** `look_for` is the new LAST column in the prompt and example; the validator accepts a missing one.
- Tests: `node tests/v22_lookfor.test.mjs` (9, includes running the SQL example on a real SQLite built from `schema.sql`) and `tests/ui/lookfor.ui.mjs` (browser).
