"use client";

import { useEffect, useState } from "react";
import { workItems, portfolioItems } from "@/app/lib/apiSite";
import { artefactTypesApi, type ArtefactType } from "@/app/lib/artefactTypesApi";
import { type ParentOption } from "./types";

interface UseParentCandidatesParams {
  artefactId?: string | null;
  typePrefix: string | null;
  resourceUrl?: string;
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
// Two scope-driven tiers (PARENT_PREFIX_MAP retired — the rule now lives on the
// type as `execution_parent_slots`, backfilled from the old map by migration):
//
//   WORK scope → resolve `execution_parent_slots` to live types. Each entry is
//     EITHER a slot handle (matches some type's `slot`) OR a prefix fallback
//     (matches some type's `prefix`) when the parent type carries no slot. The
//     live backfill stored the literal PREFIX "FE" for Feature because the
//     Feature strategy type has slot=NULL — so a Story's slots look like
//     ["FE","wrk_epic"]. We MUST resolve slot-first-then-prefix or the Feature
//     parent silently drops from a Story's candidates (a real bug). We build
//     BOTH a slot map and a prefix map and try them in that order.
//
//   STRATEGY scope → walk the `parent_type_id` chain upward (the ladder).
//
// Each allowed type id is then queried against its scope-appropriate endpoint
// (work types → /work-items; strategy types → /portfolio-items). apiSite()
// forwards ?meg= on GETs so the topology clamp comes for free.
export function resolveAllowedTypes(
  editing: ArtefactType,
  allTypes: ArtefactType[],
): ArtefactType[] {
  // WORK scope — resolve execution_parent_slots, slot-first-then-prefix.
  if (editing.scope === "work") {
    const slots = editing.execution_parent_slots ?? [];
    if (slots.length === 0) return [];
    const bySlot = new Map(
      allTypes.filter((t) => t.slot).map((t) => [t.slot as string, t]),
    );
    const byPrefix = new Map(
      allTypes.map((t) => [t.prefix.toUpperCase(), t]),
    );
    const out: ArtefactType[] = [];
    const seen = new Set<string>();
    for (const entry of slots) {
      // Try a slot match first; fall back to a prefix match (the migration's
      // documented fallback for parent types whose slot is NULL, e.g. Feature).
      const t = bySlot.get(entry) ?? byPrefix.get(entry.toUpperCase());
      if (t && t.id !== editing.id && !seen.has(t.id)) {
        seen.add(t.id);
        out.push(t);
      }
    }
    return out;
  }
  // STRATEGY scope — walk the parent_type_id chain upward.
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
  return [];
}

function pickBundle(resourceUrl?: string) {
  if (resourceUrl?.includes("/portfolio-items")) return portfolioItems;
  return workItems;
}

function addUniqueOption(list: ParentOption[], opt: ParentOption): void {
  if (list.some((existing) => existing.id === opt.id)) return;
  list.push(opt);
}

export function useParentCandidates({
  artefactId,
  typePrefix,
  workspaceId,
  resourceUrl,
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
        const typeByPrefix = new Map(
          types.map((t) => [t.prefix.toUpperCase(), t]),
        );

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

        const [results, ancestorResult] = await Promise.all([
          Promise.all(allowedTypes.map(runQuery)),
          artefactId
            ? pickBundle(resourceUrl)
                .listAncestors(artefactId)
                .catch(() => ({ ancestors: [] as unknown[] }))
            : Promise.resolve({ ancestors: [] as unknown[] }),
        ]);

        const strat: ParentOption[] = [];
        const exec: ParentOption[] = [];
        const ancestors =
          (ancestorResult as { ancestors?: unknown[] }).ancestors ?? [];
        const immediateParent = ancestors[0] as
          | {
              id?: unknown;
              type_prefix?: unknown;
              key_num?: unknown;
              title?: unknown;
            }
          | undefined;
        if (
          immediateParent &&
          typeof immediateParent.id === "string" &&
          typeof immediateParent.type_prefix === "string" &&
          typeof immediateParent.key_num === "number" &&
          typeof immediateParent.title === "string"
        ) {
          const opt: ParentOption = {
            id: immediateParent.id,
            prefix: immediateParent.type_prefix,
            key_num: immediateParent.key_num,
            label: `${immediateParent.type_prefix}-${immediateParent.key_num} — ${immediateParent.title}`,
          };
          const parentType = typeByPrefix.get(
            immediateParent.type_prefix.toUpperCase(),
          );
          if (parentType?.scope === "strategy") addUniqueOption(strat, opt);
          else addUniqueOption(exec, opt);
        }
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
            if (typeScope === "strategy") addUniqueOption(strat, opt);
            else addUniqueOption(exec, opt);
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
  }, [artefactId, typePrefix, workspaceId, resourceUrl]);

  // Back-compat flat list — strategic above execution, each internally
  // sorted, matches the visual order of the grouped renderer.
  const candidates = [...strategic, ...execution];

  return { candidates, strategic, execution, loading };
}
