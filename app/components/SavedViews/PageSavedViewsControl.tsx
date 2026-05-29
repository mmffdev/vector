"use client";

// PageSavedViewsControl — page-level saved-views dropdown that drives
// N ObjectTreeV2 grids on the same page. Body shape (kind='page'):
//   { grids: { <gridKey>: { visible_columns: string[] } } }
// Partial bodies are honoured: a grid absent from `grids` is left
// untouched on load. New grids added to a page later won't silently
// wipe their state in pre-existing views.
//
// Usage: a page calls usePageSavedViews({ target, grids: ['panel','backlog'] })
// and gets back { node, bind(gridKey) }. It renders `node` inside
// usePageHeader.actions; for each ObjectTreeV2 mount it spreads the
// `bind(gridKey)` result into the props, which wires columnsControlRef
// + onColumnsChange to the page-level orchestrator.
//
// Per the value-sprint single-dropdown design (2026-05-29). Spec:
// docs/superpowers/specs/2026-05-28-saved-views-design.md (page kind
// extension, 2026-05-29).

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useSavedViews } from "./useSavedViews";
import { SavedViewsDropdown } from "./SavedViewsDropdown";
import { SaveAsNewViewModal } from "./SaveAsNewViewModal";
import { ManageSavedViewsModal } from "./ManageSavedViewsModal";
import { SaveChangesIndicator } from "./SaveChangesIndicator";
import type { Scope, View } from "./types";

type GridKey = string;
type GridColumnsMap = Record<GridKey, string[]>;

interface PageBody {
  grids: Record<GridKey, { visible_columns: string[] }>;
}

export interface PageSavedViewsControlParams {
  /** Opaque per-page identifier — convention `page:<route-slug>`. */
  target: string;
  /** Stable list of grid keys on this page. Order is not significant. */
  grids: GridKey[];

  // Identity props for scope IDs. Passed in; never resolved internally.
  currentUserID: string;
  currentNodeID?: string | null;
  currentWorkspaceID: string;
  canShareToNode: boolean;
  canShareToWorkspace: boolean;
}

export interface PageSavedViewsBindResult {
  columnsControlRef: React.MutableRefObject<{ setColumns: (cols: string[]) => void } | null>;
  onColumnsChange: (cols: string[]) => void;
}

export interface UsePageSavedViewsResult {
  /** Render this inside usePageHeader({ actions: result.node }). */
  node: React.ReactNode;
  /** Spread the return value onto each ObjectTreeV2 mount's props. */
  bind: (gridKey: GridKey) => PageSavedViewsBindResult;
}

export function usePageSavedViews(params: PageSavedViewsControlParams): UsePageSavedViewsResult {
  const {
    target, grids,
    currentUserID, currentNodeID, currentWorkspaceID,
    canShareToNode, canShareToWorkspace,
  } = params;

  const {
    views, activeView, loading, error,
    loadView, clearView, saveChanges, saveAsNew, deleteView, renameView,
  } = useSavedViews({ kind: "page", target });

  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [manageModalOpen, setManageModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Per-grid imperative handle into each ObjectTreeV2's column picker.
  // Filled by the grids themselves via the columnsControlRef prop —
  // we own the ref on this side, hand it to the grid, the grid fills .current.
  const gridControlRefs = useRef<
    Record<GridKey, React.MutableRefObject<{ setColumns: (cols: string[]) => void } | null>>
  >({});
  // Live per-grid current columns, mirrored up from each grid via
  // onColumnsChange. Source of truth for serialise + dirty-tracking.
  const [liveCols, setLiveCols] = useState<GridColumnsMap>({});
  // Snapshot of the columns when the active view was loaded. Used for
  // isDirty diffing — partial bodies leave the omitted grids at "no
  // baseline", so dirty is computed only for grids the view named.
  const [baselineCols, setBaselineCols] = useState<GridColumnsMap | null>(null);

  // Lazy-init a ref per grid key on first call. Stable across renders.
  const ensureControlRef = useCallback((gridKey: GridKey) => {
    if (!gridControlRefs.current[gridKey]) {
      gridControlRefs.current[gridKey] = { current: null };
    }
    return gridControlRefs.current[gridKey];
  }, []);

  // Per-grid onColumnsChange — mirrors the grid's current columns into
  // liveCols so we can serialise + diff against the baseline.
  const makeOnColumnsChange = useCallback(
    (gridKey: GridKey) => (cols: string[]) => {
      setLiveCols((prev) => {
        const prevCols = prev[gridKey];
        if (prevCols && prevCols.length === cols.length && prevCols.every((k, i) => k === cols[i])) {
          return prev;
        }
        return { ...prev, [gridKey]: cols.slice() };
      });
    },
    [],
  );

  const bind = useCallback(
    (gridKey: GridKey): PageSavedViewsBindResult => ({
      columnsControlRef: ensureControlRef(gridKey),
      onColumnsChange: makeOnColumnsChange(gridKey),
    }),
    [ensureControlRef, makeOnColumnsChange],
  );

  // Dirty = some grid the baseline named has different cols than live.
  // Grids absent from the baseline don't contribute (partial-body rule).
  const isDirty = useMemo(() => {
    if (!baselineCols) return false;
    for (const [gridKey, baseline] of Object.entries(baselineCols)) {
      const live = liveCols[gridKey];
      if (!live) continue;
      if (live.length !== baseline.length) return true;
      const baseSet = new Set(baseline);
      if (live.some((k) => !baseSet.has(k))) return true;
    }
    return false;
  }, [baselineCols, liveCols]);

  // Apply a loaded view: push each named grid's columns into its picker
  // via the imperative ref. Grids absent from the body are left alone.
  const applyView = useCallback(
    (view: View) => {
      const body = view.saved_views_body as PageBody | undefined;
      const newBaseline: GridColumnsMap = {};
      if (body && body.grids) {
        for (const [gridKey, slice] of Object.entries(body.grids)) {
          if (!Array.isArray(slice?.visible_columns)) continue;
          const cols = slice.visible_columns;
          newBaseline[gridKey] = cols.slice();
          const ref = gridControlRefs.current[gridKey];
          ref?.current?.setColumns(cols);
        }
      }
      setBaselineCols(newBaseline);
    },
    [],
  );

  const handleSelectView = useCallback(
    (viewID: string) => {
      const v = views.find((view) => view.saved_views_id === viewID);
      if (!v) return;
      loadView(viewID);
      applyView(v);
    },
    [views, loadView, applyView],
  );

  const handleClearView = useCallback(() => {
    clearView();
    setBaselineCols(null);
    // Note: we deliberately do NOT reset each grid's columns to its
    // defaults here. Clear-view means "stop tracking against a view",
    // not "wipe my column choices". The user's last picker state stays.
  }, [clearView]);

  const serialiseBody = useCallback((): PageBody => {
    const out: PageBody = { grids: {} };
    for (const gridKey of grids) {
      const cols = liveCols[gridKey];
      if (cols) out.grids[gridKey] = { visible_columns: cols };
    }
    return out;
  }, [grids, liveCols]);

  const handleSaveChanges = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await saveChanges({ body: serialiseBody() });
      // After save, the baseline catches up to live so isDirty goes false.
      applyView(updated);
    } finally {
      setSaving(false);
    }
  }, [saveChanges, serialiseBody, applyView]);

  const handleSaveAsNew = useCallback(
    async (req: { name: string; scope: Scope; id_user?: string; id_node?: string; id_workspace?: string }) => {
      const created = await saveAsNew({
        name: req.name,
        scope: req.scope,
        id_user: req.id_user,
        id_node: req.id_node,
        id_workspace: req.id_workspace,
        body: serialiseBody(),
      });
      applyView(created);
    },
    [saveAsNew, serialiseBody, applyView],
  );

  // Memoise the node so usePageHeader's deps array doesn't see a new
  // ReactNode every parent render (which would re-push the header on
  // every keystroke / interval tick). The dependency list is the union
  // of every dynamic value referenced inside the JSX — keep it tight.
  const node = useMemo(
    () => (
      <div className="saved-views__Control saved-views__Control--page">
        <SavedViewsDropdown
          views={views}
          activeView={activeView}
          onSelectView={handleSelectView}
          onClearView={handleClearView}
          onSaveAsNew={() => setSaveModalOpen(true)}
          onOpenManage={() => setManageModalOpen(true)}
        />
        <SaveChangesIndicator
          isDirty={isDirty}
          hasActiveView={!!activeView}
          onSave={handleSaveChanges}
          saving={saving}
        />
        {loading && <span className="saved-views__StatusText">Loading…</span>}
        {error && <span className="saved-views__ErrorText">{error}</span>}

        <SaveAsNewViewModal
          isOpen={saveModalOpen}
          onClose={() => setSaveModalOpen(false)}
          currentUserID={currentUserID}
          currentNodeID={currentNodeID}
          currentWorkspaceID={currentWorkspaceID}
          canShareToNode={canShareToNode}
          canShareToWorkspace={canShareToWorkspace}
          onSave={handleSaveAsNew}
        />

        <ManageSavedViewsModal
          isOpen={manageModalOpen}
          onClose={() => setManageModalOpen(false)}
          views={views}
          onRename={async (id, name) => { await renameView(id, name); }}
          onDelete={async (ids) => { for (const id of ids) await deleteView(id); }}
          onChangeScope={async (_id, _scope) => {
            /* Scope-change UI deferred to manage-modal v2 — same TD as the per-grid control. */
          }}
        />
      </div>
    ),
    [
      views, activeView, isDirty, saving, loading, error,
      saveModalOpen, manageModalOpen,
      handleSelectView, handleClearView, handleSaveChanges, handleSaveAsNew,
      currentUserID, currentNodeID, currentWorkspaceID,
      canShareToNode, canShareToWorkspace,
      renameView, deleteView,
    ],
  );

  return { node, bind };
}
