# v1.17 — Step 4 stepper and format-specific preview
- Step 4 shows one part at a time with a numbered progress rail, Previous/Next buttons, auto-advance after a pick, and a "Show all parts on one page" switch.
- Live preview: letters appear on ruled letter paper with a Formal/Informal stamp; articles appear as a "SCHOOL NEWS" clipping with headline and byline.
- Browser-tested (headless Chromium, desktop and 390 px phone) and three layout bugs fixed: article preview was split into two cramped columns, the case stamp overlapped the step tabs, and the three level cards pushed the stepper below the fold on phones (they are now compact).
- New `tests/ui/step4.ui.mjs` (+ `tests/ui/serve.mjs` local harness with a fake D1). Needs playwright and Chromium; not part of the node-only suites.
