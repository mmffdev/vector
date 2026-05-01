---
name: DB migrations — file-based ordered SQL only
description: Project has always used file-based ordered SQL migrations; do not invent alternative migration patterns
type: project
originSessionId: 1cc1402b-cf28-4e3f-abce-e87c7cd19978
---
**Migrations are file-based ordered SQL. Always. No exceptions.**

- **Vector DB (`mmff_vector`)** — SQL files in `db/schema/NNN_*.sql`
- **Library DB (`mmff_library`)** — SQL files in `db/library_schema/NNN_*.sql`
- **Runner** — `backend/cmd/migrate/main.go`, invoked via `go run ./backend/cmd/migrate` from repo root
- **State** — `schema_migrations` table per DB; runner skips files already applied
- **Naming** — zero-padded 3-digit prefix, `NNN_short_description.sql`. Lexicographic order = apply order
- **Next free slot** — read `ls db/schema/ | tail -1` and increment; do NOT guess. As of 2026-05-01: vector latest = `067_icon_catalogue.sql`; library latest = `011_layer_tag_definitions.sql`

**Why:** A previous session assumed `backend/migrations/` (didn't exist) and proposed library-channel migrations as an alternative. That was wrong on both counts. The runner has been file-based since project start and there is no second migration mechanism.

**How to apply:** Before writing or scoping any schema-change story, verify the next number with `ls db/schema/ | tail -1` (or `db/library_schema/`) and write the new file directly into that directory. Story descriptions referencing migration filenames must use the actual next free number, not a guess.
