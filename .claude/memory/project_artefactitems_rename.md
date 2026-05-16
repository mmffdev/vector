---
name: project-artefactitems-rename
description: DONE 2026-05-14 — Go package artefactitemsv2 → artefactitems renamed in RF1.4.4 (bundled with mig 064 column-prefix on artefacts_fields_values). Keep memory for the §1.1.2 lesson on v-suffix lifetime.
metadata:
  type: project
---

**STATUS: DONE 2026-05-14** — committed in `7f9416f`. The Go package `backend/internal/artefactitemsv2/` is now `backend/internal/artefactitems/`. Memory retained for the design lesson it captured (see "Lesson" at the end).

`backend/internal/artefactitemsv2/` was renamed to `backend/internal/artefactitems/` on 2026-05-14.

**Why:** Per §1.1.2 of [`c_c_naming_conventions.md`](../../docs/c_c_naming_conventions.md), a version suffix earns its place when "this is v2 of ___ because v1 was ___" is answered by a real architectural fact. The v2 suffix on this package marked the post-PLA-0023 substrate cutover from `obj_work_items` (mmff_vector legacy) to `artefacts` (vector_artefacts current). Once the v1 `obj_*` substrate is fully dropped (PLA-0023 follow-up + RF1.4.2 sweep), the v2 suffix is dead weight — there is no v1 to disambiguate against.

**How to apply:** When TD-NAME-001 pay-down reaches the `artefactitemsv2` package, fold the package rename into the same commit:
- `mv backend/internal/artefactitemsv2 backend/internal/artefactitems`
- Update all imports (`grep -rl 'artefactitemsv2' backend/ app/`)
- Update package declaration in every file (`artefactitemsv2` → `artefactitems`)
- Update `cmd/server/main.go` constructor call
- Update doc.go to retire the "post-PLA-0023" version-suffix rationale (or move it to a HISTORY section)
- Update references in docs/ and CLAUDE.md

**Sequencing:** Do this AFTER the obj_* drop is fully clean, OR — if drop is deferred — do the rename now and note in doc.go that the v1 pipeline still exists but has no Go package counterpart (only DB tables).

**Lesson:** version suffixes are intentional but TEMPORARY. They earn their place while the older surface still casts a shadow (a directory, a callable handler, an active query path), and they drop when it doesn't. The `v2` here was justified during the cutover window when readers had to disambiguate against the active `obj_*` substrate; once that substrate retired, the suffix became dead weight. Future Claude: when you encounter `<thing>v<N>` in a codebase, ask "what was v<N-1>?". If the answer is "nothing in the active tree", propose the rename.

Related: [[user_background]], [[feedback_table_naming_prefixes]].
