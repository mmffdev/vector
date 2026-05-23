"use client";

// EditCustomFields — renders the per-type custom-field inputs on the
// inline EDIT form (ArtefactInlineForm). Sibling of CreateCustomFields:
// same field-type vocabulary + visual primitives, but here the values
// are loaded from `GET /{resource}/{id}/field-values` and committed via
// `PUT /{resource}/{id}/field-values` on blur. One section, one input
// per binding, ordered by display position.

import React, { useEffect, useState } from "react";
import { apiSite } from "@/app/lib/api";
import {
  useFieldsForType,
  type FieldBinding,
} from "@/app/components/ObjectTreeV2/hooks/useFieldsForType";

interface FieldValueWire {
  id: string;
  field_library_id: string | null;
  field_name: string;
  label: string;
  field_type: string;
  options_json: string | null;
  string_value: string | null;
  number_value: string | null;
  text_value: string | null;
  date_value: string | null;
}

interface Props {
  artefactId: string;
  artefactTypeId: string;
  // The resource base URL (e.g. "/work-items" or "/portfolio-items"). May
  // carry GET-only query params from the sidecar; we strip them before
  // composing field-values endpoints. Same defensive split as the
  // V2 create flyout.
  resourceUrl: string;
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

function valueFromWire(fv: FieldValueWire): string {
  return fv.string_value ?? fv.number_value ?? fv.text_value ?? fv.date_value ?? "";
}

// Routes a (binding, value) pair into the upsert body shape the backend
// PUT /{resource}/{id}/field-values expects. Mirrors customFieldsToWire
// in the create path.
function toUpsertBody(b: FieldBinding, value: string): Record<string, unknown> {
  const out: Record<string, unknown> = { field_library_id: b.field_library_id };
  switch (b.field_type) {
    case "integer":
    case "decimal":
      out.number_value = value;
      break;
    case "richtext":
      out.text_value = value;
      break;
    case "date":
      out.date_value = value;
      break;
    default:
      out.string_value = value;
      break;
  }
  return out;
}

export function EditCustomFields({ artefactId, artefactTypeId, resourceUrl }: Props) {
  const { bindings, loading: schemaLoading } = useFieldsForType(resourceUrl, artefactTypeId);

  // Local draft map keyed by field_library_id. Seeded once per artefact
  // from the GET /field-values response so re-renders during editing
  // don't blow away in-progress text.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [valuesLoading, setValuesLoading] = useState(false);

  useEffect(() => {
    if (!artefactId) return;
    let cancelled = false;
    setValuesLoading(true);
    const path = resourceUrl.split("?")[0];
    apiSite<{ field_values: FieldValueWire[] }>(`${path}/${artefactId}/field-values`)
      .then((r) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const fv of r.field_values ?? []) {
          if (fv.field_library_id) {
            next[fv.field_library_id] = valueFromWire(fv);
          }
        }
        setDraft(next);
        setValuesLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDraft({});
        setValuesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artefactId, resourceUrl]);

  const commit = (b: FieldBinding, value: string) => {
    const path = resourceUrl.split("?")[0];
    void apiSite(`${path}/${artefactId}/field-values`, {
      method: "PUT",
      body: JSON.stringify([toUpsertBody(b, value)]),
    });
  };

  if (schemaLoading || valuesLoading) {
    return (
      <div className="artefact-inline-form__Field">
        <span className="artefact-inline-form__Field_Label">Custom Fields</span>
        <div className="artefact-inline-form__Field_Stub">Loading…</div>
      </div>
    );
  }
  if (bindings.length === 0) return null;

  return (
    <div className="artefact-inline-form__Field">
      <span className="artefact-inline-form__Field_Label">Custom Fields</span>
      {bindings.map((b) => {
        const v = draft[b.field_library_id] ?? "";
        const setLocal = (next: string) =>
          setDraft((d) => ({ ...d, [b.field_library_id]: next }));
        const commitIfChanged = (next: string) => {
          if (next !== v) commit(b, next);
        };
        const labelNode = (
          <span className="artefact-inline-form__Field_Label" style={{ marginTop: 8 }}>
            {b.label}
            {b.required && <span style={{ color: "var(--danger, #c00)" }}> *</span>}
          </span>
        );

        switch (b.field_type) {
          case "richtext":
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <textarea
                  className="artefact-inline-form__Field_Input"
                  rows={3}
                  value={v}
                  onChange={(e) => setLocal(e.target.value)}
                  onBlur={(e) => commitIfChanged(e.target.value)}
                />
              </label>
            );
          case "integer":
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <input
                  type="number"
                  step={1}
                  className="artefact-inline-form__Field_Input"
                  value={v}
                  onChange={(e) => setLocal(e.target.value)}
                  onBlur={(e) => commitIfChanged(e.target.value)}
                />
              </label>
            );
          case "decimal":
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <input
                  type="number"
                  step="any"
                  className="artefact-inline-form__Field_Input"
                  value={v}
                  onChange={(e) => setLocal(e.target.value)}
                  onBlur={(e) => commitIfChanged(e.target.value)}
                />
              </label>
            );
          case "date":
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <input
                  type="date"
                  className="artefact-inline-form__Field_Input"
                  value={v}
                  onChange={(e) => {
                    setLocal(e.target.value);
                    // Date pickers commit immediately on change — there's
                    // no "type-as-you-go" state worth deferring.
                    commitIfChanged(e.target.value);
                  }}
                />
              </label>
            );
          case "boolean":
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <select
                  className="artefact-inline-form__Field_Input"
                  value={v}
                  onChange={(e) => {
                    setLocal(e.target.value);
                    commitIfChanged(e.target.value);
                  }}
                >
                  <option value="">—</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </label>
            );
          case "select":
          case "radio": {
            const opts = parseOptions(b.options_json);
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <select
                  className="artefact-inline-form__Field_Input"
                  value={v}
                  onChange={(e) => {
                    setLocal(e.target.value);
                    commitIfChanged(e.target.value);
                  }}
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
            const opts = parseOptions(b.options_json);
            const selected = new Set(v ? v.split(",") : []);
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <select
                  multiple
                  size={Math.min(opts.length || 1, 5)}
                  className="artefact-inline-form__Field_Input"
                  value={Array.from(selected)}
                  onChange={(e) => {
                    const next = Array.from(e.target.selectedOptions)
                      .map((o) => o.value)
                      .join(",");
                    setLocal(next);
                    commitIfChanged(next);
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
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <input
                  type="url"
                  placeholder="https://…"
                  className="artefact-inline-form__Field_Input"
                  value={v}
                  onChange={(e) => setLocal(e.target.value)}
                  onBlur={(e) => commitIfChanged(e.target.value)}
                />
              </label>
            );
          case "user":
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <input
                  type="text"
                  placeholder="user uuid"
                  className="artefact-inline-form__Field_Input"
                  value={v}
                  onChange={(e) => setLocal(e.target.value)}
                  onBlur={(e) => commitIfChanged(e.target.value)}
                />
              </label>
            );
          case "textbox":
          default:
            return (
              <label key={b.field_library_id} className="artefact-inline-form__Field">
                {labelNode}
                <input
                  type="text"
                  className="artefact-inline-form__Field_Input"
                  value={v}
                  onChange={(e) => setLocal(e.target.value)}
                  onBlur={(e) => commitIfChanged(e.target.value)}
                />
              </label>
            );
        }
      })}
    </div>
  );
}
