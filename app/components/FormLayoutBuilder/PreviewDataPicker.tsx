"use client";

// PreviewDataPicker — the live-data control at the top of the FLB preview.
// It lists real artefacts of the previewed type (clamp-scoped), and on select
// loads that artefact's values and hands a `valueFor(fieldKey)` resolver back
// to the preview so each placed cell shows the artefact's real value.
//
// SCOPING (SERVER IS THE GATE): the list call passes ONLY item_type_id. The
// sentinel topology clamp (FocusNodeID + AllowedSubtreeIDs, resolved
// server-side) scopes the result to the current node + allowed subtree,
// fail-closed. We NEVER pass ?meg= — it is cosmetic URL transport, not the
// scope authority (CLAUDE.md tracing-authority corollary).
//
// VALUES live in two homes (3-layer field model): core → typed artefacts
// columns (via workItems.get), custom → EAV (via workItems.getFieldValues).
// The descriptor's valueLocation routes each fieldKey; see previewValues.ts.

import React, { useEffect, useState } from "react";
import { workItems } from "@/app/lib/apiSite";
import type { CoreFieldDescriptor } from "@/app/lib/formLayoutsApi";
import {
  buildCustomValueMap,
  previewValueFor,
  type FieldValueWire,
} from "./previewValues";

// Soft cap on the dropdown list. If a type has more artefacts than this, we
// show the first N and surface that the list is truncated (never silently).
const LIST_CAP = 100;

interface ArtefactListItem {
  id: string;
  title: string;
}

export interface PreviewDataPickerProps {
  artefactTypeId: string;
  /** Human label for the type, e.g. "Defect" — for the prompt + empty hint. */
  typeLabel: string;
  /** Field descriptors (carry valueLocation) so values route to the right home. */
  fieldByKey: Map<string, CoreFieldDescriptor>;
  /**
   * Called whenever the resolved value map changes (artefact picked / cleared).
   * `valueFor` returns the display value for a placed cell's fieldKey, or "" —
   * undefined-vs-"" is handled by the caller (no selection → undefined → the
   * preview falls back to placeholder).
   */
  onValuesChange: (valueFor: ((fieldKey: string) => string) | null) => void;
}

export function PreviewDataPicker({
  artefactTypeId,
  typeLabel,
  fieldByKey,
  onValuesChange,
}: PreviewDataPickerProps) {
  const [items, setItems] = useState<ArtefactListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [valuesLoading, setValuesLoading] = useState(false);

  // Lazy load the artefact list on mount (this component only mounts when the
  // preview pane opens). item_type_id only — clamp scopes the rest.
  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setListError(false);
    workItems
      .list(`item_type_id=${encodeURIComponent(artefactTypeId)}&limit=${LIST_CAP}`)
      .then((res) => {
        if (cancelled) return;
        const raw = (res.items ?? []) as Array<Record<string, unknown>>;
        const mapped: ArtefactListItem[] = raw.map((r) => ({
          id: String(r.id ?? ""),
          title: String(r.title ?? r.id ?? "Untitled"),
        }));
        setItems(mapped);
        setTruncated((res.total ?? mapped.length) > mapped.length);
        setListLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setListError(true);
          setListLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artefactTypeId]);

  // On select, load the artefact's core row + custom EAV values in parallel,
  // build a resolver, and hand it up. Clearing the selection hands up null.
  const handleSelect = (id: string) => {
    setSelectedId(id);
    if (!id) {
      onValuesChange(null);
      return;
    }
    setValuesLoading(true);
    Promise.all([
      workItems.get(id).catch(() => null),
      workItems.getFieldValues(id).catch(() => ({ field_values: [] as unknown[] })),
    ])
      .then(([coreRaw, fvRaw]) => {
        const coreItem = (coreRaw ?? null) as Record<string, unknown> | null;
        const wire = ((fvRaw?.field_values ?? []) as FieldValueWire[]) ?? [];
        const customValues = buildCustomValueMap(wire);
        const valueFor = (fieldKey: string): string =>
          previewValueFor(fieldKey, fieldByKey.get(fieldKey), coreItem, customValues);
        onValuesChange(valueFor);
      })
      .finally(() => setValuesLoading(false));
  };

  return (
    <div className="flb-preview__Picker" role="group" aria-label="Preview with real data">
      {listError ? (
        <p className="flb-preview__Picker_Hint" role="status">
          Couldn&apos;t load {typeLabel} artefacts to preview.
        </p>
      ) : listLoading ? (
        <p className="flb-preview__Picker_Hint" role="status">
          Loading {typeLabel} artefacts…
        </p>
      ) : items.length === 0 ? (
        <p className="flb-preview__Picker_Hint">
          No {typeLabel} artefacts in this scope yet — showing an empty form.
        </p>
      ) : (
        <>
          <label className="flb-preview__Picker_Label" htmlFor="flb-preview-picker">
            Preview with a real {typeLabel}
          </label>
          <select
            id="flb-preview-picker"
            className="flb-preview__Picker_Select"
            value={selectedId}
            onChange={(e) => handleSelect(e.target.value)}
          >
            <option value="">— Select a {typeLabel} to preview —</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>
                {it.title}
              </option>
            ))}
          </select>
          {valuesLoading && (
            <span className="flb-preview__Picker_Hint" role="status">
              Loading values…
            </span>
          )}
          {truncated && (
            <span className="flb-preview__Picker_Hint">
              Showing the first {LIST_CAP} — refine in the list to find others.
            </span>
          )}
        </>
      )}
    </div>
  );
}
