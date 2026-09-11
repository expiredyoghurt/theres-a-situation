# Boss! There's a situation!

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

## AI provider chain

Every AI-assisted feature (own-content judging, holistic letter marking,
the "stronger version" rewrite, and the admin case-builder) goes through
one function that tries providers **in this order** and uses whichever
answers first:

1. **OpenRouter** — `env.OPENROUTER_API_KEY` (set via `wrangler secret put OPENROUTER_API_KEY`).
   This is the primary marker. Model defaults to `meta-llama/llama-3.1-8b-instruct`;
   override with `wrangler secret put OPENROUTER_MODEL` if you'd like a
   different OpenRouter model.
2. **Groq** — `env.GROQ_API_KEY` (optional). Defaults to `llama-3.1-8b-instant`.
3. **Gemini** — `env.GEMINI_API_KEY` (optional). Defaults to `gemini-1.5-flash`.
4. **Cloudflare Workers AI** — the `[ai]` binding in `wrangler.toml`. Always
   available on the free tier, no key needed — this is the final fallback.

Set any of the optional ones the same way:

```bash
wrangler secret put GROQ_API_KEY
wrangler secret put GEMINI_API_KEY
```

**Never commit API keys into `wrangler.toml` or any other file** — secrets
set with `wrangler secret put` are stored encrypted by Cloudflare and
injected into `env` at runtime, without ever touching your source code or
git history. If a key has been pasted somewhere it shouldn't have been
(a chat, a doc, a public repo), treat it as compromised and rotate it on
the provider's dashboard.

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
breaks — it just loses the more nuanced AI feedback notes.

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

## Class Performance Overview

The admin dashboard's "Class Performance Overview" panel shows a
heatmap: one row per pupil, one column per case they've played, each
cell colored from red (low) to green (near full marks) based on their
best score on that case, plus a per-pupil average. Admins can pick any
class that has submitted scores; teachers can only pick from the classes
assigned to their account.

## Adding more practice cases

Log in at `/admin.html`, fill in the form (title, stimulus picture,
question prompt, key information points, formal/informal, the "own
content" question, and a model letter), and click **Build case with AI**.
The AI provider chain reads your model letter and turns it into the full
playable structure — clickable task clues, evidence board items (plus 2
plausible distractors), 4-option MCQs for every part of the letter, and
the paragraph/answer key — which you can review in the JSON preview shown
after creation. Delete a case any time from the same page.

Keep uploaded images reasonably small (under ~500KB) — they're stored as
base64 directly in D1 for simplicity, rather than requiring an R2 bucket.

## Notes & possible extensions

- The two built-in cases ("The Recycling Fair" and "Sports Day Mix-up")
  work without any setup and demonstrate both formal and informal
  register.
- The "unified leaderboard" shows top scores across *all* cases together;
  each row shows which case it came from.
- This is intentionally dependency-free (no build step, no framework) so
  it's easy to read, host, and modify.
