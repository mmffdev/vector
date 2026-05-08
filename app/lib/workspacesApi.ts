// PLA-0006/00379 — Workspaces REST client. Mirrors the Go handler at
// backend/internal/workspaces/handler.go. The `/topology` workspace
// switcher (story 00379) is the first frontend consumer; later
// stories (00380, 00381) reuse this surface for the workspace
// management panel and the archived/restore section.
//
// Wire shape mirrors workspaces.Workspace exactly; `description`,
// `archived_at`, and `archived_by` are nullable on the server so the
// JSON renders them as `null` for unset rows.
//
// PLA-0006/00381 — workspace-list change event. After any mutation
// that flips a workspace between live and archived (currently only
// restore; archive will join when 00380 lands), callers MUST dispatch
// the `workspaces:changed` window CustomEvent so the topology
// switcher dropdown (story 00379) refetches without a page reload.
// Listeners attach via `window.addEventListener('workspaces:changed', …)`.

import { api } from "@/app/lib/api";

export const WORKSPACES_CHANGED_EVENT = "workspaces:changed";

export interface Workspace {
  id: string;
  subscription_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  archived_by: string | null;
}

// emitWorkspacesChanged is the producer side of the contract above.
// Safe to call on the server (no-op when window is undefined).
export function emitWorkspacesChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKSPACES_CHANGED_EVENT));
}

// CreateInput mirrors backend createReq on workspaces/handler.go.
// `description` is optional; the backend stores undefined as NULL.
export interface CreateInput {
  name: string;
  slug: string;
  description?: string;
}

export const workspacesApi = {
  // GET /api/workspaces — returns the live (non-archived) workspaces
  // for the caller's tenant ordered by created_at ASC. Default
  // workspace lands first because migration 099 seeds it before any
  // user-created workspace.
  list() {
    return api<Workspace[]>(`/workspaces`);
  },
  // GET /api/workspaces?archived=true — returns the archived
  // workspaces for the caller's tenant. Backend gates this behind
  // `workspace.view_archived`; non-holders get 403, so callers
  // SHOULD only invoke after `useHasPermission('workspace.view_archived')`
  // returns true.
  listArchived() {
    return api<Workspace[]>(`/workspaces?archived=true`);
  },
  // POST /api/workspaces — creates a new live workspace. Backend
  // enforces slug uniqueness among live workspaces only (an archived
  // workspace may share the slug); duplicate-among-live returns 409
  // {error: "slug_taken"} and the create form surfaces that inline.
  // Caller must follow up with `emitWorkspacesChanged()` so the
  // topology switcher dropdown refetches.
  create(input: CreateInput) {
    return api<Workspace>(`/workspaces`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  // PATCH /api/workspaces/{id} — rename only in MVP (slug is
  // immutable per handler note; sending slug-only returns 400).
  // Returns 204 No Content on success.
  rename(id: string, name: string) {
    return api<void>(`/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },
  // POST /api/workspaces/{id}/archive — soft-archives the workspace
  // by stamping archived_at + archived_by. Gated on
  // `workspace.archive`; non-holders get 403, so callers SHOULD only
  // expose the action when `useHasPermission('workspace.archive')`
  // returns true. Caller must follow up with
  // `emitWorkspacesChanged()` so the topology switcher dropdown
  // refetches without a page reload.
  archive(id: string) {
    return api<void>(`/workspaces/${id}/archive`, { method: "POST" });
  },
  // POST /api/workspaces/{id}/restore — clears archived_at on a
  // workspace. Gated on `workspace.restore`; non-holders get 403.
  // Caller must follow up with `emitWorkspacesChanged()` so the
  // topology switcher dropdown refetches without a page reload.
  restore(id: string) {
    return api<void>(`/workspaces/${id}/restore`, { method: "POST" });
  },
};
