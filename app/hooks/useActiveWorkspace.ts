"use client";

// useActiveWorkspace — returns the current user's active workspace_id
// or null when AuthContext hasn't resolved yet / the user is signed out.
//
// PLA-0053 / story 00580. Source of truth is AuthContext.user.workspace_id,
// populated from the JWT claim via /me on app boot. Consumers (chip
// state, catalogue providers, per-workspace localStorage keys) read
// this to scope client-side data per workspace.
//
// Empty-string workspace_id (legacy token, JWT predates PLA-0053) is
// normalised to null so consumers' loading-state handling can branch
// on a single predicate (`workspaceId == null`).

import { useAuth } from "@/app/contexts/AuthContext";

export function useActiveWorkspace(): string | null {
  const { user } = useAuth();
  if (!user) return null;
  if (!user.workspace_id) return null;
  return user.workspace_id;
}
