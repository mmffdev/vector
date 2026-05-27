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
import type { FlowBoardConfig } from "@/app/components/FlowBoard/loader";
import { loadFlowBoardConfig } from "@/app/components/FlowBoard/loader";
import { getFlowBoardSlotName } from "@/app/components/FlowBoard/registry";
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

interface FlowBoardBoardProps {
  resolvedConfig: Readonly<FlowBoardConfig>;
  topologyNodeId: string;
  activeTypeId: string;
  slotName: string;
}

function FlowBoardBoard({
  resolvedConfig,
  topologyNodeId,
  activeTypeId,
  slotName,
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

  // WIP modal state
  const [isWipModalOpen, setIsWipModalOpen] = useState(false);

  // Flyout state — open artefact id or null when closed.
  const [flyoutOpenId, setFlyoutOpenId] = useState<string | null>(null);

  // Build optimistic column view when a drag is in progress
  const visibleColumns = useMemo((): FlowBoardColumn[] => {
    if (!optimisticMove) return columns;
    return columns.map((col) => {
      if (col.flowState.id === optimisticMove.fromStateId) {
        return {
          ...col,
          cards: col.cards.filter((c) => c.id !== optimisticMove.cardId),
        };
      }
      if (col.flowState.id === optimisticMove.toStateId) {
        const movingCard = columns
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
  }, [columns, optimisticMove]);

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
    <div className="flow-board" data-samantha-slot={slotName}>
      <div className="flow-board__Toolbar">
        <WipGearButton
          topologyNodeId={topologyNodeId}
          onClick={() => setIsWipModalOpen(true)}
        />
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flow-board__Columns">
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
          onClose={() => setIsWipModalOpen(false)}
          onSaved={() => {
            refetch();
            setIsWipModalOpen(false);
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

  // Addressable slot name from registry
  const slotName = getFlowBoardSlotName(resolvedConfig.name);

  return (
    <div className="flow-board__Root">
      {resolvedConfig.type_switcher.show && (
        <div className="flow-board__Toolbar">
          <label className="flow-board__TypeLabel" htmlFor="flow-board-type-switcher">
            {resolvedConfig.type_switcher.label}
          </label>
          <select
            id="flow-board-type-switcher"
            className="flow-board__TypeSelect"
            value={activeTypeId}
            onChange={(e) => setActiveTypeId(e.target.value)}
            aria-label={resolvedConfig.type_switcher.label}
          >
            {switcherTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {activeTypeId ? (
        <FlowBoardBoard
          key={`${activeTypeId}::${boardKey}`}
          resolvedConfig={resolvedConfig}
          topologyNodeId={topologyNodeId}
          activeTypeId={activeTypeId}
          slotName={slotName}
        />
      ) : (
        <div className="flow-board__Loading">Loading types…</div>
      )}
    </div>
  );
}

export default FlowBoard;
