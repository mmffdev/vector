"use client";

import { useSentinel } from "@/app/sentinel";
import type { SentinelGrant } from "@/app/sentinel/types";
import { useScopedTopologyNodes } from "@/app/components/topology/useScopedTopologyNodes";

// ── Spine SVG (T / elbow connectors) ─────────────────────────────────────────

const STEP = 16;
const ROW_H = 32;
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
  const {
    sentinel_focus_node: activeNodeId,
    sentinel_set_focus,
    sentinel_user: user,
    sentinel_switch_workspace: switchWorkspace,
  } = useSentinel();
  const { rows, loading } = useScopedTopologyNodes();
  const setActiveNodeId = (id: string) => { void sentinel_set_focus(id); };

  if (loading && rows.length === 0) {
    return <div className="scope-group-panel__status">Loading…</div>;
  }
  if (rows.length === 0) {
    return <div className="scope-group-panel__status">No scope grants.</div>;
  }

  const select = (grant: SentinelGrant) => {
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
      {rows.map(({ grant, label, depth, isLast, hasChildren: _hasChildren, ancestorMoreChildren }) => {
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
