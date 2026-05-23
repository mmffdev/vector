"use client";

import { useEffect, useState } from "react";
import { workItems, portfolioItems } from "@/app/lib/apiSite";
import { artefactTypesApi, type ArtefactType } from "@/app/lib/artefactTypesApi";
import { PARENT_PREFIX_MAP, type ParentOption } from "./types";

interface UseParentCandidatesParams {
  typePrefix: string | null;
  // Kept for back-compat / call sites that still pass it, but no longer
  // used to pick a single endpoint — the hook now always queries BOTH
  // scopes when the allowed-parent map crosses the work↔strategy
  // boundary (e.g. Story → Feature, Epic → Feature).
  scope: "work" | "strategy";
  workspaceId: string | null;
}

interface UseParentCandidatesResult {
  // Flat list, sorted by prefix then key. Kept for back-compat with
  // call sites that don't want the grouping.
  candidates: ParentOption[];
  // Grouped buckets. Consumers that render an <optgroup>-style picker
  // (the inline edit form + create flyout) use these directly so the
  // user can see Strategic vs Execution candidates at a glance.
  strategic: ParentOption[];
  execution: ParentOption[];
  loading: boolean;
}

// Resolves the set of artefact types this type may legally parent under.
//
// Priority order (most-specific data wins so tenants can grow into the
// model without losing the static safety net):
//
//   1. `layer_depth` model — if the editing type has a layer_depth, the
//      allowed parents are every type whose layer_depth is strictly less.
//      Crosses scope freely (strategy types sit above execution types
//      because their depths are smaller).
//   2. `parent_type_id` chain — walk upward from parent_type_id,
//      collecting every ancestor. Single-parent-per-type; works for a
//      strict ladder but can't express Story → Epic OR Feature.
//   3. Static `PARENT_PREFIX_MAP` fallback. Keeps the legacy fixed
//      hierarchy working for tenants that haven't populated the model.
//
// Each allowed type id is then queried against its scope-appropriate
// endpoint (work types → /work-items; strategy types → /portfolio-items).
// apiSite() forwards ?meg= on GETs so the topology clamp comes for free.
function resolveAllowedTypes(
  editing: ArtefactType,
  allTypes: ArtefactType[],
): ArtefactType[] {
  // (1) layer_depth model — most expressive.
  if (editing.layer_depth != null) {
    const myDepth = editing.layer_depth;
    return allTypes.filter(
      (t) => t.layer_depth != null && t.layer_depth < myDepth && t.id !== editing.id,
    );
  }
  // (2) parent_type_id chain — walk upward.
  if (editing.parent_type_id != null) {
    const byId = new Map(allTypes.map((t) => [t.id, t]));
    const visited = new Set<string>();
    const out: ArtefactType[] = [];
    let cursorId: string | null = editing.parent_type_id;
    while (cursorId && !visited.has(cursorId)) {
      visited.add(cursorId);
      const node = byId.get(cursorId);
      if (!node) break;
      out.push(node);
      cursorId = node.parent_type_id ?? null;
    }
    return out;
  }
  // (3) Static fallback for tenants that haven't populated the model.
  const allowedPrefixes = PARENT_PREFIX_MAP[editing.prefix.toUpperCase()] ?? [];
  return allTypes.filter((t) =>
    allowedPrefixes.includes(t.prefix.toUpperCase()),
  );
}

export function useParentCandidates({
  typePrefix,
  workspaceId,
}: UseParentCandidatesParams): UseParentCandidatesResult {
  const [strategic, setStrategic] = useState<ParentOption[]>([]);
  const [execution, setExecution] = useState<ParentOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!typePrefix) {
      setStrategic([]);
      setExecution([]);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const types: ArtefactType[] = await artefactTypesApi.list();
        const editing = types.find(
          (t) => t.prefix.toUpperCase() === typePrefix.toUpperCase(),
        );
        if (!editing) {
          if (!cancelled) {
            setStrategic([]);
            setExecution([]);
          }
          return;
        }
        const allowedTypes = resolveAllowedTypes(editing, types);
        if (allowedTypes.length === 0) {
          if (!cancelled) {
            setStrategic([]);
            setExecution([]);
          }
          return;
        }

        // Partition by scope so each id is routed to the endpoint that
        // can actually return it. apiSite() forwards ?meg= on GETs so
        // the topology clamp comes for free on both endpoints.
        const runQuery = (t: ArtefactType) => {
          const qs = new URLSearchParams();
          qs.set("item_type_id", t.id);
          if (workspaceId) qs.set("workspace_id", workspaceId);
          const bundle = t.scope === "strategy" ? portfolioItems : workItems;
          return bundle.list(qs.toString()).then((resp) => ({
            scope: t.scope,
            resp,
          })).catch(() => ({ scope: t.scope, resp: { items: [] as unknown[] } }));
        };

        const results = await Promise.all(allowedTypes.map(runQuery));

        const strat: ParentOption[] = [];
        const exec: ParentOption[] = [];
        for (const { scope: typeScope, resp } of results) {
          const r = resp as { items?: unknown[] };
          for (const raw of r.items ?? []) {
            const item = raw as {
              id: string;
              key_num: number;
              type_prefix: string;
              title: string;
            };
            const opt: ParentOption = {
              id: item.id,
              prefix: item.type_prefix,
              key_num: item.key_num,
              label: `${item.type_prefix}-${item.key_num} — ${item.title}`,
            };
            if (typeScope === "strategy") strat.push(opt);
            else exec.push(opt);
          }
        }
        const cmp = (a: ParentOption, b: ParentOption) => {
          if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
          return a.key_num - b.key_num;
        };
        strat.sort(cmp);
        exec.sort(cmp);
        if (!cancelled) {
          setStrategic(strat);
          setExecution(exec);
        }
      } catch {
        if (!cancelled) {
          setStrategic([]);
          setExecution([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [typePrefix, workspaceId]);

  // Back-compat flat list — strategic above execution, each internally
  // sorted, matches the visual order of the grouped renderer.
  const candidates = [...strategic, ...execution];

  return { candidates, strategic, execution, loading };
}
