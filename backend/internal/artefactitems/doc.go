// Package artefactitems is the scope-parameterised artefacts handler
// reading from vector_artefacts. One handler instance is registered per
// `artefacts_types.scope` value: scope="work" mounts at /samantha/v2/work-items,
// scope="strategy" mounts at /samantha/v2/portfolio-items. The wire shape and
// SQL are identical — only the scope filter differs. See B21 (PLA-0037).
//
// ── Rename history (RF1.4.4 / §1.1.2) ──────────────────────────────────
//
// Originally named `workitemsv2` (hard-coded to scope='work') during the
// PLA-0023 cutover from the legacy obj_work_items / obj_portfolio_items
// pipeline (mmff_vector) to the unified `artefacts` substrate
// (vector_artefacts). Renamed to `artefactitemsv2` on 2026-05-09 when
// portfolio adoption needed the same surface for strategy artefacts
// (themes, objectives, business epics, etc.).
//
// Renamed again to `artefactitems` on 2026-05-14 (RF1.4.4 / TD-NAME-001
// pay-down). The v2 suffix marked the substrate transition from obj_*
// (mmff_vector legacy) to artefacts_* (vector_artefacts current). Once
// the v1 obj_* substrate was retired (PLA-0023 cutover + RF1.4.2 sweep),
// the suffix lost its meaning per §1.1.2: "a version suffix earns its
// place when 'this is v2 of ___ because v1 was ___' is answered by a
// real architectural fact." With v1 gone, there is no v1 to disambiguate
// against. The suffix drops.
package artefactitems
