# v1.15 — the Article format, and the exam-style scheme

**Headline:** a case is now a **formal letter, an informal letter, or an article**. Articles (for a wider audience such as schoolmates or neighbours) get their own 13 Step 4 parts, their own format checks and their own examiner prompt, so a good article is no longer marked as a letter with a missing salutation. The exam-style estimate (Task Fulfilment /6 + Language & Organisation /8) now follows the scheme supplied by the teacher, for letters and articles alike.

## Writing formats
- New `cases.format` column: `formal_letter | informal_letter | article`. The old `formal` column stays as a derived flag. The Worker adds the column and **backfills every existing case from `formal` on the first request**; existing cases, scores, heatmaps and the leaderboard are untouched.
- Admin: the "Register" toggle is now a three-way **Writing format** choice (AI build, manual builder and JSON import all honour it). The case list shows the format.
- Pupils: case cards carry a Formal / Informal / **Article** tag; the Step 4 reminder, proofread checklist, buttons and Verdict wording say "article" where it applies.

## Article: the 13 parts
`headline`, `byline`, `hook`, `purpose`, `context`, `keyinfo1`-`keyinfo5`, `ownIdea`, `cta` (call to action), `thanks` (thanks to readers). Still 13, so the "13 parts" editors, validators and array sizes work unchanged. Default paragraph breaks: `hook, keyinfo1, cta` (opening / body / closing). The headline and byline sit on their own lines; **all three layouts are accepted** (byline under the headline, byline at the end, or a "Dear Schoolmates," greeting with a closing signature). A salutation or sign-off in an article is tolerated, never required.
- AI case builder: per-part prompts, realistic wrong options (a dull headline ending in a full stop, a first-name-only byline, a vague or bossy call to action, text-speak thanks) and template fallbacks for every article part.
- Level 2 sentence starters for the article parts; Level 3 placeholder says "headline and byline".
- New tutorial **Case #3, Garden Club Open House (Article)**. `CASE_IMPORT_EXAMPLE_ARTICLE.json` shows the JSON-import shape.

## Article marking (worker/marking.js)
- `parseArticle` / article checks: headline present, byline present and a full name, engaging opening (a **tip only**, never penalised), call to action in the closing paragraph, thanks to readers, points woven into paragraphs rather than listed, text-speak flagged as a register slip.
- **Letter-only checks are switched off for articles.** Without this, every article would have lost marks in the deterministic paths (no salutation/sign-off) and shown "no salutation" flags. The AI-down fallbacks for audience and organisation use the article's own features.
- The AI examiner gets an article prompt and also answers `headline`, `flow`, `cta` and `byline` (full name). A "no" on `cta`, `flow` or `byline` raises the matching flag.
- New flags: `no-title`, `no-byline`, `byline-first-name`, `no-cta`, `no-thanks`, `list-like`. New "Fix this one thing" cards: call to action, headline, byline.
- **Full-name byline** (per the teacher): enforced by marking, not by blocking. A blank byline is rejected at Level 1; a first-name-only option is accepted, flagged as a kept wrong option and loses Detective points. See "Known limits".

## Exam-style estimate: the teacher's scheme
Content points = every required fact (must be *accurate*; partly right counts as missing) + the pupil's own idea (must be sensible AND appear in the writing). PAC = purpose, audience, context.
| Task Fulfilment /6 | |
|---|---|
| 6 | all content points + all of PAC accurate |
| 5 | all content, one PAC error; OR one content point missing, no PAC error |
| 3-4 | otherwise (each missing point or PAC error costs a mark below 6; floor 3) |
| 1-2 | fewer than 3 content points, or no accurate PAC |

**Language & Organisation /8** = Language 0-5 + Organisation 0-3; 8 for perfect language and excellent organisation; **capped at 6 if there is no paragraphing** (one block). The deterministic language caps from v1.14 still apply on top. The estimate is still labelled an estimate and teachers can override it.
**Behaviour change for letters:** v1.14 used an internal 4 + 2 split. Letter estimates will now move in whole steps according to the table, so some will differ from the same letter marked under v1.14. The 100-point Detective meter and rubric weights are unchanged (articles use the same weights, as agreed).

## Fixes along the way
- Step 4 live preview (client) now builds the text exactly as the Worker does (salutation / sign-off / name, or headline / byline, on their own lines). Before, the preview joined them with spaces, so a confirmed, unedited letter could be treated as "edited".
- `findUnknownNumbers` and the mechanical-error check read the parsed body, so a number in an article headline is not flagged as an invented detail.

## Upgrading
Deploy. Nothing to run by hand: the `cases.format` column is added and backfilled automatically (manual SQL is in `schema.sql`). New article cases start as drafts and need Publish, like all AI-built cases.

## Known limits (please read)
- **A full-name byline cannot be proven by a program.** "Wei Ming" is a given name and "Wei Ming Tan" is a full name; the code can only tell a one-word byline from a longer one. Levels 2-3 rely on the AI examiner's `byline` answer; Level 1 relies on the wrong option being kept. Teachers should glance at bylines in the grading panel.
- Call-to-action and thanks detection are keyword rules checked in the closing paragraph; an unusual but valid call to action may be missed (the AI examiner can still raise it). Pleasantries such as "I hope to see you there" are deliberately **not** counted as a call to action.
- A headline is "one short line without a full stop"; a one-line opening question on its own line can be mistaken for a headline.
- The exam-style number is only as good as the "content point accurate" and PAC judgements, which come from the (free-tier) AI examiner or, if it is down, from rules; submissions in that state are flagged for teacher review as before.
- I could not run Wrangler/D1 or a browser in this environment. Everything was tested against a fake D1 and fake AI (below) and the inline scripts were syntax-checked, so **please play the three tutorial cases once in a browser after deploying**.

## Tests
`node tests/marking.test.mjs` (39) + `node tests/marking_v114.test.mjs` (29) + `node tests/marking_v115.test.mjs` (36 new: the full /6 and /8 table, article parsing in all three layouts, flags, fallbacks, prompts, fix-it, assembly, end-to-end article submissions, list/payload and migration) = 104 passing.

## v1.15.1 — Manual backend upload
- Teacher page now has two tabs: **Cases & settings** and **Manual backend upload**.
- The new tab holds D1 instructions, a copy button for the external-AI SQL prompt (format dropdown; the prompt is served from `public/AI_CASE_TO_D1_SQL_PROMPT.md`, kept identical to the root copy by a test), and a per-case picture upload plus Publish button for SQL-imported cases.
- "Written by" is recognised as a sign-off line.
- `CASE_IMPORT_EXAMPLE.sql` now sets `format`; SQL imports are `draft` so nothing reaches pupils before the picture and review.
- Not browser-tested.
