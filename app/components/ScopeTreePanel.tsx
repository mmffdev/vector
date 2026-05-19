"use client";

// Inline scope tree for the Rail 2 scope panel. Same Spine/walker logic as
// ScopePicker but rendered as a flat scrollable list rather than a dropdown.
// Selecting a node sets active scope; does NOT navigate or close the panel.

import { useMemo } from "react";
import { useScope } from "@/app/contexts/ScopeContext";
import { useAuth } from "@/app/contexts/AuthContext";
import type { MyGrant } from "@/app/lib/topologyApi";
import { byPosition, walkTopology } from "@/app/lib/shared/topology/walker";

const STEP = 16;
const ROW_H = 32;
const LINE_X = 8;

interface TreeRow {
  grant: MyGrant;
  label: string;
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  ancestorMoreChildren: boolean[];
}

type GrantNode = { id: string; parent_id: string | null; position: number; grant: MyGrant };

function labelOf(g: MyGrant) {
  return g.label_override?.trim() || g.name;
}

function flattenGrants(grants: MyGrant[]): TreeRow[] {
  const wrapped: GrantNode[] = grants.map((g) => ({
    id: g.node_id, parent_id: g.parent_id, position: g.position, grant: g,
  }));
  const { rows } = walkTopology(wrapped, { collapsed: new Set(), sort: byPosition });
  return rows.map((r) => ({
    grant: r.node.grant,
    label: labelOf(r.node.grant),
    depth: r.depth,
    isLast: r.isLast,
    hasChildren: r.hasChildren,
    ancestorMoreChildren: r.depth > 0 ? r.ancestorMoreChildren.slice(1) : [],
  }));
}

function Spine({ depth, isLast, ancestorMoreChildren }: {
  depth: number; isLast: boolean; hasChildren: boolean; ancestorMoreChildren: boolean[];
}) {
  if (depth === 0) return null;
  const W = depth * STEP;
  const H = ROW_H;
  const MID = H / 2;
  const paths: string[] = [];

  for (let c = 0; c < depth; c++) {
    const x = c * STEP + LINE_X;
    const rightEdge = (c + 1) * STEP;
    if (c < depth - 1) {
      if (ancestorMoreChildren[c]) paths.push(`M${x} 0 L${x} ${H}`);
    } else {
      if (isLast) {
        paths.push(`M${x} 0 L${x} ${MID} L${rightEdge} ${MID}`);
      } else {
        paths.push(`M${x} 0 L${x} ${H}`);
        paths.push(`M${x} ${MID} L${rightEdge} ${MID}`);
      }
    }
  }

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="scope-tree-panel__spine" aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} stroke="var(--tree-connector)" strokeWidth="1.5" fill="none" strokeLinecap="square" />
      ))}
    </svg>
  );
}

export default function ScopeTreePanel() {
  const { grants, activeNodeId, setActiveNodeId, direction, setDirection, loading, error } = useScope();
  const { user, switchWorkspace } = useAuth();

  const tree = useMemo(() => flattenGrants(grants), [grants]);

  if (loading && grants.length === 0) {
    return <div className="scope-tree-panel__status">Loading…</div>;
  }
  if (error) {
    return <div className="scope-tree-panel__status scope-tree-panel__status--error">{error}</div>;
  }
  if (grants.length === 0) {
    return <div className="scope-tree-panel__status">No scope grants.</div>;
  }

  return (
    <div className="scope-tree-panel">
      {/* Direction toggle — ascend (up the chain) / descend (node + children) */}
      <div className="scope-tree-panel__direction-bar" role="group" aria-label="Scope direction">
        <button
          type="button"
          className={`scope-tree-panel__dir-btn${direction === "descend" ? " is-active" : ""}`}
          aria-pressed={direction === "descend"}
          onClick={() => setDirection("descend")}
          title="Scope down — selected node and all its children"
        >
          ↓ Down
        </button>
        <button
          type="button"
          className={`scope-tree-panel__dir-btn${direction === "ascend" ? " is-active" : ""}`}
          aria-pressed={direction === "ascend"}
          onClick={() => setDirection("ascend")}
          title="Scope up — selected node and all its ancestors"
        >
          ↑ Up
        </button>
      </div>
      {tree.map(({ grant, label, depth, isLast, hasChildren, ancestorMoreChildren }) => {
        const isActive = grant.node_id === activeNodeId;
        return (
          <button
            key={grant.grant_id}
            type="button"
            className={`scope-tree-panel__row${depth === 0 ? " scope-tree-panel__row--workspace" : ""}${isActive ? " is-active" : ""}`}
            onClick={() => {
              const select = async () => {
                if (grant.workspace_id && grant.workspace_id !== user?.workspace_id) {
                  await switchWorkspace(grant.workspace_id);
                }
                setActiveNodeId(grant.node_id);
              };
              void select();
            }}
          >
            <Spine depth={depth} isLast={isLast} hasChildren={hasChildren} ancestorMoreChildren={ancestorMoreChildren} />
            <span className="scope-tree-panel__row-name">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
