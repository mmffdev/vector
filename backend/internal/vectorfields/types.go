// Package vectorfields reads the 3-layer field model (spec 2026-05-31):
// vector_fields_library (definition) ⋈ vector_fields_context (binding).
// It is the successor reader to formlayouts.CustomFields + CoreFields. Runs
// on vaPool (vector_artefacts).
package vectorfields

// FieldEntry is one row of the unified field registry for an entity type.
type FieldEntry struct {
	FieldKey      string `json:"fieldKey"`      // "custom:<id>" or core name
	Label         string `json:"label"`
	DataType      string `json:"dataType"`
	Kind          string `json:"kind"`          // "core" | "custom"
	Required      bool   `json:"required"`      // data-entry (per context)
	IsCompulsory  bool   `json:"isCompulsory"`  // must be placed (per context)
	Position      int    `json:"position"`
	ValueLocation string `json:"valueLocation"` // "artefacts_column" | "eav"
}
