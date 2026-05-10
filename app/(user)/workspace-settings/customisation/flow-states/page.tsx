"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

const KIND_INK: Record<string, string> = {
  todo:        "var(--ink-muted)",
  in_progress: "#1e40af",
  done:        "#166534",
  accepted:    "#6b21a8",
  cancelled:   "#991b1b",
};

// ── FlowMap ───────────────────────────────────────────────────────────────────
// Pure-SVG horizontal flow diagram. States are laid out left-to-right by
// sort_order. Forward transitions (increasing sort_order) are rendered as
// straight arrows on the top half; back-edges as curved arcs on the bottom.
// No external library — just SVG path arithmetic.

const PILL_W   = 90;
const PILL_H   = 28;
const PILL_R   = 6;
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

  const handleColour = useCallback(
    async (hex: string | null) => {
      setSaving(true);
      try {
        const updated = await flowStatesApi.patchState(state.id, hex);
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
    <tr className={`table__row${saving ? " table__row--saving" : ""}`}>
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
  const [states, setStates] = useState<FlowState[]>(group.states);
  const [transitions]       = useState<FlowTransition[]>(group.transitions ?? []);

  useEffect(() => { setStates(group.states); }, [group.states]);

  const onPatched = useCallback((updated: FlowState) => {
    setStates((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  // Pass-through for map clicks (no-op for now — clicking a pill in the map
  // doesn't open the colour picker since it's aria-hidden decoration).
  const noopColourChange = useCallback(() => {}, []);

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

      <div className="table-scroll">
        <table className="table">
          <thead className="table__head">
            <tr>
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
