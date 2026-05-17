"use client";

// PLA-0042 — Chrome scope picker. Reads from ScopeContext; rendering only.
//
// Tree connectors: each row at depth D draws an SVG spine of width D×STEP.
// The spine has D columns (0..D-1). Column D-1 is this row's own connector
// (elbow └ if last sibling, T ├ if not). Columns 0..D-2 are ancestor
// pass-throughs: a full vertical if that ancestor still has siblings below
// this row (i.e. this row is not in the last subtree of that ancestor),
// otherwise blank.
//
// ancestorMoreChildren[i] from the walker = "does the ancestor at depth i
// still have siblings below?" — true → draw vertical through-line in
// column i. The entry at index depth-1 (immediate parent) tells us T vs
// elbow; entries 0..depth-2 tell us which ancestor columns stay live.

import { useEffect, useMemo, useRef, useState } from "react";
import { useScope } from "@/app/contexts/ScopeContext";
import { useAuth } from "@/app/contexts/AuthContext";
import type { MyGrant } from "@/app/lib/topologyApi";
import { byPosition, walkTopology } from "@/app/lib/shared/topology/walker";

const STEP = 16;     // px per depth level — width of one spine column
const ROW_H = 32;    // must match .scope-picker__item height in CSS
const LINE_X = 8;    // x of vertical line within each STEP column (centred)

interface TreeRow {
  grant: MyGrant;
  label: string;
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  // ancestorMoreChildren[i] = ancestor at depth i has more siblings below
  // Length = depth; index depth-1 = immediate parent.
  ancestorMoreChildren: boolean[];
}

type GrantNode = {
  id: string;
  parent_id: string | null;
  position: number;
  grant: MyGrant;
};

function labelOf(g: MyGrant): string {
  return g.label_override?.trim() || g.name;
}

function flattenGrants(grants: MyGrant[]): TreeRow[] {
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
    // Strip the workspace-level sibling flag (index 0) from the ancestor
    // path. Workspace rows are depth-0 and render as bold section headers;
    // their sibling relationship must not bleed through-lines into the
    // child subtree — each workspace's children are visually self-contained.
    // Shift the array left by 1 so depth-1 nodes start with an empty path.
    ancestorMoreChildren: r.depth > 0 ? r.ancestorMoreChildren.slice(1) : [],
  }));
}

// Spine draws the connector glyph for a row at depth D.
// SVG width = D * STEP, height = ROW_H.
// Column c occupies x = c*STEP .. (c+1)*STEP; vertical line at x = c*STEP + LINE_X.
//
// For each column c in 0..D-1:
//   c < D-1  → ancestor pass-through column
//              draw full vertical (top→bottom) if ancestorMoreChildren[c] = true
//              draw nothing if false (ancestor was last sibling, line ended)
//   c = D-1  → this row's own connector column
//              isLast=true  → elbow: vertical top→mid, then horizontal mid→right edge
//              isLast=false → T:     full vertical top→bottom + horizontal mid→right edge
function Spine({
  depth,
  isLast,
  ancestorMoreChildren,
}: {
  depth: number;
  isLast: boolean;
  hasChildren: boolean;
  ancestorMoreChildren: boolean[];
}) {
  if (depth === 0) return null;

  const W = depth * STEP;
  const H = ROW_H;
  const MID = H / 2;
  const stroke = "var(--tree-connector)";
  const sw = "1.5";

  const paths: string[] = [];

  for (let c = 0; c < depth; c++) {
    const x = c * STEP + LINE_X;
    const isOwnColumn = c === depth - 1;

    if (isOwnColumn) {
      if (isLast) {
        // Elbow └ : vertical from top to mid, then horizontal to right edge of column
        paths.push(`M${x} 0 L${x} ${MID} L${(c + 1) * STEP} ${MID}`);
      } else {
        // T ├ : full vertical top to bottom, plus horizontal arm to right edge
        paths.push(`M${x} 0 L${x} ${H}`);
        paths.push(`M${x} ${MID} L${(c + 1) * STEP} ${MID}`);
      }
    } else {
      // Ancestor pass-through: draw full vertical only if ancestor still has siblings
      if (ancestorMoreChildren[c]) {
        paths.push(`M${x} 0 L${x} ${H}`);
      }
    }
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="scope-picker__spine"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          stroke={stroke}
          strokeWidth={sw}
          fill="none"
          strokeLinecap="square"
        />
      ))}
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function ScopePicker() {
  const { grants, activeNodeId, activeGrant, loading, error, setActiveNodeId } = useScope();
  const { user, switchWorkspace } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setQuery("");
  }, [open]);

  const tree = useMemo(() => flattenGrants(grants), [grants]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tree;
    return tree.filter((r) => r.label.toLowerCase().includes(q));
  }, [tree, query]);

  if (loading && grants.length === 0) {
    return (
      <div className="scope-picker scope-picker--loading">
        <span className="scope-picker__trigger-label">Loading scope…</span>
      </div>
    );
  }

  if (grants.length === 0) return null;

  const triggerLabel = activeGrant ? labelOf(activeGrant) : "Select scope";

  return (
    <div className="scope-picker" ref={rootRef}>
      <button
        type="button"
        className="btn btn--ghost scope-picker__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={triggerLabel}
      >
        <span className="scope-picker__trigger-label">{triggerLabel}</span>
        <ChevronIcon />
      </button>

      {open && (
        <div className="scope-picker__panel" role="listbox" aria-label="Choose scope">
          <div className="scope-picker__search">
            <input
              ref={inputRef}
              type="text"
              className="form__input"
              placeholder="Filter scope…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter scope"
            />
          </div>
          <div className="scope-picker__list">
            {error && <div className="scope-picker__error">{error}</div>}
            {!error && visible.length === 0 && (
              <div className="scope-picker__empty">No matches.</div>
            )}
            {visible.map(({ grant, label, depth, isLast, hasChildren, ancestorMoreChildren }) => {
              const isActive = grant.node_id === activeNodeId;
              return (
                <button
                  key={grant.grant_id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`scope-picker__item${depth === 0 ? " scope-picker__item--workspace" : ""}${isActive ? " is-active" : ""}`}
                  onClick={() => {
                    const select = async () => {
                      if (grant.workspace_id && grant.workspace_id !== user?.workspace_id) {
                        await switchWorkspace(grant.workspace_id);
                      }
                      setActiveNodeId(grant.node_id);
                    };
                    void select();
                    setOpen(false);
                  }}
                >
                  <Spine
                    depth={depth}
                    isLast={isLast}
                    hasChildren={hasChildren}
                    ancestorMoreChildren={ancestorMoreChildren}
                  />
                  <span className="scope-picker__item-name">{label}</span>
                  <span className="scope-picker__item-role">{grant.role}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
