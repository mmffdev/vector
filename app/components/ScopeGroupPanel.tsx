"use client";

import { useMemo } from "react";
import { useScope } from "@/app/contexts/ScopeContext";
import { useAuth } from "@/app/contexts/AuthContext";
import type { MyGrant } from "@/app/lib/topologyApi";
import { byPosition, walkTopology } from "@/app/lib/shared/topology/walker";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Row {
  grant: MyGrant;
  label: string;
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  ancestorMoreChildren: boolean[];
}

type GrantNode = { id: string; parent_id: string | null; position: number; grant: MyGrant };

// ── Helpers ───────────────────────────────────────────────────────────────────

function labelOf(g: MyGrant) {
  return g.label_override?.trim() || g.name;
}

function flattenGrants(grants: MyGrant[]): Row[] {
  const wrapped: GrantNode[] = grants.map((g) => ({
    id: g.node_id,
    parent_id: g.parent_id,
    position: g.position,
    grant: g,
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

// ── Spine SVG (T / elbow connectors) ─────────────────────────────────────────

const STEP = 16;
const ROW_H = 34;
const LINE_X = 8;

function Spine({ depth, isLast, ancestorMoreChildren }: {
  depth: number;
  isLast: boolean;
  ancestorMoreChildren: boolean[];
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
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="scope-group-panel__spine"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke="var(--tree-connector)"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="square"
        />
      ))}
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScopeGroupPanel() {
  const { grants, activeNodeId, setActiveNodeId, loading, error } = useScope();
  const { user, switchWorkspace } = useAuth();

  const rows = useMemo(() => flattenGrants(grants), [grants]);

  if (loading && grants.length === 0) {
    return <div className="scope-group-panel__status">Loading…</div>;
  }
  if (error) {
    return <div className="scope-group-panel__status scope-group-panel__status--error">{error}</div>;
  }
  if (rows.length === 0) {
    return <div className="scope-group-panel__status">No scope grants.</div>;
  }

  const select = (grant: MyGrant) => {
    const run = async () => {
      if (grant.workspace_id && grant.workspace_id !== user?.workspace_id) {
        await switchWorkspace(grant.workspace_id);
      }
      setActiveNodeId(grant.node_id);
    };
    void run();
  };

  return (
    <div className="scope-group-panel">
      {rows.map(({ grant, label, depth, isLast, hasChildren, ancestorMoreChildren }) => {
        const isActive = grant.node_id === activeNodeId;
        const isWorkspace = depth === 0;

        return (
          <button
            key={grant.grant_id}
            type="button"
            onClick={() => select(grant)}
            className={[
              isWorkspace
                ? "scope-group-panel__ws-row"
                : "scope-group-panel__child-row",
              isActive ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {!isWorkspace && (
              <Spine
                depth={depth}
                isLast={isLast}
                ancestorMoreChildren={ancestorMoreChildren}
              />
            )}
            <span className="scope-group-panel__row-name">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
