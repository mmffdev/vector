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
//
// The tree's OWN title (title + subtitle) is passed straight into <GridTree>;
// the page-level title lives on <DataContainer> in page.tsx. Neither passes
// through the other — the frame and the tree are wired independently.
//
// What it does NOT own: the look (Grid__Tree), the connectors (CSS), the tree
// state machine (useTree), or the form body (Grid__Tree_Forms / ArtefactInlineForm).

import { useCallback, useMemo, useState } from "react";
import { GridTree } from "@/app/components/Grid/Grid__Tree";
import { GridTreeForms } from "@/app/components/Grid/Grid__Tree_Forms";
import { useTree } from "@/app/components/Grid/useTree";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import { makeScopeColumns } from "./scopeColumns";
import {
  fetchScopeRoots,
  fetchScopeChildren,
  type ScopeNode,
} from "./scopeTreeData";

// useTree wiring isolated to keep the assembler's JSX declarative.
// ScopeNode.id is the human id ("US-17357") — stable + unique per row, the
// React key + the expansion-set key. The hook now OWNS the paged root window:
// fetchRoots loads a page (the canopy), fetchChildren resolves a row's true
// direct children via the POST gateway (by UUID in the body, never the URL).
function useTreeScope() {
  return useTree<ScopeNode>({
    fetchRoots: fetchScopeRoots,
    pageSize: 100,
    rowIdOf: (r) => r.id,
    getChildrenCount: (r) => r.childrenCount,
    fetchChildren: (r) => fetchScopeChildren(r.uuid),
    expandable: true,
  });
}

export function GridExecution() {
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  // The headless core. It self-loads root page 0 on mount and owns the paged
  // window (loadMore / jumpToPage / refresh). expandable:true → full caret/
  // lazy-load machine; children_count decides the caret before any fetch.
  const tree = useTreeScope();

  // Creatable work-scope artefact types → one radial pill each. Sourced from
  // the artefact-type catalogue (current, not OTV2's stale SQL).
  const createTypes = useChipTypeOptions("work");
  const actionBar = useMemo(
    () => ({
      ariaLabel: "Work item actions",
      create: {
        label: "Create new",
        types: createTypes.map((t) => ({ id: t.value, label: t.label })),
        // Part 4b will open a create flyout for the picked type; for now the
        // radial pick is wired but the create form is not yet built.
        onCreate: (typeId: string) => {
          // eslint-disable-next-line no-console
          console.log("[scope] create type picked:", typeId);
        },
      },
      search: {
        placeholder: "Search work items…",
        value: search,
        onChange: setSearch,
      },
    }),
    [createTypes, search],
  );

  const closeDetail = useCallback(() => setOpenDetailId(null), []);

  // After a save/delete in the flyout, the server is the source of truth:
  // refresh() resets expansion + reloads the canopy from the top so the grid
  // reflects the mutation. Not a hack — the correct server-driven refresh.
  const refreshAfterMutation = useCallback(() => {
    tree.refresh();
  }, [tree]);

  // OTV2 form trigger: clicking a row's type badge toggles the inline edit
  // flyout below it (single-open). Separate axis from caret expansion.
  const openForm = useCallback((id: string) => {
    setOpenDetailId((cur) => (cur === id ? null : id));
  }, []);

  // Columns close over the form-open trigger so the type badge can open the
  // flyout (OTV2 parity). Memoised so the column identity is stable.
  const columns = useMemo(() => makeScopeColumns(openForm), [openForm]);

  return (
    <GridTree<ScopeNode>
      title="Tree"
      subtitle="Server-driven parentage via the audited POST read-gateway. Expand a row to load its true children."
      badge="01"
      actionBar={actionBar}
      tree={tree}
      columns={columns}
      defaultSort={null}
      loadingStyle="barberpole"
      dnd={{ resourceType: "work_item", getDescendants: () => [] }}
      selection={{ selectedIds, onSelectionChange: setSelectedIds }}
      cogMenu={(row) => [
        {
          key: "open",
          label: "Open",
          onSelect: () => setOpenDetailId(row.id),
        },
      ]}
      accentOf={(r) => r.colour}
      selectedId={openDetailId}
      openDetailId={openDetailId}
      renderRowDetail={(node) => (
        <GridTreeForms
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
