// Package lookups exposes scope-bound lookup endpoints for slim
// reference data used by inline pickers (Owner, Assignee, etc.).
//
// Unlike the admin users handler (gated by users.admin.view), these
// endpoints return only the minimum projection any authenticated tenant
// member can see: id, display name, optional avatar. No email,
// no auth fields, no PII beyond what shows up on a name chip.
//
// Tenant isolation is non-negotiable — every query is clamped by
// subscription_id pulled from auth.UserFromCtx.
package lookups

// UserInScope is the slim wire row returned by GET /lookups/users-in-scope.
type UserInScope struct {
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
}
