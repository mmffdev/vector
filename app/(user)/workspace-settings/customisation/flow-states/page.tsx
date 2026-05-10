"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  todo:        "To Do",
  in_progress: "In Progress",
  done:        "Done",
  accepted:    "Accepted",
  cancelled:   "Cancelled",
};

// Kind → border stroke colour when no custom colour is set on the state.
const KIND_STROKE: Record<string, string> = {
  todo:        "var(--border)",
  in_progress: "#93c5fd",   // blue-300
  done:        "#86efac",   // green-300
  accepted:    "#d8b4fe",   // purple-300
  cancelled:   "#fca5a5",   // red-300
};


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
  const ORDER: Record<string, number> = { todo: 0, in_progress: 1, done: 2, accepted: 3, cancelled: 4 };
  const l = ORDER[left.kind] ?? 1;
  const r = ORDER[right.kind] ?? 1;
  if (r > l) {
    const mid = Math.round((l + r) / 2);
    const KEY = ["todo", "in_progress", "done", "accepted", "cancelled"];
    return KEY[mid] ?? left.kind;
  }
  return left.kind;
}

const KIND_OPTIONS = [
  { value: "todo",        label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done",        label: "Done" },
  { value: "accepted",    label: "Accepted" },
  { value: "cancelled",   label: "Cancelled" },
];

function FlowMap({
  states,
  flowId,
  onCreated,
  onDeleted,
}: {
  states: FlowState[];
  flowId: string;
  onCreated: (st: FlowState, afterIndex: number) => void;
  onDeleted: (stateId: string) => void;
}) {
  const [pending,    setPending]    = useState<PendingInsert | null>(null);
  const [saving,     setSaving]     = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

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

  // Shared insert-card render (used for both mid and last-position slots).
  const insertCard = (key: string, showArrowAfter: boolean) => (
    <div key={key} className="fs-map__slot">
      <div className="fs-map__insert-card">
        <input
          ref={nameRef}
          className="fs-map__insert-name"
          placeholder="State name…"
          value={pending!.name}
          maxLength={60}
          onChange={(e) => setPending((p) => p ? { ...p, name: e.target.value } : p)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitSlot();
            if (e.key === "Escape") cancelSlot();
          }}
        />
        <select
          className="fs-map__insert-kind"
          value={pending!.kind}
          onChange={(e) => setPending((p) => p ? { ...p, kind: e.target.value } : p)}
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn--xs btn--primary fs-map__insert-ok"
          disabled={saving || !pending!.name.trim()}
          onClick={commitSlot}
        >
          {saving ? "…" : "Add"}
        </button>
        <button type="button" className="btn btn--xs btn--ghost" onClick={cancelSlot}>✕</button>
      </div>
      {showArrowAfter && <div className="fs-map__arrow" aria-hidden="true">→</div>}
    </div>
  );

  // Build layout: [+] → pill → [+] → pill → ... → pill → [+]
  // Sequence of slots, indexed by afterIndex:
  //   afterIndex -1  = before state[0]
  //   afterIndex  i  = after state[i] (for i = 0..N-1)
  //
  // Arrows appear: after the first +, between each pair (after pill before next +),
  // and after each mid + before its pill. NOT after the last +.
  const items: React.ReactNode[] = [];

  // Slot -1 (before all states)
  if (pending?.afterIndex === -1) {
    items.push(insertCard("slot--1", states.length > 0));
  } else {
    items.push(
      <div key="plus--1" className="fs-map__plus-wrap">
        <button
          type="button"
          className="fs-map__plus-btn"
          disabled={!!pending}
          title="Insert state before first"
          onClick={() => openSlot(-1, null, states[0] ?? null)}
          aria-label="Insert state before first"
        >
          +
        </button>
        {states.length > 0 && <div className="fs-map__arrow" aria-hidden="true">→</div>}
      </div>
    );
  }

  states.forEach((s, i) => {
    const stroke     = s.colour ?? (KIND_STROKE[s.kind] ?? "var(--border)");
    const isRemoving = removingId === s.id;
    const isLast     = i === states.length - 1;

    // Pill
    items.push(
      <div key={s.id} className={`fs-map__pill-wrap${isRemoving ? " fs-map__pill-wrap--removing" : ""}`}>
        <div className="fs-map__pill" style={{ borderColor: stroke }}>
          {s.is_initial && <span className="fs-map__initial-dot" aria-label="Initial state" />}
          <span className="fs-map__pill-label">{s.name}</span>
          {!s.is_initial && (
            <button
              type="button"
              className="fs-map__remove-btn"
              title={`Remove ${s.name}`}
              disabled={!!removingId}
              onClick={() => removeState(s)}
              aria-label={`Remove state ${s.name}`}
            >
              −
            </button>
          )}
        </div>
      </div>
    );

    // Slot after this pill
    if (!isLast) {
      // Arrow after pill, before mid +
      items.push(<div key={`arr-${i}`} className="fs-map__arrow" aria-hidden="true">→</div>);
      if (pending?.afterIndex === i) {
        items.push(insertCard(`slot-${i}`, true));
      } else {
        items.push(
          <div key={`plus-${i}`} className="fs-map__plus-wrap">
            <button
              type="button"
              className="fs-map__plus-btn"
              disabled={!!pending}
              title="Insert state here"
              onClick={() => openSlot(i, s, states[i + 1])}
              aria-label="Insert state"
            >
              +
            </button>
            <div className="fs-map__arrow" aria-hidden="true">→</div>
          </div>
        );
      }
    } else {
      // Last pill → final slot (no arrow after)
      items.push(<div key="arr-last" className="fs-map__arrow" aria-hidden="true">→</div>);
      if (pending?.afterIndex === i) {
        items.push(insertCard("slot-last", false));
      } else {
        items.push(
          <div key="plus-last" className="fs-map__plus-wrap">
            <button
              type="button"
              className="fs-map__plus-btn"
              disabled={!!pending}
              title="Add state at end"
              onClick={() => openSlot(i, s, null)}
              aria-label="Add state at end"
            >
              +
            </button>
          </div>
        );
      }
    }
  });

  return (
    <div className="fs-map" role="group" aria-label="Flow state map">
      <div className="fs-map__row">
        {items}
      </div>
    </div>
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

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setStates((prev) => {
      const oldIdx = prev.findIndex((s) => s.id === active.id);
      const newIdx = prev.findIndex((s) => s.id === over.id);
      const next = arrayMove(prev, oldIdx, newIdx);

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        const changed = next.filter((s, i) => s.sort_order !== (i + 1) * 10);
        await Promise.all(
          changed.map((s) => {
            const newOrder = (next.indexOf(s) + 1) * 10;
            return flowStatesApi
              .patchState(s.id, { sort_order: newOrder })
              .catch((err) => notify.apiError(err, "Failed to save order."));
          }),
        );
      }, 250);

      return next;
    });
  }, []);

  return (
    <div className="fs-flow-block">
      {showLabel && <p className="fs-flow-name">{group.flow_name}</p>}

      <FlowMap
        states={states}
        flowId={group.flow_id}
        onCreated={onMapCreated}
        onDeleted={onMapDeleted}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={states.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="table-scroll">
            <table className="table">
              <thead className="table__head">
                <tr>
                  <th className="table__cell drag-handle-cell" style={{ width: 36 }} />
                  <th className="table__cell">State</th>
                  <th className="table__cell" style={{ width: 110 }}>Kind</th>
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
