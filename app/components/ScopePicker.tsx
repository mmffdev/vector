"use client";

// PLA-0042 — Chrome scope picker. Mounted at the start of
// `.page-header__left` so the active topology scope sits next to the
// page title (Rally/Linear convention). Reads from ScopeContext;
// rendering only — no API calls of its own.
//
// Tree shape: grants arrive as a flat list with `parent_id`; we
// reconstruct the visible subtree by walking parent links that exist
// inside the grant set. Nodes whose parent is NOT in the grant set
// are rendered as roots — the user holds a grant on them directly.

import { useEffect, useMemo, useRef, useState } from "react";
import { useScope } from "@/app/contexts/ScopeContext";
import type { MyGrant } from "@/app/lib/topologyApi";

interface TreeRow {
  grant: MyGrant;
  depth: number;
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
  function walk(parent: string | null, depth: number) {
    for (const g of childrenOf.get(parent) ?? []) {
      rows.push({ grant: g, depth });
      walk(g.node_id, depth + 1);
    }
  }
  walk(null, 0);
  return rows;
}

function labelOf(g: MyGrant): string {
  return g.label_override?.trim() || g.name;
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
      // Focus search on open; the small timeout lets the panel render.
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setQuery("");
  }, [open]);

  const tree = useMemo(() => buildTree(grants), [grants]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tree;
    return tree.filter((r) => labelOf(r.grant).toLowerCase().includes(q));
  }, [tree, query]);

  if (loading && grants.length === 0) {
    return (
      <div className="scope-picker scope-picker--loading">
        <span className="scope-picker__trigger-label">Loading scope…</span>
      </div>
    );
  }

  if (grants.length === 0) {
    // No grants → no picker. Silent rather than a disabled stub so
    // the chrome stays clean for users who don't have any topology role.
    return null;
  }

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
            {visible.map(({ grant, depth }) => {
              const isActive = grant.node_id === activeNodeId;
              // Cap visual indent at depth 6; deeper trees just stop nesting
              // visually so the panel stays readable.
              const indent = Math.min(depth, 6);
              return (
                <button
                  key={grant.grant_id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`scope-picker__item scope-picker__item--d${indent}${isActive ? " is-active" : ""}`}
                  onClick={() => {
                    console.log("[ScopePicker] selected", {
                      node_id: grant.node_id,
                      name: labelOf(grant),
                      role: grant.role,
                      workspace_id: grant.workspace_id,
                      parent_id: grant.parent_id,
                      depth,
                    });
                    setActiveNodeId(grant.node_id);
                    setOpen(false);
                  }}
                >
                  <span className="scope-picker__item-name">{labelOf(grant)}</span>
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
