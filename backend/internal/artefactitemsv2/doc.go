// Package artefactitemsv2 is the scope-parameterised v2 artefacts handler
// reading from vector_artefacts. One handler instance is registered per
// `artefacts_types.scope` value: scope="work" mounts at /samantha/v2/work-items,
// scope="strategy" mounts at /samantha/v2/portfolio-items. The wire shape and
// SQL are identical — only the scope filter differs. See B21 (PLA-0037).
//
// ── Why the `v2` suffix is intentional (RF1.4.1 / §1.1.2) ──────────────
//
// The `v2` marks the substrate transition from the legacy
// obj_work_items / obj_portfolio_items pipeline (mmff_vector) to the
// unified `artefacts` substrate (vector_artefacts). The v1 directory
// (`internal/workitems` + `internal/portfolioitems`) was deleted after
// the PLA-0023 cutover (2026-05-13).
//
// Per the §1.1.2 v-suffix rule: a version suffix is allowed when
// "version" is a real distinction in the domain. The v1 → v2 break here
// is architectural — a different DB (mmff_vector → vector_artefacts), a
// different schema family (obj_* → artefacts_*), a different writer
// service. A future reader looking at git blame or a cross-package
// import sees the `v2` and immediately knows "this is the post-cutover
// artefacts surface, not the legacy obj_* pipeline."
//
// Filled in per the §1.1.2 sanity check: this is v2 of the artefact-items
// handler because v1 was the obj_* substrate handlers that lived in
// `internal/workitems` and `internal/portfolioitems`, both deleted at
// the PLA-0023 cutover.
//
// Renaming history within v2: originally named `workitemsv2` and hard-coded
// to scope='work'. Renamed to `artefactitemsv2` on 2026-05-09 when
// portfolio adoption needed the same surface for strategy artefacts
// (themes, objectives, business epics, etc.). The legacy `workitemsv2`
// import path is gone — all callers reference artefactitemsv2.
package artefactitemsv2
