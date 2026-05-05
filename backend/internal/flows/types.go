// Package flows owns the per-tenant flow editor surface.
//
// A "flow" is the ordered list of states an artefact moves through. Every
// artefact-shaped row in the system is governed by exactly one flow, and
// each flow attaches to one of three target columns on o_flow_tenant:
//
//   - system_artefact_type_id  → vendor-defined types (work_items, defects,…)
//   - tenant_artefact_type_id  → tenant-invented custom types
//   - portfolio_item_type_id   → strategy layers (Feature, Initiative, Theme…)
//
// The exactly-one CHECK is enforced at the DB level. This package is the sole
// writer to o_flow_tenant; all reads/writes go through Service.
package flows

import "time"

// FlowState is one row in o_flow_tenant — one state in one flow.
type FlowState struct {
	ID             string  `json:"id"`
	SubscriptionID string  `json:"subscription_id"`
	Position       int     `json:"flow_position"`
	Name           string  `json:"name"`
	CanonicalCode  string  `json:"canonical_code"`
	Description    *string `json:"description,omitempty"`

	// Exactly one of these is populated; the other two are nil.
	SystemTypeID    *string `json:"system_artefact_type_id,omitempty"`
	TenantTypeID    *string `json:"tenant_artefact_type_id,omitempty"`
	PortfolioTypeID *string `json:"portfolio_item_type_id,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// FlowGroup is one target's complete flow — the rows belonging to a single
// system type / tenant type / portfolio item type, ordered by position.
type FlowGroup struct {
	TargetKind  string      `json:"target_kind"` // "system" | "tenant" | "portfolio"
	TargetID    string      `json:"target_id"`
	TargetLabel string      `json:"target_label"`
	States      []FlowState `json:"states"`
}

// ListResponse is the wire shape of GET /api/flows.
type ListResponse struct {
	System    []FlowGroup `json:"system"`    // vendor types (work_items, defects, …)
	Tenant    []FlowGroup `json:"tenant"`    // tenant-invented custom types
	Portfolio []FlowGroup `json:"portfolio"` // strategy layers
}
