"use client";

// <FormLayoutRuntime> — renders a saved form layout as an editable form
// (runtime mode). This is the consumer half of the WYSIWYG contract: the
// SAME row/cell geometry the builder produced, now with real field
// inputs bound to the artefact's values.
//
// PoC wiring note (2026-05-30): per the design spec's "narrowly wired"
// scope, this resolves the layout by (node, type) — the current version —
// rather than the stamped artefacts_id_form_layout ref. The write side
// already stamps the ref (artefactitems create path); exposing it on the
// read DTO so the runtime can pin the EXACT stamped version is tracked as
// TD-FORMLAYOUT-READSIDE-REF (docs/c_tech_debt.md). Current-version
// resolution is correct for the PoC demo and degrades gracefully.
//
// Carried-fields fallback: after rendering placed cells, any custom field
// that HAS a value but is NOT placed in the layout renders in an appended
// "Carried fields" section — so a story authored on Insurance never hides
// data when viewed under a layout that omits some of Insurance's fields.

import React, { useEffect, useMemo, useState } from "react";
import { apiSite } from "@/app/lib/api";
import {
  getCurrentLayout,
  getCoreFields,
  type CoreFieldDescriptor,
  type FormLayout,
} from "@/app/lib/formLayoutsApi";
import { FormLayoutRenderer, type RenderCellArgs } from "./FormLayoutRenderer";
import { valueFromWire, type FieldValueWire } from "./previewValues";

export interface FormLayoutRuntimeProps {
  artefactId: string;
  topologyNodeId: string;
  artefactTypeId: string;
  /** Resource base, e.g. "/work-items". */
  resourceUrl: string;
  /** Core values (title, owner, etc.) already loaded by the host form. */
  coreValues: Record<string, unknown>;
  /** Host callback when a core field changes (host owns the PATCH). */
  onCoreChange?: (patch: Record<string, unknown>) => void;
  /** Render when no saved layout exists for (node, type). */
  fallback: React.ReactNode;
}

export function FormLayoutRuntime({
  artefactId,
  topologyNodeId,
  artefactTypeId,
  resourceUrl,
  coreValues,
  onCoreChange,
  fallback,
}: FormLayoutRuntimeProps) {
  const [layout, setLayout] = useState<FormLayout | null>(null);
  const [descriptors, setDescriptors] = useState<CoreFieldDescriptor[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [noLayout, setNoLayout] = useState(false);

  // Resolve layout + field catalogue + the artefact's custom values.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const path = resourceUrl.split("?")[0];
    Promise.all([
      getCurrentLayout(topologyNodeId, artefactTypeId),
      getCoreFields(artefactTypeId),
      apiSite<{ field_values: FieldValueWire[] }>(`${path}/${artefactId}/field-values`).catch(
        () => ({ field_values: [] as FieldValueWire[] }),
      ),
    ])
      .then(([lay, cat, vals]) => {
        if (cancelled) return;
        if (!lay) { setNoLayout(true); setLoading(false); return; }
        const valMap: Record<string, string> = {};
        for (const fv of vals.field_values ?? []) {
          if (fv.field_library_id) valMap[`custom:${fv.field_library_id}`] = valueFromWire(fv);
        }
        setLayout(lay);
        setDescriptors(cat);
        setValues(valMap);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setNoLayout(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [artefactId, topologyNodeId, artefactTypeId, resourceUrl]);

  const descByKey = useMemo(() => {
    const m = new Map<string, CoreFieldDescriptor>();
    for (const d of descriptors) m.set(d.fieldKey, d);
    return m;
  }, [descriptors]);

  // Keys placed somewhere in the layout — used to compute carried fields.
  const placedKeys = useMemo(() => {
    const s = new Set<string>();
    if (!layout) return s;
    for (const r of layout.doc.rows) for (const c of r.cells) if (c.fieldKey) s.add(c.fieldKey);
    return s;
  }, [layout]);

  // Carried fields: custom values present on the artefact but absent from
  // the layout. (Core fields aren't "carried" — they always have a home.)
  const carried = useMemo(() => {
    return Object.keys(values).filter((k) => k.startsWith("custom:") && !placedKeys.has(k) && values[k]);
  }, [values, placedKeys]);

  if (loading) return <div className="flb-runtime__Loading">Loading form…</div>;
  if (noLayout || !layout) return <>{fallback}</>;

  const getValue = (key: string): string => {
    if (key.startsWith("custom:")) return values[key] ?? "";
    const v = coreValues[key];
    return v == null ? "" : String(v);
  };

  const setValue = (key: string, next: string) => {
    if (key.startsWith("custom:")) {
      setValues((d) => ({ ...d, [key]: next }));
      // PoC: custom-field write-back reuses the host's EAV PUT through the
      // edit form; here we keep it display+local for the demo. Full
      // bidirectional commit is the runtime-adoption follow-up.
    } else {
      onCoreChange?.({ [key]: next });
    }
  };

  const renderCell = ({ cell }: RenderCellArgs) => {
    if (!cell.fieldKey) return null;
    const d = descByKey.get(cell.fieldKey);
    return (
      <RuntimeField
        label={d?.label ?? cell.fieldKey}
        dataType={d?.dataType ?? "text"}
        value={getValue(cell.fieldKey)}
        onCommit={(v) => setValue(cell.fieldKey!, v)}
      />
    );
  };

  return (
    <div className="flb-runtime">
      <FormLayoutRenderer rows={layout.doc.rows} renderCell={renderCell} className="flb-runtime-grid" />

      {carried.length > 0 && (
        <section className="flb-runtime__Carried">
          <h4 className="flb-runtime__Carried_Title">Carried fields</h4>
          <p className="flb-runtime__Carried_Hint">
            These fields hold values from another team's layout and aren&apos;t placed in this one.
          </p>
          <div className="flb-runtime__Carried_List">
            {carried.map((k) => (
              <RuntimeField
                key={k}
                label={descByKey.get(k)?.label ?? k}
                dataType={descByKey.get(k)?.dataType ?? "text"}
                value={values[k] ?? ""}
                onCommit={(v) => setValue(k, v)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// RuntimeField — minimal input dispatcher for the PoC. Mirrors the
// data-type vocabulary used by EditCustomFields without pulling in its
// full TipTap stack (kept light for the demo; richtext shows a textarea).
function RuntimeField({
  label,
  dataType,
  value,
  onCommit,
}: {
  label: string;
  dataType: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = () => { if (draft !== value) onCommit(draft); };
  const isMultiline = dataType === "richtext" || dataType === "textarea";

  return (
    <label className={"flb-runtime__Field" + (isMultiline ? " flb-runtime__Field-multiline" : "")}>
      <span className="flb-runtime__Field_Label">{label}</span>
      {isMultiline ? (
        <textarea
          className="flb-runtime__Field_Input flb-runtime__Field_Input-area"
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          type={dataType === "integer" || dataType === "decimal" ? "number" : dataType === "date" ? "date" : "text"}
          className="flb-runtime__Field_Input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
        />
      )}
    </label>
  );
}
