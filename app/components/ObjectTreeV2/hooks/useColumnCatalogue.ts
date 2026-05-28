"use client";

// useColumnCatalogue — hydrates a `ColumnCatalogue` for ObjectTreeV2's
// `<ColumnPicker>` (Slice 4.5) by fetching the server-side column catalogue
// for a given resource URL.
//
// The catalogue ships built-in columns only: every entry comes from the
// <resourceUrl>/columns endpoint, which exposes the artefactitems.ColumnSpec
// allow-list enriched with Label / Group / DefaultVisible / Addable so the
// picker can render the dropdown directly from server state. Adding a
// column on the backend reaches the UI by editing columns.go alone — no
// parallel frontend constant.
//
// Custom-field columns (artefacts_fields_library entries) are intentionally
// NOT merged in here. The picker can list and toggle them today, but the
// backend ?fields= validator does not accept `field:<uuid>` keys and the
// grid does not have a renderer for custom-field cells. Shipping the merge
// would let a user check a custom-field box, fire a refetch that 400s on
// the unknown wire key, and break the grid for the session.
//
// That follow-on is tracked as TD-OBJECTTREE-PICKER-CUSTOM-FIELDS — see
// docs/c_tech_debt.md. Pay-down path: extend the artefactitems allow-list
// to accept `field:<uuid>` keys, bulk-JOIN artefacts_fields_values into
// the List projection, then build the per-type grid cell renderer.
//
// Pattern mirrors useFieldsForType — apiSite helper, cancelled flag for
// unmount safety, error-string normalisation.

import { useEffect, useState } from "react";
import { apiSite } from "@/app/lib/api";
import type { ColumnCatalogue } from "@/app/components/ObjectTreeV2/plugins/ColumnPicker";

// ── Wire shapes ─────────────────────────────────────────────────────────────

/** One entry returned by GET <resourceUrl>/columns (artefactitems.ColumnSpec). */
interface ColumnSpecWire {
  name: string;
  always_on?: boolean;
  label?: string;
  group?: string;
  default_visible?: boolean;
  addable: boolean;
}

interface ColumnsResponse {
  columns: ColumnSpecWire[];
}

// ── Hook state ──────────────────────────────────────────────────────────────

export interface UseColumnCatalogueState {
  catalogue: ColumnCatalogue | null;
  loading: boolean;
  error: string | null;
}

const INITIAL: UseColumnCatalogueState = {
  catalogue: null,
  loading: false,
  error: null,
};

// ── Hook ────────────────────────────────────────────────────────────────────

/**
 * Build a ColumnCatalogue for the given resource URL. The `prefsKey`
 * scopes localStorage persistence — pass something stable per consumer
 * (e.g. "work-items" or "value-sprint").
 *
 * Returns `catalogue: null` while loading or on error so the picker
 * stays hidden in the action bar (no partial state visible to the user).
 */
export function useColumnCatalogue(
  resourceUrl: string,
  prefsKey: string,
): UseColumnCatalogueState {
  const [state, setState] = useState<UseColumnCatalogueState>(INITIAL);

  useEffect(() => {
    if (!resourceUrl) {
      setState(INITIAL);
      return;
    }
    let cancelled = false;
    setState({ catalogue: null, loading: true, error: null });

    // Strip any pre-existing query string (sidecars carry filters there).
    const cleanResource = resourceUrl.split("?")[0];

    apiSite<ColumnsResponse>(`${cleanResource}/columns`)
      .then((cols) => {
        if (cancelled) return;
        setState({
          catalogue: buildCatalogue(cols.columns, prefsKey),
          loading: false,
          error: null,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          catalogue: null,
          loading: false,
          error: e instanceof Error ? e.message : "Failed to load column catalogue",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [resourceUrl, prefsKey]);

  return state;
}

// ── Catalogue construction ──────────────────────────────────────────────────

function buildCatalogue(
  builtins: ColumnSpecWire[],
  prefsKey: string,
): ColumnCatalogue {
  return {
    columns: builtins.map((c) => ({
      key: c.name,
      label: c.label || c.name,
      // wireKey === key for built-ins — the projection layer expects the
      // same identifier in both the ?fields= param and the response object.
      wireKey: c.name,
      group: c.group || "Other",
      // AlwaysOn fields are non-addable by definition (the user can't turn
      // them off even if the addable flag on the wire says true).
      addable: c.addable && !c.always_on,
      defaultVisible: c.always_on === true || c.default_visible === true,
    })),
    prefsKey,
  };
}
