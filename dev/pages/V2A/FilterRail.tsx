"use client";

// FilterRail — V2A's collapsible 31-filter left rail.
//
// Data-driven from filterRegistry. Six groups; each group collapses
// independently; whole rail collapses to a thin "show filters" strip.
// State is held by the parent V2A component (filterReducer); this
// component is a pure renderer + dispatcher.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch } from "react";
import {
  FILTER_GROUPS,
  filtersInGroup,
  type FilterDef,
  type FilterGroupId,
} from "./filterRegistry";
import {
  activeCountInGroup,
  activeFilters,
  isFilterActive,
  type FilterAction,
  type FilterState,
  type GraphNode,
} from "./filterState";

type Props = {
  state: FilterState;
  dispatch: Dispatch<FilterAction>;
  nodes: GraphNode[];
  // Whole-rail collapsed flag (persisted in localStorage by parent).
  collapsed: boolean;
  onToggleCollapsed: () => void;
};

const RAIL_GROUPS_LS_KEY = "v2a.rail.groups";

export function FilterRail({ state, dispatch, nodes, collapsed, onToggleCollapsed }: Props) {
  // Per-group open/closed. Default: Structure open, others closed.
  const [openGroups, setOpenGroups] = useState<Record<FilterGroupId, boolean>>(() => {
    if (typeof window === "undefined") return defaultOpenGroups();
    try {
      const raw = window.localStorage.getItem(RAIL_GROUPS_LS_KEY);
      if (raw) return { ...defaultOpenGroups(), ...JSON.parse(raw) };
    } catch { /* noop */ }
    return defaultOpenGroups();
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(RAIL_GROUPS_LS_KEY, JSON.stringify(openGroups));
    } catch { /* noop */ }
  }, [openGroups]);

  const toggleGroup = useCallback((groupId: FilterGroupId) => {
    setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  if (collapsed) {
    return (
      <aside className="dui-viz-v2a-rail dui-viz-v2a-rail_collapsed">
        <button
          type="button"
          className="dui-viz-v2a-rail__expand"
          onClick={onToggleCollapsed}
          aria-label="Show filters"
          title="Show filters"
        >
          ❯
        </button>
      </aside>
    );
  }

  return (
    <aside className="dui-viz-v2a-rail">
      <header className="dui-viz-v2a-rail__header">
        <div className="dui-viz-v2a-rail__title-block">
          <div className="dui-viz-v2a-rail__eyebrow">Filters</div>
          <div className="dui-viz-v2a-rail__title">31-filter rail</div>
        </div>
        <button
          type="button"
          className="dui-viz-v2a-rail__collapse"
          onClick={onToggleCollapsed}
          aria-label="Hide filters"
          title="Hide filters"
        >
          ❮
        </button>
      </header>

      <div className="dui-viz-v2a-rail__groups">
        {FILTER_GROUPS.map(g => (
          <FilterGroup
            key={g.id}
            groupId={g.id}
            label={g.label}
            subtitle={g.subtitle}
            isOpen={openGroups[g.id]}
            onToggle={() => toggleGroup(g.id)}
            activeCount={activeCountInGroup(state, g.id)}
            state={state}
            dispatch={dispatch}
            nodes={nodes}
          />
        ))}
      </div>

      <footer className="dui-viz-v2a-rail__footer">
        <button
          type="button"
          className="dui-viz-v2a-rail__reset-all"
          onClick={() => dispatch({ type: "resetAll" })}
          disabled={activeFilters(state).length === 0}
        >
          ⟲ Reset all
        </button>
      </footer>
    </aside>
  );
}

function defaultOpenGroups(): Record<FilterGroupId, boolean> {
  return {
    structure: true,
    connections: false,
    criticality: false,
    surface: false,
    stateStyle: false,
    provenance: false,
  };
}

// ─── Group ─────────────────────────────────────────────────────────────────

type GroupProps = {
  groupId: FilterGroupId;
  label: string;
  subtitle: string;
  isOpen: boolean;
  onToggle: () => void;
  activeCount: number;
  state: FilterState;
  dispatch: Dispatch<FilterAction>;
  nodes: GraphNode[];
};

function FilterGroup({ groupId, label, subtitle, isOpen, onToggle, activeCount, state, dispatch, nodes }: GroupProps) {
  const filters = filtersInGroup(groupId);
  return (
    <section className={`dui-viz-v2a-group${isOpen ? " is-open" : ""}`}>
      <header className="dui-viz-v2a-group__header" onClick={onToggle}>
        <span className="dui-viz-v2a-group__chevron">{isOpen ? "▾" : "▸"}</span>
        <span className="dui-viz-v2a-group__label">{label}</span>
        <span className="dui-viz-v2a-group__subtitle">{subtitle}</span>
        {activeCount > 0 && (
          <span className="dui-viz-v2a-group__count">{activeCount}</span>
        )}
        {activeCount > 0 && (
          <button
            type="button"
            className="dui-viz-v2a-group__clear"
            onClick={(e) => { e.stopPropagation(); dispatch({ type: "resetGroup", groupId }); }}
            title={`Clear ${label} filters`}
          >
            clear
          </button>
        )}
      </header>
      {isOpen && (
        <div className="dui-viz-v2a-group__body">
          {filters.map(f => (
            <FilterCard
              key={f.id}
              def={f}
              state={state}
              dispatch={dispatch}
              nodes={nodes}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Filter card — dispatches to the right archetype renderer ─────────────

type CardProps = {
  def: FilterDef;
  state: FilterState;
  dispatch: Dispatch<FilterAction>;
  nodes: GraphNode[];
};

function FilterCard({ def, state, dispatch, nodes }: CardProps) {
  const active = isFilterActive(state, def.id);
  const disabled = def.phase !== "A";
  return (
    <div
      className={
        `dui-viz-v2a-card` +
        (active ? " is-active" : "") +
        (disabled ? " is-disabled" : "")
      }
    >
      <header className="dui-viz-v2a-card__header">
        <span className="dui-viz-v2a-card__label">{def.label}</span>
        {def.phase !== "A" && (
          <span
            className="dui-viz-v2a-card__phase-badge"
            title={def.requires ?? `Requires Phase ${def.phase} extension`}
          >
            {def.phase}
          </span>
        )}
        {active && !disabled && (
          <button
            type="button"
            className="dui-viz-v2a-card__remove"
            onClick={() => dispatch({ type: "resetFilter", filterId: def.id })}
            title="Clear filter"
          >
            ×
          </button>
        )}
      </header>
      <div className="dui-viz-v2a-card__description">{def.description}</div>
      {!disabled && (
        <div className="dui-viz-v2a-card__control">
          {renderControl(def, state, dispatch, nodes)}
        </div>
      )}
      {disabled && (
        <div className="dui-viz-v2a-card__placeholder" title={def.requires}>
          {renderPlaceholder(def.archetype)}
        </div>
      )}
    </div>
  );
}

// ─── Archetype renderers ──────────────────────────────────────────────────

function renderControl(
  def: FilterDef,
  state: FilterState,
  dispatch: Dispatch<FilterAction>,
  nodes: GraphNode[],
): React.ReactNode {
  switch (def.id) {
    // Structure
    case "layer":
      return <ChipsControl options={distinctLayers(nodes)} selected={state.layers} onChange={v => dispatch({ type: "set", filterId: "layers", value: v })} />;
    case "side":
      return <RadioControl options={["all","frontend","backend"]} value={state.side} onChange={v => dispatch({ type: "set", filterId: "side", value: v })} />;
    case "system":
      return <ChipsControl options={distinctSystems(nodes)} selected={state.systems} onChange={v => dispatch({ type: "set", filterId: "systems", value: v })} />;
    case "uiComposition":
      return <RadioControl options={[null,"page","layout","component","hook"]} labels={["all","page","layout","component","hook"]} value={state.uiComposition} onChange={v => dispatch({ type: "set", filterId: "uiComposition", value: v })} />;

    // Connections
    case "importDirection":
      return <RadioControl options={["all","in","out","bi"]} labels={["all","in","out","both"]} value={state.importDirection} disabled={!state.seedNodeId} disabledReason="Click a node first" onChange={v => dispatch({ type: "set", filterId: "importDirection", value: v })} />;
    case "depth":
      return <RadioControl options={[0,1,2,3]} labels={["off","1-hop","2-hop","3-hop"]} value={state.depth} disabled={!state.seedNodeId} disabledReason="Click a node first" onChange={v => dispatch({ type: "set", filterId: "depth", value: v })} />;
    case "bridgeKinds":
      return <ChipsControl options={["import","bridge"]} selected={state.bridgeKinds} onChange={v => dispatch({ type: "set", filterId: "bridgeKinds", value: v })} />;
    case "boundaryCrossings":
      return <ToggleControl value={state.boundaryCrossingsOnly} onChange={v => dispatch({ type: "set", filterId: "boundaryCrossingsOnly", value: v })} />;

    // Criticality
    case "fanIn":
      return <RangeControl values={nodes.map(n => n.fan_in)} value={state.fanInRange} onChange={v => dispatch({ type: "set", filterId: "fanInRange", value: v })} />;
    case "fanOut":
      return <RangeControl values={nodes.map(n => n.fan_out)} value={state.fanOutRange} onChange={v => dispatch({ type: "set", filterId: "fanOutRange", value: v })} />;
    case "orphans":
      return <ToggleControl value={state.orphansOnly} onChange={v => dispatch({ type: "set", filterId: "orphansOnly", value: v })} />;
    case "deadEnds":
      return <ToggleControl value={state.deadEndsOnly} onChange={v => dispatch({ type: "set", filterId: "deadEndsOnly", value: v })} />;
    case "cycles":
      return <ToggleControl value={state.cyclesOnly} onChange={v => dispatch({ type: "set", filterId: "cyclesOnly", value: v })} />;
    case "criticalPath":
      return <ChipsControl options={distinctCriticalPaths(nodes)} selected={state.criticalPaths} onChange={v => dispatch({ type: "set", filterId: "criticalPaths", value: v })} />;
    case "complexity":
      return <RangeControl values={nodes.map(n => n.complexity ?? 0)} value={state.complexityRange} onChange={v => dispatch({ type: "set", filterId: "complexityRange", value: v })} step={1} />;

    // Surface (each is a tag-targeted toggle, all push to surfaceTags array)
    case "authSurface":     return <SurfaceTagToggle tag="auth"     state={state} dispatch={dispatch} />;
    case "authzSurface":    return <SurfaceTagToggle tag="authz"    state={state} dispatch={dispatch} />;
    case "auditSurface":    return <SurfaceTagToggle tag="audit"    state={state} dispatch={dispatch} />;
    case "securitySurface": return <SurfaceTagToggle tag="security" state={state} dispatch={dispatch} />;
    case "errorSurface":    return <SurfaceTagToggle tag="error"    state={state} dispatch={dispatch} />;
    case "dbSurface":       return <SurfaceTagToggle tag="db"       state={state} dispatch={dispatch} />;
    case "configSurface":   return <SurfaceTagToggle tag="config"   state={state} dispatch={dispatch} />;

    // State & Style
    case "stateSurface":
      return <ToggleControl value={state.stateOnly} onChange={v => dispatch({ type: "set", filterId: "stateOnly", value: v })} />;
    case "styling":
      return <ChipsControl options={["catalog","dui","bespoke"]} selected={state.stylingKinds} onChange={v => dispatch({ type: "set", filterId: "stylingKinds", value: v })} />;
    case "generated":
      return <RadioControl options={["all","handwritten","generated"]} value={state.generatedMode} onChange={v => dispatch({ type: "set", filterId: "generatedMode", value: v })} />;
    case "visibility":
      return <RadioControl options={["all","exported","internal"]} value={state.visibilityMode} onChange={v => dispatch({ type: "set", filterId: "visibilityMode", value: v })} />;

    // Provenance
    case "testCoverage":
      return <RadioControl options={["all","covered","uncovered"]} value={state.testCoverageMode} onChange={v => dispatch({ type: "set", filterId: "testCoverageMode", value: v })} />;

    default:
      return null;
  }
}

function renderPlaceholder(archetype: FilterDef["archetype"]): React.ReactNode {
  switch (archetype) {
    case "chips":  return <div className="dui-viz-v2a-skel dui-viz-v2a-skel_chips" />;
    case "radio":  return <div className="dui-viz-v2a-skel dui-viz-v2a-skel_radio" />;
    case "range":  return <div className="dui-viz-v2a-skel dui-viz-v2a-skel_range" />;
    case "toggle": return <div className="dui-viz-v2a-skel dui-viz-v2a-skel_toggle" />;
    case "node-seeded": return <div className="dui-viz-v2a-skel dui-viz-v2a-skel_radio" />;
  }
}

// ─── Atomic controls ──────────────────────────────────────────────────────

function ChipsControl<T extends string>({ options, selected, onChange }: {
  options: T[]; selected: T[]; onChange: (v: T[]) => void;
}) {
  const toggle = (opt: T) => {
    onChange(selected.includes(opt) ? selected.filter(x => x !== opt) : [...selected, opt]);
  };
  return (
    <div className="dui-viz-v2a-chips">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          className={`dui-viz-v2a-chip${selected.includes(opt) ? " is-active" : ""}`}
          onClick={() => toggle(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function RadioControl<T>({
  options,
  labels,
  value,
  onChange,
  disabled,
  disabledReason,
}: {
  options: T[];
  labels?: string[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <div className="dui-viz-v2a-radio" title={disabled ? disabledReason : undefined}>
      {options.map((opt, i) => (
        <button
          key={String(opt)}
          type="button"
          className={`dui-viz-v2a-chip${value === opt ? " is-active" : ""}`}
          onClick={() => onChange(opt)}
          disabled={disabled}
        >
          {labels?.[i] ?? String(opt)}
        </button>
      ))}
    </div>
  );
}

function ToggleControl({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`dui-viz-v2a-toggle${value ? " is-on" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span className="dui-viz-v2a-toggle__knob" />
      <span className="dui-viz-v2a-toggle__label">{value ? "on" : "off"}</span>
    </button>
  );
}

function RangeControl({
  values,
  value,
  onChange,
  step = 1,
}: {
  values: number[];
  value: [number, number] | null;
  onChange: (v: [number, number] | null) => void;
  step?: number;
}) {
  const min = useMemo(() => Math.floor(Math.min(...values, 0)), [values]);
  const max = useMemo(() => Math.ceil(Math.max(...values, 1)), [values]);
  const [lo, hi] = value ?? [min, max];
  return (
    <div className="dui-viz-v2a-range">
      <div className="dui-viz-v2a-range__readout">
        {lo} – {hi}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={lo}
        onChange={e => {
          const newLo = parseFloat(e.target.value);
          if (newLo === min && hi === max) onChange(null);
          else onChange([newLo, Math.max(newLo, hi)]);
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={hi}
        onChange={e => {
          const newHi = parseFloat(e.target.value);
          if (lo === min && newHi === max) onChange(null);
          else onChange([Math.min(lo, newHi), newHi]);
        }}
      />
    </div>
  );
}

function SurfaceTagToggle({ tag, state, dispatch }: { tag: string; state: FilterState; dispatch: Dispatch<FilterAction> }) {
  const isOn = state.surfaceTags.includes(tag);
  return (
    <ToggleControl
      value={isOn}
      onChange={v => {
        const next = v
          ? [...state.surfaceTags, tag]
          : state.surfaceTags.filter(t => t !== tag);
        dispatch({ type: "set", filterId: "surfaceTags", value: next });
      }}
    />
  );
}

// ─── Distinct value extractors ────────────────────────────────────────────

function distinctLayers(nodes: GraphNode[]): string[] {
  return Array.from(new Set(nodes.map(n => n.layer))).sort();
}

function distinctSystems(nodes: GraphNode[]): string[] {
  const s = new Set<string>();
  for (const n of nodes) if (n.system) s.add(n.system);
  return Array.from(s).sort();
}

function distinctCriticalPaths(nodes: GraphNode[]): string[] {
  const s = new Set<string>();
  for (const n of nodes) for (const p of n.critical_paths ?? []) s.add(p);
  return Array.from(s).sort();
}

// ─── Active-filter summary line ───────────────────────────────────────────
// Rendered separately by V2A.tsx below the topbar (not inside the rail).

export function ActiveFilterSummary({ state, dispatch }: { state: FilterState; dispatch: Dispatch<FilterAction> }) {
  const active = activeFilters(state);
  if (active.length === 0) return null;
  return (
    <div className="dui-viz-v2a-summary">
      {active.map(f => (
        <span key={f.id} className="dui-viz-v2a-summary__chip">
          <span className="dui-viz-v2a-summary__label">{f.label}</span>
          <span className="dui-viz-v2a-summary__value">{formatFilterValue(state, f)}</span>
          <button
            type="button"
            className="dui-viz-v2a-summary__remove"
            onClick={() => dispatch({ type: "resetFilter", filterId: f.id })}
            title="Clear filter"
          >×</button>
        </span>
      ))}
      <button
        type="button"
        className="dui-viz-v2a-summary__reset"
        onClick={() => dispatch({ type: "resetAll" })}
      >
        ⟲ Reset
      </button>
    </div>
  );
}

function formatFilterValue(state: FilterState, def: FilterDef): string {
  const v = (state as unknown as Record<string, unknown>)[def.id];
  if (Array.isArray(v)) return v.join(" · ");
  if (v === null) return "—";
  if (typeof v === "object") {
    const r = v as [number, number];
    return `${r[0]}–${r[1]}`;
  }
  return String(v);
}
