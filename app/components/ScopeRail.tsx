"use client";

// PLA-0042 / PLA-0043 PoC — Sidebar-rail scope picker. Replaces the
// header-mounted dropdown with a permanent vertical rail (single
// BsMap icon) that toggles a full-height flyout showing the topology
// tree. Toggle-only dismiss for the PoC: click the icon again to
// close (no outside-click, no Esc).
//
// Selection is intentionally NOT wired yet — the flyout renders the
// tree so we can validate the visual + open/close behaviour first.
//
// Tree spine: SVG elbow / T / through-line geometry mirrors
// TopologyTreeFlyout so the visual vocabulary matches the canvas
// tree exactly. Lightweight port — no DnD, no inline rename, no
// menu, no archive triangle (those belong on the topology page).

import { useMemo, useState } from "react";
import { BsMap } from "react-icons/bs";
import { useScope } from "@/app/contexts/ScopeContext";
import type { MyGrant } from "@/app/lib/topologyApi";

// Per-depth width of the SVG spine column. Smaller than the canvas
// tree (24px) — the rail is tighter and node names are the focus.
const STEP = 18;

// Row height — must match `.scope-flyout__item` line-height + padding.
// 6px top + 6px bottom + (13px font * 1.3 line-height) ≈ 29px. Keep
// in sync if the item padding changes.
const ROW_H = 28;

interface TreeRow {
  grant: MyGrant;
  depth: number;
  isFirst: boolean;
  isLast: boolean;
  hasChildren: boolean;
  // ancestorMoreChildren[d] = true means the ancestor at depth d
  // still has visible siblings below this row's subtree; we paint a
  // pass-through vertical at column d*STEP + STEP/2 so disjoint
  // sibling subtrees of that ancestor stay visually connected.
  // Length = depth; entry for the immediate parent (index depth-1)
  // is omitted because the row's own elbow handles that column.
  ancestorMoreChildren: boolean[];
}

function labelOf(g: MyGrant): string {
  return g.label_override?.trim() || g.name;
}

function buildTree(grants: MyGrant[]): TreeRow[] {
  const byId = new Map<string, MyGrant>();
  for (const g of grants) byId.set(g.node_id, g);

  const childrenOf = new Map<string | null, MyGrant[]>();
  for (const g of grants) {
    const parentKey = g.parent_id && byId.has(g.parent_id) ? g.parent_id : null;
    const bucket = childrenOf.get(parentKey) ?? [];
    bucket.push(g);
    childrenOf.set(parentKey, bucket);
  }
  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  }

  const rows: TreeRow[] = [];
  const walk = (
    parentId: string | null,
    depth: number,
    pathMoreChildren: boolean[],
  ) => {
    const kids = childrenOf.get(parentId) ?? [];
    kids.forEach((g, idx) => {
      const childKids = childrenOf.get(g.node_id) ?? [];
      const hasChildren = childKids.length > 0;
      const isFirst = idx === 0;
      const isLast = idx === kids.length - 1;
      rows.push({
        grant: g,
        depth,
        isFirst,
        isLast,
        hasChildren,
        ancestorMoreChildren: pathMoreChildren,
      });
      if (hasChildren) {
        // Mirror the canvas tree's path-building: root children
        // (depth 1) get an empty array because the root spine is
        // drawn separately; deeper children append `!isLast`.
        const childPath = depth === 0 ? [] : [...pathMoreChildren, !isLast];
        walk(g.node_id, depth + 1, childPath);
      }
    });
  };
  walk(null, 0, []);
  return rows;
}

export default function ScopeRail() {
  const { grants, activeNodeId, loading, error } = useScope();
  const [open, setOpen] = useState(false);

  const tree = useMemo(() => buildTree(grants), [grants]);

  return (
    <>
      <nav className="scope-rail" aria-label="Topology scope rail">
        <button
          type="button"
          className={`scope-rail__icon${open ? " is-open" : ""}`}
          aria-pressed={open}
          aria-label="Toggle topology scope panel"
          title="Topology scope"
          onClick={() => setOpen((v) => !v)}
        >
          <BsMap size={20} />
        </button>
      </nav>

      {open && (
        <aside className="scope-flyout" aria-label="Topology scope">
          <header className="scope-flyout__header">
            <h2 className="scope-flyout__title">Topology</h2>
          </header>
          <div className="scope-flyout__body vector-scroll">
            {loading && grants.length === 0 && (
              <div className="scope-flyout__status">Loading…</div>
            )}
            {error && (
              <div className="scope-flyout__status scope-flyout__status--error">{error}</div>
            )}
            {!loading && !error && grants.length === 0 && (
              <div className="scope-flyout__status">No scope grants.</div>
            )}
            {tree.map((row) => (
              <ScopeRow
                key={row.grant.grant_id}
                row={row}
                isActive={row.grant.node_id === activeNodeId}
              />
            ))}
          </div>
        </aside>
      )}
    </>
  );
}

function ScopeRow({ row, isActive }: { row: TreeRow; isActive: boolean }) {
  const { grant, depth, isFirst, isLast, hasChildren, ancestorMoreChildren } = row;
  return (
    <div
      className={`scope-flyout__item${isActive ? " is-active" : ""}`}
      aria-current={isActive ? "true" : undefined}
    >
      <Spine
        depth={depth}
        isFirst={isFirst}
        isLast={isLast}
        hasChildren={hasChildren}
        ancestorMoreChildren={ancestorMoreChildren}
      />
      <span className="scope-flyout__item-name">{labelOf(grant)}</span>
    </div>
  );
}

// Renders the per-row spine cell. At depth 0 we draw only the root
// spine verticals (so consecutive roots visually connect). At deeper
// depths we draw any ancestor pass-throughs plus this row's own
// elbow (└) or T (├) and an optional child stub.
function Spine({
  depth,
  isFirst,
  isLast,
  hasChildren,
  ancestorMoreChildren,
}: {
  depth: number;
  isFirst: boolean;
  isLast: boolean;
  hasChildren: boolean;
  ancestorMoreChildren: boolean[];
}) {
  const H = ROW_H;
  const MID = H / 2;
  const STUB_GAP = 6;
  const stroke = "var(--ink-3, #888)";

  if (depth === 0) {
    // Root rows render flush against the panel's left padding — no
    // spine column. Children at depth 1 carry the elbow that points
    // back to their root parent, and that elbow's starting column
    // is what visually anchors the root's name above it. Returning
    // null here is intentional: reserving a STEP-wide column for
    // roots would push them out of alignment with their depth-1
    // children's elbow column.
    return null;
  }

  const W = depth * STEP;
  const lineX = (depth - 1) * STEP + STEP / 2;
  const childLineX = depth * STEP + STEP / 2;

  const throughPaths: string[] = [];
  const paths: string[] = [];

  // Pass-through verticals for ancestors with more siblings below.
  ancestorMoreChildren.forEach((cont, i) => {
    if (cont) {
      const x = i * STEP + STEP / 2;
      throughPaths.push(`M${x} 0 L${x} ${H}`);
    }
  });

  // Own connector — └ for last sibling, ├ otherwise.
  if (isLast) {
    paths.push(`M${lineX} 0 L${lineX} ${MID} L${W} ${MID}`);
  } else {
    paths.push(`M${lineX} 0 L${lineX} ${H}`);
    paths.push(`M${lineX} ${MID} L${W} ${MID}`);
  }
  if (hasChildren) {
    // Child stub — short vertical below MID that feeds into the
    // first child's pass-through column.
    paths.push(`M${childLineX} ${MID + STUB_GAP} L${childLineX} ${H}`);
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="scope-flyout__spine"
      aria-hidden="true"
    >
      {throughPaths.map((d, i) => (
        <path
          key={`t${i}`}
          d={d}
          stroke={stroke}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {paths.map((d, i) => (
        <path
          key={`c${i}`}
          d={d}
          stroke={stroke}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
