package workspaces

import "errors"

// Sentinel errors. Map these to HTTP statuses in the handler layer
// (which lands in story 00377). The naming follows the AC sentinels
// from PLA-0006 / story 00376 #100:
//
//	ErrNotFound                → 404 (also covers "wrong tenant" — we
//	                                  never leak existence cross-tenant)
//	ErrSlugTaken               → 409 (per-subscription unique CHECK)
//	ErrAlreadyArchived         → 409 (Archive on archived workspace)
//	ErrInvalidName             → 400 (empty / whitespace-only)
//	ErrInvalidSlug             → 400 (regex / empty)
//	ErrPermissionDenied        → 403 (caller lacks workspace.* perm)
//	ErrSingleAdminViolation    → 409 (workspace_roles single-admin
//	                                  partial unique index)
//	ErrCannotArchiveLastLive   → 409 (a tenant must keep ≥1 live
//	                                  workspace at all times)
//	ErrGrantNotFound           → 404 (revoke/list on missing grant)
//	ErrInvalidRole             → 400 (closed-vocab CHECK)
//	ErrNotArchived             → 409 (Restore on a live workspace)
//	ErrCrossDBOrphans          → 409 (Delete blocked: vector_artefacts
//	                                  still references the workspace)
var (
	ErrNotFound              = errors.New("workspaces: workspace not found")
	ErrSlugTaken             = errors.New("workspaces: slug already in use for this subscription")
	ErrAlreadyArchived       = errors.New("workspaces: workspace is already archived")
	ErrNotArchived           = errors.New("workspaces: workspace is not archived")
	ErrInvalidName           = errors.New("workspaces: name must be non-empty")
	ErrInvalidSlug           = errors.New("workspaces: slug must match ^[a-z0-9][a-z0-9-]*$")
	ErrPermissionDenied      = errors.New("workspaces: actor lacks the required permission")
	ErrSingleAdminViolation  = errors.New("workspaces: an active admin grant already exists for this workspace")
	ErrCannotArchiveLastLive = errors.New("workspaces: cannot archive the last live workspace in a subscription")
	ErrGrantNotFound         = errors.New("workspaces: workspace role grant not found")
	ErrInvalidRole           = errors.New("workspaces: invalid role")
	ErrCrossDBOrphans        = errors.New("workspaces: vector_artefacts still references this workspace")
)
