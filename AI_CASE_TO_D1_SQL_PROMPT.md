# Prompt: Generate a complete Boss! There's a situation! case as D1 SQL

Copy everything below into the external AI tool you want to use to author a new case. Replace the CASE BRIEF section with your own content.

---

You are generating one complete practice case for the English situational-writing game **"Boss! There's a situation!"**.

Your job is to return a **single executable SQLite/D1 SQL file** that inserts exactly one case into the existing `cases` table.

## Important rules

1. Output **SQL only**. No markdown fences. No explanation before or after the SQL.
2. Use one `INSERT INTO cases (...) VALUES (...)` statement.
3. Generate a unique case id such as `case_import_school_trip_001` using lowercase letters, numbers, underscores and hyphens only.
4. The case must contain exactly **13 Step 4 components in this exact order and with these exact keys**:
   - `salutation`
   - `greeting`
   - `purpose`
   - `context`
   - `keyinfo1`
   - `keyinfo2`
   - `keyinfo3`
   - `keyinfo4`
   - `keyinfo5`
   - `ownIdea`
   - `closing`
   - `signoff`
   - `name`
5. Every component must contain **exactly 3 options** with ids `a`, `b`, `c`.
6. The `answer_key.components` object must identify the correct option id for every one of the 13 components.
7. The pupil-facing UI automatically provides a separate blank **"write your own"** text field for every component. Do **not** invent a fourth stored option for that field.
8. `formal = 1` means formal writing; `formal = 0` means informal writing.
9. For formal writing, use a full first + last name in the `name` component. For informal writing, use a first name only.
10. For formal sign-off, suitable choices include `Yours faithfully,`, `Yours sincerely,` and `Best regards,`. For informal writing, use natural informal choices.
11. The 5 `keyinfo` components must match the 5 required facts in `stimulus_points`.
12. `stimulus_points` must contain the 5 required facts with `relevant: true`, plus 2 plausible but unnecessary distractor facts with `relevant: false`.
13. `task_chunks` should identify the purpose, audience and context where possible. Use objects shaped like `{"id":"t1","text":"...","type":"purpose"}`.
14. `own_content_keywords` must be valid JSON containing keyword groups useful for marking the pupil's original idea, for example `[["donate","give"],["poster","sign"]]`.
15. `answer_key.paragraphBreaks` should normally be `[`"purpose"`, `"keyinfo1"`, `"closing"`, `"signoff"`]` unless the task clearly calls for a different paragraph structure.
16. Set `status` to **`'published'`** because this file is intended for direct D1 Console import. A teacher should review the case before allowing pupils to use it.
17. Set `created_by` to `external-ai-import`.
18. Set `approved_by` to `external-ai-import` and `approved_at` to the current ISO timestamp.
19. `image_data` should be **NULL**. The teacher will attach the picture later from the Teacher front-end using the case id.
20. Escape all apostrophes inside SQL strings by doubling them (`''`).
21. Store JSON using valid JSON syntax inside SQL string literals.
22. Keep the case content suitable for Primary 5/6 English situational writing.
23. Distractors must be genuinely plausible enough to test understanding, but clearly wrong because they do not suit the situation, audience, register or required information.
24. The model letter must be a coherent full reference answer that uses the intended register and includes all 5 key information points plus the own-content idea in a natural way.

## Required SQL column order

Use these columns exactly:

`id, title, image_data, task_text, task_chunks, formal, stimulus_points, own_content_prompt, own_content_keywords, components, answer_key, model_letter, status, created_by, approved_by, approved_at`

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

Before returning the SQL, silently validate:

- exactly 13 components;
- exact component-key order;
- exactly 3 options per component;
- every answer-key component points to `a`, `b` or `c`;
- exactly 5 relevant stimulus points plus 2 irrelevant distractors;
- valid JSON in every JSON column;
- no unescaped apostrophes that would break the SQL;
- model letter agrees with the task and key information;
- `image_data` is NULL.

Return the final executable SQL only.
