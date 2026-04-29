---
name: ALLDOC files in web/documents/
description: All project documents (ALLDOC collection) now live in web/documents/, not root. Root README.md was merged and deleted.
type: project
originSessionId: d56bdd3f-826c-4cb6-bc6b-3de680858489
---
All ALLDOC document files are in `web/documents/`, not the project root.

**Why:** Root README.md was merged into web/documents/README.md and the root copy deleted. DEVELOPMENT.md was also moved there. All docs are now centralised in one folder.

**How to apply:** When referencing or updating any ALLDOC document (PAP, SCO, ARC, SPR, COP, GSD, RMF, DEF, DED), always use the `web/documents/` path. The app's sidebar Documents section links to all of them via a backend `/api/documents/:name` endpoint serving markdown.
