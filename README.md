# Boss! There's a situation! (v1.8)

A detective-themed game that gamifies the PSLE English **Situational Writing**
task (Purpose / Audience / Context, key information, and formal vs. informal
letter/email writing), based on the step-by-step process described in
[Lil' but Mighty's situational writing guide](https://lilbutmightyenglish.com/blog/situational-writing-step-by-step-plus-free-revision-card/).

Pupils play through 5 stages per case:

1. **The Briefing** — click phrases in the task text and tag each as
   Purpose / Audience / Context / Not needed.
2. **The Evidence Board** — click the relevant points in the graphic
   stimulus (poster/notice); some details are irrelevant distractors.
3. **Your Hunch** — supply the "own content" idea that isn't given anywhere
   in the stimulus (a required PSLE skill).
4. **Draft Your Report** — build the letter by choosing 1-of-4 multiple
   choice options for each part (salutation, greeting, purpose, key
   information sentences, additional context, sign-off), and mark where new
   paragraphs should start. A live preview assembles the letter as you go.
5. **Verdict** — a score out of the rubric's total marks (editable by
   teachers/admins — see "Marking rubric" below) with a breakdown, an
   AI-assisted qualitative note, and a side-by-side comparison with the
   model answer. **Score below the mastery threshold, and the AI marker
   writes a stronger version of the pupil's own letter** (keeping their
   own idea and voice) plus a couple of specific tips, so they can see
   exactly what "good" looks like starting from what they already wrote.

Every completed case is added to a **single, unified leaderboard** (across
all cases) stored in Cloudflare D1.

A teacher/admin page (`/admin.html`) lets teachers upload new practice
cases — a stimulus picture, the question prompt, key information points,
a formal/informal toggle, and a model answer — and uses AI to
auto-generate the MCQ options, distractors, clue tagging, and scoring key.
All AI marking runs through a **provider fallback chain**: every AI call
in the app tries **OpenRouter → Groq → Gemini → Cloudflare Workers AI**,
in that order, and falls through to deterministic scoring (keyword
matching / text-similarity) if every provider is unavailable — so the
game never breaks, it just loses the more nuanced AI feedback.

Accounts are stored in D1 with hashed passwords — there's no hard-coded
login. **Admins** manage teacher accounts, the marking rubric, and cases;
**teachers** manage cases and the rubric too, but only see the Class
Performance Overview for classes assigned to them by an admin. See
"Accounts & first login" below to create the first admin account.

**v1.5 highlights:** AI-built cases now require an explicit teacher/admin
Publish step before pupils can see them; every AI provider is now
pinned to its free tier (including code-enforced free-only model
selection on OpenRouter — see "AI provider chain"); added per-part case
regeneration, an AI provider health panel, login lockout, same-name
pupil disambiguation, in-progress draft autosave, and an automated test
suite for the scoring logic.

## Project structure

```
boss-theres-a-situation/
  wrangler.toml        - Cloudflare Worker config (D1 + Workers AI + static assets)
  schema.sql            - D1 database schema
  worker/
    index.js            - API routes, scoring logic, admin auth, AI calls
    demoCases.js         - Two built-in tutorial cases (always playable)
  public/
    index.html           - The game (pupil-facing)
    admin.html            - Teacher/admin tool
```

## Deploying to Cloudflare

You'll need a free Cloudflare account and Node.js installed locally.

```bash
npm install -g wrangler
wrangler login

cd boss-theres-a-situation

# 1. Create the D1 database
wrangler d1 create boss-situation-db
# Copy the returned database_id into wrangler.toml (database_id = "...")

# 2. Apply the schema
wrangler d1 execute boss-situation-db --remote --file=./schema.sql

# 3. Set the seed admin credentials (used ONLY to create the first admin
#    account — see "Accounts & first login" below):
wrangler secret put SEED_ADMIN_USERNAME
wrangler secret put SEED_ADMIN_PASSWORD

# 4. Set your AI provider secret(s) — see "AI provider chain" below.
#    At minimum, set OpenRouter (this is your primary marker):
wrangler secret put OPENROUTER_API_KEY
#   paste your OpenRouter key when prompted, then press Enter

# 5. Deploy
wrangler deploy
```

Wrangler will print your live URL, e.g. `https://boss-theres-a-situation.<you>.workers.dev`.
That's it — the game, the API, and the admin tool are all served from that
one Worker.

## Accounts & first login

There's no hard-coded admin login. Instead, the **first time** anyone logs
in at `/admin.html` using the `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD`
secrets you set above, the Worker creates a real admin account in D1 (with
a salted, hashed password) and logs you in as that account. After that,
the seed secrets are never consulted again (the `users` table is no longer
empty), so you can rotate or remove them once you've logged in.

From the admin dashboard you can:

- **Add teacher accounts** (username + password + assigned classes, e.g.
  `5IG, 5HN`). Teachers log in at the same `/admin.html` page.
- **Change a teacher's password or assigned classes** at any time, or
  remove the account entirely.
- Every account (admin or teacher) can update its own password via
  `POST /api/admin/change-password` if you want to wire up a "change my
  password" control later — it isn't in the UI yet, but the endpoint is
  there.

**Permissions:** admins and teachers can both manage cases and edit the
marking rubric. The difference is scope on the **Class Performance
Overview**: admins see every class that has played, while teachers only
see the classes an admin has assigned to them.

**Login lockout:** `/api/admin/login` tracks failed attempts per
username in a `login_attempts` table and applies exponential backoff
after 5 consecutive failures (1 min, 2 min, 4 min, ... capped at 30
minutes) — enough to make brute-forcing the login page impractical
without needing an external rate-limiting service. A successful login
resets the counter. This fails open (no lockout enforced) if
`login_attempts` isn't migrated yet, rather than blocking all logins.

## AI provider chain

Every AI-assisted feature (own-content judging, holistic letter marking,
the "stronger version" rewrite, and the admin case-builder) goes through
one function that tries providers **in this order** and uses whichever
answers first. **Every provider is configured to run entirely on its
free tier — this deployment should never incur an AI inference charge:**

1. **OpenRouter** — `env.OPENROUTER_API_KEY` (set via `wrangler secret put OPENROUTER_API_KEY`).
   This is the primary marker. Defaults to
   [`openrouter/free`](https://openrouter.ai/openrouter/free), OpenRouter's
   own Free Models Router — it randomly selects a free model per request
   (filtered to whatever the request needs) and can never incur a charge.
   **The code enforces this**: even if you override `OPENROUTER_MODEL`
   via `wrangler secret put OPENROUTER_MODEL`, it's only honored if it's
   either `openrouter/free` or ends in the `:free` variant suffix (e.g.
   `meta-llama/llama-3.2-3b-instruct:free`) — any other model id is
   silently replaced with `openrouter/free` before the request goes out
   (see `isFreeOpenRouterModel()` in `worker/index.js`), so a paid model
   id can't slip in by accident.
2. **Groq** — `env.GROQ_API_KEY` (optional). Defaults to
   `openai/gpt-oss-20b`. (Groq's free tier — no credit card required —
   covers every model on the platform, just rate-limited; this replaces
   the previous default of `llama-3.1-8b-instant`, which Groq
   deprecated on 2026-06-17 and decommissioned on 2026-08-16.)
3. **Gemini** — `env.GEMINI_API_KEY` (optional). Defaults to
   `gemini-2.5-flash-lite`. Google's free tier (since April 2026) only
   covers Flash and Flash-Lite models — Pro models are paid-only — so
   if you override `GEMINI_MODEL`, keep it in the Flash/Flash-Lite
   family to stay on the free tier. (This replaces the previous default
   of `gemini-1.5-flash`, which Google has fully discontinued.)
4. **Cloudflare Workers AI** — the `[ai]` binding in `wrangler.toml`. Always
   available on the free tier, no key needed — this is the final fallback.

Set any of the optional ones the same way:

```bash
wrangler secret put GROQ_API_KEY
wrangler secret put GEMINI_API_KEY
```

AI provider model lineups shift fairly often (deprecations, new free
variants) — if a provider starts failing outright, check the "🩺 AI
Provider Health" panel on the admin dashboard first (see below), then
check that provider's current model/docs page before assuming the
integration itself is broken.

**Never commit API keys into `wrangler.toml` or any other file** — secrets
set with `wrangler secret put` are stored encrypted by Cloudflare and
injected into `env` at runtime, without ever touching your source code or
git history. If a key has been pasted somewhere it shouldn't have been
(a chat, a doc, a public repo), treat it as compromised and rotate it on
the provider's dashboard.

### How the admin case-builder talks to the AI

Marking a submission and building a new case ask very different things
of the model: marking wants a tiny `{"score": N, "note": "..."}` reply,
while building a case used to ask for one big nested JSON object (7
MCQ components × 4 options each, task chunks, distractors, an answer
key) in a single ~1800-token completion. Free-tier 8B-class models are
reliable at the small ask and unreliable at the big one — they'd
frequently truncate or malform the large JSON, which used to silently
fall back to a fully generic template for the **whole** case.

The case-builder now makes **several small, focused AI calls** instead
of one large one — one for the task-chunk labelling, one for the two
irrelevant stimulus distractors, one for the own-content keyword
groups, one each for the "purpose" and "additional context" MCQ
options, and **one batched call covering every key-information point's
distractors together** (rather than one call per point — cuts a
4-key-info case build from 4 concurrent AI requests down to 1, which
matters on free-tier rate/concurrency limits). Each piece is validated
independently: if one comes back malformed, only *that* piece falls
back to a deterministic template (a fixed salutation/sign-off pair by
register, or a plain wrong-answer sentence) — the rest of the case
still uses whatever the AI generated. The admin dashboard's
case-creation result tells you whether a case was fully AI-assisted,
partially AI-assisted, or fully templated, and the preview panel shows
exactly which pieces used which.

Because every piece is independent, you can also **regenerate just one
part** of an already-built case later — e.g. you like everything except
the "purpose" MCQ — via the "🔄 Regenerate a part" control on each case
row, instead of rebuilding the whole thing from scratch.

Each provider also gets a hard timeout (`AI_TIMEOUT_MS`, 9 seconds by
default): if one hangs instead of erroring outright, `callAI` moves on
to the next provider rather than stalling. Every attempt (success,
failure, or timeout) is logged to an `ai_call_log` table, surfaced on
the admin dashboard as **"🩺 AI Provider Health (24h)"** — a per-provider
success/fail count, so you can tell whether OpenRouter is actually
carrying the load or every request is silently falling through to a
backup provider. Providers with no API key configured at all are
skipped without logging anything (not counted as a "failure").

### Review before publish

An AI-built case is **never immediately visible to pupils**. `POST
/api/admin/cases` always creates it with `status = 'draft'` and records
who built it (`created_by`); a separate explicit **"Publish"** action
(`PUT /api/admin/cases/:id/publish`) is what makes it live, and it
records who approved it and when (`approved_by` / `approved_at` — which
can be a different person from whoever built it, since one teacher
might review another's draft). The pupil-facing `/api/cases` list only
ever returns `status = 'published'` rows, so a draft sitting unreviewed
is simply invisible to pupils rather than being a security boundary
that could be bypassed — it's a workflow gate, not a permissions gate
(any admin/teacher account can still publish any draft).

If you're upgrading an existing deployment, see the migration comment
at the top of `schema.sql` — existing published cases are backfilled as
already-approved (`approved_by = 'legacy'`) rather than being hidden.

### Local development

```bash
wrangler dev
```

This runs everything locally (D1 in local/emulated mode, Workers AI calls
still hit Cloudflare's real inference). Note the built-in tutorial cases
work even before you've run the schema migration or created any teacher
cases — only the leaderboard and teacher-uploaded cases need D1.

### Custom domain

Add a route in the Cloudflare dashboard (Workers & Pages → your worker →
Triggers → Custom Domains) once deployed, if you want it on your own
domain instead of `*.workers.dev`.

## How scoring works

Each submission is scored **server-side** (so pupils can't just view-source
the answer key), out of a **total that admins/teachers control** from the
"AI Marking Rubric" panel on `/admin.html`:

| Component | Default points |
|---|---|
| Task identification (Purpose/Audience/Context) | 15 |
| Evidence Board (key info correctly selected) | 20 |
| Your Hunch (own-content plausibility, AI-judged with keyword fallback) | 15 |
| Letter MCQ choices vs. answer key | 30 |
| Paragraphing vs. model paragraph breaks | 10 |
| Overall quality (AI holistic read vs. model letter, similarity fallback) | 10 |

These are just the starting defaults (from `rubric_config` in D1, seeded
by `schema.sql`) — change any value in the rubric panel and the total
marks (shown live as you type) and every subsequent submission is marked
against the new weights immediately. The **mastery threshold** (the score
at/above which no "stronger version" rewrite is generated) is also set
there, and is validated to sit between 0 and the total.

If every AI provider is temporarily unavailable, the own-content and
overall quality scores automatically fall back to keyword-matching and
token-overlap (Jaccard) similarity respectively, so the game never
breaks — it just loses the more nuanced AI feedback notes. The AI marker
for these two components is also **skipped on purpose** when the
deterministic fallback score already lands confidently near 0% or 100%
of that component's points — in that band an AI opinion is unlikely to
change the score, so skipping it cuts AI provider load and marking
latency at effectively no cost to accuracy. It only gets called when the
fallback score is genuinely in the middle (currently the 15%-85% band).

Each provider in the fallback chain (OpenRouter → Groq → Gemini →
Workers AI) also gets a hard timeout (`AI_TIMEOUT_MS`, 9 seconds by
default) — if one hangs instead of erroring outright, the chain moves on
to the next provider rather than stalling the pupil's submit button.

The two AI-judged components (own-content and overall quality) are also
requested **in parallel** rather than one after another, so a pupil
waits for whichever one takes longer, not for both combined.

**Below the mastery threshold**, the response also includes an
`improvement` object: an AI-rewritten stronger version of the pupil's own
assembled letter (keeping their own-content idea and voice where
sensible) plus 2-3 short tips, shown in a highlighted panel on the
Verdict screen. At or above the threshold, no rewrite is generated — the
pupil already hit mastery.

## Pupil sign-in: Name@Class

Before reaching the case files, pupils see a launch screen asking them to
type their **name and class together**, e.g. `John@5IG`. This is parsed
client-side: everything before `@` is the name, everything after is the
class (uppercased). If no `@` is given, the class is left blank. Both are
stored in `localStorage` (so pupils aren't re-prompted every visit) and
sent with every submission, which is how the Class Performance Overview
knows which class each score belongs to. A "Not you? Switch detective"
link on the case-file screen lets a pupil re-identify themselves (e.g. on
a shared classroom device).

A second identifier — a random `deviceId` generated once and stored in
`localStorage` — travels alongside name/class on every submission,
practice-due check, and my-scores lookup. This exists purely to
disambiguate two different pupils who happen to share a first name (very
common in a class of 30): the heatmap only appends a `(#xxxx)` suffix
when it detects an actual collision (2+ distinct device ids under the
same name), so a class with no name clashes looks exactly as before.
**Known limitation:** on a shared classroom device used by multiple
pupils, they'd all carry the same `deviceId`, which doesn't help
disambiguate them — this fix targets the common case of personal
laptops/tablets, not shared hardware, since solving that properly would
mean real pupil accounts, which is out of scope for how lightweight this
sign-in is meant to be.

## MCQ option order

Each MCQ's four options are shuffled **client-side, once per case load**
(`shuffleArray()` in `index.html`) — the correct answer is still tracked
server-side by a stable option id, not by position, so shuffling display
order doesn't touch scoring. This exists because option order used to be
fixed at case-creation time and stored that way in D1: once "the answer
is always C" spread around a class, the MCQ stopped testing anything.
Now the visible order is different every time a pupil opens the case.

## Signing off the letter

On the Draft step, pupils also type their own name into a blank field to
sign the letter — **first name only for an informal letter**, **first
AND last name for a formal one** (matching real PSLE marking, where a
formal letter without a full name signature is marked down). This is
validated both client-side (the Submit button stays disabled until it's
filled in correctly) and server-side (`submitCase` rejects a submission
missing a name, or a single-word name on a formal case, with a 400
error) — the client check is just a UX nicety, not the only thing
enforcing it. The name is appended to the assembled letter that's shown
on the Verdict screen and fed to the AI holistic marker, but isn't itself
a separate scored rubric component.

## Class Performance Overview

The admin dashboard's "Class Performance Overview" panel shows a
heatmap: one row per pupil, one column per case they've played, each
cell colored from red (low) to green (near full marks) based on their
best score on that case, plus a per-pupil average. Admins can pick any
class that has submitted scores; teachers can only pick from the classes
assigned to their account.

Below the heatmap, a **"🔍 Common mix-ups"** panel surfaces components
where a large share of the class picked the *same wrong* MCQ option —
e.g. "half the class thinks this is a formal sign-off." This comes from
a separate `option_picks` table that logs every MCQ choice a pupil makes
(not just the final score), aggregated per class/case/component with a
minimum sample size (4 picks) and a popularity threshold (30% picking
the same wrong option) before it's surfaced, to avoid noise from a
handful of attempts. It's meant to catch a genuine class-wide
misconception that an average score alone wouldn't show.

## Spaced review & pupil progress

Two small features nudge pupils back to what they haven't mastered yet,
rather than leaving case selection purely up to whatever looks fun:

- **"📌 Cases due for another look"** on the pupil home screen: a case
  resurfaces here once a pupil's most recent attempt scored below the
  *current* mastery threshold AND enough time has passed since that
  attempt (`REVIEW_COOLDOWN_HOURS`, 20 hours by default) — simple
  time-boxed spacing rather than a full SM-2 scheduler, but enough to
  avoid an immediate replay loop while still bringing weak spots back.
  A case a pupil has since mastered (or hasn't attempted at all) never
  shows up here.
- **"📈 My Scores"**, in the top bar: a pupil-facing history of their own
  past attempts (case, score, out of), so they can see their own
  progress without needing a teacher login.

Both are read-only, best-effort endpoints (`/api/practice-due` and
`/api/my-scores`) keyed on `name` + `playerClass` + `deviceId` from the
launch screen — no additional login needed.

## Draft persistence

Every answer a pupil gives on the Briefing/Evidence/Hunch/Draft steps —
task tags, evidence picks, their own-content idea, MCQ choices,
paragraph breaks, and the sign-off name — is saved to `localStorage`
(keyed by case id) as they go, and restored automatically if they
reopen the same case after a refresh or a dropped connection (school
wifi isn't always reliable). The saved draft is cleared the moment a
submission succeeds, so it never resurfaces stale answers on a case
they've already finished.

## Adding more practice cases

Log in at `/admin.html`, fill in the form (title, stimulus picture,
question prompt, key information points, formal/informal, the "own
content" question, and a model letter), and click **Build case with AI**.
The AI provider chain reads your model letter and turns it into the full
playable structure — clickable task clues, evidence board items (plus 2
plausible distractors), 4-option MCQs for every part of the letter, and
the paragraph/answer key. The case is created as a **draft**: review it
in the JSON preview shown after creation (along with a breakdown of
which specific pieces came from AI vs. a deterministic template — see
"How the admin case-builder talks to the AI" above), regenerate any
single part that doesn't read well, and click **Publish this case**
when you're happy. Delete a case any time from the same page.

Keep uploaded images reasonably small (under ~500KB) — they're stored as
base64 directly in D1 for simplicity, rather than requiring an R2 bucket.

## Testing the marking logic

```bash
node tests/marking.test.mjs
```

This runs a small, dependency-free test suite directly against the pure
functions in `worker/index.js` (keyword scoring, similarity scoring,
MCQ shuffle/answer-key correctness, letter assembly) — no D1 database,
no AI provider, no Cloudflare runtime needed. It deliberately doesn't
cover `submitCase()` end-to-end, since that function mixes D1/AI I/O
with the scoring logic, but it does cover the pieces most likely to
silently regress from a future rubric or scoring tweak. Worth running
before deploying any change to the scoring functions.

## Notes & possible extensions

- The two built-in cases ("The Recycling Fair" and "Sports Day Mix-up")
  work without any setup and demonstrate both formal and informal
  register.
- The "unified leaderboard" shows top scores across *all* cases together;
  each row shows which case it came from.
- This is intentionally dependency-free (no build step, no framework) so
  it's easy to read, host, and modify.


## v1.8 change log

- Step 4 “Draft Your Report” now has **13 parts**: Salutation (Audience), Greeting/Introduction, Purpose, Context, Key information 1–5, Own idea, Closing sentence, Sign-off, and Name.
- Every Step 4 part presents **3 options plus a blank “write your own” field**.
- Typed responses are included in the live letter preview and submitted for marking; custom responses are checked against the expected content with similarity/own-content heuristics.
- Teacher/admin users can **manually edit all 13 labels, options, and correct answers** from each case’s “Edit 13 parts” panel. Saving changes returns the case to Draft for review.
- Teacher/admin users can **AI-regenerate any of the 13 parts individually**, as well as the existing task/evidence/own-content supporting pieces.
- AI case generation now targets **five key-information points** and creates the expanded 13-part Step 4 structure.
- Built-in tutorial cases are served through the same 13-part Step 4 interface.
- Version bumped to **v1.8**.

## External D1 case-authoring workflow (V1.8)

For cases that you prefer to author outside the app, use `AI_CASE_TO_D1_SQL_PROMPT.md` with an external AI tool to produce a complete executable SQL file. Run the resulting SQL in Cloudflare D1 Console. Set `image_data` to `NULL`; then use the Teacher front-end's **Add picture / Replace picture** control on that case to attach the stimulus image. Attaching or replacing an image returns the case to **Draft**, so it should be reviewed and published again.

The included `CASE_IMPORT_EXAMPLE.sql` shows the expected D1 shape.
