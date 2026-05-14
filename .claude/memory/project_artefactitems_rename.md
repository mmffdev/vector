---
name: project-artefactitems-rename
description: Go package backend/internal/artefactitemsv2/ must be renamed to backend/internal/artefactitems/ — the v2 suffix loses its meaning once the v1 obj_work_items pipeline is fully retired.
metadata:
  type: project
---

`backend/internal/artefactitemsv2/` should be renamed to `backend/internal/artefactitems/`.

**Why:** Per §1.1.2 of [`c_c_naming_conventions.md`](../../docs/c_c_naming_conventions.md), a version suffix earns its place when "this is v2 of ___ because v1 was ___" is answered by a real architectural fact. The v2 suffix on this package marked the post-PLA-0023 substrate cutover from `obj_work_items` (mmff_vector legacy) to `artefacts` (vector_artefacts current). Once the v1 `obj_*` substrate is fully dropped (PLA-0023 follow-up + RF1.4.2 sweep), the v2 suffix is dead weight — there is no v1 to disambiguate against.

**How to apply:** When TD-NAME-001 pay-down reaches the `artefactitemsv2` package, fold the package rename into the same commit:
- `mv backend/internal/artefactitemsv2 backend/internal/artefactitems`
- Update all imports (`grep -rl 'artefactitemsv2' backend/ app/`)
- Update package declaration in every file (`artefactitemsv2` → `artefactitems`)
- Update `cmd/server/main.go` constructor call
- Update doc.go to retire the "post-PLA-0023" version-suffix rationale (or move it to a HISTORY section)
- Update references in docs/ and CLAUDE.md

**Sequencing:** Do this AFTER the obj_* drop is fully clean, OR — if drop is deferred — do the rename now and note in doc.go that the v1 pipeline still exists but has no Go package counterpart (only DB tables).

Related: [[user_background]], [[feedback_table_naming_prefixes]].
