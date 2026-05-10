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
// Pure-SVG horizontal flow diagram. States are laid out left-to-right by
// sort_order. Forward transitions (increasing sort_order) are rendered as
// straight arrows on the top half; back-edges as curved arcs on the bottom.
// No external library — just SVG path arithmetic.

const PILL_W   = 90;
const PILL_H   = 28;
const GAP      = 36;         // horizontal gap between pills
const ARROW_Y  = PILL_H / 2; // centre-line Y (within the pill row)
const ARC_DIP  = 22;         // how far below centre back-arcs dip
const PAD_X    = 12;
const PAD_TOP  = 20;         // space above pills for forward arrows
const PAD_BOT  = ARC_DIP + 14; // space below pills for back-arcs

const SVG_H    = PAD_TOP + PILL_H + PAD_BOT;

function pillX(idx: number): number {
  return PAD_X + idx * (PILL_W + GAP);
}

function pillCentreX(idx: number): number {
  return pillX(idx) + PILL_W / 2;
}

// Arrow marker id is unique per flow to avoid SVG defs collision when multiple
// FlowMap instances share the page.
function FlowMap({
  states,
  transitions,
  markerId,
  onStateColourChange,
}: {
  states: FlowState[];
  transitions: FlowTransition[];
  markerId: string;
  onStateColourChange: (stateId: string, colour: string | null) => void;
}) {
  // Index states by id for O(1) lookup.
  const byId = new Map(states.map((s, i) => [s.id, { ...s, idx: i }]));

  const svgW = PAD_X * 2 + states.length * PILL_W + Math.max(0, states.length - 1) * GAP;
  const pillBaseY = PAD_TOP; // top of pill row within SVG

  // Split transitions into forward (happy path) and back (return arcs).
  const fwdEdges: FlowTransition[] = [];
  const backEdges: FlowTransition[] = [];
  for (const t of (transitions ?? [])) {
    const f = byId.get(t.from);
    const to = byId.get(t.to);
    if (!f || !to) continue;
    if (to.idx > f.idx) fwdEdges.push(t);
    else backEdges.push(t);
  }

  // Arrow head: small filled triangle.
  const markerSize = 7;

  return (
    <div className="fs-flow-map" aria-hidden="true">
      <svg
        width={svgW}
        height={SVG_H}
        viewBox={`0 0 ${svgW} ${SVG_H}`}
        className="fs-flow-map__svg"
      >
        <defs>
          {/* Forward arrow — dark */}
          <marker
            id={`${markerId}-fwd`}
            markerWidth={markerSize}
            markerHeight={markerSize}
            refX={markerSize - 1}
            refY={markerSize / 2}
            orient="auto"
          >
            <path
              d={`M0,0 L0,${markerSize} L${markerSize},${markerSize / 2} Z`}
              fill="var(--ink-muted)"
            />
          </marker>
          {/* Back arrow — subtler */}
          <marker
            id={`${markerId}-back`}
            markerWidth={markerSize}
            markerHeight={markerSize}
            refX={markerSize - 1}
            refY={markerSize / 2}
            orient="auto"
          >
            <path
              d={`M0,0 L0,${markerSize} L${markerSize},${markerSize / 2} Z`}
              fill="var(--border)"
            />
          </marker>
        </defs>

        {/* ── Forward edges ── straight lines in the top zone */}
        {fwdEdges.map((t) => {
          const f  = byId.get(t.from)!;
          const to = byId.get(t.to)!;
          // Only draw non-adjacent edges as arcs above; adjacent ones as
          // a simpler line connecting pill right-edge to pill left-edge.
          const x1 = pillCentreX(f.idx)  + PILL_W / 2 + 5;
          const x2 = pillCentreX(to.idx) - PILL_W / 2 - 5;
          const y  = pillBaseY + ARROW_Y;
          // Arc height scales with distance so crossing lines stay readable.
          const span = to.idx - f.idx;
          const lift = span === 1 ? 0 : 10 + (span - 2) * 6;
          const mx   = (x1 + x2) / 2;
          const my   = y - lift - 10;
          const d    = lift === 0
            ? `M${x1},${y} L${x2},${y}`
            : `M${x1},${y} Q${mx},${my} ${x2},${y}`;
          return (
            <path
              key={`fwd-${t.from}-${t.to}`}
              d={d}
              fill="none"
              stroke="var(--ink-muted)"
              strokeWidth={1.5}
              markerEnd={`url(#${markerId}-fwd)`}
            />
          );
        })}

        {/* ── Back edges ── arcs dipping below the pill row */}
        {backEdges.map((t) => {
          const f  = byId.get(t.from)!;
          const to = byId.get(t.to)!;
          const x1 = pillX(f.idx)  - 5;
          const x2 = pillX(to.idx) + PILL_W + 5;
          const y  = pillBaseY + PILL_H;
          const span = f.idx - to.idx;
          const dip  = ARC_DIP + (span - 1) * 8;
          const mx   = (x1 + x2) / 2;
          const my   = y + dip;
          return (
            <path
              key={`back-${t.from}-${t.to}`}
              d={`M${x1},${y} Q${mx},${my} ${x2},${y}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.2}
              strokeDasharray="3 3"
              markerEnd={`url(#${markerId}-back)`}
            />
          );
        })}

        {/* ── State pills ── */}
        {states.map((s, i) => {
          const x    = pillX(i);
          const y    = pillBaseY;
          const stroke = s.colour ?? (KIND_STROKE[s.kind] ?? "var(--border)");
          return (
            <g
              key={s.id}
              className="fs-flow-map__pill"
              onClick={() => onStateColourChange(s.id, null)}
              style={{ cursor: "default" }}
            >
              <rect
                x={x}
                y={y}
                width={PILL_W}
                height={PILL_H}
                rx={0}
                fill="transparent"
                stroke={stroke}
                strokeWidth={1.5}
              />
              {s.is_initial && (
                <circle cx={x + 8} cy={y + PILL_H / 2} r={3} fill="var(--ink-muted)" opacity={0.5} />
              )}
              <text
                x={x + PILL_W / 2}
                y={y + PILL_H / 2 + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={10}
                fontFamily="inherit"
                fontWeight={s.is_initial ? 600 : 400}
                fill="var(--ink)"
              >
                {s.name}
              </text>
            </g>
          );
        })}
      </svg>
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
      <td className="table__cell drag-handle-cell" {...attributes} {...listeners} aria-label="Drag to reorder">
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

// ── AddStateForm ──────────────────────────────────────────────────────────────
const KIND_OPTIONS = [
  { value: "todo",        label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "done",        label: "Done" },
  { value: "accepted",    label: "Accepted" },
  { value: "cancelled",   label: "Cancelled" },
];

function AddStateForm({
  flowId,
  onCreated,
}: {
  flowId: string;
  onCreated: (state: FlowState) => void;
}) {
  const [open,    setOpen]    = useState(false);
  const [name,    setName]    = useState("");
  const [kind,    setKind]    = useState("todo");
  const [saving,  setSaving]  = useState(false);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const st = await flowStatesApi.createState(flowId, { name: name.trim(), kind });
      onCreated(st);
      setName("");
      setKind("todo");
      setOpen(false);
    } catch (err) {
      notify.apiError(err, "Failed to create state.");
    } finally {
      setSaving(false);
    }
  }, [flowId, name, kind, onCreated]);

  if (!open) {
    return (
      <button type="button" className="btn btn--sm btn--ghost fs-add-state-btn" onClick={() => setOpen(true)}>
        + Add state
      </button>
    );
  }

  return (
    <form className="fs-add-state-form" onSubmit={submit}>
      <input
        className="form__input fs-add-state-form__name"
        placeholder="State name"
        value={name}
        maxLength={60}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <select
        className="form__select fs-add-state-form__kind"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
        {KIND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <button type="submit" className="btn btn--sm btn--primary" disabled={saving || !name.trim()}>
        {saving ? "Adding…" : "Add"}
      </button>
      <button type="button" className="btn btn--sm btn--ghost" onClick={() => { setOpen(false); setName(""); }}>
        Cancel
      </button>
    </form>
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
// One flow within a type section — diagram header + state table.
function FlowBlock({
  group,
  markerId,
  showLabel,
}: {
  group: FlowGroup;
  markerId: string;
  showLabel: boolean;
}) {
  const [states,      setStates]      = useState<FlowState[]>(group.states);
  const [transitions, setTransitions] = useState<FlowTransition[]>(group.transitions ?? []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setStates(group.states); }, [group.states]);

  const onPatched = useCallback((updated: FlowState) => {
    setStates((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  const onCreated = useCallback((st: FlowState) => {
    setStates((prev) => [...prev, st].sort((a, b) => a.sort_order - b.sort_order));
  }, []);

  const noopColourChange = useCallback(() => {}, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setStates((prev) => {
      const oldIdx = prev.findIndex((s) => s.id === active.id);
      const newIdx = prev.findIndex((s) => s.id === over.id);
      const next = arrayMove(prev, oldIdx, newIdx);

      // Debounce the persist — fire 250ms after the last drop.
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        // Assign sort_order as multiples of 10 to leave gaps for future inserts.
        const changed = next.filter((s, i) => s.sort_order !== (i + 1) * 10);
        await Promise.all(
          changed.map((s, _) => {
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

      {states.length > 0 && (
        <FlowMap
          states={states}
          transitions={transitions}
          markerId={markerId}
          onStateColourChange={noopColourChange}
        />
      )}

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

      <AddStateForm flowId={group.flow_id} onCreated={onCreated} />

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
          markerId={`flow-${g.flow_id.slice(0, 8)}`}
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
