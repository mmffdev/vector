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

import { memo, useCallback, useMemo, useState } from "react";
import { BsMap } from "react-icons/bs";
import { MdOutlineArrowForwardIos } from "react-icons/md";
import { useScope } from "@/app/contexts/ScopeContext";
import type { MyGrant } from "@/app/lib/topologyApi";
import { byPosition, walkTopology } from "@/app/lib/shared/topology/walker";

// Per-depth width of the SVG spine column. Matches ResourceTree's
// DEFAULT_STEP so the rail's elbow vocabulary aligns with the canvas
// (ObjectTree) tree exactly.
const STEP = 20;

// Row height — must match `.scope-flyout__item` height in CSS so the
// SVG geometry doesn't drift. Same as ResourceTree DEFAULT_ROW_H.
const ROW_H = 28;

// Horizontal offset of vertical spine lines within each STEP column.
// Equals ResourceTree's CARET_OFFSET so the elbow's vertical sits
// where the chevron's centre lands one column to its right.
const CARET_OFFSET = 8;

// PLA-0044: row payload used by ScopeRow + Spine. Keeps the original
// shape so the renderer code below is unchanged; the walker output is
// translated into this shape in flattenGrants.
interface TreeRow {
  grant: MyGrant;
  label: string;
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  // Length = depth; entry for the immediate parent (index depth-1)
  // is omitted because the row's own elbow handles that column.
  ancestorMoreChildren: boolean[];
}

function labelOf(g: MyGrant): string {
  return g.label_override?.trim() || g.name;
}

// Wraps a MyGrant in the {id, parent_id} contract the shared walker
// expects (MyGrant's identity field is `node_id`, not `id`). `__label`
// is consumed by byLabel — kept for future label sort if we change
// scope ordering away from canvas-position. position is forwarded from
// MyGrant.position (PLA-0044 / story 00538) so byPosition works.
type GrantNode = {
  id: string;
  parent_id: string | null;
  __label: string;
  position: number;
  grant: MyGrant;
};

function flattenGrants(grants: MyGrant[], collapsed: Set<string>): TreeRow[] {
  const wrapped: GrantNode[] = grants.map((g) => ({
    id: g.node_id,
    parent_id: g.parent_id,
    __label: labelOf(g),
    position: g.position,
    grant: g,
  }));
  // PLA-0044: walkTopology drops orphans (was the phantom-D bug —
  // unreachable grants used to re-root under null). byPosition matches
  // canvas sibling order from topology_nodes.sort_order.
  const { rows } = walkTopology(wrapped, {
    collapsed,
    sort: byPosition,
  });
  return rows.map((r) => ({
    grant: r.node.grant,
    label: r.node.__label,
    depth: r.depth,
    isLast: r.isLast,
    hasChildren: r.hasChildren,
    ancestorMoreChildren: r.ancestorMoreChildren,
  }));
}

export default function ScopeRail() {
  const { grants, activeNodeId, loading, error } = useScope();
  const [open, setOpen] = useState(false);
  // Collapsed-node IDs. In-memory only — refreshing or closing the
  // flyout doesn't persist state, matching ObjectTree (the canvas
  // tree doesn't persist either).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleCollapsed = useCallback((nodeId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const tree = useMemo(() => flattenGrants(grants, collapsed), [grants, collapsed]);

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
                isCollapsed={collapsed.has(row.grant.node_id)}
                onToggleCollapsed={toggleCollapsed}
              />
            ))}
          </div>
        </aside>
      )}
    </>
  );
}

const ScopeRow = memo(function ScopeRow({
  row,
  isActive,
  isCollapsed,
  onToggleCollapsed,
}: {
  row: TreeRow;
  isActive: boolean;
  isCollapsed: boolean;
  onToggleCollapsed: (nodeId: string) => void;
}) {
  const { grant, label, depth, isLast, hasChildren, ancestorMoreChildren } = row;
  const isExpanded = hasChildren && !isCollapsed;
  // Dashed bottom rule closes any row that visually ends a subtree:
  // a leaf (no expanded children below) OR the last sibling in its group.
  const isSubtreeClose = !isExpanded || isLast;
  return (
    <div
      className={
        "scope-flyout__item" +
        (isActive ? " is-active" : "") +
        (isSubtreeClose ? " divider-dashed" : "")
      }
      aria-current={isActive ? "true" : undefined}
    >
      <Spine
        depth={depth}
        isLast={isLast}
        hasChildren={isExpanded}
        ancestorMoreChildren={ancestorMoreChildren}
      />
      <button
        type="button"
        className={
          "tree_accordion-dense__expander" +
          (isExpanded ? " tree_accordion-dense__expander--open" : "") +
          (!hasChildren ? " tree_accordion-dense__expander--leaf" : "")
        }
        aria-label={isCollapsed ? "Expand" : "Collapse"}
        aria-expanded={hasChildren ? !isCollapsed : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggleCollapsed(grant.node_id);
        }}
        tabIndex={hasChildren ? 0 : -1}
      >
        <MdOutlineArrowForwardIos
          size={10}
          className="tree_accordion-dense__expander-icon"
        />
      </button>
      <span className="scope-flyout__item-name">{label}</span>
    </div>
  );
});

// Depth 0 renders flush against the panel's left padding (no spine column);
// depth ≥ 1 paints ancestor pass-throughs plus this row's own elbow (└) or
// T (├), with an optional child stub. Elbow vs T is decided by "more
// siblings below" — not by whether this row has children — so an only-child
// (isLast && hasChildren) still gets an elbow.
function Spine({
  depth,
  isLast,
  hasChildren,
  ancestorMoreChildren,
}: {
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  ancestorMoreChildren: boolean[];
}) {
  const H = ROW_H;
  const MID = H / 2;
  const STUB_GAP = 6;
  const stroke = "var(--surface-sunken)";

  if (depth === 0) return null;

  const W = depth * STEP;
  const lineX = (depth - 1) * STEP + CARET_OFFSET;
  const childLineX = depth * STEP + CARET_OFFSET;

  const throughPaths: string[] = [];
  const paths: string[] = [];

  ancestorMoreChildren.forEach((cont, i) => {
    if (cont && i < depth - 1) {
      const x = i * STEP + CARET_OFFSET;
      throughPaths.push(`M${x} 0 L${x} ${H}`);
    }
  });

  if (isLast) {
    paths.push(`M${lineX} 0 L${lineX} ${MID} L${W} ${MID}`);
  } else {
    paths.push(`M${lineX} 0 L${lineX} ${H}`);
    paths.push(`M${lineX} ${MID} L${W} ${MID}`);
  }
  if (hasChildren) {
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
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {paths.map((d, i) => (
        <path
          key={`c${i}`}
          d={d}
          stroke={stroke}
          strokeWidth="1.25"
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
