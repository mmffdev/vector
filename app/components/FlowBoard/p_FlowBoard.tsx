"use client";

// FlowBoard — top-level component. FB1.3.7.
//
// Composes all Phase-3 building blocks:
//   FB1.3.1 — loader, registry (FlowBoardConfig, getFlowBoardSlotName)
//   FB1.3.2 — useFlowBoardData (columns + cards + WIP)
//   FB1.3.3 — BoardColumnHeader
//   FB1.3.4 — BoardColumn, useFlowStateTransitions, useFlowBoardDnd, patchArtefactFlowState
//   FB1.3.5 — BoardCard
//   FB1.3.6 — useNodeMembership, WipGearButton, WipSettingsModal
//
// Architecture:
//   FlowBoard (outer) — owns type-switcher state, boardKey (refetch),
//                       controlled/uncontrolled mode split.
//   FlowBoardBoard (inner, keyed on boardKey) — owns data hooks + DnD
//                       so incrementing boardKey triggers a clean remount
//                       of useFlowBoardData (refetch without modifying the hook).
//
// Flyout note (TODO FB1.4.1):
//   ObjectTreeDetailFlyout requires a Body adapter that bridges its
//   DetailFlyoutBodyProps (rowId, onClose, onSaved) onto ArtefactInlineForm's
//   (artefactId, resourceUrl, scope, onClose, onSaved) prop shape. That
//   adapter is > 50 LoC and belongs in a dedicated sub-component. Left as
//   a TODO so FB1.4.1 can wire it with full context. The flyoutOpenId state
//   and handleCardClick are stubbed here so the composition slot is reserved.
//
// Addressable slot:
//   data-samantha-slot={getFlowBoardSlotName(config.name)} on the root div.
//   Slot string: samantha._viewport.app._kind.panel.flow_board_{config.name}

import React, { useMemo, useState } from "react";
import { DndContext, DragOverlay, useSensor, useSensors, PointerSensor } from "@dnd-kit/core";
import { MdTune, MdFlag, MdOutlinePerson } from "react-icons/md";
import Panel from "@/app/components/Panel";
import { DenseGridHeader } from "@/app/components/ObjectTreeV2/kinds/DenseGridHeader";
import { ActionBar } from "@/app/components/ObjectTreeV2/kinds/ActionBar";
import NavigationPie from "@/app/components/NavigationPie";
import { useArtefactPriorityCatalogue } from "@/app/contexts/ArtefactPriorityCatalogueContext";
import type { FlowBoardConfig } from "@/app/components/FlowBoard/loader";
import { loadFlowBoardConfig } from "@/app/components/FlowBoard/loader";
// getFlowBoardSlotName is no longer used directly — <Panel name=…> registers
// the addressable at samantha._viewport.app._kind.panel.<name> via
// useRegisterAddressable, replacing the legacy data-samantha-slot attribute
// (which AddressAnchorResolver never read; it watches data-address instead).
// Helper kept in registry.ts for any caller that still wants to compute the
// slot string for diagnostics/tests.
import { useFlowBoardData } from "@/app/components/FlowBoard/hooks/useFlowBoardData";
import { useFlowStateTransitions } from "@/app/components/FlowBoard/hooks/useFlowStateTransitions";
import { useFlowBoardDnd } from "@/app/components/FlowBoard/hooks/useFlowBoardDnd";
import { patchArtefactFlowState } from "@/app/components/FlowBoard/hooks/usePatchArtefactFlowState";
import { BoardColumn } from "@/app/components/FlowBoard/columns/BoardColumn";
import { BoardCard } from "@/app/components/FlowBoard/card/BoardCard";
import { WipGearButton } from "@/app/components/FlowBoard/settings/WipGearButton";
import { WipSettingsModal } from "@/app/components/FlowBoard/settings/WipSettingsModal";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { useSentinel } from "@/app/sentinel";
import { notify } from "@/app/lib/toast";
import type { ArtefactCard, FlowBoardColumn } from "@/app/components/FlowBoard/hooks/useFlowBoardData";
import { ObjectTreeDetailFlyout } from "@/app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout";
import type { DetailFlyoutBodyProps } from "@/app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout";
import ArtefactInlineForm from "@/app/components/ArtefactInlineForm";

// ── FlowBoard flyout body adapter ─────────────────────────────────────────────
//
// Bridges DetailFlyoutBodyProps (rowId, onClose, onSaved) onto
// ArtefactInlineForm's prop shape (artefactId, resourceUrl, scope, onClose, onSaved).
// Scope is "work" because FlowBoard only surfaces work-scoped artefact types.
// resourceUrl mirrors the work-items grid.

function FlowBoardFlyoutBody({ rowId, onClose, onSaved }: DetailFlyoutBodyProps) {
  return (
    <ArtefactInlineForm
      artefactId={rowId}
      resourceUrl="/work-items"
      scope="work"
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

// ── Props contract (spec §6) ──────────────────────────────────────────────────

export interface FlowBoardProps {
  /**
   * Validated sidecar config — import the JSON and pass through
   * `loadFlowBoardConfig` before passing here, or pass the raw JSON and
   * supply a `configOverride` that will be merged inside.
   */
  config: FlowBoardConfig;

  /**
   * Topology node UUID the board belongs to. When omitted the component
   * resolves the active node from `useSentinel().sentinel_focus_node`.
   */
  topologyNodeId?: string;

  /**
   * Currently selected artefact type UUID. When provided alongside
   * `onArtefactTypeChange`, the parent controls the switcher (controlled mode).
   * When omitted the component owns the selection as internal state (uncontrolled mode).
   */
  artefactTypeId?: string;

  /**
   * Called when the type switcher changes. Required for controlled mode;
   * ignored when `artefactTypeId` is omitted.
   */
  onArtefactTypeChange?: (id: string) => void;

  /**
   * Per-mount config override — shallow-merged over the validated config
   * via `loadFlowBoardConfig`. Useful for samanthaAPI mounts that need a
   * single field customised without forking the JSON sidecar.
   */
  configOverride?: Partial<FlowBoardConfig>;
}

// ── Inner board component (keyed on boardKey for clean refetch) ───────────────

interface FlowBoardFilters {
  /** Lower-cased title substring; empty = no search. */
  search: string;
  /** Set of priority NAMES (case-sensitive, matches the wire shape on
   *  ArtefactCard.priority). Empty set = show all. */
  priorityNames: Set<string>;
  /** Set of owner user ids. Empty set = show all. */
  ownerIds: Set<string>;
}

interface FlowBoardBoardProps {
  resolvedConfig: Readonly<FlowBoardConfig>;
  topologyNodeId: string;
  activeTypeId: string;
  /** Client-side filter bundle driven by the outer ActionBar chips. The
   *  inner board applies these over its already-fetched cards (no extra
   *  network calls — search/priority/owner all sit in the card payload).
   *  When all filters are inert the column data passes through untouched. */
  filters: FlowBoardFilters;
  /** WIP-modal open/close lives at the outer FlowBoard scope so the gear
   *  button in the ActionBar can drive it. The inner board still renders
   *  the modal here because the modal needs `columns` + `refetch` from
   *  useFlowBoardData. */
  isWipModalOpen: boolean;
  onWipModalClose: () => void;
}

function FlowBoardBoard({
  resolvedConfig,
  topologyNodeId,
  activeTypeId,
  filters,
  isWipModalOpen,
  onWipModalClose,
}: FlowBoardBoardProps): React.ReactElement {
  // Data hooks. refetch() is exposed by useFlowBoardData (added post-FB1.4.1
  // so we re-fetch in place without unmounting the board — replaces the
  // FB1.3.7 boardKey-remount pattern that flashed the whole surface on
  // every successful drop).
  const { columns, isLoading, error, refetch } = useFlowBoardData({
    topologyNodeId,
    artefactTypeId: activeTypeId,
  });
  const { isAllowed } = useFlowStateTransitions(activeTypeId);

  // Optimistic move state: when a card is dragging we locally shift it
  // to the target column so the UI responds instantly.
  const [optimisticMove, setOptimisticMove] = useState<{
    cardId: string;
    fromStateId: string;
    toStateId: string;
  } | null>(null);

  // Flyout state — open artefact id or null when closed.
  const [flyoutOpenId, setFlyoutOpenId] = useState<string | null>(null);

  // ── Column derivation pipeline ──────────────────────────────────────────
  // Two passes: (1) apply client-side filter chips → filteredColumns;
  //             (2) overlay the optimistic drag move on top → visibleColumns.
  // Splitting the passes keeps each step's responsibility crisp and means
  // the drag overlay still works against the filtered card set (a dragged
  // card stays visible even if it would otherwise have been filtered out
  // mid-drag — UX win, no stranded ghosts).

  const filteredColumns = useMemo((): FlowBoardColumn[] => {
    const hasSearch = filters.search.length > 0;
    const hasPriority = filters.priorityNames.size > 0;
    const hasOwner = filters.ownerIds.size > 0;
    if (!hasSearch && !hasPriority && !hasOwner) return columns;
    return columns.map((col) => ({
      ...col,
      cards: col.cards.filter((c) => {
        if (hasSearch && !c.title.toLowerCase().includes(filters.search))
          return false;
        if (
          hasPriority &&
          !(c.priority && filters.priorityNames.has(c.priority))
        )
          return false;
        if (hasOwner && !(c.assignee && filters.ownerIds.has(c.assignee)))
          return false;
        return true;
      }),
    }));
  }, [columns, filters]);

  // Build optimistic column view when a drag is in progress (applied
  // OVER filteredColumns so search/priority/owner survive the drag).
  const visibleColumns = useMemo((): FlowBoardColumn[] => {
    if (!optimisticMove) return filteredColumns;
    return filteredColumns.map((col) => {
      if (col.flowState.id === optimisticMove.fromStateId) {
        return {
          ...col,
          cards: col.cards.filter((c) => c.id !== optimisticMove.cardId),
        };
      }
      if (col.flowState.id === optimisticMove.toStateId) {
        const movingCard = filteredColumns
          .flatMap((c) => c.cards)
          .find((c) => c.id === optimisticMove.cardId);
        if (!movingCard) return col;
        const updated: ArtefactCard = {
          ...movingCard,
          flowStateId: optimisticMove.toStateId,
        };
        return { ...col, cards: [...col.cards, updated] };
      }
      return col;
    });
  }, [filteredColumns, optimisticMove]);

  // Flat card list for dnd lookup
  const allCards = useMemo(
    () => visibleColumns.flatMap((col) => col.cards),
    [visibleColumns],
  );

  // Drop handler — optimistic move + PATCH + revert on error
  const handleDrop = async (card: ArtefactCard, newStateId: string) => {
    setOptimisticMove({
      cardId: card.id,
      fromStateId: card.flowStateId,
      toStateId: newStateId,
    });
    try {
      await patchArtefactFlowState(card.id, newStateId);
      // Server accepted — clear optimistic and refetch in place for the
      // rollup-recalc'd state from the backend. refetch() does NOT
      // unmount the board (no flash); the boardKey-remount fallback is
      // kept for the type-switcher case where a fresh subtree IS desired.
      setOptimisticMove(null);
      refetch();
    } catch (err: unknown) {
      // Revert optimistic update and surface the error as a toast
      setOptimisticMove(null);
      notify.apiError(err, "Couldn't move the card");
    }
  };

  // DnD hook — provides sensors + drag start/end + active card reference
  const { activeCard, activeStateId, onDragStart, onDragEnd } = useFlowBoardDnd({
    allCards,
    onDrop: (card, newStateId) => {
      void handleDrop(card, newStateId);
    },
  });

  const sensors = useSensors(useSensor(PointerSensor));

  // Card click handler — opens ObjectTreeDetailFlyout for the clicked artefact.
  const handleCardClick = (artefactId: string): void => {
    // Toggle: clicking the same card again closes the flyout.
    setFlyoutOpenId((prev) => (prev === artefactId ? null : artefactId));
  };

  // Progressive render: the shell (toolbar + column rail) renders immediately
  // even when data is still arriving. We show a skeleton column rail while
  // `columns` is empty AND we're loading; we keep the real columns visible
  // during re-fetches (so a drag-induced refetch doesn't blank the board).
  // Errors replace only the columns area, not the whole shell — the toolbar
  // (incl. gear button) stays clickable so the user can recover.
  const showSkeleton = isLoading && visibleColumns.length === 0;

  return (
    <div className="flow-board">
      {/* Gear button moved into the outer <ActionBar> chrome — the inner
          toolbar block is gone. Modal still lives here because it needs
          columns + refetch from useFlowBoardData; open/close state is
          driven by the outer wrapper via `isWipModalOpen` prop. */}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div
          className="flow-board__Columns"
          style={{
            // Sidecar-controlled minimum column width (Rally-style).
            // Columns grow to share spare width, but never shrink below
            // this floor; once cumulative min-widths exceed the panel
            // the rail scrolls. Default 280px when the sidecar omits it.
            ["--col-min-width" as string]: `${resolvedConfig.columns.column_min_width}px`,
          }}
        >
          {showSkeleton ? (
            // 3 placeholder columns — the eventual column count is unknown
            // until flow_states arrives; 3 is the most common case and the
            // shimmer telegraphs activity without committing to a specific
            // shape. Replaced atomically once the real columns land.
            <>
              {[0, 1, 2].map((i) => (
                <div
                  key={`skel-${i}`}
                  className="flow-board__Column flow-board__Column-skeleton"
                  aria-hidden="true"
                >
                  <div
                    className="skeleton flow-board__Skeleton_header"
                    style={{ ["--skeleton-delay" as string]: `${i * 80}ms` }}
                  />
                  <div className="flow-board__Column_body">
                    {[0, 1, 2].map((j) => (
                      <div
                        key={`skel-${i}-${j}`}
                        className="skeleton flow-board__Skeleton_card"
                        style={{ ["--skeleton-delay" as string]: `${i * 80 + j * 120}ms` }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          ) : error ? (
            <div className="flow-board__Error" role="alert">
              Failed to load board. {error.message}
            </div>
          ) : (
            visibleColumns.map((col) => (
              <BoardColumn
                key={col.flowState.id}
                column={col}
                activeStateId={activeStateId}
                isAllowed={isAllowed}
              >
                {col.cards.map((card) => (
                  <BoardCard
                    key={card.id}
                    artefact={card}
                    fields={resolvedConfig.card.default_fields}
                    onClick={handleCardClick}
                  />
                ))}
              </BoardColumn>
            ))
          )}
        </div>

        <DragOverlay>
          {activeCard ? (
            <BoardCard
              artefact={activeCard}
              fields={resolvedConfig.card.default_fields}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      {isWipModalOpen && (
        <WipSettingsModal
          isOpen={isWipModalOpen}
          onClose={onWipModalClose}
          onSaved={() => {
            refetch();
            onWipModalClose();
          }}
          topologyNodeId={topologyNodeId}
          artefactTypeId={activeTypeId}
          columns={visibleColumns.map((c) => ({
            flowStateId: c.flowState.id,
            flowStateName: c.flowState.name,
            currentLimit: c.wipLimit,
          }))}
        />
      )}

      {/* Flyout — inline below the board columns; always mounted so
          ArtefactInlineForm preserves its lifecycle across open/close. */}
      <ObjectTreeDetailFlyout
        openId={flyoutOpenId}
        Body={FlowBoardFlyoutBody}
        onClose={() => setFlyoutOpenId(null)}
      />
    </div>
  );
}

// ── Top-level component ────────────────────────────────────────────────────────

/**
 * FlowBoard — Kanban board whose columns are the custom flow states of a
 * selected artefact type, cards are live artefacts at the sentinel scope,
 * and card movement fires the existing flow-state PATCH.
 *
 * Controlled mode: supply both `artefactTypeId` and `onArtefactTypeChange`.
 * Uncontrolled mode: omit both; the component owns the selected type state.
 *
 * `topologyNodeId` defaults to `sentinel_focus_node` when omitted.
 * `configOverride` is shallow-merged over the sidecar via `loadFlowBoardConfig`.
 */
export function FlowBoard({
  config,
  topologyNodeId: topologyNodeIdProp,
  artefactTypeId: artefactTypeIdProp,
  onArtefactTypeChange,
  configOverride,
}: FlowBoardProps): React.ReactElement {
  // Merge config with override (shallow-merge, deep-frozen result)
  const resolvedConfig = useMemo(
    () => loadFlowBoardConfig(config as unknown, configOverride),
    [config, configOverride],
  );

  // Sentinel for default node id fallback
  const sentinel = useSentinel();
  const topologyNodeId =
    topologyNodeIdProp ?? sentinel.sentinel_focus_node ?? "";

  // Controlled vs uncontrolled type switcher
  // Controlled:   artefactTypeIdProp !== undefined AND onArtefactTypeChange defined
  // Uncontrolled: either is absent → component owns state
  const isControlled =
    artefactTypeIdProp !== undefined && onArtefactTypeChange !== undefined;

  const [internalTypeId, setInternalTypeId] = useState<string>("");

  const activeTypeId = isControlled ? artefactTypeIdProp : internalTypeId;

  const setActiveTypeId = (id: string): void => {
    if (isControlled) {
      onArtefactTypeChange(id);
    } else {
      setInternalTypeId(id);
    }
  };

  // Artefact type catalogue for the type-switcher dropdown
  const { types: catalogueTypes } = useArtefactTypeCatalogue();

  // Filter types per sidecar scope + excluded prefixes
  const switcherTypes = useMemo(
    () =>
      catalogueTypes.filter(
        (t) =>
          t.scope === resolvedConfig.artefact_type_scope &&
          !resolvedConfig.exclude_prefixes.includes(t.prefix),
      ),
    [catalogueTypes, resolvedConfig.artefact_type_scope, resolvedConfig.exclude_prefixes],
  );

  // When the catalogue loads (or scope changes), seed the uncontrolled
  // internal selection to the default prefix if not yet set.
  React.useEffect(() => {
    if (isControlled) return;
    if (internalTypeId !== "") return;
    if (switcherTypes.length === 0) return;

    const defaultType =
      switcherTypes.find(
        (t) => t.prefix === resolvedConfig.default_artefact_type_prefix,
      ) ?? switcherTypes[0];

    if (defaultType) {
      setInternalTypeId(defaultType.id);
    }
  }, [
    isControlled,
    internalTypeId,
    switcherTypes,
    resolvedConfig.default_artefact_type_prefix,
  ]);

  // boardKey — incrementing this re-mounts FlowBoardBoard, triggering a fresh
  // useFlowBoardData call (full remount). Now only used implicitly on
  // type-switcher change (the `key` includes activeTypeId, so swapping
  // type unmounts + remounts naturally — boardKey itself is reserved
  // as an escape hatch for future "force everything fresh" cases).
  const [boardKey] = useState(0);

  // Active type metadata for the DenseGridHeader badge + subtitle. When the
  // catalogue hasn't loaded yet OR the active id isn't in the filtered set
  // (rare race), both fall back to undefined and DenseGridHeader gracefully
  // omits the row. The sidecar's top-level `description` field provides the
  // sunken-band description line; it doesn't depend on the active type.
  const activeType = useMemo(
    () => switcherTypes.find((t) => t.id === activeTypeId),
    [switcherTypes, activeTypeId],
  );
  const headerBadge = activeType?.prefix;
  const headerSubtitle = activeType?.name;

  // ── ActionBar filter state ──────────────────────────────────────────────
  //
  // All three filters apply CLIENT-SIDE over useFlowBoardData's columns —
  // backend already filters cards to the active artefact type, and the
  // remaining facets (title contains, priority, owner) work over fields
  // that already arrive in the card payload. No new backend calls.
  //
  // In-memory only for now (no per-page persistence). Persistence via
  // the work-items useWorkItemsFilters(prefKey) pattern is a follow-up.

  // Search input (filters cards by title substring, case-insensitive).
  const [searchQuery, setSearchQuery] = useState("");

  // Priority filter — UUIDs of priorities to KEEP (empty = show all).
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);

  // Owner filter — user ids to KEEP (empty = show all). "Mine" toggle
  // pushes the current user id; clicking the chip again clears it.
  const [ownerFilter, setOwnerFilter] = useState<string[]>([]);

  // Priority catalogue for the pie options. The hook is workspace-scoped
  // via sentinel inside the provider; no second fetch.
  const { priorities: priorityCatalogue } = useArtefactPriorityCatalogue();

  // Bundle the filter state into a single object the inner board consumes.
  // Reference identity stable when nothing changed — useMemo so the inner
  // board's downstream memoisation isn't invalidated on every render.
  const filters = useMemo(
    () => ({
      search: searchQuery.trim().toLowerCase(),
      priorityNames: new Set(
        priorityCatalogue
          .filter((p) => priorityFilter.includes(p.id))
          .map((p) => p.name),
      ),
      ownerIds: new Set(ownerFilter),
    }),
    [searchQuery, priorityFilter, priorityCatalogue, ownerFilter],
  );

  // Pie option arrays.
  const typeOptions = useMemo(
    () => switcherTypes.map((t) => ({ value: t.id, label: t.name })),
    [switcherTypes],
  );
  const priorityOptions = useMemo(
    () =>
      priorityCatalogue.map((p) => ({
        value: p.id,
        label: p.name,
        color: p.colour ?? undefined,
      })),
    [priorityCatalogue],
  );

  // Owner pie — derived from the cards we already loaded would be ideal,
  // but the outer FlowBoard doesn't have the card list (FlowBoardBoard
  // owns useFlowBoardData). For now expose a single "Mine" affordance
  // matching the work-items pattern. A full owner pie is a follow-up
  // once the card list is hoisted (or a separate /users-in-scope fetch
  // lands here).
  const meId = sentinel.sentinel_user?.id ?? null;
  const ownerIsMe = ownerFilter.length > 0 && ownerFilter[0] === meId;

  // WIP-modal open/close hoisted from the inner board so the gear
  // button in the ActionBar can drive it. The modal itself stays
  // inside FlowBoardBoard where it has columns + refetch in scope.
  const [isWipModalOpen, setIsWipModalOpen] = useState(false);

  // Chrome split:
  //   <Panel>             outer white card + title bar + help icon + addressable
  //   <DenseGridHeader>   sunken badge + subtitle + description band
  //   <ActionBar>         filter chips (Type / Priority / Mine) + search + gear
  //   <FlowBoardBoard>    the board itself; receives `filters` to apply client-side
  //
  // Mirrors the ObjectTreeV2 Risk-register chrome so FlowBoard reads as a
  // first-class panel, not a bare canvas.
  return (
    <Panel name={resolvedConfig.name} title={resolvedConfig.panel.title}>
      <DenseGridHeader
        badge={headerBadge}
        subtitle={headerSubtitle}
        description={resolvedConfig.description}
      />

      <ActionBar
        ariaLabel="Flow board actions"
        search={{
          placeholder: "Search cards…",
          value: searchQuery,
          onChange: setSearchQuery,
        }}
        filterChips={
          <>
            {resolvedConfig.type_switcher.show && (
              <NavigationPie
                label={resolvedConfig.type_switcher.label}
                icon={<MdTune size={14} />}
                options={typeOptions}
                // Single-select shim: the pie is multi-select by default;
                // we project activeTypeId into a one-element array, and on
                // change we take the most-recent click (the value the user
                // toggled IN, ignoring any toggled-out tail). Clicking the
                // currently-active type clears it — that empties the
                // board until the user picks again, matching expected
                // single-select semantics.
                selected={activeTypeId ? [activeTypeId] : []}
                onChange={(next) => {
                  const newlySelected = next.find((id) => id !== activeTypeId);
                  setActiveTypeId(newlySelected ?? "");
                }}
              />
            )}
            <NavigationPie
              label="Priority"
              icon={<MdFlag size={14} />}
              options={priorityOptions}
              selected={priorityFilter}
              onChange={setPriorityFilter}
            />
            <button
              type="button"
              className={
                "navigation-pie__Chip" +
                (ownerIsMe ? " navigation-pie__Chip-active" : "")
              }
              onClick={() =>
                setOwnerFilter(ownerIsMe ? [] : meId ? [meId] : [])
              }
              disabled={!meId}
              aria-pressed={ownerIsMe}
            >
              <span className="navigation-pie__Chip_icon">
                <MdOutlinePerson size={14} />
              </span>
              <span className="navigation-pie__Chip_label">
                {ownerIsMe ? "Mine" : "Owner"}
              </span>
            </button>
            {/* Gear lives at the right edge of the action bar. Membership
                gating is internal to WipGearButton — non-members see
                nothing rendered, so the chip just disappears for them. */}
            <span className="flow-board__GearWrap">
              <WipGearButton
                topologyNodeId={topologyNodeId}
                onClick={() => setIsWipModalOpen(true)}
              />
            </span>
          </>
        }
      />

      {activeTypeId ? (
        <FlowBoardBoard
          key={`${activeTypeId}::${boardKey}`}
          resolvedConfig={resolvedConfig}
          topologyNodeId={topologyNodeId}
          activeTypeId={activeTypeId}
          filters={filters}
          isWipModalOpen={isWipModalOpen}
          onWipModalClose={() => setIsWipModalOpen(false)}
        />
      ) : (
        <div className="flow-board__Loading">Loading types…</div>
      )}
    </Panel>
  );
}

export default FlowBoard;
