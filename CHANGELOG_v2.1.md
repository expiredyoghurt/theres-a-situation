# v2.1 — Case file pop-up, working gauges, CASE CLOSED stamp
- **📌 Case file button** in all three Step 4 modes (guided, confirmed-edit, independent). It opens a native `<dialog>` with the picture, the full task and the teacher's required content points. It is a bottom sheet on phones. Esc, the Close button or a backdrop click close it; focus returns to the button; the draft behind it is never re-rendered, so typed text and the selected part are untouched. No new API calls (the data was already in the pupil payload; no answers are exposed).
- **Gauge fix:** the v1.18 ring gauges had a transition that never played. They are now drawn empty and fill on the next frame (instantly under reduced-motion). A browser test fails if the fill is not applied.
- **CASE CLOSED stamp** on a pass (250 ms slam-in, decorative, hidden from screen readers; off under reduced-motion; sits above the score on phones).
- No other animations were added.
- Tests: `tests/ui/casefile.ui.mjs` (popup in all modes at desktop and 390 px, text survives, focus return, gauge fill, stamp only on a pass, reduced-motion).
