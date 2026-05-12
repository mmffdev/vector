"use client";

// PLA-0042 / PLA-0043 PoC — Sidebar-rail scope picker. Replaces the
// header-mounted dropdown with a permanent vertical rail (single
// BsMap icon) that toggles a full-height flyout showing the topology
// tree. Toggle-only dismiss for the PoC: click the icon again to
// close (no outside-click, no Esc).
//
// Selection is intentionally NOT wired yet — the flyout renders the
// tree so we can validate the visual + open/close behaviour first.

import { useState } from "react";
import { BsMap } from "react-icons/bs";
import { useScope } from "@/app/contexts/ScopeContext";
import type { MyGrant } from "@/app/lib/topologyApi";

interface TreeRow {
  grant: MyGrant;
  depth: number;
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
  function walk(parent: string | null, depth: number) {
    for (const g of childrenOf.get(parent) ?? []) {
      rows.push({ grant: g, depth });
      walk(g.node_id, depth + 1);
    }
  }
  walk(null, 0);
  return rows;
}

export default function ScopeRail() {
  const { grants, activeNodeId, loading, error } = useScope();
  const [open, setOpen] = useState(false);

  const tree = buildTree(grants);

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
          <div className="scope-flyout__body">
            {loading && grants.length === 0 && (
              <div className="scope-flyout__status">Loading…</div>
            )}
            {error && (
              <div className="scope-flyout__status scope-flyout__status--error">{error}</div>
            )}
            {!loading && !error && grants.length === 0 && (
              <div className="scope-flyout__status">No scope grants.</div>
            )}
            {tree.map(({ grant, depth }) => {
              const isActive = grant.node_id === activeNodeId;
              const indent = Math.min(depth, 6);
              return (
                <div
                  key={grant.grant_id}
                  className={`scope-flyout__item scope-flyout__item--d${indent}${isActive ? " is-active" : ""}`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <span className="scope-flyout__item-name">{labelOf(grant)}</span>
                  <span className="scope-flyout__item-role">{grant.role}</span>
                </div>
              );
            })}
          </div>
        </aside>
      )}
    </>
  );
}
