# CHANGELOG — V1.8

## Fixed
- Fixed the **Create full case manually** button. The browser was calling `fallbackComponentSet()`, which only existed inside the Worker and therefore caused a client-side `ReferenceError`.
- Added a browser-safe manual fallback/template generator so the manual editor opens immediately and is usable without an AI call.

## New
- Added teacher/admin **Attach / Replace picture** control for any D1 case already in the case manager.
- Added authenticated `PUT /api/admin/cases/:id/image` endpoint.
- Image uploads update the D1 `cases.image_data` field and return the case to **Draft** so the teacher reviews it again before publishing.
- Images are validated as PNG/JPEG/WebP/GIF and limited to approximately 500 KB for practical D1 storage.
- Added `AI_CASE_TO_D1_SQL_PROMPT.md` for generating a complete case externally as executable D1 SQL.
- Added `CASE_IMPORT_EXAMPLE.sql` showing the exact import format and the image-attachment workflow.
- External SQL-imported cases can use `image_data = NULL`; the teacher can attach the picture later by case ID from the Teacher front-end.

## Workflow now supported
1. Build a case with AI in the Teacher front-end.
2. Create a complete case manually in the Teacher front-end.
3. Generate a complete case outside the app as a `.sql` file, then run it in Cloudflare D1 Console.
4. Open the imported case in the Teacher front-end and attach the stimulus picture.
5. Review and publish the case.

## Version
- App version bumped from **v1.7** to **v1.8**.
