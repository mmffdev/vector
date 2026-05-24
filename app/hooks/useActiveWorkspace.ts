"use client";

// useActiveWorkspace — returns the current user's active workspace_id
// or null when Sentinel hasn't resolved yet / the user is signed out.
//
// PLA-0053 / story 00580. PLA062 S17 — source of truth migrated from
// the legacy AuthContext to Sentinel (sentinel_user.workspace_id),
// populated from the JWT claim via /sentinel/boot.
//
// Empty-string workspace_id (legacy token) is normalised to null so
// consumers' loading-state handling can branch on a single predicate
// (`workspaceId == null`).

import { useSentinel } from "@/app/sentinel";

export function useActiveWorkspace(): string | null {
  const { sentinel_user } = useSentinel();
  if (!sentinel_user) return null;
  if (!sentinel_user.workspace_id) return null;
  return sentinel_user.workspace_id;
}
