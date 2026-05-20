"use client";

import { useEffect, useState } from "react";
import { workItems, portfolioItems } from "@/app/lib/apiSite";
import { artefactTypesApi, type ArtefactType } from "@/app/lib/artefactTypesApi";
import { PARENT_PREFIX_MAP, type ParentOption } from "./types";

interface UseParentCandidatesParams {
  typePrefix: string | null;
  scope: "work" | "strategy";
  workspaceId: string | null;
}

interface UseParentCandidatesResult {
  candidates: ParentOption[];
  loading: boolean;
}

// Resolves valid parent artefacts for a given type prefix. Backend
// applies workspace + topology scope via ?meg= header forwarding; the
// client just consumes the filtered lists. TODO: derive the prefix
// map from artefact_types.parent_type_id chain so tenant-added types
// flow through without code change (tracked as TD-PARENT-CANDIDATES-DYNAMIC).
export function useParentCandidates({
  typePrefix,
  scope,
  workspaceId,
}: UseParentCandidatesParams): UseParentCandidatesResult {
  const [candidates, setCandidates] = useState<ParentOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!typePrefix) {
      setCandidates([]);
      return;
    }
    const allowedPrefixes = PARENT_PREFIX_MAP[typePrefix.toUpperCase()] ?? [];
    if (allowedPrefixes.length === 0) {
      setCandidates([]);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        const types: ArtefactType[] = await artefactTypesApi.list();
        const allowedIds = types
          .filter((t) => allowedPrefixes.includes(t.prefix.toUpperCase()))
          .map((t) => ({ id: t.id, prefix: t.prefix.toUpperCase() }));
        if (allowedIds.length === 0) {
          if (!cancelled) setCandidates([]);
          return;
        }
        // Same backend handler serves both — workItems for "work" scope,
        // portfolioItems for "strategy" scope. The ?meg= header is added
        // automatically by apiSite based on the active scope context.
        const bundle = scope === "strategy" ? portfolioItems : workItems;
        const queries = allowedIds.map(({ id }) => {
          const qs = new URLSearchParams();
          qs.set("item_type_id", id);
          if (workspaceId) qs.set("workspace_id", workspaceId);
          return bundle.list(qs.toString());
        });
        const responses = await Promise.all(queries);

        const flattened: ParentOption[] = [];
        for (const resp of responses) {
          const r = resp as { items?: unknown[] };
          for (const raw of r.items ?? []) {
            const item = raw as {
              id: string;
              key_num: number;
              type_prefix: string;
              title: string;
            };
            flattened.push({
              id: item.id,
              prefix: item.type_prefix,
              key_num: item.key_num,
              label: `${item.type_prefix}-${item.key_num} — ${item.title}`,
            });
          }
        }
        flattened.sort((a, b) => {
          if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix);
          return a.key_num - b.key_num;
        });
        if (!cancelled) setCandidates(flattened);
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [typePrefix, scope, workspaceId]);

  return { candidates, loading };
}
