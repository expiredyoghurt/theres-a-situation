# v2.3 — Teachers can change a case's writing format

Case editor → Step 1 now starts with a **Writing format** control (formal letter / informal letter / article).

- `PUT /api/admin/cases/:id/format` (new `worker/caseFormat.js`).
- Letter ↔ article: parts that exist in only one format are rebuilt by AI; shared parts (purpose, context, key info 1-5, own idea) keep their options and answers. Parts the AI cannot build get template text and are flagged, so Publish is blocked until fixed.
- Formal ↔ informal: parts are kept and relabelled. Optional "also rebuild register-specific parts" re-generates salutation, greeting, closing, sign-off and name.
- The case always returns to **draft** and must be republished.
- **The model answer is not rewritten.** The result banner warns you to edit it.
- Also repairs SQL-imported cases with a NULL/wrong format (label-only fix).
- Tests: `tests/v23_format.test.mjs` (8), `tests/ui/format.ui.mjs`.
