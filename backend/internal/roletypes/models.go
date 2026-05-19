package roletypes

import (
	"time"

	"github.com/google/uuid"
)

type Role string

const (
	RoleUser   Role = "user"
	RolePAdmin Role = "padmin"
	RoleGAdmin Role = "gadmin"
)

// Rank returns the role's position in the privilege hierarchy.
// Higher rank = more privileged. Use Rank to compare roles for the
// "role ceiling" rule: an admin can only act on accounts at or below
// their own rank. See feedback_role_ceiling.md.
func (r Role) Rank() int {
	switch r {
	case RoleGAdmin:
		return 30
	case RolePAdmin:
		return 20
	case RoleUser:
		return 10
	}
	return 0
}

type User struct {
	ID                  uuid.UUID  `json:"id"`
	SubscriptionID            uuid.UUID  `json:"subscription_id"`
	// WorkspaceID is the user's active workspace within their subscription.
	// Populated from the JWT claim on RequireAuth (PLA-0053 / story 00575).
	// Zero (uuid.Nil) when the JWT predates PLA-0053 — middleware falls
	// back to FirstLiveWorkspace per the legacy-token rollout window.
	WorkspaceID         uuid.UUID  `json:"workspace_id"`
	Email               string     `json:"email"`
	PasswordHash        string     `json:"-"`
	// Role is the legacy user_role enum (gadmin/padmin/user) kept
	// during the dual-read window. Authoritative gating moved to RoleID
	// in PLA-0049 — most call sites should use RoleID and reserve Role
	// for cosmetic display only.
	Role                Role       `json:"role"`
	// RoleID is the UUID of the user's grp_* system or tenant role
	// in users_roles. Source of truth for all post-PLA-0049 page-grant
	// and permission lookups. Populated in auth.RequireAuth from
	// users.role_id.
	RoleID              uuid.UUID  `json:"role_id"`
	IsActive            bool       `json:"is_active"`
	FirstName           *string    `json:"first_name,omitempty"`
	LastName            *string    `json:"last_name,omitempty"`
	Department          *string    `json:"department,omitempty"`

	// B20.4.2 extended profile. Optional on the wire — fields are
	// only returned to callers holding users.admin.view (the admin
	// handler clears them server-side for other roles before
	// serialising; see backend/internal/users/handler.go).
	MiddleName                *string `json:"middle_name,omitempty"`
	DisplayName               *string `json:"display_name,omitempty"`
	PhoneWork                 *string `json:"phone_work,omitempty"`
	PhoneMobile               *string `json:"phone_mobile,omitempty"`
	Timezone                  *string `json:"timezone,omitempty"`
	DateFormat                *string `json:"date_format,omitempty"`
	DatetimeFormat            *string `json:"datetime_format,omitempty"`
	EmailNotificationsEnabled *bool   `json:"email_notifications_enabled,omitempty"`
	PasswordResetRequired     *bool   `json:"password_reset_required,omitempty"`
	// Stub UUID columns (B20.4.2). Promoted to real FKs by the
	// owning stories; until then they accept NULL or a string UUID.
	CostCentreID     *uuid.UUID `json:"cost_centre_id,omitempty"`
	OfficeLocationID *uuid.UUID `json:"office_location_id,omitempty"`
	ProfileImageURL  *string    `json:"profile_image_url,omitempty"`

	LastLogin           *time.Time `json:"last_login,omitempty"`
	AuthMethod          string     `json:"auth_method"`
	LdapDN              *string    `json:"-"`
	ForcePasswordChange bool       `json:"force_password_change"`
	PasswordChangedAt   *time.Time `json:"password_changed_at,omitempty"`
	FailedLoginCount    int        `json:"-"`
	LockedUntil         *time.Time `json:"-"`
	// MFA fields — populated from the four columns added in 003_mfa_scaffold.sql.
	// MFAEnrolled is false until the user completes POST /auth/mfa/confirm.
	MFAEnrolled         bool       `json:"-"`
	MFASecret           *string    `json:"-"`
	MFARecoveryCodes    []string   `json:"-"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type Session struct {
	ID         uuid.UUID  `json:"id"`
	UserID     uuid.UUID  `json:"user_id"`
	TokenHash  string     `json:"-"`
	CreatedAt  time.Time  `json:"created_at"`
	ExpiresAt  time.Time  `json:"expires_at"`
	LastUsedAt time.Time  `json:"last_used_at"`
	IPAddress  *string    `json:"ip_address,omitempty"`
	UserAgent  *string    `json:"user_agent,omitempty"`
	Revoked    bool       `json:"revoked"`
}

type PasswordReset struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	TokenHash   string     `json:"-"`
	ExpiresAt   time.Time  `json:"expires_at"`
	UsedAt      *time.Time `json:"used_at,omitempty"`
	RequestedIP *string    `json:"requested_ip,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// ============================================================
// Portfolio stack (migrations 004–006)
// ============================================================

type CompanyRoadmap struct {
	ID          uuid.UUID  `json:"id"`
	SubscriptionID    uuid.UUID  `json:"subscription_id"`
	KeyNum      int64      `json:"key_num"`
	Name        string     `json:"name"`
	OwnerUserID uuid.UUID  `json:"owner_user_id"`
	ArchivedAt  *time.Time `json:"archived_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type Workspace struct {
	ID                uuid.UUID  `json:"id"`
	SubscriptionID          uuid.UUID  `json:"subscription_id"`
	CompanyRoadmapID  uuid.UUID  `json:"company_roadmap_id"`
	KeyNum            int64      `json:"key_num"`
	Name              string     `json:"name"`
	OwnerUserID       uuid.UUID  `json:"owner_user_id"`
	ArchivedAt        *time.Time `json:"archived_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

type Portfolio struct {
	ID           uuid.UUID  `json:"id"`
	SubscriptionID     uuid.UUID  `json:"subscription_id"`
	WorkspaceID  uuid.UUID  `json:"workspace_id"`
	TypeID       *uuid.UUID `json:"type_id,omitempty"`
	KeyNum       int64      `json:"key_num"`
	Name         string     `json:"name"`
	OwnerUserID  uuid.UUID  `json:"owner_user_id"`
	ArchivedAt   *time.Time `json:"archived_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type Product struct {
	ID                 uuid.UUID  `json:"id"`
	SubscriptionID           uuid.UUID  `json:"subscription_id"`
	WorkspaceID        uuid.UUID  `json:"workspace_id"`
	ParentPortfolioID  *uuid.UUID `json:"parent_portfolio_id,omitempty"`
	TypeID             *uuid.UUID `json:"type_id,omitempty"`
	KeyNum             int64      `json:"key_num"`
	Name               string     `json:"name"`
	OwnerUserID        uuid.UUID  `json:"owner_user_id"`
	ArchivedAt         *time.Time `json:"archived_at,omitempty"`
	CreatedAt          time.Time  `json:"created_at"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type PortfolioItemType struct {
	ID         uuid.UUID  `json:"id"`
	SubscriptionID   uuid.UUID  `json:"subscription_id"`
	Name       string     `json:"name"`
	Tag        string     `json:"tag"`
	SortOrder  int        `json:"sort_order"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type ExecutionItemType struct {
	ID         uuid.UUID  `json:"id"`
	SubscriptionID   uuid.UUID  `json:"subscription_id"`
	Name       string     `json:"name"`
	Tag        string     `json:"tag"`
	SortOrder  int        `json:"sort_order"`
	ArchivedAt *time.Time `json:"archived_at,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type ItemTypeKind string

const (
	ItemTypeKindPortfolio ItemTypeKind = "portfolio"
	ItemTypeKindExecution ItemTypeKind = "execution"
)

type ItemTypeState struct {
	ID            uuid.UUID    `json:"id"`
	SubscriptionID      uuid.UUID    `json:"subscription_id"`
	ItemTypeID    uuid.UUID    `json:"item_type_id"`
	ItemTypeKind  ItemTypeKind `json:"item_type_kind"`
	Name          string       `json:"name"`
	CanonicalCode string       `json:"canonical_code"`
	SortOrder     int          `json:"sort_order"`
	ArchivedAt    *time.Time   `json:"archived_at,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
}

// ============================================================
// PLA-0007 — data-driven RBAC (migration 088)
// ============================================================

// RoleRow is a row in the roles table. SubscriptionID is NULL for
// system roles (visible to every tenant) and non-NULL for tenant
// custom roles. IsSystem is the authoritative immutability flag.
type RoleRow struct {
	ID             uuid.UUID  `json:"id"`
	SubscriptionID *uuid.UUID `json:"subscription_id,omitempty"`
	Code           string     `json:"code"`
	Label          string     `json:"label"`
	Description    string     `json:"description"`
	Rank           int        `json:"rank"`
	IsSystem       bool       `json:"is_system"`
	IsExternal     bool       `json:"is_external"`
	ArchivedAt     *time.Time `json:"archived_at,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	CreatedBy      *uuid.UUID `json:"created_by,omitempty"`
}

// RolePermissionRow is a junction row in role_permissions.
type RolePermissionRow struct {
	RoleID       uuid.UUID  `json:"role_id"`
	PermissionID uuid.UUID  `json:"permission_id"`
	GrantedBy    *uuid.UUID `json:"granted_by,omitempty"`
	GrantedAt    time.Time  `json:"granted_at"`
}

// PermissionRow is a row in the permissions catalogue.
type PermissionRow struct {
	ID          uuid.UUID `json:"id"`
	Code        string    `json:"code"`
	Label       string    `json:"label"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"created_at"`
}
