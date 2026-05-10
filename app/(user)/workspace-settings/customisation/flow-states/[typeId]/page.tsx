"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { use } from "react";
import { notify } from "@/app/lib/toast";
import { safeInk } from "@/app/lib/colourUtils";
import {
  flowStatesApi,
  type FlowGroup,
  type FlowState,
} from "@/app/lib/flowStatesApi";

// ── Palette (same as artefact-types page) ───────────────────────────────────
const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#ec4899", "#f43f5e", "#64748b",
  "#6b7280", "#78716c",
];

// ── KIND_LABEL ───────────────────────────────────────────────────────────────
const KIND_LABEL: Record<string, string> = {
  todo:        "To Do",
  in_progress: "In Progress",
  done:        "Done",
  accepted:    "Accepted",
  cancelled:   "Cancelled",
};

// ── ColourPicker ─────────────────────────────────────────────────────────────
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

  const pick = (hex: string) => { onChange(hex); setCustom(hex); setOpen(false); };
  const clear = () => { onChange(null); setCustom(""); setOpen(false); };

  const displayBg  = value ?? "var(--surface-sunken)";
  const displayInk = value ? safeInk(value) : "var(--ink-muted)";

  return (
    <div className="at-colour-picker" ref={ref}>
      <button
        type="button"
        className="at-colour-swatch"
        style={{ background: displayBg, color: displayInk }}
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
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => pick(custom.trim().toUpperCase())}>
                Apply
              </button>
            )}
          </div>
          {value && (
            <button type="button" className="btn btn--sm btn--ghost at-colour-clear" onClick={clear}>
              Remove colour
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── StateRow ─────────────────────────────────────────────────────────────────
function StateRow({
  state,
  onPatched,
}: {
  state: FlowState;
  onPatched: (updated: FlowState) => void;
}) {
  const [saving, setSaving] = useState(false);

  const handleColourChange = useCallback(
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

  const dotBg  = state.colour ?? "var(--surface-raised)";
  const dotInk = state.colour ? safeInk(state.colour) : "var(--ink-muted)";

  return (
    <tr className={`table__row${saving ? " table__row--saving" : ""}`}>
      <td className="table__cell">
        <span
          className="fs-state-dot"
          style={{ background: dotBg, color: dotInk }}
          aria-hidden="true"
        />
        {state.name}
        {state.is_initial && (
          <span className="fs-state-initial" title="Initial state">●</span>
        )}
      </td>
      <td className="table__cell table__cell--muted" style={{ fontSize: "0.75rem" }}>
        {KIND_LABEL[state.kind] ?? state.kind}
      </td>
      <td className="table__cell">
        <ColourPicker value={state.colour} onChange={handleColourChange} />
      </td>
    </tr>
  );
}

// ── FlowSection ──────────────────────────────────────────────────────────────
function FlowSection({
  group,
  showLabel,
  onPatched,
}: {
  group: FlowGroup;
  showLabel: boolean;
  onPatched: (stateId: string, updated: FlowState) => void;
}) {
  const [states, setStates] = useState<FlowState[]>(group.states);

  useEffect(() => { setStates(group.states); }, [group.states]);

  const handlePatched = useCallback(
    (updated: FlowState) => {
      setStates((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      onPatched(updated.id, updated);
    },
    [onPatched],
  );

  return (
    <div className="fs-flow-section">
      {showLabel && (
        <h4 className="eyebrow fs-flow-section__label">{group.flow_name}</h4>
      )}
      <div className="table-scroll">
        <table className="table">
          <thead className="table__head">
            <tr>
              <th className="table__cell">State</th>
              <th className="table__cell" style={{ width: 120 }}>Kind</th>
              <th className="table__cell" style={{ width: 160 }}>Colour</th>
            </tr>
          </thead>
          <tbody>
            {states.map((s) => (
              <StateRow key={s.id} state={s} onPatched={handlePatched} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function FlowStatesTypePage({
  params,
}: {
  params: Promise<{ typeId: string }>;
}) {
  const { typeId } = use(params);
  const [groups, setGroups] = useState<FlowGroup[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const resp = await flowStatesApi.list();
      const all  = [...resp.work, ...resp.strategy];
      setGroups(all.filter((g) => g.type_id === typeId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load flow states.");
    }
  }, [typeId]);

  useEffect(() => { load(); }, [load]);

  const handlePatched = useCallback(
    (_stateId: string, _updated: FlowState) => {
      // StateRow manages its own local state; no action needed here.
    },
    [],
  );

  if (loadError) {
    return (
      <div className="settings-panel">
        <p className="form__error">{loadError}</p>
        <div className="form__actions">
          <button type="button" className="btn btn--ghost" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  if (!groups) {
    return (
      <div className="settings-panel">
        <p className="form__hint">Loading…</p>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="settings-panel">
        <p className="form__hint">No flow states found for this artefact type.</p>
      </div>
    );
  }

  const showFlowLabels = groups.length > 1;

  return (
    <div className="settings-panel">
      <p className="form__hint">
        Click a colour swatch to change it. Colours apply immediately and are reflected in the work-item tree.
      </p>
      {groups.map((g) => (
        <FlowSection
          key={g.flow_id}
          group={g}
          showLabel={showFlowLabels}
          onPatched={handlePatched}
        />
      ))}
    </div>
  );
}
