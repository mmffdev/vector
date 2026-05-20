"use client";

// ObjectTree — generic dumb primitive over <ResourceTree>. This wrapper owns
// pagination/sort UI state and composes the columns + I/O hook + chrome from
// a config object. Every tree concern (lines, expand, resize, etc.)
// lives in <ResourceTree>; every data-type concern lives in the config.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArtefactInlineForm from "@/app/components/ArtefactInlineForm";
import BulkActionBar from "@/app/components/BulkActionBar";
import Panel from "@/app/components/Panel";
import { ResourceTree } from "@/app/components/ResourceTree";
import { useWorkItemFlowStates } from "@/app/components/useWorkItemFlowStates";
import { useFlowStatesByType } from "@/app/components/useFlowStatesByType";
import {
  buildWorkItemsColumns,
  useArtefactItemsWindow,
  useArtefactTypeColours,
  useWorkItemsFilters,
  useWorkItemsSort,
  WorkItemsFilterChips,
  type SortKey,
  type WorkItem,
} from "@/app/components/work-items-tree-config";
import { useChipTypeOptions } from "@/app/hooks/useChipTypeOptions";
import type { ColumnDef } from "@/app/components/ResourceTree";
import { MdAdd, MdOutlineCategory, MdSearch } from "react-icons/md";

export type { WorkItem };

// ObjectTree configuration interface — tells ObjectTree how to fetch, render,
// and interact with a specific data type. Built inline based on `mode` for now;
// when we have multiple data types, this comes from the registry.
export interface ObjectTreeDataConfig<T = any> {
  // UI labels and messaging
  label: string; // e.g. "Work items", "Portfolio items"
  searchPlaceholder: string; // e.g. "Search work items…"
  ariaLabel: string; // e.g. "Work items dense grid"
  treeName: string; // e.g. "workitems", "portfolioitems" (for addressing)

  // Columns and rendering
  columns: ColumnDef<T>[];

  // Drag-and-drop configuration
  dndResourceType: string; // e.g. "work_item", "portfolio_item"
  dndEnabled: boolean;

  // Sorting configuration
  defaultSortKey: string | null;
  defaultSortDir: "asc" | "desc";

  // Hierarchy accessors
  getParentId: (row: T) => string | null;
  getChildrenCount: (row: T) => number;

  // Search accessor
  searchAccessor: (row: T) => string;

  // Optional UI elements
  filterChips?: React.ReactNode;

  // Pagination configuration
  paginationOptions: number[];
  defaultPageSize: number;

  // Backend wiring (PLA-0037 / B21) — apiSite path prefix for the artefact
  // resource ("/work-items" or "/portfolio-items"). When omitted, derived
  // from `mode` for back-compat. Supplied by p_wizard_*.json sidecars.
  resourceUrl?: string;
  // Optional scope hint for diagnostics / addressing — does NOT influence
  // routing (the backend route already encodes the scope).
  scope?: "work" | "strategy";
}

export default function ObjectTree({
  selectedId,
  onSelect,
  onPatched,
  mode = "work_items",
  wizardConfig,
  title,
  addressableName,
  subtitleBadge,
  subtitle,
  description,
}: {
  selectedId: string | null;
  onSelect: (item: WorkItem) => void;
  onPatched?: (body: Record<string, unknown>) => void;
  mode?: "work_items" | "portfolio_items";
  wizardConfig?: ObjectTreeDataConfig<WorkItem>;
  // Chrome props. ObjectTree renders its own outer <Panel> + sunken header;
  // pages no longer wrap with <Panel>. `title` + `addressableName` are
  // required for the new chrome; `subtitleBadge` / `subtitle` / `description`
  // fill the sunken header band below the title.
  title?: string;
  addressableName?: string;
  subtitleBadge?: React.ReactNode;
  subtitle?: React.ReactNode;
  description?: React.ReactNode;
}) {
  // For now, build config based on mode. Once we have multiple data types,
  // this could accept a config prop or look it up from the registry.
  const flowStates = useWorkItemFlowStates();
  const colourMap = useArtefactTypeColours();
  const [pageSize, setPageSize] = useState<number | "all">(25);
  const [pageIndex, setPageIndex] = useState(0);

  // Per-user filter/sort preferences are namespaced by treeName so
  // /work-items and /portfolio-items don't bleed across pages
  // (TD-URL-FILTER-CHIPS pay-down). Default keys when consumer hasn't
  // passed treeName: fall back to mode for back-compat.
  const treeName = wizardConfig?.treeName ?? (mode === "portfolio_items" ? "portfolioitems" : "workitems");
  const filtersPrefKey = `${treeName}.filters`;
  const sortPrefKey = `${treeName}.sort`;

  // sortRef and filtersRef cross-wire the two hooks so URL writes from
  // either side carry both dimensions (TD-URL-SHAREABLE-VIEWS).
  const filtersRef = useRef<import("@/app/components/work-items-tree-config").WorkItemsFilters>(
    { type: [], status: [], priority: [], owner_id: [] }
  );
  const { sortKey, sortDir, sortRef, setSort } = useWorkItemsSort(sortPrefKey, filtersRef);
  const { filters } = useWorkItemsFilters(filtersPrefKey, sortRef);
  // Keep filtersRef current so sort-side URL writes reflect latest filters.
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  // PLA-0021 / 00456 — multi-select state lives here; the tree consumes
  // it via the SelectionConfig prop set, and BulkActionBar reads it to
  // decide whether to render itself.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Action bar — artefact type picker that focuses the "Add new" CTA.
  // Design-only for now (no create wiring); options come from the workspace
  // artefact-type catalogue, same source as the filter chips.
  const actionTypeOptions = useChipTypeOptions("work");
  const [actionTypeId, setActionTypeId] = useState<string>("");
  const actionTypeLabel = useMemo(() => {
    const found = actionTypeOptions.find((o) => o.value === actionTypeId);
    return found?.label ?? null;
  }, [actionTypeOptions, actionTypeId]);

  // ArtefactInlineForm — single-open state for the inline edit panel
  // that expands beneath the action bar when the user clicks a row's
  // coloured type badge. Mutually exclusive with the create flyout
  // (one effect below force-closes the inline form whenever the
  // create flyout opens).
  const [openInlineFormId, setOpenInlineFormId] = useState<string | null>(null);
  const openInlineForm = useCallback((id: string) => {
    setActionTypeId("");
    setOpenInlineFormId((cur) => (cur === id ? null : id));
  }, []);
  const closeInlineForm = useCallback(() => setOpenInlineFormId(null), []);
  useEffect(() => {
    if (actionTypeId) setOpenInlineFormId(null);
  }, [actionTypeId]);

  // Search lives at this level so it can render inside the action bar
  // alongside the create-new chip and filter chips. ResourceTree consumes
  // it via the controlled searchValue + onSearchChange props.
  const [searchQuery, setSearchQuery] = useState("");

  // Filter or sort changes invalidate the page offset — page 5 of an
  // unfiltered/default-sorted set is meaningless on a filtered/resorted set.
  // Multi-value filters are arrays; join to a stable string so identity
  // churn from `useMemo` doesn't fire this effect every render.
  const filterFingerprint =
    filters.type.join(",") + "|" +
    filters.status.join(",") + "|" +
    filters.priority.join(",") + "|" +
    filters.owner_id.join(",");
  useEffect(() => {
    setPageIndex(0);
  }, [filterFingerprint, sortKey, sortDir]);

  // resourceUrl resolution order:
  //   1. wizardConfig.resourceUrl (sidecar JSON — preferred path, PLA-0037)
  //   2. mode-derived fallback (back-compat for callers not on sidecars yet)
  // Both endpoints land on artefactitems with different scope (work | strategy).
  const resourceUrl =
    wizardConfig?.resourceUrl ?? (mode === "portfolio_items" ? "/portfolio-items" : "/work-items");

  const { windowRoots, total, loadingWindow, patchAndApply, fetchChildren } =
    useArtefactItemsWindow({
      resourceUrl,
      pageSize,
      pageIndex,
      sortKey,
      sortDir,
      filters,
      onPatched,
    });

  // Bulk-fetch flow states for every artefact type visible in the
  // current window so each row's Status pill row paints with its OWN
  // type's flow (Risk gets Risk states, Task gets Task states, etc.).
  // The legacy `flowStates` (above) stays as a fallback when a row's
  // type id is missing from the by-type cache.
  const visibleTypeIds = useMemo(() => {
    const seen = new Set<string>();
    for (const r of windowRoots) {
      if (r.artefact_type_id) seen.add(r.artefact_type_id);
    }
    return Array.from(seen);
  }, [windowRoots]);
  const flowStatesByType = useFlowStatesByType(visibleTypeIds);

  // Patch wrapper to satisfy the ResourceTree contract (returns the row).
  const patchRemote = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      patchAndApply(id, body);
      return { id, ...body } as unknown as WorkItem;
    },
    [patchAndApply],
  );

  const columns = useMemo(
    () => buildWorkItemsColumns(flowStates, patchAndApply, colourMap, {
      onTypeBadgeClick: openInlineForm,
      flowStatesByType,
    }),
    [flowStates, patchAndApply, colourMap, openInlineForm, flowStatesByType],
  );

  const handleSortChange = useCallback(
    (key: string | null, dir: "asc" | "desc") => {
      setSort(key as SortKey | null, dir);
    },
    [setSort],
  );

  // Per-row cog-menu items. Wiring deferred — handlers log for now; the
  // visual surface and dropdown behaviour are the contract for this card.
  const buildCogMenu = useCallback(
    (row: WorkItem) => [
      { key: "edit",      label: "Edit",      onSelect: () => console.log("edit", row.id) },
      { key: "duplicate", label: "Duplicate", onSelect: () => console.log("duplicate", row.id) },
      { key: "move",      label: "Move",      onSelect: () => console.log("move", row.id) },
      { key: "split",     label: "Split",     onSelect: () => console.log("split", row.id) },
      { key: "delete",    label: "Delete",    onSelect: () => console.log("delete", row.id) },
    ],
    [],
  );

  // Build config based on mode or accept from wizardConfig (p_wizard.json).
  // When wizardConfig.filterChips is missing OR doesn't already carry our
  // prefKey-bound chips, we provide them here so the page doesn't have to
  // know the prefKey namespace (TD-URL-FILTER-CHIPS).
  const config = useMemo<ObjectTreeDataConfig<WorkItem>>(() => {
    if (wizardConfig) {
      return {
        ...wizardConfig,
        columns,
        filterChips: wizardConfig.filterChips ?? <WorkItemsFilterChips prefKey={filtersPrefKey} />,
      };
    }
    const isPortfolio = mode === "portfolio_items";
    return {
      label: isPortfolio ? "Portfolio items" : "Work items",
      searchPlaceholder: isPortfolio ? "Search portfolio items…" : "Search work items…",
      ariaLabel: isPortfolio ? "Portfolio items dense grid" : "Work items dense grid",
      treeName: isPortfolio ? "portfolioitems" : "workitems",
      columns,
      dndResourceType: isPortfolio ? "portfolio_item" : "work_item",
      dndEnabled: true,
      defaultSortKey: null,
      defaultSortDir: "asc",
      getParentId: (r) => r.parent_id,
      getChildrenCount: (r) => r.children_count,
      searchAccessor: (r) => `${r.title} vec-${r.key_num}`,
      filterChips: <WorkItemsFilterChips prefKey={filtersPrefKey} />,
      paginationOptions: [25, 50, 100],
      defaultPageSize: 25,
      resourceUrl: isPortfolio ? "/portfolio-items" : "/work-items",
      scope: isPortfolio ? "strategy" : "work",
    };
  }, [mode, columns, wizardConfig]);

  // Sunken header band — badge + title + subtitle below the panel title.
  const headerNode = (subtitleBadge || subtitle || description) ? (
    <header className="tree_accordion-dense__panel-head">
      {subtitleBadge && (
        <span className="tree_accordion-dense__panel-head-num">{subtitleBadge}</span>
      )}
      <div className="tree_accordion-dense__panel-head-body">
        {subtitle && (
          <h3 className="tree_accordion-dense__panel-head-title">{subtitle}</h3>
        )}
        {description && (
          <p className="tree_accordion-dense__panel-head-subtitle">{description}</p>
        )}
      </div>
    </header>
  ) : null;

  // Action bar — sits between the dense-grid header and the filter bar.
  // The artefact-type dropdown IS the create trigger: picking a type opens
  // the create-flyout below the tree (see createFlyoutNode). Clearing the
  // dropdown closes it. Design-only — submit isn't wired yet.
  const actionBarNode = (
    <div className="tree_accordion-dense__actionbar" role="toolbar" aria-label="Work item actions">
      <span
        className={
          "tree_accordion-dense__filterbar-chip" +
          (actionTypeId ? " tree_accordion-dense__filterbar-chip--active" : "")
        }
        style={{ position: "relative" }}
      >
        <span className="tree_accordion-dense__filterbar-chip-icon">
          {actionTypeId ? <MdAdd size={14} /> : <MdOutlineCategory size={14} />}
        </span>
        <span className="tree_accordion-dense__filterbar-chip-label">
          {actionTypeLabel ? `Add new ${actionTypeLabel}` : "Create New"}
        </span>
        <select
          className="tree_accordion-dense__filterbar-chip-select"
          aria-label="Add new artefact — pick type"
          value={actionTypeId}
          onChange={(e) => setActionTypeId(e.target.value)}
        >
          <option value="">Artefact type…</option>
          {actionTypeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </span>

      {actionTypeId && (
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          onClick={() => setActionTypeId("")}
          aria-label="Cancel new artefact"
        >
          Cancel
        </button>
      )}

      <div className="tree_accordion-dense__filterbar-search">
        <span className="tree_accordion-dense__filterbar-search-icon" aria-hidden="true">
          <MdSearch size={12} />
        </span>
        <input
          type="search"
          className="tree_accordion-dense__filterbar-search-input"
          placeholder={config.searchPlaceholder ?? "Search…"}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={config.searchPlaceholder ?? "Search"}
        />
      </div>
      {config.filterChips}
      <span className="tree_accordion-dense__filterbar-spacer" />
    </div>
  );

  // Always mounted so the slide-down/up animation has both states to
  // transition between. Visibility is gated by data-open on the wrapper,
  // which drives grid-template-rows + opacity + translateY in CSS.
  //
  // Field inventory below is design-only (PLA-0052 Path A): every column
  // on `artefacts` (vector_artefacts) plus a custom-fields section that
  // shows one stub input per `field_library.field_type` so the visual
  // contract is reviewable. No live data, no submit wiring.
  const tab = (open: boolean) => (open ? 0 : -1);
  const createFlyoutNode = (
    <section
      className="tree_accordion-dense__createflyout"
      data-open={actionTypeId ? "true" : "false"}
      role="region"
      aria-label={actionTypeLabel ? `New ${actionTypeLabel} form` : "New artefact form"}
      aria-hidden={!actionTypeId}
    >
      <div className="tree_accordion-dense__createflyout-inner">
        <header className="tree_accordion-dense__createflyout-head">
          <h3 className="tree_accordion-dense__createflyout-title">
            New {actionTypeLabel ?? "artefact"}
          </h3>
          <button
            type="button"
            className="tree_accordion-dense__createflyout-close"
            aria-label="Close form"
            tabIndex={tab(!!actionTypeId)}
            onClick={() => setActionTypeId("")}
          >
            ×
          </button>
        </header>
        <form
          className="tree_accordion-dense__createflyout-form"
          onSubmit={(e) => {
            e.preventDefault();
            // Design-only — surface intent in console until wired.
            // eslint-disable-next-line no-console
            console.log("Create artefact", { artefact_type_id: actionTypeId, label: actionTypeLabel });
            setActionTypeId("");
          }}
        >
          {/* ─── Core (artefacts columns) ──────────────────────────── */}
          <div className="tree_accordion-dense__createflyout-section">
            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">
                Title <span className="tree_accordion-dense__createflyout-required">*</span>
              </span>
              <input
                type="text"
                className="tree_accordion-dense__createflyout-input"
                placeholder={actionTypeLabel ? `${actionTypeLabel} title…` : "Title…"}
                tabIndex={tab(!!actionTypeId)}
              />
            </label>

            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">Description</span>
              <textarea
                className="tree_accordion-dense__createflyout-input"
                rows={3}
                placeholder="Optional rich text"
                tabIndex={tab(!!actionTypeId)}
              />
            </label>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Parent artefact
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— None (root) —</option>
                  <option value="stub-1">Epic: Onboarding revamp</option>
                  <option value="stub-2">Feature: Risk register</option>
                </select>
              </label>

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Topology node
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— Unassigned —</option>
                  <option value="stub-a">Platform / Identity</option>
                  <option value="stub-b">Platform / Billing</option>
                  <option value="stub-c">Revenue / Acquisition</option>
                </select>
              </label>
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Flow state
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— Initial —</option>
                  <option value="backlog">Backlog</option>
                  <option value="ready">Ready</option>
                  <option value="doing">Doing</option>
                </select>
              </label>

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Position
                </span>
                <input
                  type="number"
                  className="tree_accordion-dense__createflyout-input"
                  defaultValue={0}
                  tabIndex={tab(!!actionTypeId)}
                />
              </label>
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Owner
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— Me —</option>
                  <option value="stub-u1">Alex Chen</option>
                  <option value="stub-u2">Priya Shah</option>
                </select>
              </label>

              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">
                  Assigned to
                </span>
                <select
                  className="tree_accordion-dense__createflyout-input"
                  tabIndex={tab(!!actionTypeId)}
                  defaultValue=""
                >
                  <option value="">— Unassigned —</option>
                  <option value="stub-u1">Alex Chen</option>
                  <option value="stub-u2">Priya Shah</option>
                </select>
              </label>
            </div>

            <p className="tree_accordion-dense__createflyout-meta">
              <span>Type: <strong>{actionTypeLabel ?? "—"}</strong></span>
              <span>Number: <strong>auto</strong></span>
              <span>Created by: <strong>me</strong></span>
              <span>Workspace + Subscription: <strong>session-scoped</strong></span>
            </p>
          </div>

          {/* ─── Custom fields (per-type field_library bindings) ───── */}
          <div className="tree_accordion-dense__createflyout-section">
            <div className="tree_accordion-dense__createflyout-section-head">
              <span className="cf-tree__section-label">Custom Fields</span>
              <span className="tree_accordion-dense__createflyout-stub-tag">stub</span>
            </div>

            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">Short text (textbox)</span>
              <input type="text" className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
            </label>

            <label className="tree_accordion-dense__createflyout-field">
              <span className="tree_accordion-dense__createflyout-field-label">Long text (richtext)</span>
              <textarea rows={2} className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
            </label>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Integer</span>
                <input type="number" step={1} className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
              </label>
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Decimal</span>
                <input type="number" step="0.01" className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
              </label>
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Date</span>
                <input type="date" className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
              </label>
              <label className="tree_accordion-dense__createflyout-field tree_accordion-dense__createflyout-field--inline">
                <input type="checkbox" tabIndex={tab(!!actionTypeId)} />
                <span className="tree_accordion-dense__createflyout-field-label">Boolean</span>
              </label>
            </div>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Select (one)</span>
                <select className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} defaultValue="">
                  <option value="">— Choose —</option>
                  <option value="a">Option A</option>
                  <option value="b">Option B</option>
                </select>
              </label>
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">Multiselect</span>
                <select multiple size={3} className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)}>
                  <option value="a">Option A</option>
                  <option value="b">Option B</option>
                  <option value="c">Option C</option>
                </select>
              </label>
            </div>

            <fieldset className="tree_accordion-dense__createflyout-radiogroup">
              <legend className="tree_accordion-dense__createflyout-field-label">Radio</legend>
              <label className="tree_accordion-dense__createflyout-radio">
                <input type="radio" name="stub-radio" tabIndex={tab(!!actionTypeId)} /> One
              </label>
              <label className="tree_accordion-dense__createflyout-radio">
                <input type="radio" name="stub-radio" tabIndex={tab(!!actionTypeId)} /> Two
              </label>
              <label className="tree_accordion-dense__createflyout-radio">
                <input type="radio" name="stub-radio" tabIndex={tab(!!actionTypeId)} /> Three
              </label>
            </fieldset>

            <div className="tree_accordion-dense__createflyout-row">
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">User picker</span>
                <select className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} defaultValue="">
                  <option value="">— Choose user —</option>
                  <option value="stub-u1">Alex Chen</option>
                  <option value="stub-u2">Priya Shah</option>
                </select>
              </label>
              <label className="tree_accordion-dense__createflyout-field">
                <span className="tree_accordion-dense__createflyout-field-label">URL</span>
                <input type="url" placeholder="https://…" className="tree_accordion-dense__createflyout-input" tabIndex={tab(!!actionTypeId)} />
              </label>
            </div>
          </div>

          <div className="tree_accordion-dense__createflyout-actions">
            <button
              type="button"
              className="btn btn--sm btn--secondary"
              tabIndex={tab(!!actionTypeId)}
              onClick={() => setActionTypeId("")}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn--sm btn--primary"
              tabIndex={tab(!!actionTypeId)}
            >
              + Create {actionTypeLabel ?? "artefact"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );

  const inlineFormNode = (
    <ArtefactInlineForm
      artefactId={openInlineFormId}
      resourceUrl={resourceUrl}
      scope={config.scope ?? "work"}
      onClose={closeInlineForm}
      onSaved={(body) => {
        if (openInlineFormId) patchAndApply(openInlineFormId, body);
      }}
    />
  );

  const inner = (
    <>
      {headerNode}
      {actionBarNode}
      {createFlyoutNode}
      {/* TODO(00456): wire bulk action handlers in WS3-D */}
      <BulkActionBar selectedIds={selectedIds} onClear={clearSelection} />
      <ResourceTree<WorkItem>
        roots={windowRoots}
        total={total}
        getId={(r) => r.id}
        getParentId={config.getParentId}
        getChildrenCount={config.getChildrenCount}
        fetchChildren={fetchChildren}
        patch={patchRemote}
        columns={config.columns}
        pagination={{ pageSize, options: config.paginationOptions }}
        paginationPosition="bottom"
        search={{ placeholder: config.searchPlaceholder, accessor: config.searchAccessor }}
        sort={{ key: sortKey, dir: sortDir, onChange: handleSortChange }}
        {...(config.dndEnabled && { dnd: { resourceType: config.dndResourceType } })}
        selection={{ mode: "multi", selectedIds, onSelectionChange: setSelectedIds }}
        cogMenu={buildCogMenu}
        selectedId={selectedId}
        onSelect={onSelect}
        pageIndex={pageIndex}
        onPageIndexChange={setPageIndex}
        onPageSizeChange={setPageSize}
        loading={loadingWindow}
        filterChips={config.filterChips}
        hideFilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        ariaLabel={config.ariaLabel}
        name={config.treeName}
        getRowClass={(row) =>
          row.id === openInlineFormId
            ? "tree_accordion-dense__row--form-open"
            : undefined
        }
      />
    </>
  );

  // When the page passes title + addressableName, ObjectTree owns its own
  // <Panel>. Otherwise (legacy callers still wrapping with their own Panel)
  // we render bare. The inline form is rendered as a SIBLING after the
  // panel — not a child — so the panel's white background ends at the
  // pagination's rounded bottom corners, and the gap above the form
  // shows the page canvas through (no holdover panel bg).
  if (title && addressableName) {
    return (
      <>
        <Panel name={addressableName} title={title}>
          {inner}
        </Panel>
        {inlineFormNode}
      </>
    );
  }
  return (
    <>
      <div>{inner}</div>
      {inlineFormNode}
    </>
  );
}
