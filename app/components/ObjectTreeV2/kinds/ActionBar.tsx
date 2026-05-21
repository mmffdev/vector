"use client";

// <ActionBar> — the row beneath the dense-grid header carrying:
//   • Create-action (single button OR type-picker dropdown) at the left
//   • Search input in the middle
//   • Domain-supplied filter chips on the right
//
// Slice 3 of the ObjectTree refactor. The work-items-specific bits
// (useChipTypeOptions, "Add new artefact" label, console.log submit)
// move OUT of <ObjectTree> and INTO the caller-supplied `createAction`
// config. The bar is now purely presentational + state-driven; domains
// describe their action shape via JSON-style config.

import React from "react";
import { MdAdd, MdOutlineCategory, MdSearch } from "react-icons/md";

// ── Create-action variants ──────────────────────────────────────────────────
//
// Two patterns cover every grid we have today:
//
//   single        — one labelled button. No dropdown. Click fires the
//                   caller's onCreate. Used by sprints, releases,
//                   milestones (single kind per grid).
//
//   type-picker   — a dropdown of options. Picking an option turns the
//                   button into "Add new <Label>" and exposes a Cancel
//                   button next to it; second click on the now-armed
//                   button fires onCreate with the picked id. Used by
//                   work-items, portfolio-items, risks (multi-type
//                   grids).
//
// Adding a third pattern later (e.g. "multi-step wizard") = new variant
// here; existing configs unchanged.

interface CreateActionSingle {
  mode: "single";
  /** Button label, e.g. "Create Sprint" */
  label: string;
  /** Fired when the user clicks the button. */
  onCreate: () => void;
}

interface CreateActionTypePicker {
  mode: "type-picker";
  /** Static label when no type is picked, e.g. "Create New". */
  label: string;
  /** Type-picker option list. Provided by the caller (e.g. from useChipTypeOptions). */
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Currently-selected type id. Empty string = not yet picked. */
  selectedTypeId: string;
  /** Fired when the user picks a type from the dropdown. */
  onSelectType: (typeId: string) => void;
  /** Fired when the user clicks Cancel (clears the selection). */
  onCancel: () => void;
}

export type CreateActionConfig = CreateActionSingle | CreateActionTypePicker;

// ── ActionBar props ─────────────────────────────────────────────────────────

export interface ActionBarProps {
  /** aria-label for the toolbar (e.g. "Work item actions", "Sprint actions"). */
  ariaLabel: string;
  /**
   * Caller-supplied create-action config. When omitted, no create chip
   * renders — used by read-only grids.
   */
  createAction?: CreateActionConfig;
  /** Search placeholder + accessor. When omitted, no search input renders. */
  search?: {
    placeholder: string;
    value: string;
    onChange: (next: string) => void;
  };
  /** Caller-supplied filter chips. Renders verbatim. */
  filterChips?: React.ReactNode;
}

// ── Implementation ──────────────────────────────────────────────────────────

export function ActionBar({
  ariaLabel,
  createAction,
  search,
  filterChips,
}: ActionBarProps) {
  return (
    <div
      className="tree_accordion-dense__actionbar"
      role="toolbar"
      aria-label={ariaLabel}
    >
      {createAction && <CreateActionChip action={createAction} />}
      {search && (
        <div className="tree_accordion-dense__filterbar-search">
          <span
            className="tree_accordion-dense__filterbar-search-icon"
            aria-hidden="true"
          >
            <MdSearch size={12} />
          </span>
          <input
            type="search"
            className="tree_accordion-dense__filterbar-search-input"
            placeholder={search.placeholder}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            aria-label={search.placeholder}
          />
        </div>
      )}
      {filterChips}
      <span className="tree_accordion-dense__filterbar-spacer" />
    </div>
  );
}

// ── Create-action chip ──────────────────────────────────────────────────────

function CreateActionChip({ action }: { action: CreateActionConfig }) {
  if (action.mode === "single") {
    return (
      <button
        type="button"
        className="tree_accordion-dense__filterbar-chip"
        onClick={action.onCreate}
        aria-label={action.label}
      >
        <span className="tree_accordion-dense__filterbar-chip-icon">
          <MdAdd size={14} />
        </span>
        <span className="tree_accordion-dense__filterbar-chip-label">
          {action.label}
        </span>
      </button>
    );
  }

  // type-picker variant
  const { label, options, selectedTypeId, onSelectType, onCancel } = action;
  const selectedLabel = options.find((o) => o.value === selectedTypeId)?.label ?? null;
  const armed = !!selectedTypeId;
  return (
    <>
      <span
        className={
          "tree_accordion-dense__filterbar-chip" +
          (armed ? " tree_accordion-dense__filterbar-chip--active" : "")
        }
        style={{ position: "relative" }}
      >
        <span className="tree_accordion-dense__filterbar-chip-icon">
          {armed ? <MdAdd size={14} /> : <MdOutlineCategory size={14} />}
        </span>
        <span className="tree_accordion-dense__filterbar-chip-label">
          {selectedLabel ? `Add new ${selectedLabel}` : label}
        </span>
        <select
          className="tree_accordion-dense__filterbar-chip-select"
          aria-label={`${label} — pick type`}
          value={selectedTypeId}
          onChange={(e) => onSelectType(e.target.value)}
        >
          <option value="">Type…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
      {armed && (
        <button
          type="button"
          className="btn btn--sm btn--secondary"
          onClick={onCancel}
          aria-label="Cancel new"
        >
          Cancel
        </button>
      )}
    </>
  );
}
