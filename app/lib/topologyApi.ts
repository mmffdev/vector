// PLA-0006 — Topology REST client. Mirrors the Go handler at
// backend/internal/orgdesign/handler.go. Routes through apiSite()
// (/_site) — topology I/O is staff-only BFF, not customer-public.

import { apiSite } from "@/app/lib/api";

export type LayoutMode =
  | "auto-horizontal"
  | "auto-vertical"
  | "auto-radial"
  | "manual";

export type Role = "admin" | "editor" | "viewer";

export interface OrgNode {
  id: string;
  subscription_id: string;
  parent_id: string | null;
  name: string;
  // PLA-0006/00312: column is NOT NULL DEFAULT '' on the server, so
  // the wire shape is always a string ('' for "no description yet").
  description: string;
  label_override: string | null;
  icon: string | null;
  colour: string | null;
  avatar_url: string | null;
  layout_mode: LayoutMode;
  manual_x: number | null;
  manual_y: number | null;
  collapsed_default: boolean;
  position: number;
  archived_at: string | null;
  // Count of archived descendants reachable through live ancestors of this
  // node. Populated by the tree endpoint; absent (undefined) on responses
  // from endpoints that don't compute it (e.g. ancestors).
  archived_descendant_count?: number;
  created_at: string;
  updated_at: string;
}

export interface ArchivedDescendant {
  id: string;
  parent_id: string | null;
  name: string;
  archived_at: string;
  // True iff `parent_id` is itself archived. The UI uses this to decide
  // whether the row's default Restore action is reachable (restore-to-parent)
  // or whether the user must pick a new parent.
  parent_is_archived: boolean;
}

// PLA-0042 — one row of the user's own grant list, returned by
// GET /api/topology/grants/me and consumed by the chrome scope picker.
export interface MyGrant {
  grant_id: string;
  node_id: string;
  workspace_id: string;
  parent_id: string | null;
  name: string;
  label_override: string | null;
  colour: string | null;
  icon: string | null;
  role: Role;
  granted_at: string;
}

export interface CommitStatus {
  committed_at: string | null;
  committed_by: string | null;
  last_node_update: string | null;
  dirty_since_commit: boolean;
}

export interface PatchNodeFields {
  name?: string;
  description?: string;
  label_override?: string;
  icon?: string;
  colour?: string;
  avatar_url?: string;
}

export interface CreateNodeInput {
  parent_id?: string | null;
  name: string;
  description?: string | null;
  label_override?: string | null;
  icon?: string | null;
  colour?: string | null;
  avatar_url?: string | null;
  layout_mode?: LayoutMode;
  manual_x?: number | null;
  manual_y?: number | null;
  collapsed_default?: boolean;
  position?: number;
}

export interface PreviewMoveResult {
  ok: boolean;
  reason?: "cycle";
  moving?: OrgNode[];
  landing?: OrgNode[];
}

export const topologyApi = {
  // GET /api/topology/tree — when rootId is undefined the backend
  // resolves the tenant root. When wsRef is supplied it is forwarded
  // as `?ws=<ref>` so the workspace clamp middleware narrows the
  // tree to that workspace (story 00378). The backend accepts either
  // a UUID (canonical) or a slug; UUID is preferred so renames don't
  // invalidate deep-links. Absent → backend falls back to the actor's
  // first live workspace, which is what the Default workspace seed
  // guarantees exists.
  tree(rootId?: string, wsRef?: string) {
    const params = new URLSearchParams();
    if (rootId) params.set("root", rootId);
    if (wsRef) params.set("ws", wsRef);
    const q = params.toString();
    return apiSite<OrgNode[]>(`/topology/tree${q ? `?${q}` : ""}`);
  },

  ancestors(nodeId: string) {
    return apiSite<OrgNode[]>(`/topology/nodes/${nodeId}/ancestors`);
  },

  // PLA-0042 — list every active grant on a live node held by the
  // authenticated user. Used by the chrome scope picker; spans
  // workspaces inside the subscription.
  listMyGrants() {
    return apiSite<MyGrant[]>(`/topology/grants/me`);
  },

  create(input: CreateNodeInput) {
    return apiSite<OrgNode>(`/topology/nodes`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  rename(nodeId: string, name: string) {
    return apiSite<void>(`/topology/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },

  // newParentId === null means "move to root".
  move(nodeId: string, newParentId: string | null) {
    const body =
      newParentId === null
        ? { clear_root: true }
        : { parent_id: newParentId };
    return apiSite<void>(`/topology/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  archive(nodeId: string) {
    return apiSite<void>(`/topology/nodes/${nodeId}`, { method: "DELETE" });
  },

  // Recursively clone the live subtree rooted at nodeId. The new root
  // lands immediately to the right of the source in sibling order;
  // names are copied verbatim (sibling-name uniqueness was dropped in
  // schema migration 096 — identity is the UUID, not the name).
  duplicate(nodeId: string) {
    return apiSite<OrgNode>(`/topology/nodes/${nodeId}/duplicate`, {
      method: "POST",
    });
  },

  bulkPosition(updates: Array<{
    node_id: string;
    position: number;
    layout_mode?: LayoutMode;
    manual_x?: number | null;
    manual_y?: number | null;
  }>) {
    return apiSite<void>(`/topology/nodes/bulk-position`, {
      method: "POST",
      body: JSON.stringify({ updates }),
    });
  },

  setViewState(viewportX: number, viewportY: number, viewportZoom: number) {
    return apiSite<void>(`/topology/view-state`, {
      method: "PUT",
      body: JSON.stringify({ viewport_x: viewportX, viewport_y: viewportY, viewport_zoom: viewportZoom }),
    });
  },

  grantRole(nodeId: string, userId: string, role: Role, canRedelegate = false) {
    return apiSite<{ grant_id: string }>(`/topology/nodes/${nodeId}/roles`, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        role,
        can_redelegate: canRedelegate,
      }),
    });
  },

  revokeRole(grantId: string) {
    return apiSite<void>(`/topology/roles/${grantId}`, { method: "DELETE" });
  },

  previewMove(nodeId: string, newParentId: string | null) {
    const params = new URLSearchParams({ node: nodeId });
    if (newParentId) params.set("new_parent", newParentId);
    return apiSite<PreviewMoveResult>(`/topology/preview-move?${params.toString()}`);
  },

  // Sparse field patch — only non-empty fields applied. Empty string
  // clears a field (description / label_override / icon / colour /
  // avatar_url). For a rename use rename() above.
  patchFields(nodeId: string, fields: PatchNodeFields) {
    return apiSite<void>(`/topology/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  },

  // Disconnect a node from its parent without archiving — node and
  // its subtree become a root in the disconnected tray.
  disconnect(nodeId: string) {
    return apiSite<void>(`/topology/nodes/${nodeId}/disconnect`, {
      method: "POST",
    });
  },

  // Flat list of archived descendants reachable through live ancestors of
  // `nodeId`. Returned in tree order; the UI re-builds parent links from
  // `parent_id` to render the dotted-line tree.
  archivedDescendants(nodeId: string) {
    return apiSite<ArchivedDescendant[]>(
      `/topology/nodes/${nodeId}/archived-descendants`,
    );
  },

  // Restore a node from limbo. Pass `newParentId` to land it under a
  // different parent (required when the original parent is itself
  // archived). Returns 409 with `parent_archived` or `parent_missing`
  // when the requested parent is invalid.
  restore(nodeId: string, newParentId?: string | null) {
    const body: Record<string, unknown> = {};
    if (newParentId !== undefined) body.new_parent_id = newParentId;
    return apiSite<void>(`/topology/nodes/${nodeId}/restore`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  disconnected() {
    return apiSite<OrgNode[]>(`/topology/disconnected`);
  },

  // Commit working model — gadmin only. After commit, any edit to
  // org_nodes flips dirty_since_commit until next commit.
  commitStatus() {
    return apiSite<CommitStatus>(`/topology/commit`);
  },

  commit() {
    return apiSite<CommitStatus>(`/topology/commit`, { method: "POST" });
  },

  // Reset entire canvas — gadmin only. Mass-archives every live node.
  reset() {
    return apiSite<{ archived: number }>(`/topology/reset`, { method: "POST" });
  },
};
