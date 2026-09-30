# Prompt: Generate a complete Boss! There's a situation! case as JSON

Copy everything below into the external AI tool you want to use to author a
new case. Replace the CASE BRIEF section with your own content.

Use this version (instead of `AI_CASE_TO_D1_SQL_PROMPT.md`) if you want to
**import the case through the Teacher front-end** — on the "Add a new
case" screen, use "📥 Import case JSON", pick the `.json` file this
produces, then attach the stimulus picture as a normal `.jpg`/`.png`
upload in the same form. You never need to open the Cloudflare D1
Console for this path, and the case is always created as a **draft** for
you to review before publishing — never published automatically.

---

You are generating one complete practice case for the English
situational-writing game **"Boss! There's a situation!"**.

Your job is to return a **single JSON object** matching the schema below.
Nothing else.

## Important rules

1. Output **JSON only**. No markdown fences, no explanation before or
   after it. The response must be valid, parseable JSON.
2. The case must contain exactly **13 `components`, in this exact order**:
   `salutation`, `greeting`, `purpose`, `context`, `keyinfo1`, `keyinfo2`,
   `keyinfo3`, `keyinfo4`, `keyinfo5`, `ownIdea`, `closing`, `signoff`,
   `name`. Do not include a `"key"` field on each component — the
   position in the array determines which of the 13 parts it is, in the
   order above.
3. Every component needs a short `"label"` (e.g. `"Purpose"`) and exactly
   **3 `"options"`** — plain strings, the correct one plus two plausible
   but clearly wrong distractors — plus `"correctIndex"`: `0`, `1` or `2`,
   pointing at the correct option's position in that component's
   `"options"` array.
4. The pupil-facing UI automatically gives every component a separate
   blank **"write your own"** field. Do not invent a 4th option for that.
5. `"formal": true` means formal writing; `"formal": false` means
   informal writing.
6. For formal writing, use a full first + last name in the `name`
   component's options. For informal writing, use a first name only.
7. For formal sign-off, suitable choices include `Yours faithfully,`,
   `Yours sincerely,` and `Best regards,`. For informal writing, use
   natural informal choices.
8. The 5 `keyinfo` components' correct options must match, in order, the
   5 strings in `"keyInfo"`.
9. `"distractorStimulusPoints"` should contain exactly 2 plausible but
   unnecessary facts (`relevant: false` on the pupil's evidence board) —
   details that fit the scene but are not required in the letter.
10. `"taskChunks"` should break the task prompt into short phrases, each
    tagged `"purpose"`, `"audience"`, `"context"`, or `"other"`. Cover the
    whole task text; exactly one phrase should be `"purpose"` (what
    pupils must do) and one `"audience"` (who they're writing to).
11. `"ownContentKeywords"` must be an array of keyword groups for marking
    the pupil's original idea, e.g. `[["donate","give"],["poster","sign"]]`.
12. Keep the case content suitable for Primary 5/6 English situational
    writing.
13. Distractors must be genuinely plausible enough to test understanding,
    but clearly wrong because they don't suit the situation, audience,
    register, or required information.
14. `"modelLetter"` must be a coherent full reference answer that uses
    the intended register and naturally includes all 5 key information
    points plus the own-content idea.
15. Do not include `id`, `status`, `imageData`, or any approval fields —
    the app assigns those. The stimulus picture is attached separately
    as a file upload in the same form, not inside this JSON.

## Required JSON schema

```json
{
  "title": "string",
  "formal": true,
  "taskText": "the full task prompt exactly as given to pupils",
  "taskChunks": [
    { "text": "substring of taskText", "type": "purpose|audience|context|other" }
  ],
  "keyInfo": ["fact 1", "fact 2", "fact 3", "fact 4", "fact 5"],
  "distractorStimulusPoints": ["unnecessary but plausible detail 1", "unnecessary but plausible detail 2"],
  "ownContentPrompt": "the own-idea question posed to pupils",
  "ownContentIdeas": ["example acceptable idea 1", "example acceptable idea 2", "example acceptable idea 3"],
  "ownContentKeywords": [["keyword", "synonym"], ["keyword2", "synonym2"]],
  "modelLetter": "full reference answer",
  "components": [
    { "label": "Salutation (Audience)", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Greeting", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Purpose", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Context", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Key information 1", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Key information 2", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Key information 3", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Key information 4", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Key information 5", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Own idea", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Closing sentence", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Sign-off", "options": ["...", "...", "..."], "correctIndex": 0 },
    { "label": "Name", "options": ["...", "...", "..."], "correctIndex": 0 }
  ]
}
```

## CASE BRIEF

Title:
[INSERT TITLE]

Formal or informal:
[INSERT FORMAL OR INFORMAL]

Task prompt:
[INSERT FULL TASK PROMPT]

Key information 1:
[INSERT FACT 1]

Key information 2:
[INSERT FACT 2]

Key information 3:
[INSERT FACT 3]

Key information 4:
[INSERT FACT 4]

Key information 5:
[INSERT FACT 5]

Own-content question:
[INSERT OWN-IDEA QUESTION]

Acceptable own-content ideas:
[INSERT 2-4 EXAMPLES]

Audience:
[INSERT AUDIENCE]

Context:
[INSERT BACKGROUND CONTEXT]

Model-answer guidance:
[INSERT ANY CONTENT OR TONE GUIDANCE]

---

Before returning the JSON, silently validate:

- exactly 13 components, in the exact order given;
- exactly 3 options per component, with a valid `correctIndex` (0, 1, or 2);
- exactly 5 `keyInfo` facts, matched in order by the 5 `keyinfo` components;
- exactly 2 `distractorStimulusPoints`;
- `taskChunks` covers the whole task text with exactly one `"purpose"` and
  one `"audience"` entry;
- the model letter agrees with the task, register, and all 5 key facts;
- the whole response is valid, parseable JSON with no trailing commas or
  comments.

Return the final JSON object only.
