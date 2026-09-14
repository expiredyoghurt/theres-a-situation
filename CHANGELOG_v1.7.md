# Change Log — v1.7

## AI case-building reliability
- Hardened `Build case with AI` so AI failures cannot prevent case creation.
- Added deterministic complete-case fallback when the AI build throws or all generation calls fail.
- Added explicit `Create full case manually` workflow with editable title, task, five key information points, model answer, and all 13 Step 4 parts.
- Manual case creation always saves as a draft for teacher review.
- Clarified that every Step 4 part has 3 selectable options plus a separate blank “write your own response” field for pupils.

## Student visibility control
- Added a global Teacher/Admin “Student access” switch.
- Turning the switch off hides every case from the pupil case list, including built-in sample/tutorial cases.
- Direct case requests are blocked server-side while student access is disabled.
- Practice-due requests are also disabled while student access is off.
- Added persistent `app_settings.student_access_enabled` setting and schema seed.

## Version
- Bumped application/package version to **v1.7**.
