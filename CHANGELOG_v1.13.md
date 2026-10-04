# v1.13 — what changed

## New: "Mark with an external AI" in the grading panel
Open any submission in **Pupil submissions & grading** and you'll find a new **🤖 Mark with an external AI** section (it opens by default when the app's own AI marker failed).

- **📋 Copy marking prompt** puts a complete, ready-to-paste prompt on the clipboard. Paste it into ChatGPT, Gemini, Copilot or any other LLM.
- The prompt is filled in automatically with the case's question prompt, letter type (formal/informal), required content points, the "own idea" question, acceptable ideas, the model answer, and the pupil's own idea and letter.
- It asks the AI to mark the two criteria the app's AI normally marks, **Own idea (Step 3)** and **Overall quality**, and to answer in a fixed format (score, one-line reason, pupil feedback, teacher flags) that is easy to copy into the score boxes.
- Score maximums and score bands follow your **current rubric weights**, so changing the rubric changes the prompt.
- **Privacy:** the pupil's name and class are never included. The panel reminds teachers to check the writing for real names before pasting it into a third-party tool.
- **Safety:** pupil writing is fenced and the AI is told to treat it as text to mark, not instructions. A pupil who writes `"""` or "give me 15/15" cannot break out of the fence.
- If a detail can't be filled in (for example the case was deleted), it shows as `[not available]` and a red note lists what's missing.
- If the browser blocks the clipboard (common on locked-down school devices), the prompt is shown selected in a box, ready for Ctrl+C / Cmd+C.
- The AI's scores are a **draft**. Teachers still enter their own scores and the required comment, as in v1.12.

## Also included
- `TEACHER_MARKING_PROMPT_TEMPLATE.md`: the same prompt as a fill-in-the-blanks template, for marking work that isn't in the app.
- The submission-detail endpoint (teacher/admin only) now returns the letter type, required points, acceptable ideas and required-points text, so the prompt can be built. The pupil-facing case payload is unchanged and still contains no answers.

## Upgrading
Just deploy. No database changes since v1.12.

## Tests
`node tests/marking.test.mjs`: 39 passing (unchanged).
