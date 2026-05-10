"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/app/lib/toast";
import { safeInk } from "@/app/lib/colourUtils";
import PageAnchorNav, { type AnchorNavItem } from "@/app/components/PageAnchorNav";
import {
  flowStatesApi,
  type FlowGroup,
  type FlowState,
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

// ── FlowTable ─────────────────────────────────────────────────────────────────
function FlowTable({ group }: { group: FlowGroup }) {
  const [states, setStates] = useState<FlowState[]>(group.states);

  useEffect(() => { setStates(group.states); }, [group]);

  const onPatched = useCallback((updated: FlowState) => {
    setStates((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  return (
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
  );
}

// ── TypeSection ───────────────────────────────────────────────────────────────
// Renders all flows for one artefact type as a single section with an anchor id.
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
        <div key={g.flow_id} className="fs-flow-block">
          {multiFlow && (
            <p className="fs-flow-name">{g.flow_name}</p>
          )}
          <FlowTable group={g} />
        </div>
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
  const [data, setData]         = useState<FlowsResponse | null>(null);
  const [loadError, setError]   = useState<string | null>(null);

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

  // Work types first (sorted by name), then strategy types (sorted by name).
  const workByType     = groupByType([...data.work].sort((a, b) => a.type_name.localeCompare(b.type_name)));
  const strategyByType = groupByType([...data.strategy].sort((a, b) => a.type_name.localeCompare(b.type_name)));

  const tocItems: AnchorNavItem[] = [
    ...(workByType.size > 0
      ? [{ id: "section-work",     label: "Work Types",     depth: 0 },
         ...[...workByType.entries()].map(([id, { name }]) => ({
           id: `type-${id}`, label: name, depth: 1,
         }))]
      : []),
    ...(strategyByType.size > 0
      ? [{ id: "section-strategy", label: "Strategy Types", depth: 0 },
         ...[...strategyByType.entries()].map(([id, { name }]) => ({
           id: `type-${id}`, label: name, depth: 1,
         }))]
      : []),
  ];

  return (
    <div className="settings-panel settings-panel--wide">
      <p className="form__hint" style={{ marginBottom: "var(--space-6)" }}>
        Click a colour swatch to change it. Colours apply immediately and are reflected in work-item trees.
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
