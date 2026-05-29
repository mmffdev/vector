// Wire types for /_site/saved-views. Match backend types.go field names
// 1:1 — the wire shape uses the saved_views_* column-prefix convention.

export type Scope = "user" | "node" | "workspace";
// Kind discriminators. "page" body shape:
//   { grids: { <gridKey>: { visible_columns: string[] } } }
// Partial bodies are honoured — a grid absent from `grids` is left
// untouched when the view is loaded.
export type Kind = "objecttree" | "page_layout" | "page";

export interface View {
  saved_views_id: string;
  saved_views_id_subscription: string;
  saved_views_kind: Kind;
  saved_views_scope: Scope;
  saved_views_id_user?: string | null;
  saved_views_id_node?: string | null;
  saved_views_id_workspace?: string | null;
  saved_views_target: string;
  saved_views_name: string;
  saved_views_body: unknown; // schema-less; consumer interprets
  saved_views_id_user_created_by: string;
  saved_views_created_at: string;
  saved_views_updated_at: string;
  saved_views_archived_at?: string | null;
}

export interface ListResponse {
  views: View[];
}

// CreateRequest mirrors the backend createReq shape (snake_case at the wire).
export interface CreateRequest {
  kind: Kind;
  scope: Scope;
  id_user?: string | null;
  id_node?: string | null;
  id_workspace?: string | null;
  target: string;
  name: string;
  body: unknown;
}

export interface UpdateBodyRequest {
  name?: string;
  body?: unknown;
}

export interface UpdateScopeRequest {
  scope: Scope;
  id_user?: string | null;
  id_node?: string | null;
  id_workspace?: string | null;
}
