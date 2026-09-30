# v1.9 change log

- New **"Tutorial cases" toggle** on the admin dashboard: a narrower
  switch than the existing "Student access" master switch — it hides
  only the two built-in tutorial/sample cases ("The Recycling Fair" and
  "Sports Day Mix-up") from pupils, while leaving any teacher-uploaded
  published cases untouched. Useful once a class has outgrown the
  tutorial cases and a teacher wants the case list to only show real
  practice material.
  - New endpoints: `GET/PUT /api/admin/tutorial-access` (admin or
    teacher; same auth as the existing student-access endpoints).
  - Stored as a new `tutorial_cases_enabled` row in the existing
    `app_settings` table — no new table needed. `schema.sql` seeds it
    to `'1'` (visible) so re-running the schema on an existing database
    is safe and preserves today's behavior.
  - `GET /api/cases`, `GET /api/cases/:id`, and
    `POST /api/cases/:id/submit` all now return a 403 / omit the demo
    cases when this is off; `GET /api/practice-due` also stops
    resurfacing a tutorial case a pupil can no longer open.
  - Defaults to **on** (tutorial cases visible), matching pre-v1.9
    behavior for anyone who doesn't touch the new setting.
- Version bumped to **v1.9**.
