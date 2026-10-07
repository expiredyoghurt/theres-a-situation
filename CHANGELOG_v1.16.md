# v1.16 — safety and speed
- **Structural validation** (`worker/validate.js`): every case row is checked (JSON, 13 parts in the right order for its format, 3 options a/b/c, answer key ids, paragraph breaks, image data URI, size). Publish refuses invalid cases (422, not bypassable with force). The teacher case list and the Manual backend upload tab show a ✔/✖/⚠ checklist per case; a case with broken JSON is listed (so you can delete it) instead of crashing the list.
- **Drafts are no longer reachable by pupils.** `/api/cases/:id`, submit and fix-check only serve demo cases or *published, valid* cases.
- **Smaller case menu.** Pupil list no longer ships base64 pictures; pictures come from `GET /api/cases/:id/image` (cached 1 h, published only).
- **Image XSS closed**: pupil page escapes the image src; the validator rejects non-image data URIs from SQL imports.
- **Submit cooldown**: 5 submissions per device per minute (HTTP 429), protecting the shared AI quota.
- Tests: `node tests/marking_v116.test.mjs` (7). Not browser-tested.
