"use client";

// useFieldsForType — fetches the per-type custom-field schema from the
// backend (GET /work-items/types/{typeId}/fields OR the portfolio-items
// sibling). Returns the bindings ordered by display position, so the
// caller can render inputs left-to-right / top-to-bottom without
// re-sorting. The endpoint is identical between work + strategy scopes
// because artefactitems is scope-parameterised; we route by stripping
// any query string off `resourceUrl` and tacking on `/types/<id>/fields`.

import { useEffect, useState } from "react";
import { apiSite } from "@/app/lib/api";

export interface FieldBinding {
  field_library_id: string;
  field_name: string;
  label: string;
  // textbox | richtext | integer | decimal | date | boolean | select |
  // multiselect | radio | user | url — matches artefacts_fields_library.field_type
  field_type: string;
  // JSON-encoded array; only present for select/multiselect/radio.
  options_json: string | null;
  position: number;
  required: boolean;
  default_value: string | null;
}

interface State {
  bindings: FieldBinding[];
  loading: boolean;
  error: string | null;
}

const INITIAL: State = { bindings: [], loading: false, error: null };

export function useFieldsForType(
  resourceUrl: string,
  typeId: string | null,
): State {
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    if (!typeId) {
      setState(INITIAL);
      return;
    }
    let cancelled = false;
    setState({ bindings: [], loading: true, error: null });
    // Strip any pre-existing query params off resourceUrl (e.g. /risk's
    // sidecar carries `?item_type_id=<uuid>` for GET filters). Mirrors
    // the same defensive split p_ObjectTree's POST URL builder uses.
    const path = resourceUrl.split("?")[0];
    apiSite<{ fields: FieldBinding[] }>(`${path}/types/${encodeURIComponent(typeId)}/fields`)
      .then((r) => {
        if (cancelled) return;
        setState({ bindings: r.fields ?? [], loading: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({
          bindings: [],
          loading: false,
          error: e instanceof Error ? e.message : "Failed to load fields",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [resourceUrl, typeId]);

  return state;
}
