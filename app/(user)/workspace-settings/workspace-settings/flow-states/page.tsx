"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Modifier } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { BsArrowsExpand, BsPencilSquare, BsPlusCircleDotted, BsXCircle } from "react-icons/bs";
import { FaRegTrashCan } from "react-icons/fa6";
import { notify } from "@/app/lib/toast";
import { safeInk } from "@/app/lib/colourUtils";
import { useAuth } from "@/app/contexts/AuthContext";
import PageAnchorNav, { type AnchorNavItem } from "@/app/components/PageAnchorNav";
import Panel from "@/app/components/Panel";
import {
  flowStatesApi,
  type FlowExitRule,
  type FlowGroup,
  type FlowState,
  type FlowsResponse,
  type ResetPreview,
} from "@/app/lib/flowStatesApi";

type ExpanderMode = "edit";
interface ExpanderSlot {
  stateId: string;
  mode: ExpanderMode;
}

// Friendly workspace label — mirrors the derivation used in the sidebar so the
// help copy matches the chrome the user already sees.
function useWorkspaceName(): string {
  const { user } = useAuth();
  if (!user) return "this workspace";
  return user.subscription_id === "00000000-0000-0000-0000-000000000001"
    ? "MMFFDev"
    : user.subscription_id.slice(0, 8).toUpperCase();
}

// ── Colour palette ────────────────────────────────────────────────────────────
const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#ec4899", "#f43f5e", "#64748b",
  "#6b7280", "#78716c",
];

const KIND_LABEL: Record<string, string> = {
  backlog:     "Backlog",
  todo:        "To Do",
  in_progress: "In Progress",
  done:        "Done",
  accepted:    "Accepted",
  cancelled:   "Cancelled",
};

// Kind → border stroke colour when no custom colour is set on the state.
const KIND_STROKE: Record<string, string> = {
  backlog:     "#cbd5e1",   // slate-300
  todo:        "var(--border)",
  in_progress: "#93c5fd",   // blue-300
  done:        "#86efac",   // green-300
  accepted:    "#d8b4fe",   // purple-300
  cancelled:   "#fca5a5",   // red-300
};


// Restrict drag movement to the vertical axis only (no @dnd-kit/modifiers dep).
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
});

// ── FlowMap ───────────────────────────────────────────────────────────────────
// Interactive inline flow editor. States render as HTML flex pills with + insert
// buttons between them (and at the ends). Clicking + opens an inline name input
// at that position; the new state is auto-assigned a kind based on neighbours.
// Custom states (not seeded) show a − remove button.

// A pending insert slot — not yet persisted.
interface PendingInsert {
  afterIndex: number; // -1 = before all; 0 = after index 0; etc.
  name: string;
  kind: string;
}

// Infer a sensible kind for a new state inserted between left/right neighbours.
function inferKind(left: FlowState | null, right: FlowState | null): string {
  if (!left)  return right?.kind ?? "todo";
  if (!right) return left?.kind  ?? "in_progress";
  const ORDER: Record<string, number> = { backlog: 0, todo: 1, in_progress: 2, done: 3, accepted: 4, cancelled: 5 };
  const l = ORDER[left.kind] ?? 1;
  const r = ORDER[right.kind] ?? 1;
  if (r > l) {
    const mid = Math.round((l + r) / 2);
    const KEY = ["backlog", "todo", "in_progress", "done", "accepted", "cancelled"];
    return KEY[mid] ?? left.kind;
  }
  return left.kind;
}

// ── PillRow ───────────────────────────────────────────────────────────────────
// 3-cell pill row: [kind-label] [pill cell] [drag handle]. Real flex row.
function PillRow({
  state,
  removingId,
  onRemove,
  dragHandleProps,
  dragging = false,
}: {
  state: FlowState;
  removingId?: string | null;
  onRemove?: (s: FlowState) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
  dragging?: boolean;
}) {
  const stroke = state.colour ?? (KIND_STROKE[state.kind] ?? "var(--border)");
  const kindLabel = KIND_LABEL[state.kind] ?? state.kind;
  const cellOpacity = dragging ? 0 : 1;

  return (
    <div className="fs-map__row">
      <span
        className="fs-map__kind-label"
        title={`Master kind: ${kindLabel}`}
        style={{ opacity: cellOpacity }}
      >
        {kindLabel}
      </span>

      <div className="fs-map__pill-cell" style={{ opacity: cellOpacity }}>
        {!state.is_initial && onRemove ? (
          <button
            type="button"
            className="fs-map__remove-btn"
            title={`Remove ${state.name}`}
            disabled={!!removingId}
            onClick={() => onRemove(state)}
            aria-label={`Remove state ${state.name}`}
          >
            <BsXCircle size={14} />
          </button>
        ) : (
          <span className="fs-map__toolbar-spacer" />
        )}
        <div className="fs-map__pill" style={{ borderColor: stroke }}>
          {state.is_initial && <span className="fs-map__initial-dot" aria-label="Initial state" />}
          <span className="fs-map__pill-label">{state.name}</span>
        </div>
      </div>

      <button
        type="button"
        className="fs-map__drag-handle"
        title="Drag to reorder"
        aria-label="Drag to reorder"
        style={{ touchAction: "none", opacity: cellOpacity }}
        {...dragHandleProps}
      >
        <BsArrowsExpand size={16} />
      </button>
    </div>
  );
}

// ── PillOverlay ───────────────────────────────────────────────────────────────
// Standalone ghost shown by DragOverlay. Renders just the pill (no kind label,
// no drag handle) so the overlay's bounding rect matches the picked-up pill.
function PillOverlay({ state }: { state: FlowState }) {
  const stroke = state.colour ?? (KIND_STROKE[state.kind] ?? "var(--border)");
  return (
    <div className="fs-map__pill-overlay">
      <div className="fs-map__pill" style={{ borderColor: stroke }}>
        {state.is_initial && <span className="fs-map__initial-dot" aria-label="Initial state" />}
        <span className="fs-map__pill-label">{state.name}</span>
      </div>
    </div>
  );
}

// ── SortablePill ──────────────────────────────────────────────────────────────
// Wraps PillRow with useSortable. The wrapper uses display: contents so its
// three children land directly in the parent grid columns.
function SortablePill({
  state,
  removingId,
  onRemove,
}: {
  state: FlowState;
  removingId: string | null;
  onRemove: (s: FlowState) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({ id: state.id });

  return (
    <div ref={setNodeRef} className="fs-map__pill-slot">
      <PillRow
        state={state}
        removingId={removingId}
        onRemove={onRemove}
        dragHandleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
        dragging={isDragging}
      />
    </div>
  );
}

// ── PlusSlot ──────────────────────────────────────────────────────────────────
// A `+` row that doubles as a drop target. `insertAt` is the index where a
// dropped pill would land in the resulting array.
function PlusSlot({
  insertAt,
  pending,
  saving,
  pendingName,
  onPendingChange,
  onCommit,
  onCancel,
  onOpen,
  isDragActive,
  isInsertOpen,
  nameRef,
}: {
  insertAt: number;
  pending: PendingInsert | null;
  saving: boolean;
  pendingName: string;
  onPendingChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onOpen: () => void;
  isDragActive: boolean;
  isInsertOpen: boolean;
  nameRef: React.RefObject<HTMLInputElement | null>;
}) {
  const id = `slot-${insertAt}`;
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: "slot", insertAt } });

  if (isInsertOpen) {
    return (
      <div className="fs-map__row fs-map__plus-row">
        <span className="fs-map__kind-label" />
        <div className="fs-map__pill-cell">
          <span className="fs-map__toolbar-spacer" />
          <div className="fs-map__insert-card">
            <input
              ref={nameRef as React.RefObject<HTMLInputElement>}
              className="fs-map__insert-name"
              placeholder="State name…"
              value={pendingName}
              maxLength={60}
              onChange={(e) => onPendingChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  onCommit();
                if (e.key === "Escape") onCancel();
              }}
            />
            <button
              type="button"
              className="btn btn--xs btn--primary fs-map__insert-ok"
              disabled={saving || !pendingName.trim()}
              onClick={onCommit}
            >
              {saving ? "…" : "Add"}
            </button>
            <button type="button" className="btn btn--xs btn--ghost" onClick={onCancel}>✕</button>
          </div>
        </div>
        <span className="fs-map__toolbar-spacer" />
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={[
        "fs-map__row",
        "fs-map__plus-row",
        isDragActive ? "fs-map__plus-row--target" : "",
        isOver       ? "fs-map__plus-row--over"   : "",
      ].filter(Boolean).join(" ")}
    >
      <span className="fs-map__kind-label" />
      <div className="fs-map__pill-cell">
        <span className="fs-map__toolbar-spacer" />
        <button
          type="button"
          className="fs-map__plus-btn"
          disabled={!!pending || isDragActive}
          title="Insert state here"
          onClick={onOpen}
          aria-label="Insert state"
        >
          <BsPlusCircleDotted size={22} />
        </button>
      </div>
      <span className="fs-map__toolbar-spacer" />
    </div>
  );
}

function FlowMap({
  states,
  flowId,
  onCreated,
  onDeleted,
  onReorder,
}: {
  states: FlowState[];
  flowId: string;
  onCreated: (st: FlowState, afterIndex: number) => void;
  onDeleted: (stateId: string) => void;
  onReorder: (params: { activeId: string; insertAt: number }) => void;
}) {
  const [pending,    setPending]    = useState<PendingInsert | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [activeId,   setActiveId]   = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const mapSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const lastOverIdRef = useRef<string | null>(null);

  // Custom collision: pointerWithin is most accurate, falls back to
  // rectIntersection then closestCenter for edge cases.
  const collisionDetection = useCallback((args: Parameters<typeof closestCenter>[0]) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) return pointerCollisions;
    const rectCollisions = rectIntersection(args);
    if (rectCollisions.length > 0) return rectCollisions;
    return closestCenter(args);
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    lastOverIdRef.current = null;
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    lastOverIdRef.current = event.over ? String(event.over.id) : null;
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    const fallbackOverId = event.over ? String(event.over.id) : null;
    const resolvedOverId = lastOverIdRef.current ?? fallbackOverId;
    const activeIdStr = String(event.active.id);
    lastOverIdRef.current = null;
    if (!resolvedOverId) return;

    // Drop targets are slots only — id format `slot-N`. Ignore anything else.
    const m = /^slot-(\d+)$/.exec(resolvedOverId);
    if (!m) return;
    const insertAt = parseInt(m[1], 10);
    onReorder({ activeId: activeIdStr, insertAt });
  }, [onReorder]);

  // Focus the name input when a slot opens.
  useEffect(() => {
    if (pending) nameRef.current?.focus();
  }, [pending?.afterIndex]);

  const openSlot = useCallback((afterIndex: number, left: FlowState | null, right: FlowState | null) => {
    setPending({ afterIndex, name: "", kind: inferKind(left, right) });
  }, []);

  const cancelSlot = useCallback(() => setPending(null), []);

  const commitSlot = useCallback(async () => {
    if (!pending || !pending.name.trim() || saving) return;
    setSaving(true);
    try {
      const insertAt = pending.afterIndex + 1;
      const sort_order = (insertAt + 1) * 10;
      const st = await flowStatesApi.createState(flowId, {
        name: pending.name.trim(),
        kind: pending.kind,
        sort_order,
      });
      onCreated(st, pending.afterIndex);
      setPending(null);
    } catch (err) {
      notify.apiError(err, "Failed to create state.");
    } finally {
      setSaving(false);
    }
  }, [pending, saving, flowId, onCreated]);

  const removeState = useCallback(async (st: FlowState) => {
    setRemovingId(st.id);
    try {
      await flowStatesApi.deleteState(st.id);
      // Wait for CSS collapse animation (200ms) before parent removes from list.
      setTimeout(() => {
        onDeleted(st.id);
        setRemovingId(null);
      }, 220);
    } catch (err) {
      setRemovingId(null);
      notify.apiError(err, "Failed to remove state.");
    }
  }, [onDeleted]);

  const isDragActive = activeId !== null;

  // Build the alternating row sequence:
  //   PlusSlot(0) → Pill(0) → PlusSlot(1) → Pill(1) → … → Pill(N-1) → PlusSlot(N)
  // PlusSlot insertAt index N means "drop here = pill ends up at index N".
  const rows: React.ReactNode[] = [];

  for (let i = 0; i <= states.length; i++) {
    const isInsertOpen = pending?.afterIndex === i - 1;
    const left  = i === 0 ? null : states[i - 1];
    const right = i === states.length ? null : states[i];
    rows.push(
      <PlusSlot
        key={`slot-${i}`}
        insertAt={i}
        pending={pending}
        saving={saving}
        pendingName={pending?.name ?? ""}
        onPendingChange={(v) => setPending((p) => (p ? { ...p, name: v } : p))}
        onCommit={commitSlot}
        onCancel={cancelSlot}
        onOpen={() => openSlot(i - 1, left, right)}
        isDragActive={isDragActive}
        isInsertOpen={isInsertOpen}
        nameRef={nameRef}
      />
    );
    if (i < states.length) {
      const s = states[i];
      rows.push(
        <SortablePill
          key={s.id}
          state={s}
          removingId={removingId}
          onRemove={removeState}
        />
      );
    }
  }

  const activeState = activeId ? states.find((s) => s.id === activeId) ?? null : null;

  return (
    <DndContext
      sensors={mapSensors}
      collisionDetection={collisionDetection}
      modifiers={[restrictToVerticalAxis]}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={states.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="fs-map" role="group" aria-label="Flow state map">
          <div className="fs-map__col">
            {rows}
          </div>
        </div>
      </SortableContext>

      <DragOverlay modifiers={[restrictToVerticalAxis]} dropAnimation={null}>
        {activeState && <PillOverlay state={activeState} />}
      </DragOverlay>
    </DndContext>
  );
}

// ── ColourPicker ──────────────────────────────────────────────────────────────
function ColourPicker({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (hex: string | null) => void;
}) {
  const [open, setOpen]     = useState(false);
  const [custom, setCustom] = useState(value ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick  = (hex: string) => { onChange(hex); setCustom(hex); setOpen(false); };
  const clear = ()            => { onChange(null); setCustom(""); setOpen(false); };

  const bg  = value ?? "var(--surface-sunken)";
  const ink = value ? safeInk(value) : "var(--ink-muted)";

  return (
    <div className="at-colour-picker" ref={ref}>
      <button
        type="button"
        className="at-colour-swatch"
        style={{ background: bg, color: ink }}
        title={value ?? "No colour set"}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        {value ? value.toUpperCase() : "—"}
      </button>

      {open && (
        <div className="at-colour-popover" role="dialog" aria-label="Choose a colour">
          <div className="at-colour-palette">
            {PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                className={`at-colour-cell${value === hex ? " at-colour-cell--active" : ""}`}
                style={{ background: hex }}
                title={hex}
                onClick={() => pick(hex)}
                aria-label={hex}
                aria-pressed={value === hex}
              />
            ))}
          </div>
          <div className="at-colour-custom">
            <label className="at-colour-custom__label">
              Custom hex
              <input
                type="text"
                className="form__input at-colour-custom__input"
                value={custom}
                maxLength={7}
                placeholder="#3B82F6"
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const v = custom.trim().toUpperCase();
                    if (/^#[0-9A-F]{6}$/.test(v)) pick(v);
                  }
                }}
              />
            </label>
            {/^#[0-9A-Fa-f]{6}$/.test(custom) && custom !== value && (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={() => pick(custom.trim().toUpperCase())}
              >
                Apply
              </button>
            )}
          </div>
          {value && (
            <button
              type="button"
              className="btn btn--sm btn--ghost at-colour-clear"
              onClick={clear}
            >
              Remove colour
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── StateRow ──────────────────────────────────────────────────────────────────
function StateRow({
  state,
  onPatched,
  expander,
  onToggleExpander,
}: {
  state: FlowState;
  onPatched: (updated: FlowState) => void;
  expander: ExpanderSlot | null;
  onToggleExpander: (stateId: string, mode: ExpanderMode) => void;
}) {
  const [saving, setSaving] = useState(false);
  const isEditOpen = expander?.stateId === state.id && expander.mode === "edit";
  const ruleCount = state.exit_rule_count ?? 0;
  const hasDescription = !!(state.description && state.description.trim().length > 0);

  // Inline-edit state for the Description text cell (click → input, Enter saves, Escape cancels)
  const [descEditing, setDescEditing] = useState(false);
  const [descDraft, setDescDraft] = useState(state.description ?? "");
  useEffect(() => {
    if (!descEditing) setDescDraft(state.description ?? "");
  }, [state.description, descEditing]);

  const handleColour = useCallback(
    async (hex: string | null) => {
      setSaving(true);
      try {
        const updated = await flowStatesApi.patchState(state.id, { colour: hex });
        onPatched(updated);
      } catch (err) {
        notify.apiError(err, "Failed to update state colour.");
      } finally {
        setSaving(false);
      }
    },
    [state.id, onPatched],
  );

  const handlePullable = useCallback(
    async (next: boolean) => {
      setSaving(true);
      try {
        const updated = await flowStatesApi.patchState(state.id, { is_pullable: next });
        onPatched(updated);
      } catch (err) {
        notify.apiError(err, "Failed to update pull eligibility.");
      } finally {
        setSaving(false);
      }
    },
    [state.id, onPatched],
  );

  const handleDescription = useCallback(
    async (next: string) => {
      const trimmed = next.trim();
      const current = (state.description ?? "").trim();
      if (trimmed === current) return;
      setSaving(true);
      try {
        const updated = await flowStatesApi.patchState(state.id, {
          description: trimmed === "" ? null : trimmed,
        });
        onPatched(updated);
      } catch (err) {
        notify.apiError(err, "Failed to update description.");
      } finally {
        setSaving(false);
      }
    },
    [state.id, state.description, onPatched],
  );

  const commitDesc = () => {
    setDescEditing(false);
    void handleDescription(descDraft);
  };
  const cancelDesc = () => {
    setDescEditing(false);
    setDescDraft(state.description ?? "");
  };

  return (
    <tr className={`table__row${saving ? " table__row--saving" : ""}`}>
      {/* 1. State */}
      <td className="table__cell fs-table__cell--nowrap">
        <span
          className="fs-state-dot"
          style={{
            background: state.colour ?? "var(--surface-raised)",
            border: state.colour ? "none" : "1px solid var(--border)",
          }}
          aria-hidden="true"
        />
        {state.name}
        {state.is_initial && (
          <span className="fs-state-badge" title="Initial state">start</span>
        )}
      </td>
      {/* 3. Default State (was 'Kind') */}
      <td className="table__cell table__cell--muted fs-table__cell--nowrap" style={{ fontSize: "0.75rem" }}>
        {KIND_LABEL[state.kind] ?? state.kind}
      </td>
      {/* 4. Description (inline-edit text — EXPANDER column) */}
      <td
        className="table__cell fs-table__cell--expander"
        onClick={() => { if (!descEditing) setDescEditing(true); }}
      >
        {descEditing ? (
          <input
            autoFocus
            className="form__input fs-desc-inline-input"
            value={descDraft}
            disabled={saving}
            onChange={(e) => setDescDraft(e.target.value)}
            onBlur={commitDesc}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitDesc(); }
              else if (e.key === "Escape") { e.preventDefault(); cancelDesc(); }
            }}
            aria-label={`Description for ${state.name}`}
          />
        ) : (
          <span
            className={hasDescription ? "fs-desc-text" : "fs-desc-text fs-desc-text--placeholder"}
            title={hasDescription ? state.description! : "Click to add a description"}
          >
            {hasDescription ? state.description : "Click to add a description"}
          </span>
        )}
      </td>
      {/* 5. Edit (pencil → opens combined description + exit-rules flyout) */}
      <td className="table__cell fs-table__cell--nowrap" style={{ textAlign: "center" }}>
        <button
          type="button"
          className={`btn btn--ghost btn--icon${isEditOpen ? " is-active" : ""}`}
          aria-label={`Edit description and exit rules for ${state.name}`}
          aria-pressed={isEditOpen}
          title="Edit description and exit rules"
          onClick={(e) => { e.stopPropagation(); onToggleExpander(state.id, "edit"); }}
        >
          <BsPencilSquare size={14} aria-hidden />
        </button>
      </td>
      {/* 7. Exit Rules (count) */}
      <td className="table__cell fs-table__cell--nowrap" style={{ textAlign: "center" }} title={`${ruleCount} exit rule(s)`}>
        {ruleCount > 0
          ? <span className="pill pill--neutral">{ruleCount}</span>
          : <span style={{ opacity: 0.4 }}>—</span>}
      </td>
      {/* 8. Colour */}
      <td className="table__cell fs-table__cell--nowrap">
        <ColourPicker value={state.colour} onChange={handleColour} />
      </td>
      {/* 9. Pullable */}
      <td className="table__cell fs-table__cell--nowrap" style={{ textAlign: "center" }}>
        <label
          className="fs-pullable-toggle"
          title={state.is_pullable
            ? "Team can pull from this state"
            : "Not pullable — passive/gate state"}
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)", cursor: saving ? "wait" : "pointer" }}
        >
          <input
            type="checkbox"
            checked={state.is_pullable}
            disabled={saving}
            onChange={(e) => handlePullable(e.target.checked)}
            aria-label={`Pullable: ${state.name}`}
          />
        </label>
      </td>
    </tr>
  );
}

// ── DescriptionExpander ───────────────────────────────────────────────────────
// Inline expander for one flow-state's description. Debounced autosave (250ms).
function DescriptionExpander({
  state,
  colSpan,
  typeName,
  workspaceName,
  onPatched,
  onClose,
}: {
  state: FlowState;
  colSpan: number;
  typeName: string;
  workspaceName: string;
  onPatched: (s: FlowState) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState<string>(state.description ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baselineRef = useRef<string>(state.description ?? "");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { taRef.current?.focus(); }, []);

  const persist = useCallback(async (next: string) => {
    if (next === baselineRef.current) return;
    setSaving(true);
    setErr(null);
    try {
      const trimmed = next.trim();
      const sendValue = trimmed.length === 0 ? "" : next; // "" → clear, else set
      const updated = await flowStatesApi.patchState(state.id, { description: sendValue });
      baselineRef.current = updated.description ?? "";
      onPatched(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save description.");
    } finally {
      setSaving(false);
    }
  }, [state.id, onPatched]);

  const onChange = (v: string) => {
    setValue(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(v), 250);
  };

  return (
    <tr className="flow-editor__expander-row">
      <td colSpan={colSpan} className="flow-editor__expander-cell">
        <div className="flow-editor__expander">
          <div className="flow-editor__expander-header">
            <h4 className="flow-editor__expander-title">
              Description for <strong>{state.name}</strong>
            </h4>
            <span className="flow-editor__expander-status">
              {saving ? "Saving…" : err ? err : "Autosaves as you type"}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={onClose}
              aria-label="Close description editor"
            >
              Close
            </button>
          </div>
          <p className="fs-form-help">
            Write a clear description for the <strong>{typeName}</strong> state{" "}
            <strong>{state.name}</strong> in the <strong>{workspaceName}</strong> workspace.
            Use it to explain what work in this state means, what entry conditions apply,
            and how it should pass through your system of work. Your team will see this
            description on every artefact that sits in this state.
          </p>
          <textarea
            ref={taRef}
            className="form__input flow-editor__description"
            value={value}
            placeholder="Explain what this state means in this workspace."
            rows={4}
            maxLength={2000}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      </td>
    </tr>
  );
}

// ── ExitRulesExpander ─────────────────────────────────────────────────────────
// Inline expander for one flow-state's exit-rule checklist. Supports add,
// inline-edit name, colour, drag-reorder (@dnd-kit), soft-delete.
function ExitRulesExpander({
  state,
  colSpan,
  typeName,
  workspaceName,
  onCountChange,
  onClose,
}: {
  state: FlowState;
  colSpan: number;
  typeName: string;
  workspaceName: string;
  onCountChange: (n: number) => void;
  onClose: () => void;
}) {
  const [rules, setRules] = useState<FlowExitRule[]>(state.exit_rules ?? []);
  const [hydrating, setHydrating] = useState(rules.length === 0 && (state.exit_rule_count ?? 0) > 0);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reorderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!hydrating) return;
    let cancelled = false;
    flowStatesApi.listExitRules(state.id)
      .then((rs) => { if (!cancelled) { setRules(rs); setHydrating(false); } })
      .catch((e) => { if (!cancelled) { setErr(e instanceof Error ? e.message : "Failed to load rules."); setHydrating(false); } });
    return () => { cancelled = true; };
  }, [hydrating, state.id]);

  const updateCount = useCallback((rs: FlowExitRule[]) => onCountChange(rs.length), [onCountChange]);

  const addRule = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setErr(null);
    try {
      const created = await flowStatesApi.createExitRule(state.id, { name: trimmed, colour: state.colour ?? null });
      const next = [...rules, created].sort((a, b) => a.sort_order - b.sort_order);
      setRules(next);
      updateCount(next);
      setName("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add rule.");
    } finally {
      setSaving(false);
    }
  }, [name, saving, state.id, state.colour, rules, updateCount]);

  const patchRule = useCallback(async (ruleId: string, patch: { name?: string; colour?: string | null; sort_order?: number }) => {
    try {
      const updated = await flowStatesApi.patchExitRule(ruleId, patch);
      setRules((prev) => prev.map((r) => (r.id === ruleId ? updated : r)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to update rule.");
    }
  }, []);

  const removeRule = useCallback(async (ruleId: string) => {
    try {
      await flowStatesApi.deleteExitRule(ruleId);
      setRules((prev) => {
        const next = prev.filter((r) => r.id !== ruleId);
        updateCount(next);
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete rule.");
    }
  }, [updateCount]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setRules((prev) => {
      const oldIdx = prev.findIndex((r) => r.id === active.id);
      const newIdx = prev.findIndex((r) => r.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      const moved = [...prev];
      const [picked] = moved.splice(oldIdx, 1);
      moved.splice(newIdx, 0, picked);
      const renumbered = moved.map((r, i) => ({ ...r, sort_order: (i + 1) * 10 }));
      if (reorderTimer.current) clearTimeout(reorderTimer.current);
      reorderTimer.current = setTimeout(() => {
        const changed = renumbered.filter((r) => {
          const before = prev.find((p) => p.id === r.id);
          return !before || before.sort_order !== r.sort_order;
        });
        Promise.all(changed.map((r) =>
          flowStatesApi.patchExitRule(r.id, { sort_order: r.sort_order })
            .catch((e) => setErr(e instanceof Error ? e.message : "Failed to save order.")),
        ));
      }, 250);
      return renumbered;
    });
  }, []);

  return (
    <tr className="flow-editor__expander-row">
      <td colSpan={colSpan} className="flow-editor__expander-cell">
        <div className="flow-editor__expander">
          <div className="flow-editor__expander-header">
            <h4 className="flow-editor__expander-title">
              Exit rules for <strong>{state.name}</strong>
            </h4>
            <span className="flow-editor__expander-status">
              The system does not enforce these — they surface as a self-attestation checklist.
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={onClose}
              aria-label="Close exit-rule editor"
            >
              Close
            </button>
          </div>

          <p className="fs-form-help">
            Exit rules are a checklist your team confirms before an artefact leaves the{" "}
            <strong>{typeName}</strong> state <strong>{state.name}</strong> in the{" "}
            <strong>{workspaceName}</strong> workspace. They are not enforced by the system —
            they prompt the person moving the work to self-check that each item is done.
            Add a rule with the form below, drag rules to reorder them, click a rule&rsquo;s
            name to rename it inline, change its colour with the swatch, or remove a rule
            with the trash icon. Removed rules are kept in the audit log but no longer appear
            in the checklist.
          </p>

          {err && <p className="form__error">{err}</p>}

          {hydrating ? (
            <p className="form__hint">Loading rules…</p>
          ) : rules.length === 0 ? (
            <p className="form__hint">No rules yet. Add the first one below.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                <ul className="flow-editor__rules">
                  {rules.map((r, i) => (
                    <SortableExitRule
                      key={r.id}
                      rule={r}
                      index={i}
                      defaultColour={state.colour ?? null}
                      onPatch={(patch) => patchRule(r.id, patch)}
                      onRemove={() => removeRule(r.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          <div className="flow-editor__rule-add">
            <input
              ref={inputRef}
              type="text"
              className="form__input"
              placeholder="New exit rule, e.g. ‘Acceptance criteria reviewed’"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addRule(); }}
            />
            <button
              type="button"
              className="btn btn--primary btn--small"
              disabled={saving || !name.trim()}
              onClick={addRule}
            >
              {saving ? "Adding…" : "Add exit rule"}
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── SortableExitRule ──────────────────────────────────────────────────────────
function SortableExitRule({
  rule,
  index,
  defaultColour,
  onPatch,
  onRemove,
}: {
  rule: FlowExitRule;
  index: number;
  defaultColour: string | null;
  onPatch: (patch: { name?: string; colour?: string | null }) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: rule.id });
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(rule.name);
  useEffect(() => { setDraftName(rule.name); }, [rule.name]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const swatchColour = rule.colour ?? defaultColour;
  const swatchBg = swatchColour ?? "var(--surface-sunken)";
  const swatchInk = swatchColour ? safeInk(swatchColour) : "var(--ink-muted)";

  const commitName = () => {
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === rule.name) { setEditing(false); setDraftName(rule.name); return; }
    onPatch({ name: trimmed });
    setEditing(false);
  };

  return (
    <li ref={setNodeRef} style={style} className="flow-editor__rule">
      <button
        type="button"
        className="flow-editor__rule-grip drag-handle-cell"
        title="Drag to reorder"
        aria-label="Drag to reorder"
        style={{ touchAction: "none", cursor: "grab", background: "transparent", border: 0, padding: 0 }}
        {...attributes}
        {...listeners}
      >
        <span className="drag-handle" aria-hidden="true">⋮⋮</span>
      </button>
      <span className="flow-editor__rule-index" aria-hidden>{index + 1}</span>
      <span
        className="flow-editor__rule-swatch"
        style={{ background: swatchBg, color: swatchInk }}
        aria-hidden
      />
      {editing ? (
        <input
          autoFocus
          className="form__input flow-editor__rule-name-input"
          value={draftName}
          maxLength={200}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") { setEditing(false); setDraftName(rule.name); }
          }}
        />
      ) : (
        <span
          className="flow-editor__rule-name"
          role="button"
          tabIndex={0}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setEditing(true); }}
        >
          {rule.name}
        </span>
      )}
      <span className="flow-editor__rule-actions">
        <ColourPicker value={rule.colour} onChange={(hex) => onPatch({ colour: hex })} />
        <button
          type="button"
          className="btn btn--ghost btn--icon"
          aria-label={`Edit name for ${rule.name}`}
          title="Edit name"
          onClick={() => setEditing(true)}
        >
          <BsPencilSquare size={14} />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon flow-editor__rule-delete"
          aria-label={`Delete ${rule.name}`}
          title="Delete"
          onClick={onRemove}
        >
          <FaRegTrashCan size={13} />
        </button>
      </span>
    </li>
  );
}


// ── FlowBlock ─────────────────────────────────────────────────────────────────
function FlowBlock({
  group,
}: {
  group: FlowGroup;
}) {
  const workspaceName = useWorkspaceName();
  const [states,      setStates]      = useState<FlowState[]>(group.states);
  const [expander,    setExpander]    = useState<ExpanderSlot | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPatched = useCallback((updated: FlowState) => {
    setStates((prev) => prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)));
  }, []);

  const toggleExpander = useCallback((stateId: string, mode: ExpanderMode) => {
    setExpander((prev) => (prev && prev.stateId === stateId && prev.mode === mode ? null : { stateId, mode }));
  }, []);

  const onCountChange = useCallback((stateId: string, n: number) => {
    setStates((prev) => prev.map((s) => (s.id === stateId ? { ...s, exit_rule_count: n } : s)));
  }, []);

  // Insert the new state at the correct position based on afterIndex.
  const onMapCreated = useCallback((st: FlowState, afterIndex: number) => {
    setStates((prev) => {
      const insertAt = afterIndex + 1; // -1 → 0 (prepend), N → N+1
      const next = [...prev];
      next.splice(insertAt, 0, st);
      return next;
    });
  }, []);

  const onMapDeleted = useCallback((stateId: string) => {
    setStates((prev) => prev.filter((s) => s.id !== stateId));
  }, []);

  // Slot-drop reorder. `insertAt` is the index where the pill should land in
  // the resulting array (0..N where N = states.length). Kind inheritance:
  // the dragged pill takes the kind of the pill that was above the target
  // slot (or `todo` if dropped into the very top slot).
  const handleSlotReorder = useCallback(({ activeId, insertAt }: { activeId: string; insertAt: number }) => {
    setStates((prev) => {
      const oldIdx = prev.findIndex((s) => s.id === activeId);
      if (oldIdx === -1) return prev;

      // Compute the kind to inherit BEFORE removing the dragged pill, using
      // the pill that sits above the target slot in the original list.
      // Slot 0 → no pill above → inherit `todo`.
      // Slot N (after pill N-1) → inherit prev[N-1].kind. But if that pill
      // *is* the dragged pill, climb up one more.
      let inheritedKind: FlowState["kind"] = "todo";
      for (let k = insertAt - 1; k >= 0; k--) {
        if (prev[k].id !== activeId) { inheritedKind = prev[k].kind; break; }
      }

      // Remove dragged pill, then splice into target index. After removal,
      // if the original index sat before insertAt, shift insertAt left by 1.
      const without = prev.filter((s) => s.id !== activeId);
      const adjusted = insertAt > oldIdx ? insertAt - 1 : insertAt;
      const moved = [...without];
      moved.splice(adjusted, 0, { ...prev[oldIdx], kind: inheritedKind });

      const renumbered = moved.map((s, i) => ({ ...s, sort_order: (i + 1) * 10 }));

      // No-op? Same index AND same kind — skip the round trip.
      const noChange = adjusted === oldIdx && prev[oldIdx].kind === inheritedKind;
      if (noChange) return prev;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        const changed = renumbered.filter((s) => {
          const before = prev.find((p) => p.id === s.id);
          return !before || before.sort_order !== s.sort_order || before.kind !== s.kind;
        });
        await Promise.all(
          changed.map((s) =>
            flowStatesApi
              .patchState(s.id, { sort_order: s.sort_order, kind: s.kind })
              .catch((err) => notify.apiError(err, "Failed to save order."))
          ),
        );
      }, 250);

      return renumbered;
    });
  }, []);

  return (
    <div className="fs-flow-block">
      <div className="fs-flow-map-help">
        <p>
          The system below lets you create custom transition states for your work items.
          States are grouped by item type &mdash; we call each type an <em>artefact</em>.
        </p>
        <p>
          These states are scoped to this workspace. If you use more than one workspace,
          each one can have its own pattern of states.
        </p>
        <p>The map below shows three things:</p>
        <ol className="fs-flow-map-help__list">
          <li>
            <strong>Default state.</strong> The labels on the left are the stages the app uses
            to track work. They cannot be changed.
          </li>
          <li>
            <strong>Custom state.</strong> The boxes on the right are the states you control.
            When you add a new state, you map it to a default state on the left by dragging the box
            up or down. As you drag, the default state it lines up with is shown on the left.
          </li>
          <li>
            <strong>New states.</strong> Click the <em>new artefact state</em> button
            (a circle with a <strong>+</strong>) to add a state of your choice &mdash; one that
            matches how your team works. Once it is added, move it up or down to line it up
            with the default state you want to map it to.
          </li>
          <li>
            <strong>Edit, move, or remove.</strong> States can be renamed, repositioned, or removed.
            <em> Note:</em> if you remove a state that has artefacts attached, those artefacts move
            to the previous state in the list. If there is no previous state, they move to the first
            state under the same default stage, so no work is left disconnected from the system.
          </li>
        </ol>
      </div>

      <FlowMap
        states={states}
        flowId={group.flow_id}
        onCreated={onMapCreated}
        onDeleted={onMapDeleted}
        onReorder={handleSlotReorder}
      />

      <div className="fs-flow-table-help">
        <p>
          The table below lists every <strong>{group.type_name}</strong> state in the{" "}
          <strong>{workspaceName}</strong> workspace, one row per state.
          Each row shows the state&rsquo;s name, the default stage it maps to, its description,
          its colour, and how many exit rules it has.
        </p>
        <p>
          Click the pencil in the <em>Edit</em> column to open a panel where you can write a
          description for the state and add exit rules. Click straight on the description text
          to edit it inline. Use the colour swatch to change the state&rsquo;s colour, and the
          pullable toggle to control whether a team can pull work into the state.
        </p>
      </div>

      <div className="table-scroll">
        <table className="table table--auto-expander">
          <thead className="table__head">
            <tr>
              <th className="table__cell fs-table__cell--nowrap">State</th>
              <th className="table__cell fs-table__cell--nowrap" title="Underlying default state (lifecycle stage)">Default State</th>
              <th className="table__cell fs-table__cell--expander" title="Description for this state — click cell to edit inline">Description</th>
              <th className="table__cell fs-table__cell--nowrap" style={{ textAlign: "center" }} title="Open the description + exit-rules editor">Edit</th>
              <th className="table__cell fs-table__cell--nowrap" style={{ textAlign: "center" }} title="Number of exit rules">Exit Rules</th>
              <th className="table__cell fs-table__cell--nowrap">Colour</th>
              <th
                className="table__cell fs-table__cell--nowrap"
                style={{ textAlign: "center" }}
                title="Can the team pull from this state?"
              >
                Pullable
              </th>
            </tr>
          </thead>
          <tbody>
            {states.map((s) => {
              const isEditOpen = expander?.stateId === s.id && expander.mode === "edit";
              return (
                <React.Fragment key={s.id}>
                  <StateRow
                    state={s}
                    onPatched={onPatched}
                    expander={expander}
                    onToggleExpander={toggleExpander}
                  />
                  {isEditOpen && (
                    <>
                      <DescriptionExpander
                        state={s}
                        colSpan={7}
                        typeName={group.type_name}
                        workspaceName={workspaceName}
                        onPatched={onPatched}
                        onClose={() => setExpander(null)}
                      />
                      <ExitRulesExpander
                        state={s}
                        colSpan={7}
                        typeName={group.type_name}
                        workspaceName={workspaceName}
                        onCountChange={(n) => onCountChange(s.id, n)}
                        onClose={() => setExpander(null)}
                      />
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── TypeSection ───────────────────────────────────────────────────────────────
function TypeSection({ typeId, typeName, groups, onReloaded }: {
  typeId: string;
  typeName: string;
  groups: FlowGroup[];
  onReloaded: () => void;
}) {
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState<string | null>(null);

  async function handlePreview() {
    setBusy(true);
    setErr(null);
    try {
      const p = await flowStatesApi.resetPreview(typeId);
      setPreview(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to preview reset.");
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await flowStatesApi.resetApply(typeId);
      setPreview(null);
      notify.success(
        `${typeName} reset — +${r.pills_added}/~${r.pills_updated}/-${r.pills_removed} pills, ${r.artefacts_rebound} artefacts rebound.`
      );
      onReloaded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to apply reset.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id={`type-${typeId}`}>
      <div className="fs-type-heading-row">
        <h3 className="fs-type-heading">{typeName}</h3>
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={handlePreview}
          disabled={busy || preview !== null}
          title="Compare this flow to its factory default and offer to reset it."
        >
          Reset to default…
        </button>
      </div>

      {err && <p className="form__error">{err}</p>}

      {preview && (
        <ResetBanner
          preview={preview}
          busy={busy}
          onCancel={() => { setPreview(null); setErr(null); }}
          onApply={handleApply}
        />
      )}

      {groups.map((g) => (
        <FlowBlock
          key={g.flow_id}
          group={g}
        />
      ))}
    </section>
  );
}

// ── ResetBanner ───────────────────────────────────────────────────────────────
function ResetBanner({
  preview,
  busy,
  onCancel,
  onApply,
}: {
  preview: ResetPreview;
  busy: boolean;
  onCancel: () => void;
  onApply: () => void;
}) {
  const pills       = preview.pills       ?? [];
  const transitions = preview.transitions ?? [];
  const impacts     = preview.artefact_impacts ?? [];
  const adds      = pills.filter((p) => p.action === "add");
  const updates   = pills.filter((p) => p.action === "update");
  const removes   = pills.filter((p) => p.action === "remove");
  const txAdds    = transitions.filter((t) => t.action === "add");
  const txRemoves = transitions.filter((t) => t.action === "remove");

  if (preview.already_at_default) {
    return (
      <div className="fs-reset-banner fs-reset-banner--info">
        <p>This flow already matches its factory default.</p>
        <div className="fs-reset-banner__actions">
          <button type="button" className="btn btn--ghost btn--small" onClick={onCancel}>Dismiss</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fs-reset-banner">
      <p className="fs-reset-banner__lead">
        Resetting will rewrite this flow to its factory default. Review the changes below before applying.
      </p>

      <ul className="fs-reset-banner__counts">
        {adds.length    > 0 && <li>+{adds.length} new pills: {adds.map((p) => p.name).join(", ")}</li>}
        {removes.length > 0 && <li>−{removes.length} removed pills: {removes.map((p) => p.name).join(", ")}</li>}
        {updates.length > 0 && <li>~{updates.length} updated pills: {updates.map((p) => p.name).join(", ")}</li>}
        {txAdds.length    > 0 && <li>+{txAdds.length} new transitions</li>}
        {txRemoves.length > 0 && <li>−{txRemoves.length} removed transitions</li>}
      </ul>

      {impacts.length > 0 && (
        <>
          <p className="fs-reset-banner__warn">
            <strong>{impacts.reduce((n, i) => n + i.artefact_count, 0)}</strong> artefacts
            will move to a new flow state:
          </p>
          <ul className="fs-reset-banner__impacts">
            {impacts.map((i) => (
              <li key={i.removed_state_id}>
                {i.artefact_count} on <strong>{i.removed_state_name}</strong> →{" "}
                <strong>{i.successor_state_name}</strong>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="fs-reset-banner__actions">
        <button type="button" className="btn btn--ghost btn--small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn--primary btn--small" onClick={onApply} disabled={busy}>
          {busy ? "Applying…" : "Apply reset"}
        </button>
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────
function groupByType(groups: FlowGroup[]): Map<string, { name: string; flows: FlowGroup[] }> {
  const map = new Map<string, { name: string; flows: FlowGroup[] }>();
  for (const g of groups) {
    if (!map.has(g.type_id)) map.set(g.type_id, { name: g.type_name, flows: [] });
    map.get(g.type_id)!.flows.push(g);
  }
  return map;
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function FlowStatesPage() {
  const [data, setData]       = useState<FlowsResponse | null>(null);
  const [loadError, setError] = useState<string | null>(null);
  // Bumped on every successful (re)load so child sections remount and pick
  // up fresh group props instead of holding their initial-prop state.
  const [version, setVersion] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await flowStatesApi.list());
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load flow states.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loadError) {
    return (
      <div className="settings-panel">
        <p className="form__error">{loadError}</p>
        <button type="button" className="btn btn--ghost" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="settings-panel">
        <p className="form__hint">Loading flow states…</p>
      </div>
    );
  }

  const workByType     = groupByType([...data.work].sort((a, b) => a.type_name.localeCompare(b.type_name)));
  const strategyByType = groupByType([...data.strategy].sort((a, b) => a.type_name.localeCompare(b.type_name)));

  const tocItems: AnchorNavItem[] = [
    ...(workByType.size > 0
      ? [{ id: "section-work",     label: "Work Types",     depth: 0 },
         ...[...workByType.entries()].map(([id, { name }]) => ({ id: `type-${id}`, label: name, depth: 1 }))]
      : []),
    ...(strategyByType.size > 0
      ? [{ id: "section-strategy", label: "Strategy Types", depth: 0 },
         ...[...strategyByType.entries()].map(([id, { name }]) => ({ id: `type-${id}`, label: name, depth: 1 }))]
      : []),
  ];

  return (
    <div className="settings-panel settings-panel--wide">
      <p className="form__hint" style={{ marginBottom: "var(--space-6)" }}>
        Click a colour swatch to change it. Colours update the flow map and work-item trees immediately.
      </p>
      <div className="anav-layout">
        <PageAnchorNav items={tocItems} />
        <div className="anav-content">

          {workByType.size > 0 && (
            <section id="section-work">
              <Panel name="work_types" title="Work Types" helpable={false}>
                {[...workByType.entries()].map(([typeId, { name, flows }]) => (
                  <TypeSection key={`${typeId}-${version}`} typeId={typeId} typeName={name} groups={flows} onReloaded={load} />
                ))}
              </Panel>
            </section>
          )}

          {strategyByType.size > 0 && (
            <section id="section-strategy">
              <Panel name="strategy_types" title="Strategy Types" helpable={false}>
                {[...strategyByType.entries()].map(([typeId, { name, flows }]) => (
                  <TypeSection key={`${typeId}-${version}`} typeId={typeId} typeName={name} groups={flows} onReloaded={load} />
                ))}
              </Panel>
            </section>
          )}

        </div>
      </div>
    </div>
  );
}
