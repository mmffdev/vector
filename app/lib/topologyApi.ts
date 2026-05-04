// PLA-0006 — Topology REST client. Mirrors the Go handler at
// backend/internal/orgdesign/handler.go. All calls go through the
// shared api() helper so 401-refresh + auth-token + CSRF are
// handled uniformly.

import { api } from "@/app/lib/api";

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
  level_id: string;
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
  created_at: string;
  updated_at: string;
}

export interface OrgLevel {
  id: string;
  subscription_id: string;
  depth: number;
  name: string;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
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
  // resolves the tenant root.
  tree(rootId?: string) {
    const q = rootId ? `?root=${encodeURIComponent(rootId)}` : "";
    return api<OrgNode[]>(`/api/topology/tree${q}`);
  },

  ancestors(nodeId: string) {
    return api<OrgNode[]>(`/api/topology/nodes/${nodeId}/ancestors`);
  },

  create(input: CreateNodeInput) {
    return api<OrgNode>(`/api/topology/nodes`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  rename(nodeId: string, name: string) {
    return api<void>(`/api/topology/nodes/${nodeId}`, {
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
    return api<void>(`/api/topology/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  },

  archive(nodeId: string) {
    return api<void>(`/api/topology/nodes/${nodeId}`, { method: "DELETE" });
  },

  bulkPosition(updates: Array<{
    node_id: string;
    position: number;
    layout_mode?: LayoutMode;
    manual_x?: number | null;
    manual_y?: number | null;
  }>) {
    return api<void>(`/api/topology/nodes/bulk-position`, {
      method: "POST",
      body: JSON.stringify({ updates }),
    });
  },

  setViewState(nodeId: string, collapsed: boolean) {
    return api<void>(`/api/topology/nodes/${nodeId}/view-state`, {
      method: "PUT",
      body: JSON.stringify({ collapsed }),
    });
  },

  grantRole(nodeId: string, userId: string, role: Role, canRedelegate = false) {
    return api<{ grant_id: string }>(`/api/topology/nodes/${nodeId}/roles`, {
      method: "POST",
      body: JSON.stringify({
        user_id: userId,
        role,
        can_redelegate: canRedelegate,
      }),
    });
  },

  revokeRole(grantId: string) {
    return api<void>(`/api/topology/roles/${grantId}`, { method: "DELETE" });
  },

  previewMove(nodeId: string, newParentId: string | null) {
    const params = new URLSearchParams({ node: nodeId });
    if (newParentId) params.set("new_parent", newParentId);
    return api<PreviewMoveResult>(`/api/topology/preview-move?${params.toString()}`);
  },

  // Sparse field patch — only non-empty fields applied. Empty string
  // clears a field (description / label_override / icon / colour /
  // avatar_url). For a rename use rename() above.
  patchFields(nodeId: string, fields: PatchNodeFields) {
    return api<void>(`/api/topology/nodes/${nodeId}`, {
      method: "PATCH",
      body: JSON.stringify(fields),
    });
  },

  // Disconnect a node from its parent without archiving — node and
  // its subtree become a root in the disconnected tray.
  disconnect(nodeId: string) {
    return api<void>(`/api/topology/nodes/${nodeId}/disconnect`, {
      method: "POST",
    });
  },

  disconnected() {
    return api<OrgNode[]>(`/api/topology/disconnected`);
  },

  // Levels — horizontal "rows" the canvas draws nodes onto.
  levels() {
    return api<OrgLevel[]>(`/api/topology/levels`);
  },

  createLevel(input: { depth: number; name: string; position?: number }) {
    return api<OrgLevel>(`/api/topology/levels`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },

  renameLevel(levelId: string, name: string) {
    return api<void>(`/api/topology/levels/${levelId}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
  },

  // Commit working model — gadmin only. After commit, any edit to
  // org_nodes flips dirty_since_commit until next commit.
  commitStatus() {
    return api<CommitStatus>(`/api/topology/commit`);
  },

  commit() {
    return api<CommitStatus>(`/api/topology/commit`, { method: "POST" });
  },

  // Reset entire canvas — gadmin only. Mass-archives every live node.
  reset() {
    return api<{ archived: number }>(`/api/topology/reset`, { method: "POST" });
  },
};
