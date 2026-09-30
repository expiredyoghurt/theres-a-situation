# v1.11 change log

Fixes the three UI/UX issues identified in review: keyboard/screen-reader
accessibility, color-only signaling on task-chunk tags, and mobile
responsiveness.

## Keyboard & screen-reader accessibility (pupil game)

- **Task chunks** (Briefing step): now `role="button"`, `tabindex="0"`,
  with an `aria-label` describing the phrase and its current tag (or
  lack of one), and Enter/Space activate them just like a click. After
  tagging, keyboard focus is returned to the same chunk (previously a
  keyboard user's focus silently dropped to the document body on every
  full-step re-render) and — on first selecting a chunk — focus jumps
  straight into the tag picker instead of leaving the user to hunt for it.
- **Evidence cards**: same treatment — `role="button"`, `tabindex="0"`,
  `aria-pressed` reflecting pinned/unpinned, Enter/Space support, and
  focus restored to the same card after toggling.
- **Case cards and "due for review" items** on the home screen: same
  `role="button"`/`tabindex="0"`/keyboard-activation treatment. The case
  card's thumbnail image `alt` was changed from `"Case stimulus"` to `""`
  (decorative) since the card's own `aria-label` already states the case
  title and register, so a screen reader isn't left announcing the same
  information twice.
- **Letter-builder option buttons** were already real `<button>`
  elements (already keyboard-accessible); added `aria-pressed` so a
  screen reader announces which of the 3 options is currently selected.
- **Global visible focus ring**: added a `:focus-visible` outline (gold,
  matching the theme) in both `index.html` and `admin.html`. It only
  shows for keyboard focus, never for mouse/touch clicks, so it adds no
  visual noise for most pupils while making keyboard navigation possible
  to follow for the first time.

## Color is no longer the only signal on task-chunk tags

- Each tagged chunk (Purpose/Audience/Context/Not needed) now also shows
  a small icon badge (🎯/👤/📍/—) matching the picker's own icons, so the
  tag doesn't rely on the background color alone — this was the one
  concrete color-only-signal gap found (the evidence board's
  pinned/unpinned state already had a 📌 icon in addition to color).

## Mobile responsiveness

- Replaced the pupil game's single `@media (max-width:600px)` rule
  (which only shrank the score number) with a real `@media
  (max-width:480px)` pass: tighter panel/wrap padding, the case and
  evidence grids collapse to one column, the top bar wraps and shrinks,
  step tabs shrink to fit, nav buttons stack full-width, and the
  leaderboard/scores modal fits narrow viewports.
- Added the equivalent pass to the admin dashboard, which previously had
  **no** media queries at all: tighter panel padding, wrapping header/
  row/radio layouts, a narrower rubric grid, and a smaller heatmap table
  font (the heatmap already had a horizontal-scroll wrapper from an
  earlier version, so that part needed no change).

## Testing

- Full existing test suite still passes (18/18) after these changes.
- Both files' inline `<script>` blocks were syntax-checked with `node
  --check` after editing.
- These are markup/CSS-only changes — no backend/API behavior changed,
  so no version-specific migration or new endpoints in this release.

Version bumped to **v1.11**.
