// Shared value-binding helpers for the Form Layout Builder's data-bound
// surfaces (FormLayoutRuntime + the preview data picker). Extracted so the
// two consumers share ONE definition of "how do we read an artefact's value
// for a fieldKey" rather than copy it (NCY).
//
// The 3-layer field model (spec 2026-05-31) keeps field VALUES in two homes:
//   - core fields   → typed columns on the artefacts row  (valueLocation "artefacts_column")
//   - custom fields → an artefacts_fields_values EAV row    (valueLocation "eav")
// A consumer that has the field descriptors (with valueLocation) can therefore
// route each fieldKey to the right source with no hard-coded branching.

import type { CoreFieldDescriptor } from "@/app/lib/formLayoutsApi";

// FieldValueWire mirrors the /work-items/{id}/field-values row shape (the EAV
// custom values). Exactly one of the typed *_value columns is non-null.
export interface FieldValueWire {
  id: string;
  field_library_id: string | null;
  field_name: string;
  label: string;
  field_type: string;
  string_value: string | null;
  number_value: string | null;
  text_value: string | null;
  date_value: string | null;
}

// valueFromWire collapses the 5 typed EAV buckets to a single display string.
export function valueFromWire(fv: FieldValueWire): string {
  return fv.string_value ?? fv.number_value ?? fv.text_value ?? fv.date_value ?? "";
}

// buildCustomValueMap turns a field-values payload into a
// `custom:<library_id>` → display-string map (the key vocabulary the layout
// uses for custom cells).
export function buildCustomValueMap(wire: FieldValueWire[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fv of wire) {
    if (fv.field_library_id) out[`custom:${fv.field_library_id}`] = valueFromWire(fv);
  }
  return out;
}

// coreValueFromWorkItem reads a CORE field's display value off a loosely-typed
// work-item row. Most core fields map straight to a JSON tag of the same name
// (title, flow_state_name, …). A few are nested objects (owner, priority) and
// are unwrapped to their human label here so the preview shows "Rick C." not
// "[object Object]".
export function coreValueFromWorkItem(
  item: Record<string, unknown>,
  fieldKey: string,
): string {
  // Nested-object core fields: prefer a display label over the raw object.
  if (fieldKey === "owner") return displayOf(item.owner) || displayOf(item.owner_id) || "";
  if (fieldKey === "priority") return displayOf(item.priority) || "";
  const v = item[fieldKey];
  if (v == null) return "";
  if (typeof v === "object") return displayOf(v);
  return String(v);
}

// displayOf pulls a human-readable label out of a value that might be a
// `{ display_name | label | name | email }` object, a primitive, or null.
function displayOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  const o = v as Record<string, unknown>;
  const cand = o.display_name ?? o.label ?? o.name ?? o.email;
  return cand == null ? "" : String(cand);
}

// previewValueFor is the single entry point the preview uses: given the field
// descriptor (carrying valueLocation), the loaded work-item core row, and the
// custom EAV map, return the display value for a placed cell's fieldKey.
// valueLocation routes to the right source — no hard-coded core/custom branch.
export function previewValueFor(
  fieldKey: string,
  descriptor: CoreFieldDescriptor | undefined,
  coreItem: Record<string, unknown> | null,
  customValues: Record<string, string>,
): string {
  // Custom keys are always "custom:<id>" and live in EAV regardless of how
  // the descriptor resolved; fall back to descriptor.valueLocation otherwise.
  if (fieldKey.startsWith("custom:") || descriptor?.valueLocation === "eav") {
    return customValues[fieldKey] ?? "";
  }
  if (!coreItem) return "";
  return coreValueFromWorkItem(coreItem, fieldKey);
}
