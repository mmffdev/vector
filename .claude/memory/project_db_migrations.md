---
name: DB migrations — file-based ordered SQL only
description: Project has always used file-based ordered SQL migrations; do not invent alternative migration patterns
type: project
originSessionId: 1cc1402b-cf28-4e3f-abce-e87c7cd19978
---
**Migrations are file-based ordered SQL. Always. No exceptions.**

- **Vector DB (`mmff_vector`)** — SQL files in `db/mmff_vector/schema/NNN_*.sql`
- **Library DB (`mmff_library`)** — SQL files in `db/mmff_library/schema/NNN_*.sql`
- **Vector-artefacts DB (`vector_artefacts`)** — SQL files in `db/vector_artefacts/schema/NNN_*.sql`
- **Runner** — `backend/cmd/migrate/main.go`, invoked via `go run ./backend/cmd/migrate` from repo root
- **State** — `schema_migrations` table per DB; runner skips files already applied
- **Naming** — zero-padded 3-digit prefix, `NNN_short_description.sql`. Lexicographic order = apply order
- **Next free slot** — read `ls db/<dbname>/schema/ | tail -1` and increment; do NOT guess.

**Why:** A previous session assumed `backend/migrations/` (didn't exist) and proposed library-channel migrations as an alternative. That was wrong on both counts. The runner has been file-based since project start and there is no second migration mechanism. PLA-0048 RF1.3 (2026-05-14) reorganised the dirs from flat `db/schema/`, `db/library_schema/`, `db/artefacts_schema/` to per-DB `db/<dbname>/schema/`.

**How to apply:** Before writing or scoping any schema-change story, verify the next number with `ls db/<dbname>/schema/ | tail -1` and write the new file directly into that directory. Story descriptions referencing migration filenames must use the actual next free number, not a guess.
