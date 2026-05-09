// /api/v2/work-items/relations
//
// GET — read-only payload for the Work Item Relations 3D graph.
//
// Shape: { nodes, edges, meta } — chosen so the client can hand it straight
// to 3d-force-graph. Hub-size on the client is driven by `descendant_count`
// per node (computed server-side via a recursive CTE so 50k+ tenants don't
// have to walk the tree in JS).
//
// Edge sources today:
//   - parent_artefact_id → emits one "parent" edge per child
//
// Future edge sources (PLA-0036, work_item_links table) will add typed
// edges (blocks, duplicates, relates_to, …). The payload shape is already
// edge-typed so the client doesn't change when those land.

import { NextRequest, NextResponse } from "next/server";
import { query, POC_SUBSCRIPTION_ID } from "@/app/lib/v2/db";

export const dynamic = "force-dynamic";

// ─── Wire types ───────────────────────────────────────────────────────────

export type RelationsNode = {
  id: string;
  number: number;
  prefix: string;            // "EP" | "US" | "DE" | "TA" | tenant prefix
  type_name: string;         // "Epic" | "Story" | …
  title: string;
  state_name: string | null;
  state_kind: string | null; // "todo" | "doing" | "done" | "blocked" | …
  parent_id: string | null;
  depth: number;             // 0 = root, 1 = child of a root, …
  descendant_count: number;  // total descendants under this node (drives hub size)
};

export type RelationsEdgeKind = "parent" | "blocks" | "duplicates" | "relates_to";

export type RelationsEdge = {
  source: string;            // node id
  target: string;            // node id
  kind: RelationsEdgeKind;
};

export type RelationsMeta = {
  subscription_id: string;
  generated_at: string;      // ISO-8601
  node_count: number;
  edge_count: number;
  edge_kinds: RelationsEdgeKind[];   // which kinds appear in this payload
  truncated: boolean;        // true if a hard cap was hit
  cap: number;               // the hard cap that would have triggered truncation
};

export type RelationsPayload = {
  nodes: RelationsNode[];
  edges: RelationsEdge[];
  meta: RelationsMeta;
};

// Hard cap to keep the wire payload + client renderer honest. 60k matches
// the Tier-A seed (~55k) plus headroom; tenants past this need server-side
// filtering before rendering. B19.6.1 lifts/refines this once we measure.
const NODE_CAP = 60_000;

// ─── Row shapes ───────────────────────────────────────────────────────────

interface NodeRow {
  id: string;
  number: number;
  prefix: string;
  type_name: string;
  title: string;
  state_name: string | null;
  state_kind: string | null;
  parent_artefact_id: string | null;
  depth: number;
  descendant_count: number;
}

// ─── Handler ──────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  try {
    // Recursive CTE: walk the parent_artefact_id tree once, compute depth and
    // descendant_count for every work-scope artefact in this subscription.
    //
    // depth        — number of parent hops to a root (root = depth 0).
    // descendant_count — total transitive children. Drives hub size on the
    //                client; computing it once on the server is far cheaper
    //                than every client navigating the tree.
    const sql = `
      WITH RECURSIVE
      base AS (
        SELECT
          a.id,
          a.number,
          a.title,
          a.parent_artefact_id,
          at.prefix,
          at.name AS type_name,
          fs.name AS state_name,
          fs.kind AS state_kind
        FROM artefacts a
        JOIN artefact_types at ON at.id = a.artefact_type_id
        LEFT JOIN flow_states fs ON fs.id = a.flow_state_id
        WHERE a.subscription_id = $1
          AND at.scope = 'work'
          AND a.archived_at IS NULL
      ),
      depth AS (
        SELECT id, parent_artefact_id, 0 AS depth
          FROM base
         WHERE parent_artefact_id IS NULL
        UNION ALL
        SELECT b.id, b.parent_artefact_id, d.depth + 1
          FROM base b
          JOIN depth d ON d.id = b.parent_artefact_id
      ),
      descendants AS (
        -- Count descendants by walking the inverse direction: every node
        -- contributes 1 to each of its ancestors' descendant_count.
        SELECT
          ancestor_id,
          COUNT(*)::int AS descendant_count
        FROM (
          WITH RECURSIVE up AS (
            SELECT id AS leaf_id, parent_artefact_id AS ancestor_id
              FROM base
             WHERE parent_artefact_id IS NOT NULL
            UNION ALL
            SELECT u.leaf_id, b.parent_artefact_id
              FROM up u
              JOIN base b ON b.id = u.ancestor_id
             WHERE b.parent_artefact_id IS NOT NULL
          )
          SELECT ancestor_id FROM up
        ) hops
        GROUP BY ancestor_id
      )
      SELECT
        b.id,
        b.number::int                       AS number,
        b.prefix,
        b.type_name,
        b.title,
        b.state_name,
        b.state_kind,
        b.parent_artefact_id,
        COALESCE(d.depth, 0)::int           AS depth,
        COALESCE(dc.descendant_count, 0)::int AS descendant_count
      FROM base b
      LEFT JOIN depth        d  ON d.id  = b.id
      LEFT JOIN descendants  dc ON dc.ancestor_id = b.id
      ORDER BY b.prefix, b.number
      LIMIT $2
    `;
    const { rows } = await query<NodeRow>(sql, [POC_SUBSCRIPTION_ID, NODE_CAP + 1]);

    const truncated = rows.length > NODE_CAP;
    const kept = truncated ? rows.slice(0, NODE_CAP) : rows;
    const keptIds = new Set(kept.map(r => r.id));

    const nodes: RelationsNode[] = kept.map(r => ({
      id: r.id,
      number: r.number,
      prefix: r.prefix,
      type_name: r.type_name,
      title: r.title,
      state_name: r.state_name,
      state_kind: r.state_kind,
      parent_id: r.parent_artefact_id,
      depth: r.depth,
      descendant_count: r.descendant_count,
    }));

    // Parent edges only (today). Skip dangling refs caused by truncation —
    // the client should never receive an edge whose endpoint isn't in `nodes`.
    const edges: RelationsEdge[] = [];
    for (const n of nodes) {
      if (n.parent_id && keptIds.has(n.parent_id)) {
        edges.push({ source: n.parent_id, target: n.id, kind: "parent" });
      }
    }

    const meta: RelationsMeta = {
      subscription_id: POC_SUBSCRIPTION_ID,
      generated_at: new Date().toISOString(),
      node_count: nodes.length,
      edge_count: edges.length,
      edge_kinds: ["parent"],
      truncated,
      cap: NODE_CAP,
    };

    return NextResponse.json<RelationsPayload>({ nodes, edges, meta });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
