"use client";

// OwnerChip — slim presentational chip for the embedded OwnerRef payload
// the work-items list/get/children queries now return (PLA-0021 / 00459).
//
// Pure-prop, no client-side data fetching. Renders the user's display name;
// shows the avatar <img> only when avatar_url is non-null. With user=null
// (e.g. join failed because the row's owner was deleted) renders the
// "Unassigned" placeholder.
//
// Composes the catalog .pill / .pill--neutral primitives so the chip
// inherits the active theme without bespoke colour. The avatar <img> uses
// the existing .pill--letter footprint as a sibling so the chip stays
// inline-aligned with sprint / priority neighbours in the same cell.

import type { ReactElement } from "react";

export interface OwnerChipUser {
  id: string;
  display_name: string;
  avatar_url: string | null;
}

export interface OwnerChipProps {
  user: OwnerChipUser | null;
}

export default function OwnerChip({ user }: OwnerChipProps): ReactElement {
  if (!user) {
    return (
      <span
        className="pill pill--neutral"
        data-testid="owner-chip"
        title="Unassigned"
      >
        <span className="pill__label">Unassigned</span>
      </span>
    );
  }

  const showAvatar = !!user.avatar_url;

  return (
    <span
      className="pill pill--neutral"
      data-testid="owner-chip"
      title={user.display_name}
    >
      {showAvatar ? (
        <img
          className="pill__icon"
          src={user.avatar_url ?? ""}
          alt=""
          width={14}
          height={14}
        />
      ) : null}
      <span className="pill__label">{user.display_name}</span>
    </span>
  );
}
