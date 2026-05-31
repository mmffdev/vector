package artefactitems

// MapPublicWorkItem projects the internal WorkItem wire type into its public
// API representation. The two shapes are currently identical — this function
// exists as the required seam (PLA-0039 / Story 00532) so that when the
// internal and public shapes diverge (e.g. stripping subscription_id,
// renaming fields, adding computed fields for external callers) the change
// is a single edit here rather than a hunt across handler call sites.
//
// lint:public-dto-mapper checks for MapPublic* in public-transport handlers;
// add new projections here as additional domains join /samantha/v2.
func MapPublicWorkItem(w WorkItem) WorkItem {
	return w
}

// MapPublicSprint projects the internal Sprint type into its public shape.
func MapPublicSprint(s Sprint) Sprint {
	return s
}

// QueryRequest is the body DTO for the audited POST read-gateway
// (POST /work-items/query + /portfolio-items/query). It unifies "list
// roots" (no ParentID) and "list children" (ParentID set) behind one
// body-driven endpoint so every read is logged uniformly for SOC 2.
//
// SECURITY: every field here is a NARROW hint, re-validated each request.
// The authority for what the caller may see is the SERVER-SIDE clamp
// (subscription from auth ctx + workspace from sentinel ctx) — never the
// body. A forged ParentID/filters can only sub-select within that ceiling.
type QueryRequest struct {
	ParentID *string       `json:"parentId"`
	Filters  *QueryFilters `json:"filters"`
	Page     *QueryPage    `json:"page"`
	Sort     *QuerySort    `json:"sort"`
}

// QueryFilters carries the row-level allow-lists. ItemTypeID maps to
// Filters.ItemType / ChildFilters.ItemType, FlowStateID → Filters.Status,
// PriorityID → Filters.Priority, OwnerID → Filters.OwnerID. SprintID uses
// the "__none__" sentinel for "no sprint assigned".
type QueryFilters struct {
	ItemTypeID  []string `json:"itemTypeId"`
	FlowStateID []string `json:"flowStateId"`
	PriorityID  []string `json:"priorityId"`
	OwnerID     []string `json:"ownerId"`
	SprintID    *string  `json:"sprintId"`
}

// QueryPage carries the page window (roots path only; children return the
// full direct-child set, matching the GET /{id}/children contract).
type QueryPage struct {
	Limit  int `json:"limit"`
	Offset int `json:"offset"`
}

// QuerySort carries the sort key + direction (roots path only).
type QuerySort struct {
	Key string `json:"key"`
	Dir string `json:"dir"`
}
