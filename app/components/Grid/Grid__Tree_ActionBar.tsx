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
// Create-new uses the same <NavigationPie> primitive as the work-items Type
// filter: the create button is the anchor; clicking opens one segmented wedge
// per creatable artefact type; picking fires onCreate(typeId). The consumer
// decides what create means (open a flyout, quick-create, …) — this band only
// raises the intent.

import { MdAdd, MdSearch } from "react-icons/md";
import NavigationPie from "@/app/components/NavigationPie";

const CREATE_PIE_SELECTED: string[] = [];

export interface GridTreeActionBarCreate {
  /** Label on the create button (e.g. "Create new"). */
  label: string;
  /** Creatable artefact types — one radial pill each. */
  types: ReadonlyArray<{ id: string; label: string; color?: string }>;
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
  /**
   * Host-supplied nodes rendered at the START of the toolbar, before the
   * create chip. The seam for page-specific affordances that belong on the
   * tree's own action band — e.g. /value-sprint-review's Prev / Next / Current
   * / Switch-sprint / Sprint-Status buttons. Mirrors ObjectTreeV2's
   * `actionBarLeading`. Omit → nothing rendered (the /scope default).
   */
  leading?: React.ReactNode;
  /** Create-new control (radial pick-one). Omit → no create chip. */
  create?: GridTreeActionBarCreate;
  /** Search input. Omit → no search. */
  search?: GridTreeActionBarSearch;
  /** Host-supplied filter chips, rendered right-aligned. */
  filterChips?: React.ReactNode;
}

export function GridTreeActionBar({
  ariaLabel = "Tree actions",
  leading,
  create,
  search,
  filterChips,
}: GridTreeActionBarConfig) {
  return (
    <div
      className="grid__Tree_ActionBar"
      role="toolbar"
      aria-label={ariaLabel}
    >
      {leading}

      {create && create.types.length > 0 && (
        <NavigationPie
          label={create.label}
          icon={<MdAdd size={14} />}
          options={create.types.map((t) => ({
            value: t.id,
            label: t.label,
            color: t.color,
          }))}
          selected={CREATE_PIE_SELECTED}
          onChange={(next) => {
            const picked = next[next.length - 1];
            if (picked) create.onCreate(picked);
          }}
          chipClassName="grid__Tree_ActionBar_Create"
          closeOnPick
        />
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
