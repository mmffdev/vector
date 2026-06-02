"use client";

// Grid__Tree_ActionBar — the action band of the canonical skin. The SECOND
// band inside <div class="grid">, between Grid__Tree_Title and Grid__Tree_Head.
// Carries the tree-scoped affordances: a create-new control, a search input,
// and a host-supplied filter slot.
//
// Layout + class structure are ported from OTV2's proven
// .tree_accordion-dense__actionbar (search markup, flex row, right-spacer) but
// re-homed under grid__Tree_ActionBar* so the tree owns its own band.
//
// Create-new uses the project's RadialPillMenu (the "fan-out pick-one" the
// design system already ships) rather than a native <select>: the create
// button is the anchor; clicking fans one pill per creatable artefact type
// around it; picking fires onCreate(typeId). The consumer decides what create
// means (open a flyout, quick-create, …) — this band only raises the intent.

import { useRef, useState } from "react";
import { MdAdd, MdSearch } from "react-icons/md";
import RadialPillMenu from "@/app/components/RadialPillMenu/p_RadialPillMenu";

export interface GridTreeActionBarCreate {
  /** Label on the create button (e.g. "Create new"). */
  label: string;
  /** Creatable artefact types — one radial pill each. */
  types: ReadonlyArray<{ id: string; label: string }>;
  /** Fired when the user picks a type from the radial. */
  onCreate: (typeId: string) => void;
}

export interface GridTreeActionBarSearch {
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
}

export interface GridTreeActionBarConfig {
  /** aria-label for the toolbar. */
  ariaLabel?: string;
  /** Create-new control (radial pick-one). Omit → no create chip. */
  create?: GridTreeActionBarCreate;
  /** Search input. Omit → no search. */
  search?: GridTreeActionBarSearch;
  /** Host-supplied filter chips, rendered right-aligned. */
  filterChips?: React.ReactNode;
}

export function GridTreeActionBar({
  ariaLabel = "Tree actions",
  create,
  search,
  filterChips,
}: GridTreeActionBarConfig) {
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const [radialOpen, setRadialOpen] = useState(false);

  return (
    <div
      className="grid__Tree_ActionBar"
      role="toolbar"
      aria-label={ariaLabel}
    >
      {create && create.types.length > 0 && (
        <>
          <button
            ref={createBtnRef}
            type="button"
            className={
              "btn grid__Tree_ActionBar_Create" +
              (radialOpen ? " btn--active" : "")
            }
            aria-haspopup="dialog"
            aria-expanded={radialOpen}
            onClick={() => setRadialOpen((o) => !o)}
          >
            <span className="btn__icon">
              <MdAdd size={14} />
            </span>
            <span>{create.label}</span>
          </button>
          <RadialPillMenu
            open={radialOpen}
            anchor={createBtnRef.current}
            ariaLabel="Pick a type to create"
            items={create.types.map((t) => ({ id: t.id, label: t.label }))}
            onPick={(id) => create.onCreate(id)}
            onClose={() => setRadialOpen(false)}
          />
        </>
      )}

      {search && (
        <div className="grid__Tree_ActionBar_Search">
          <span
            className="grid__Tree_ActionBar_SearchIcon"
            aria-hidden="true"
          >
            <MdSearch size={12} />
          </span>
          <input
            type="search"
            className="grid__Tree_ActionBar_SearchInput"
            placeholder={search.placeholder}
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            aria-label={search.placeholder}
          />
        </div>
      )}

      {filterChips}
      <span className="grid__Tree_ActionBar_Spacer" />
    </div>
  );
}
