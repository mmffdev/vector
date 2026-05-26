"use client";

// useScopedTopologyNodes — single source of truth for "topology nodes
// the active actor is allowed to assign to / pick from".
//
// Backed by `sentinel_grants` (from useSentinel()), which is the wire
// payload of `GET /_site/topology/grants/me` (handler
// `topology.Service.ListMyGrants`). That handler is the only path that
// applies the per-actor grant filter — it:
//
//   - forks on `actorRoleID == SystemGrpGlobalID` and ships a synthetic
//     admin grant on every live node in the subscription (gadmin);
//   - returns real `users_roles_topology_nodes` rows joined to live
//     `topology_nodes` for everyone else, with the descend-inheritance
//     contract already baked into the surface (a grant on Insurance
//     gives the picker B2B Insurance, B2C Insurance, etc.);
//   - promotes orphan grants to virtual roots so a user with a deep-
//     node-only grant still renders a coherent tree.
//
// Every UI surface that needs to ask "which topology nodes can this
// user reach?" — node-picker dropdowns in the artefact Create / Edit /
// Duplicate forms, the Rail-2 scope panels, future bulk-move dialogs —
// MUST source from this hook. Calling `GET /_site/topology/tree`
// directly leaks the entire workspace topology to non-gadmin actors
// because that endpoint is not per-actor clamped (it's the canvas
// admin view).
//
// Companion to the backend `Resolver.GrantOnNode` (sentinel/resolver.go)
// which holds the same gadmin short-circuit on the request-time clamp
// path. Frontend list + backend write-gate must agree on what counts as
// "reachable" — both read from the same SystemGrpGlobalID + grant-row
// rule.

import { useMemo } from "react";
import { useSentinel } from "@/app/sentinel";
import type { SentinelGrant } from "@/app/sentinel/types";
import { byPosition, walkTopology } from "@/app/lib/shared/topology/walker";

/**
 * Minimal node shape consumed by `<select>` dropdowns — keys match the
 * legacy `OrgNode` fields that the call sites already read (`id`,
 * `name`, `label_override`) so the migration is a pure source swap.
 * Walk-ordered (siblings together, parents before children).
 */
export interface ScopedNode {
  /** topology_nodes.id (== SentinelGrant.node_id). */
  id: string;
  /** Live node display name. */
  name: string;
  /** User-set label override, or null if absent. */
  label_override: string | null;
  /** The workspace this node belongs to — populated by ListMyGrants. */
  workspace_id: string | null;
  /** Parent topology node, or null at workspace root. */
  parent_id: string | null;
  /** Depth in the walk (0 = workspace root, 1 = direct child, …). */
  depth: number;
}

/**
 * Spine-render-ready row for the Rail-2 scope panels. Carries the
 * original `SentinelGrant` plus the walk metadata the SVG connectors
 * need. Kept separate from `ScopedNode` so dropdown consumers don't
 * accidentally re-render on depth/isLast changes (which don't affect
 * `<option>` rendering).
 */
export interface ScopedTreeRow {
  grant: SentinelGrant;
  label: string;
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  ancestorMoreChildren: boolean[];
}

interface GrantNode {
  id: string;
  parent_id: string | null;
  position: number;
  grant: SentinelGrant;
}

function labelOf(g: SentinelGrant): string {
  return g.label_override?.trim() || g.name || g.node_id;
}

/**
 * useScopedTopologyNodes — call from any node-picker UI.
 *
 * Returns the same walk-ordered list in two shapes — `nodes` for
 * `<select>` dropdowns (legacy-OrgNode-compatible keys), `rows` for
 * tree renderers that need depth + spine flags. Both views are
 * derived from one `walkTopology` pass so they stay in lockstep on
 * sort / orphan-handling tweaks.
 *
 * `loading` is the Sentinel boot flag — true until grants have arrived
 * from `/topology/grants/me`. Consumers typically render an empty
 * dropdown while loading; the spinner already lives upstream in the
 * scope rail.
 */
export function useScopedTopologyNodes(): {
  nodes: ScopedNode[];
  rows: ScopedTreeRow[];
  loading: boolean;
} {
  const { sentinel_grants: grants, sentinel_loading: loading } = useSentinel();

  return useMemo(() => {
    const wrapped: GrantNode[] = grants.map((g) => ({
      id: g.node_id,
      parent_id: g.parent_id ?? null,
      position: g.position ?? 0,
      grant: g,
    }));
    const { rows: walked } = walkTopology(wrapped, {
      collapsed: new Set(),
      sort: byPosition,
    });

    const rows: ScopedTreeRow[] = walked.map((r) => ({
      grant: r.node.grant,
      label: labelOf(r.node.grant),
      depth: r.depth,
      isLast: r.isLast,
      hasChildren: r.hasChildren,
      // Match the existing rail-panel slice: depth-0 rows drop the
      // first ancestor entry so the spine offsets line up with the
      // workspace-row indent.
      ancestorMoreChildren: r.depth > 0 ? r.ancestorMoreChildren.slice(1) : [],
    }));

    const nodes: ScopedNode[] = walked.map((r) => ({
      id: r.node.grant.node_id,
      name: r.node.grant.name ?? "",
      label_override: r.node.grant.label_override ?? null,
      workspace_id: r.node.grant.workspace_id ?? null,
      parent_id: r.node.grant.parent_id ?? null,
      depth: r.depth,
    }));

    return { nodes, rows, loading };
  }, [grants, loading]);
}
