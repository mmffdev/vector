"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { Modifier } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { BsArrowsExpand, BsPlusCircleDotted, BsXCircle } from "react-icons/bs";
import { notify } from "@/app/lib/toast";
import { safeInk } from "@/app/lib/colourUtils";
import PageAnchorNav, { type AnchorNavItem } from "@/app/components/PageAnchorNav";
import {
  flowStatesApi,
  type FlowGroup,
  type FlowState,
  type FlowTransition,
  type FlowsResponse,
} from "@/app/lib/flowStatesApi";

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
}: {
  state: FlowState;
  onPatched: (updated: FlowState) => void;
}) {
  const [saving, setSaving] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: state.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

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

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`table__row${saving ? " table__row--saving" : ""}${isDragging ? " table__row--dragging" : ""}`}
    >
      <td className="table__cell drag-handle-cell" {...attributes} {...listeners} aria-label="Drag to reorder" style={{ cursor: "grab", touchAction: "none" }}>
        <span className="drag-handle" aria-hidden="true">⋮⋮</span>
      </td>
      <td className="table__cell">
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
      <td className="table__cell table__cell--muted" style={{ fontSize: "0.75rem", width: 110 }}>
        {KIND_LABEL[state.kind] ?? state.kind}
      </td>
      <td className="table__cell" style={{ width: 110, textAlign: "center" }}>
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
      <td className="table__cell" style={{ width: 150 }}>
        <ColourPicker value={state.colour} onChange={handleColour} />
      </td>
    </tr>
  );
}


// ── TransitionMatrix ──────────────────────────────────────────────────────────
// Grid where each cell represents a possible (from → to) transition.
// Click to toggle. From = rows, To = columns.
function TransitionMatrix({
  flowId,
  states,
  transitions,
  onTransitionsChange,
}: {
  flowId: string;
  states: FlowState[];
  transitions: FlowTransition[];
  onTransitionsChange: (t: FlowTransition[]) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null); // "fromId-toId" while toggling

  const edgeSet = new Set(transitions.map((t) => `${t.from}-${t.to}`));

  const toggle = useCallback(async (from: FlowState, to: FlowState) => {
    const key = `${from.id}-${to.id}`;
    if (busy) return;
    setBusy(key);
    try {
      if (edgeSet.has(key)) {
        await flowStatesApi.deleteTransition(flowId, from.id, to.id);
        onTransitionsChange(transitions.filter((t) => !(t.from === from.id && t.to === to.id)));
      } else {
        const tr = await flowStatesApi.createTransition(flowId, from.id, to.id);
        onTransitionsChange([...transitions, tr]);
      }
    } catch (err) {
      notify.apiError(err, "Failed to update transition.");
    } finally {
      setBusy(null);
    }
  }, [flowId, transitions, edgeSet, busy, onTransitionsChange]);

  if (states.length < 2) return null;

  return (
    <div className="fs-transition-matrix">
      <p className="fs-transition-matrix__label">Allowed transitions — click to toggle</p>
      <div className="fs-transition-matrix__scroll">
        <table className="fs-transition-matrix__table">
          <thead>
            <tr>
              <th className="fs-transition-matrix__corner">From ↓ / To →</th>
              {states.map((s) => (
                <th key={s.id} className="fs-transition-matrix__col-head" title={s.name}>
                  <span className="fs-transition-matrix__col-label">{s.name}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {states.map((from) => (
              <tr key={from.id}>
                <td className="fs-transition-matrix__row-head">{from.name}</td>
                {states.map((to) => {
                  if (from.id === to.id) {
                    return <td key={to.id} className="fs-transition-matrix__cell fs-transition-matrix__cell--self" />;
                  }
                  const key = `${from.id}-${to.id}`;
                  const active = edgeSet.has(key);
                  const loading = busy === key;
                  return (
                    <td key={to.id} className="fs-transition-matrix__cell">
                      <button
                        type="button"
                        className={`fs-transition-matrix__toggle${active ? " fs-transition-matrix__toggle--on" : ""}`}
                        disabled={loading}
                        onClick={() => toggle(from, to)}
                        title={active ? `Remove ${from.name} → ${to.name}` : `Allow ${from.name} → ${to.name}`}
                        aria-pressed={active}
                      >
                        {loading ? "…" : active ? "✓" : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── FlowBlock ─────────────────────────────────────────────────────────────────
function FlowBlock({
  group,
  showLabel,
}: {
  group: FlowGroup;
  showLabel: boolean;
}) {
  const [states,      setStates]      = useState<FlowState[]>(group.states);
  const [transitions, setTransitions] = useState<FlowTransition[]>(group.transitions ?? []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPatched = useCallback((updated: FlowState) => {
    setStates((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  // Table drag-end (DndContext below the map) still uses the old shape.
  const handleTableDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setStates((prev) => {
      const oldIdx = prev.findIndex((s) => s.id === active.id);
      const newIdx = prev.findIndex((s) => s.id === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      // Translate "drop on pill B" to slot-insert semantics.
      const insertAt = newIdx > oldIdx ? newIdx + 1 : newIdx;
      handleSlotReorder({ activeId: String(active.id), insertAt });
      return prev; // handleSlotReorder updates state itself
    });
  }, [handleSlotReorder]);

  return (
    <div className="fs-flow-block">
      {showLabel && <p className="fs-flow-name">{group.flow_name}</p>}

      <FlowMap
        states={states}
        flowId={group.flow_id}
        onCreated={onMapCreated}
        onDeleted={onMapDeleted}
        onReorder={handleSlotReorder}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTableDragEnd}>
        <SortableContext items={states.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="table-scroll">
            <table className="table">
              <thead className="table__head">
                <tr>
                  <th className="table__cell drag-handle-cell" style={{ width: 36 }} />
                  <th className="table__cell">State</th>
                  <th className="table__cell" style={{ width: 110 }}>Kind</th>
                  <th
                    className="table__cell"
                    style={{ width: 110, textAlign: "center" }}
                    title="Can the team pull from this state?"
                  >
                    Pullable
                  </th>
                  <th className="table__cell" style={{ width: 150 }}>Colour</th>
                </tr>
              </thead>
              <tbody>
                {states.map((s) => (
                  <StateRow key={s.id} state={s} onPatched={onPatched} />
                ))}
              </tbody>
            </table>
          </div>
        </SortableContext>
      </DndContext>

      <TransitionMatrix
        flowId={group.flow_id}
        states={states}
        transitions={transitions}
        onTransitionsChange={setTransitions}
      />
    </div>
  );
}

// ── TypeSection ───────────────────────────────────────────────────────────────
function TypeSection({ typeId, typeName, groups }: {
  typeId: string;
  typeName: string;
  groups: FlowGroup[];
}) {
  const multiFlow = groups.length > 1;
  return (
    <section id={`type-${typeId}`}>
      <h3 className="fs-type-heading">{typeName}</h3>
      {groups.map((g) => (
        <FlowBlock
          key={g.flow_id}
          group={g}
          showLabel={multiFlow}
        />
      ))}
    </section>
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

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await flowStatesApi.list());
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
            <>
              <h2 className="eyebrow fs-scope-heading" id="section-work">Work Types</h2>
              {[...workByType.entries()].map(([typeId, { name, flows }]) => (
                <TypeSection key={typeId} typeId={typeId} typeName={name} groups={flows} />
              ))}
            </>
          )}

          {strategyByType.size > 0 && (
            <>
              <h2 className="eyebrow fs-scope-heading" id="section-strategy">Strategy Types</h2>
              {[...strategyByType.entries()].map(([typeId, { name, flows }]) => (
                <TypeSection key={typeId} typeId={typeId} typeName={name} groups={flows} />
              ))}
            </>
          )}

        </div>
      </div>
    </div>
  );
}
