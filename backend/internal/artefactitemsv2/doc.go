// Package artefactitemsv2 is the scope-parameterised v2 artefacts handler
// reading from vector_artefacts. One handler instance is registered per
// `artefact_types.scope` value: scope="work" mounts at /samantha/v2/work-items,
// scope="strategy" mounts at /samantha/v2/portfolio-items. The wire shape and
// SQL are identical — only the scope filter differs. See B21 (PLA-0037).
//
// Originally named `workitemsv2` and hard-coded to scope='work'. Renamed
// 2026-05-09 when portfolio adoption needed the same surface for strategy
// artefacts (themes, objectives, business epics, etc.). The legacy
// `workitemsv2` import path is gone — all callers reference artefactitemsv2.
package artefactitemsv2
