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

import { useMemo } from "react";
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
}

export default function TypeBindingsPicker({ bindings, onChange, disabled }: Props) {
  const { types } = useArtefactTypeCatalogue();

  const selectedIds = useMemo(() => new Set(bindings.map((b) => b.artefact_type_id)), [bindings]);

  const groupedAvailable = useMemo(() => {
    const live = types.filter((t) => t.archived_at == null);
    const work: typeof live = [];
    const strategy: typeof live = [];
    for (const t of live) {
      if (t.scope === "work") work.push(t);
      else if (t.scope === "strategy") strategy.push(t);
    }
    work.sort((a, b) => a.name.localeCompare(b.name));
    strategy.sort((a, b) => a.name.localeCompare(b.name));
    return { work, strategy };
  }, [types]);

  function toggle(typeId: string) {
    if (disabled) return;
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
              return (
                <li
                  key={t.id}
                  className={`type-bindings-picker__TypeRow ${selected ? "is-selected" : ""}`}
                  onClick={() => toggle(t.id)}
                >
                  <input type="checkbox" checked={selected} readOnly tabIndex={-1} />
                  <span className="type-bindings-picker__TypeName">{t.name}</span>
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
              return (
                <li
                  key={t.id}
                  className={`type-bindings-picker__TypeRow ${selected ? "is-selected" : ""}`}
                  onClick={() => toggle(t.id)}
                >
                  <input type="checkbox" checked={selected} readOnly tabIndex={-1} />
                  <span className="type-bindings-picker__TypeName">{t.name}</span>
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
                    <button
                      type="button"
                      className="type-bindings-picker__RemoveBtn"
                      onClick={() => toggle(b.artefact_type_id)}
                      disabled={disabled}
                    >
                      Remove
                    </button>
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
