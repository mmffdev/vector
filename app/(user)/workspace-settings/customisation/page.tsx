"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import InlineEditField from "@/app/components/InlineEditField";
import { notify } from "@/app/lib/toast";
import { ApiError } from "@/app/lib/api";
import {
  artefactTypesApi,
  type ArtefactType,
} from "@/app/lib/artefactTypesApi";

// ── Colour-safety algorithm ──────────────────────────────────────────────────
// Relative luminance per WCAG 2.1 §1.4.3. Returns 0 (black) to 1 (white).
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: string, b: string): number {
  const lA = relativeLuminance(a);
  const lB = relativeLuminance(b);
  const [lo, hi] = lA < lB ? [lA, lB] : [lB, lA];
  return (hi + 0.05) / (lo + 0.05);
}

// Returns the ink colour (#fff or #000) that achieves the higher contrast
// ratio against the given background hex, ensuring WCAG AA (≥4.5:1).
function safeInk(bg: string): string {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#000000")
    ? "#ffffff"
    : "#000000";
}

// Palette offered in the colour picker. Curated so every swatch meets
// WCAG AA with either black or white ink (safeInk picks which).
const PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#eab308",
  "#84cc16", "#22c55e", "#10b981", "#14b8a6",
  "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
  "#a855f7", "#ec4899", "#f43f5e", "#64748b",
  "#6b7280", "#78716c",
];

// ── ColourPicker ─────────────────────────────────────────────────────────────
function ColourPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (hex: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(value ?? "");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const pick = (hex: string) => {
    onChange(hex);
    setCustom(hex);
    setOpen(false);
  };

  const clearColour = () => {
    onChange(null);
    setCustom("");
    setOpen(false);
  };

  const displayBg = value ?? "var(--surface-sunken)";
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
            <button type="button" className="btn btn--sm btn--ghost at-colour-clear" onClick={clearColour}>
              Remove colour
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── TypeRow ───────────────────────────────────────────────────────────────────
function TypeRow({
  type,
  onPatched,
}: {
  type: ArtefactType;
  onPatched: (updated: ArtefactType) => void;
}) {
  const [saving, setSaving] = useState(false);

  const patch = useCallback(
    async (body: Parameters<typeof artefactTypesApi.patch>[1]) => {
      setSaving(true);
      try {
        const updated = await artefactTypesApi.patch(type.id, body);
        onPatched(updated);
      } catch (err) {
        if (err instanceof ApiError && err.status === 422) {
          const msgs = (err.violations ?? []).map((v) => `${v.field}: ${v.message}`).join("; ");
          notify.error(msgs || "Validation failed.");
        } else {
          notify.apiError(err, "Failed to update artefact type.");
        }
      } finally {
        setSaving(false);
      }
    },
    [type.id, onPatched],
  );

  const onCommitName = (next: string) => {
    if (next === type.name) return;
    patch({ name: next });
  };

  const onCommitPrefix = (next: string) => {
    const up = next.toUpperCase();
    if (up === type.prefix) return;
    patch({ prefix: up });
  };

  const onCommitDescription = (next: string) => {
    const val = next === "—" ? null : next;
    if (val === (type.description ?? null)) return;
    patch({ description: val });
  };

  const onColourChange = (hex: string | null) => {
    patch({ colour: hex });
  };

  const tagBg = type.colour ?? "var(--surface-sunken)";
  const tagInk = type.colour ? safeInk(type.colour) : "var(--ink-muted)";

  return (
    <tr className={`table__row${saving ? " table__row--saving" : ""}`}>
      <td className="table__cell">
        <span
          className="at-type-tag"
          style={{ background: tagBg, color: tagInk }}
        >
          <InlineEditField
            value={type.prefix}
            onCommit={onCommitPrefix}
            ariaLabel={`Prefix for ${type.name}`}
            clickToEdit
            maxLength={4}
            displayClassName="at-type-tag__text"
            inputClassName="at-type-tag__input"
          />
        </span>
      </td>
      <td className="table__cell">
        <InlineEditField
          value={type.name}
          onCommit={onCommitName}
          ariaLabel={`Name for ${type.prefix}`}
          clickToEdit
          maxLength={64}
        />
      </td>
      <td className="table__cell table__cell--muted">
        <InlineEditField
          value={type.description ?? ""}
          onCommit={onCommitDescription}
          ariaLabel={`Description for ${type.name}`}
          clickToEdit
          emptyDisplay="—"
          maxLength={256}
        />
      </td>
      <td className="table__cell">
        <ColourPicker value={type.colour} onChange={onColourChange} />
      </td>
      <td className="table__cell table__cell--muted" style={{ fontSize: "0.75rem" }}>
        {type.scope}
      </td>
      <td className="table__cell table__cell--muted" style={{ fontSize: "0.75rem" }}>
        {type.source}
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CustomisationPage() {
  const [types, setTypes] = useState<ArtefactType[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await artefactTypesApi.list();
      setTypes(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load artefact types.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onPatched = useCallback((updated: ArtefactType) => {
    setTypes((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? null);
  }, []);

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

  if (!types) {
    return (
      <div className="settings-panel">
        <p className="form__hint">Loading artefact types…</p>
      </div>
    );
  }

  const workTypes = types.filter((t) => t.scope === "work");
  const strategyTypes = types.filter((t) => t.scope === "strategy");

  return (
    <div className="settings-panel">
      <p className="form__hint">
        Click any cell to edit inline. Colour changes apply immediately. Prefix
        must be 1–4 uppercase characters, unique within scope.
      </p>

      {workTypes.length > 0 && (
        <>
          <h3 className="eyebrow">Work types</h3>
          <TypeTable types={workTypes} onPatched={onPatched} />
        </>
      )}

      {strategyTypes.length > 0 && (
        <>
          <h3 className="eyebrow" style={{ marginTop: "var(--space-6)" }}>Strategy types</h3>
          <TypeTable types={strategyTypes} onPatched={onPatched} />
        </>
      )}
    </div>
  );
}

function TypeTable({
  types,
  onPatched,
}: {
  types: ArtefactType[];
  onPatched: (updated: ArtefactType) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead className="table__head">
          <tr>
            <th className="table__cell" style={{ width: 90 }}>Tag</th>
            <th className="table__cell">Name</th>
            <th className="table__cell">Description</th>
            <th className="table__cell" style={{ width: 140 }}>Colour</th>
            <th className="table__cell" style={{ width: 80 }}>Scope</th>
            <th className="table__cell" style={{ width: 80 }}>Source</th>
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <TypeRow key={t.id} type={t} onPatched={onPatched} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
