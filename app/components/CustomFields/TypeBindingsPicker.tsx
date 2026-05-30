"use client";

// TypeBindingsPicker — workspace-admin surface for binding a custom field
// to one or more artefact types. Mounted on the custom-fields editor page.
//
// Wire contract: parent owns the bindings state (so Save can write them
// atomically with the field). This component is stateless beyond the
// per-binding editor inputs.
//
// Type-scope agnostic: artefact types are user-defined (admins create new
// types via /workspace-admin/artefacts/artefact-types/). The picker lists
// every type in the tenant catalogue, segmented visually by scope. It
// does NOT filter by field scope — see
// docs/superpowers/specs/2026-05-28-custom-field-type-bindings-design.md §4.

import { useEffect, useMemo } from "react";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";

export interface DraftBinding {
  artefact_type_id: string;
  position: number;
  required: boolean;
  default_value: string | null;
}

interface Props {
  bindings: DraftBinding[];
  onChange: (next: DraftBinding[]) => void;
  disabled?: boolean;
  /**
   * When set, this artefact type is force-bound: the picker seeds a
   * binding for it on mount, renders its row checked + disabled, and
   * suppresses its Remove affordance. Used by the Form Layout Builder's
   * add-custom-field overlay so a field created while working a given
   * type is always bound to that type (the user may ADD others, never
   * un-tick the one they're working in). See
   * docs/superpowers/specs/2026-05-30-per-type-form-builder-design.md.
   */
  lockedTypeId?: string;
}

export default function TypeBindingsPicker({
  bindings,
  onChange,
  disabled,
  lockedTypeId,
}: Props) {
  const { types } = useArtefactTypeCatalogue();

  const selectedIds = useMemo(() => new Set(bindings.map((b) => b.artefact_type_id)), [bindings]);

  // Seed the locked type's binding on mount (and re-seed if it's ever
  // dropped from the incoming bindings). The picker is otherwise stateless
  // — this is the one place it pushes a binding the parent didn't supply.
  useEffect(() => {
    if (!lockedTypeId) return;
    if (selectedIds.has(lockedTypeId)) return;
    onChange([
      ...bindings,
      { artefact_type_id: lockedTypeId, position: 100, required: false, default_value: null },
    ]);
  }, [lockedTypeId, selectedIds, bindings, onChange]);

  const groupedAvailable = useMemo(() => {
    const live = types.filter((t) => t.archived_at == null);
    const work: typeof live = [];
    const strategy: typeof live = [];
    for (const t of live) {
      if (t.scope === "work") work.push(t);
      else if (t.scope === "strategy") strategy.push(t);
    }
    // Dedup by name, keeping the smallest UUID per name. DB seed history
    // left duplicate rows for the same name within a single subscription
    // (e.g. five active "Feature" rows in vector_artefacts.artefacts_types
    // — possibly multiple seed-replays during the Pillar refactors). The
    // picker should show one row per distinct name; binding to a single
    // canonical UUID is the contract. The backend listing also dedups via
    // DISTINCT ON (artefacts_types_name) for defence-in-depth — this FE
    // dedup is a belt-and-braces so the picker stays clean if the
    // backend is ever bypassed (e.g. legacy callers). See
    // TD-ARTEFACT-TYPES-DUP-SEED in docs/c_tech_debt.md.
    const dedupByName = <T extends { id: string; name: string }>(arr: T[]): T[] => {
      const byName = new Map<string, T>();
      for (const t of arr) {
        const existing = byName.get(t.name);
        if (!existing || t.id < existing.id) byName.set(t.name, t);
      }
      return Array.from(byName.values());
    };
    const workDeduped = dedupByName(work);
    const strategyDeduped = dedupByName(strategy);
    workDeduped.sort((a, b) => a.name.localeCompare(b.name));
    strategyDeduped.sort((a, b) => a.name.localeCompare(b.name));
    return { work: workDeduped, strategy: strategyDeduped };
  }, [types]);

  function toggle(typeId: string) {
    if (disabled) return;
    if (typeId === lockedTypeId) return; // locked — cannot be un-bound
    if (selectedIds.has(typeId)) {
      onChange(bindings.filter((b) => b.artefact_type_id !== typeId));
    } else {
      onChange([
        ...bindings,
        { artefact_type_id: typeId, position: 100, required: false, default_value: null },
      ]);
    }
  }

  function patch(typeId: string, patch: Partial<DraftBinding>) {
    onChange(bindings.map((b) => (b.artefact_type_id === typeId ? { ...b, ...patch } : b)));
  }

  return (
    <div className="type-bindings-picker">
      <div className="type-bindings-picker__Columns">
        <div className="type-bindings-picker__AvailableCol">
          <div className="type-bindings-picker__SectionLabel">Work scope</div>
          <ul className="type-bindings-picker__TypeList">
            {groupedAvailable.work.map((t) => {
              const selected = selectedIds.has(t.id);
              const locked = t.id === lockedTypeId;
              return (
                <li
                  key={t.id}
                  className={`type-bindings-picker__TypeRow ${selected ? "is-selected" : ""} ${locked ? "is-locked" : ""}`}
                  onClick={() => toggle(t.id)}
                >
                  <input type="checkbox" checked={selected} disabled={locked} readOnly tabIndex={-1} />
                  <span className="type-bindings-picker__TypeName">{t.name}</span>
                  {locked && (
                    <span className="type-bindings-picker__LockTag">current type</span>
                  )}
                </li>
              );
            })}
            {groupedAvailable.work.length === 0 && (
              <li className="type-bindings-picker__EmptyRow">No work-scope types defined</li>
            )}
          </ul>

          <div className="type-bindings-picker__SectionLabel">Strategy scope</div>
          <ul className="type-bindings-picker__TypeList">
            {groupedAvailable.strategy.map((t) => {
              const selected = selectedIds.has(t.id);
              const locked = t.id === lockedTypeId;
              return (
                <li
                  key={t.id}
                  className={`type-bindings-picker__TypeRow ${selected ? "is-selected" : ""} ${locked ? "is-locked" : ""}`}
                  onClick={() => toggle(t.id)}
                >
                  <input type="checkbox" checked={selected} disabled={locked} readOnly tabIndex={-1} />
                  <span className="type-bindings-picker__TypeName">{t.name}</span>
                  {locked && (
                    <span className="type-bindings-picker__LockTag">current type</span>
                  )}
                </li>
              );
            })}
            {groupedAvailable.strategy.length === 0 && (
              <li className="type-bindings-picker__EmptyRow">No strategy-scope types defined</li>
            )}
          </ul>
        </div>

        <div className="type-bindings-picker__SelectedCol">
          <div className="type-bindings-picker__SectionLabel">
            Selected ({bindings.length})
          </div>
          <ul className="type-bindings-picker__BindingList">
            {bindings.length === 0 && (
              <li className="type-bindings-picker__EmptyRow">
                Pick types from the left to bind this field
              </li>
            )}
            {bindings.map((b) => {
              const t = types.find((x) => x.id === b.artefact_type_id);
              return (
                <li key={b.artefact_type_id} className="type-bindings-picker__BindingRow">
                  <div className="type-bindings-picker__BindingHead">
                    <span className="type-bindings-picker__TypeName">
                      {t?.name ?? b.artefact_type_id.slice(0, 8) + "…"}
                    </span>
                    {b.artefact_type_id === lockedTypeId ? (
                      <span className="type-bindings-picker__LockTag">current type</span>
                    ) : (
                      <button
                        type="button"
                        className="btn type-bindings-picker__RemoveBtn"
                        onClick={() => toggle(b.artefact_type_id)}
                        disabled={disabled}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="type-bindings-picker__BindingControls">
                    <label className="type-bindings-picker__InputLabel">
                      Position
                      <input
                        type="number"
                        value={b.position}
                        min={0}
                        onChange={(e) => patch(b.artefact_type_id, { position: Number(e.target.value) })}
                        disabled={disabled}
                      />
                    </label>
                    <label className="type-bindings-picker__InputLabel">
                      <input
                        type="checkbox"
                        checked={b.required}
                        onChange={(e) => patch(b.artefact_type_id, { required: e.target.checked })}
                        disabled={disabled}
                      />
                      Required
                    </label>
                    <label className="type-bindings-picker__InputLabel">
                      Default value
                      <input
                        type="text"
                        value={b.default_value ?? ""}
                        onChange={(e) =>
                          patch(b.artefact_type_id, {
                            default_value: e.target.value === "" ? null : e.target.value,
                          })
                        }
                        disabled={disabled}
                      />
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
