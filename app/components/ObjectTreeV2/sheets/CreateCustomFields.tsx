"use client";

// CreateCustomFields — renders the per-type custom-field inputs for the
// V2 create flyout. Each input is controlled by a value map keyed by
// field_library_id; the parent owns the state and forwards it into the
// POST body as `custom_fields: [...]`. Mirrors the field_type vocabulary
// in artefacts_fields_library: textbox / richtext / integer / decimal /
// date / boolean / select / multiselect / radio / user / url.
//
// Required fields are marked with an asterisk in the label. Validation is
// soft (label hint only) — the server enforces required + type-coercion
// at the transactional create boundary.

import React from "react";
import type { FieldBinding } from "@/app/components/ObjectTreeV2/hooks/useFieldsForType";

export type CustomFieldValues = Record<string, string>;

interface Props {
  bindings: FieldBinding[];
  values: CustomFieldValues;
  onChange: (next: CustomFieldValues) => void;
  // Mirrors the `tabIndex` discipline of the surrounding create-flyout
  // inputs — closed flyouts are taken out of the tab order entirely so
  // focus never lands on hidden fields.
  tabIndex: number;
}

function parseOptions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function CreateCustomFields({ bindings, values, onChange, tabIndex }: Props) {
  if (bindings.length === 0) return null;

  const set = (id: string, value: string) => {
    onChange({ ...values, [id]: value });
  };

  return (
    <div className="tree_accordion-dense__createflyout-section">
      <div className="tree_accordion-dense__createflyout-section-head">
        <span className="cf-tree__section-label">Custom Fields</span>
      </div>

      {bindings.map((b) => {
        const v = values[b.field_library_id] ?? b.default_value ?? "";
        const labelNode = (
          <span className="tree_accordion-dense__createflyout-field-label">
            {b.label}
            {b.required && (
              <span className="tree_accordion-dense__createflyout-required"> *</span>
            )}
          </span>
        );

        switch (b.field_type) {
          case "richtext":
            // Plain textarea for now — TipTap upgrade matches the
            // Description field once richtext custom fields are a real
            // requirement (tracked alongside TD-CREATE-CUSTOM-FIELDS).
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <textarea
                  className="tree_accordion-dense__createflyout-input"
                  rows={3}
                  tabIndex={tabIndex}
                  value={v}
                  onChange={(e) => set(b.field_library_id, e.target.value)}
                />
              </label>
            );
          case "integer":
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <input
                  type="number"
                  step={1}
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tabIndex}
                  value={v}
                  onChange={(e) => set(b.field_library_id, e.target.value)}
                />
              </label>
            );
          case "decimal":
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <input
                  type="number"
                  step="any"
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tabIndex}
                  value={v}
                  onChange={(e) => set(b.field_library_id, e.target.value)}
                />
              </label>
            );
          case "date":
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <input
                  type="date"
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tabIndex}
                  value={v}
                  onChange={(e) => set(b.field_library_id, e.target.value)}
                />
              </label>
            );
          case "boolean":
            return (
              <label
                key={b.field_library_id}
                className="tree_accordion-dense__createflyout-field tree_accordion-dense__createflyout-field--inline"
              >
                <input
                  type="checkbox"
                  tabIndex={tabIndex}
                  checked={v === "true"}
                  onChange={(e) => set(b.field_library_id, e.target.checked ? "true" : "false")}
                />
                {labelNode}
              </label>
            );
          case "select":
          case "radio": {
            const opts = parseOptions(b.options_json);
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tabIndex}
                  value={v}
                  onChange={(e) => set(b.field_library_id, e.target.value)}
                >
                  <option value="">— Choose —</option>
                  {opts.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </label>
            );
          }
          case "multiselect": {
            // Multi-select serialises to a comma-separated string in
            // string_value for now (the storage column is single-string).
            // A JSON array shape would need a `text_value` route; this
            // is the same convention WorkItemDetailPanel implies but
            // doesn't actually exercise.
            const opts = parseOptions(b.options_json);
            const selected = new Set(v ? v.split(",") : []);
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <select
                  multiple
                  size={Math.min(opts.length || 1, 5)}
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tabIndex}
                  value={Array.from(selected)}
                  onChange={(e) => {
                    const next = Array.from(e.target.selectedOptions).map((o) => o.value);
                    set(b.field_library_id, next.join(","));
                  }}
                >
                  {opts.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </label>
            );
          }
          case "url":
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <input
                  type="url"
                  placeholder="https://…"
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tabIndex}
                  value={v}
                  onChange={(e) => set(b.field_library_id, e.target.value)}
                />
              </label>
            );
          case "user":
            // User-picker custom field — defers to the same workspace
            // users list the Owner / Assigned-to dropdowns use, but the
            // create flyout would need to pass that list down. For the
            // first cut we render a UUID input and let the inline edit
            // form upgrade post-create. Tracked alongside the broader
            // TD-CREATE-CUSTOM-FIELDS work.
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <input
                  type="text"
                  placeholder="user uuid"
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tabIndex}
                  value={v}
                  onChange={(e) => set(b.field_library_id, e.target.value)}
                />
              </label>
            );
          case "textbox":
          default:
            return (
              <label key={b.field_library_id} className="tree_accordion-dense__createflyout-field">
                {labelNode}
                <input
                  type="text"
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tabIndex}
                  value={v}
                  onChange={(e) => set(b.field_library_id, e.target.value)}
                />
              </label>
            );
        }
      })}
    </div>
  );
}

// Translates a CustomFieldValues map + the bindings list into the wire
// shape expected by POST /work-items `custom_fields: [...]`. Each entry
// is routed to the correct *_value column by field_type. Empty strings
// are dropped (no point writing a row that has no value across any
// column). Boolean false maps to the string "false" (the column is text;
// the rules engine reads "true"/"false" as the canonical encoding).
export function customFieldsToWire(
  values: CustomFieldValues,
  bindings: FieldBinding[],
): Array<{
  field_library_id: string;
  string_value?: string;
  number_value?: string;
  text_value?: string;
  date_value?: string;
}> {
  const out: Array<{
    field_library_id: string;
    string_value?: string;
    number_value?: string;
    text_value?: string;
    date_value?: string;
  }> = [];
  for (const b of bindings) {
    const raw = values[b.field_library_id];
    if (raw == null || raw === "") continue;
    const entry: {
      field_library_id: string;
      string_value?: string;
      number_value?: string;
      text_value?: string;
      date_value?: string;
    } = { field_library_id: b.field_library_id };
    switch (b.field_type) {
      case "integer":
      case "decimal":
        entry.number_value = raw;
        break;
      case "richtext":
        entry.text_value = raw;
        break;
      case "date":
        entry.date_value = raw;
        break;
      default:
        entry.string_value = raw;
        break;
    }
    out.push(entry);
  }
  return out;
}
