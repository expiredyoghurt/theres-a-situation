# v1.14 — what changed

**Headline:** marking now reads the *letter the pupil actually wrote*. Before v1.14 about 90% of the marks came from clicking the right multiple-choice options or tags, and the "own idea" was scored from keyword lists. This release re-aims the marking at what PSLE situational writing rewards, and adds a writing ladder so pupils move from picking sentences to writing their own.

## Marking (worker/marking.js, new)
- **Scored from the final letter text.** Required details (accurate, including dates/times/numbers), register and format, paragraphing and language are read from the submitted text. Editing the confirmed letter now changes the score (before, 40 of 100 marks ignored your edits). Deleting a required fact from the letter loses marks; fixing a mistake earns them back. A wrong option the pupil picked and then *kept* in the letter is penalised.
- **Exam-style estimate shown next to the game score:** Task Fulfilment /6 + Language & Organisation /8 = /14. The 6/8 split follows the published PSLE 2025 format as reported by tuition centres. **SEAB does not publish a per-descriptor mark scheme**, so the internal split (content 4 + purpose/audience/context 2; language 5 + organisation 3) is this app's approximation. It is always labelled an *estimate* and teachers can override it. Please check it against the official SEAB/MOE documents before relying on it.
- **The 100-point "Detective points" meter stays** (leaderboard, ranks, mastery threshold, rubric weights). Criterion labels: Briefing, Evidence, Own idea, Letter content & accuracy, Paragraphing, Language & organisation. Old submissions and rubric weights are untouched.
- **Own idea is always judged by the AI examiner** against three true/false questions (relevant, logical, linked to a clue in the notice). Before, the AI was skipped exactly when keywords missed, so a valid unlisted idea and gibberish both scored 2/15 while `donate poster pack` scored 14/15. With the AI down, gibberish scores 0, keyword-stuffing is capped at 70%, valid unlisted ideas get partial credit, and the submission is flagged for teacher review.
- **Two small AI examiner calls** (own idea; letter language/organisation/purpose/audience/context), temperature 0, retried once if the reply is malformed. The examiner is told *not* to compare with the model answer. If the AI is unavailable, deterministic estimates are used and the submission is flagged "Needs grading" (v1.12 mechanism).
- **Prompt-injection hardening.** Pupil text is fenced and sanitised in every AI prompt (own idea, letter, "stronger version"). Letters that look like instructions to the marker ("ignore the above… 15/15") are flagged for a teacher.
- **Paragraphing** is read from the text; never ticking a paragraph box no longer earns free marks.
- **Opaque option ids.** The correct option is no longer always id "a" in the browser payload.

## Writing ladder (Step 4)
Level 1 Guided (pick sentences, as before) → Level 2 Starters (sentence-starter chips, pupil writes every part) → Level 3 Independent (blank page, word counter). Pupils unlock the next level by mastering a case at the level below (pacing, not security). Teachers can unlock all levels from the admin dashboard.

## Feedback
Verdict screen now shows the exam-style estimate, a checklist of every required detail (found / partly / missing, with the matching sentence highlighted in the pupil's letter), own-idea status, format checks (salutation↔sign-off pairing, register), language slips, wrong-fact warnings, stars per skill, and a **"Fix this one thing"** card with an instant, deterministic check. The model answer is demoted to a collapsed "one good example". "Try this case again" shows what you missed last time.

## Game feel
Detective ranks, case status chips (New / Best % / Mastered), personal bests and change since last attempt, a "your next focus" card from recurring mistakes, a class-first Wall of Fame with a "hide my name" option, a progress bar and auto-scroll in the guided builder, a non-blocking proofread checklist.

## Teacher tools
Heatmap toggle (Detective % / Task Fulfilment / Language & Organisation), exam-style estimate in the grading panel with optional teacher override, a "Common letter mistakes" panel (from final letters, not MCQ picks), an "Unlock all writing levels" switch, and an updated copy-ready external-AI marking prompt (`TEACHER_MARKING_PROMPT_TEMPLATE.md`) that matches the new scheme.

## Content
Both tutorial cases are rewritten as full 13-part cases with realistic wrong options (a changed date, a mismatched sign-off, an idea that cannot work) instead of obviously silly ones. The AI case builder and fallback templates, and `AI_CASE_TO_JSON_PROMPT.md` / `AI_CASE_TO_D1_SQL_PROMPT.md`, now ask for the same kind of realistic distractors. Default paragraph breaks for new cases changed to `greeting, keyinfo1, closing, signoff`.

## Upgrading
Just deploy. The Worker adds the new columns (`submissions.level/moe_json/error_flags/final_moe_json`, `leaderboard.hide_on_board`) on the first request; `schema.sql` carries them for fresh installs. Tested by upgrading a copy of a v1.13 database.
Recommended: pin one free model so marking is consistent — `wrangler secret put OPENROUTER_MODEL` with a `:free` model id from OpenRouter's current free list (the default `openrouter/free` picks a different free model per request). Check the id on OpenRouter before setting it.
Note: pupil-facing marking now makes two AI calls per submission instead of up to two conditional ones; watch the "AI Provider Health" panel on free tiers.

## Known limits
- The exam-style number is an estimate (see above); language marking by free-tier models is noisier than multiple-choice scoring, so confirm samples in the grading panel.
- Level locks are client-side pacing, not enforcement.
- The deterministic checks cannot see spelling mistakes; only the AI examiner can.

## Tests
`node tests/marking.test.mjs` — 39 existing + 29 new (marking engine; full `submitCase` against a fake database and fake AI) = 68 passing. The Worker was also run locally with a real SQLite D1 and the pupil/teacher API flow checked end to end (19 checks), and the upgrade from a v1.13 database was verified.
