// PLA-0054 / story 00592 — sidecar slot → UUID resolver.
//
// Page sidecars (p_wizard_*.json) reference artefact types by their
// project-locked slot ("artefact_type_slot": "wrk_risk"). At mount
// time, the page resolves slot → per-tenant UUID via the catalogue
// and substitutes the resolved UUID into the request URL.
//
// The resolver is pure so it composes cleanly with both context-aware
// React code (catalogue from useArtefactTypeCatalogue) and pre-React
// callers (tests, server-side wizard preprocessing).
//
// Currently handles two cases:
//   1. Sidecar field `artefact_type_slot: "wrk_X"` → drop the field
//      and add `artefact_type_id: "<uuid>"` to the same parent object.
//   2. Sidecar field `resourceUrl: "/work-items?item_type=wrk_X"` →
//      rewrite the param to `?item_type_id=<uuid>`. This bridges the
//      existing wizard JSONs that hardcoded the slug; new sidecars
//      should prefer the dedicated `artefact_type_slot` field.

import type { ArtefactType } from "@/app/lib/artefactTypesApi";

type Catalogue = Pick<ArtefactType, "id" | "slot">[];

const SLOTS = new Set([
  "wrk_epic",
  "wrk_story",
  "wrk_defect",
  "wrk_task",
  "wrk_risk",
]);

function idForSlot(slot: string, catalogue: Catalogue): string | null {
  for (const t of catalogue) {
    if (t.slot === slot) return t.id;
  }
  return null;
}

function rewriteResourceUrl(url: string, catalogue: Catalogue): string {
  // Looks for `item_type=<slug-or-slot>` and rewrites to
  // `item_type_id=<uuid>` when the value is a known slot. Anything
  // else is left untouched.
  const tryReplace = (param: string, replacement: string): string | null => {
    const re = new RegExp(`([?&])${param}=([^&]+)`);
    const m = url.match(re);
    if (!m) return null;
    const raw = decodeURIComponent(m[2]);
    // Accept either the full slot (wrk_risk) or its short form (risk).
    const slot = SLOTS.has(raw) ? raw : SLOTS.has(`wrk_${raw}`) ? `wrk_${raw}` : null;
    if (slot == null) return null;
    const id = idForSlot(slot, catalogue);
    if (id == null) return null;
    return url.replace(re, `$1${replacement}=${encodeURIComponent(id)}`);
  };
  return tryReplace("item_type", "item_type_id") ?? url;
}

export function resolveSlotRefs<T extends Record<string, unknown>>(
  sidecar: T,
  catalogue: Catalogue,
): T {
  // Deep-copy so callers can pass frozen JSON imports.
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(sidecar));

  const walk = (node: unknown): unknown => {
    if (node == null || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    const obj = node as Record<string, unknown>;
    // (1) artefact_type_slot → artefact_type_id rewrite.
    if (typeof obj.artefact_type_slot === "string") {
      const id = idForSlot(obj.artefact_type_slot, catalogue);
      if (id != null) {
        obj.artefact_type_id = id;
      }
      delete obj.artefact_type_slot;
    }
    // (2) resourceUrl param rewrite.
    if (typeof obj.resourceUrl === "string") {
      obj.resourceUrl = rewriteResourceUrl(obj.resourceUrl, catalogue);
    }
    for (const k of Object.keys(obj)) {
      obj[k] = walk(obj[k]);
    }
    return obj;
  };

  return walk(out) as T;
}
