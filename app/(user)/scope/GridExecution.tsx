"use client";

// GridExecution — Layer 2. The per-page assembler for /scope. A thin assembly
// with NO row markup of its own: it mounts the primitive (Grid__Tree + useTree)
// with the /scope column config and the ONE reference extension
// (expandable-rows-with-flyout-below). Future pages get their own assembler
// (GridStrategic, GridRisk, …) over the same primitive — this file is the
// template.
//
// What it owns:
//   • roots state          — loaded once via the audited POST gateway
//                            (fetchScopeRoots → workItems.query({page})).
//   • useTree({expandable}) — the headless core; fetchChildren resolves a row's
//                            TRUE direct children via workItems.query({parentId}).
//   • openDetailId         — which row currently has its flyout-below open
//                            (the expandable extension's open-state).
//   • onHeader             — pushes the four header strings UP into the
//                            <DataContainer> band once, on mount.
//
// What it does NOT own: the look (Grid__Tree), the connectors (CSS), the tree
// state machine (useTree), or the form body (Grid__Forms / ArtefactInlineForm).

import { useCallback, useEffect, useState } from "react";
import { GridTree } from "@/app/components/Grid/Grid__Tree";
import { GridForms } from "@/app/components/Grid/Grid__Forms";
import { useTree } from "@/app/components/Grid/useTree";
import type { TreeNode } from "@/app/components/Grid/types";
import type { DataContainerHeader } from "@/app/components/DataContainer/DataContainer";
import { scopeColumns } from "./scopeColumns";
import {
  fetchScopeRoots,
  fetchScopeChildren,
  type ScopeNode,
} from "./scopeTreeData";

// useTree wiring isolated to keep the assembler's JSX declarative.
// ScopeNode.id is the human id ("US-17357") — stable + unique per row, the
// React key + the expansion-set key. childrenCount is the authoritative
// server count; fetchChildren resolves a row's true direct children via the
// POST gateway (by UUID in the body, never the URL).
function useTreeScope(roots: ScopeNode[]) {
  return useTree<ScopeNode>(roots, {
    rowIdOf: (r) => r.id,
    getChildrenCount: (r) => r.childrenCount,
    fetchChildren: (r) => fetchScopeChildren(r.uuid),
    expandable: true,
  });
}

export interface GridExecutionProps {
  /** Push header strings up into the DataContainer band. */
  onHeader: (h: DataContainerHeader) => void;
}

export function GridExecution({ onHeader }: GridExecutionProps) {
  const [roots, setRoots] = useState<ScopeNode[]>([]);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);

  // Header band — set once. The frame holds it; this assembler is the only
  // thing that knows the page's identity.
  useEffect(() => {
    onHeader({
      title: "Scope",
      description:
        "The work-item hierarchy for this workspace — parent → child, collapsed by default.",
      subtitle: "Tree",
      subDescription:
        "Server-driven parentage via the audited POST read-gateway. Expand a row to load its true children.",
    });
  }, [onHeader]);

  // Roots loader — the canopy. Hoisted so a post-mutation refresh can re-run it.
  // tree.reset() drops every expansion + child cache so the reloaded roots
  // render clean (no stale expanded subtrees pointing at deleted rows).
  const loadRoots = useCallback(async () => {
    const rows = await fetchScopeRoots();
    setRoots(rows);
  }, []);

  useEffect(() => {
    void loadRoots();
  }, [loadRoots]);

  // The headless core. expandable:true → full caret/lazy-load machine.
  // fetchChildren receives the ROW (not an id) and returns its true direct
  // children through the POST gateway; children_count (rowIdOf's sibling on
  // the wire) decides whether a caret shows before any fetch.
  const tree = useTreeScope(roots);

  const closeDetail = useCallback(() => setOpenDetailId(null), []);

  // After a save/delete in the flyout, the server is the source of truth:
  // reset the tree and reload roots so the grid reflects the mutation. Not a
  // hack — it's the correct server-driven refresh (the old DataGrid relied on
  // a manual page reload, which is exactly the staleness this refactor fixes).
  const refreshAfterMutation = useCallback(() => {
    tree.reset();
    void loadRoots();
  }, [tree, loadRoots]);

  // Row click → toggle the flyout-below for that node. The caret (child
  // expansion) is handled inside the skin; this is the DETAIL open-state, a
  // separate axis (a row can be expanded AND have its form open).
  const handleSelect = useCallback(
    (node: TreeNode<ScopeNode>) => {
      setOpenDetailId((cur) => (cur === node.id ? null : node.id));
    },
    [],
  );

  return (
    <GridTree<ScopeNode>
      tree={tree}
      columns={scopeColumns}
      defaultSort={null}
      loadingStyle="barberpole"
      dnd={{ resourceType: "work_item", getDescendants: () => [] }}
      accentOf={(r) => r.colour}
      selectedId={openDetailId}
      onSelect={handleSelect}
      openDetailId={openDetailId}
      renderRowDetail={(node) => (
        <GridForms
          artefactId={node.row.uuid}
          resourceUrl="/work-items"
          scope="work"
          onClose={closeDetail}
          onSaved={() => refreshAfterMutation()}
          onDelete={() => {
            closeDetail();
            refreshAfterMutation();
          }}
        />
      )}
      empty={<p className="grid__Empty">No work items in scope.</p>}
    />
  );
}
