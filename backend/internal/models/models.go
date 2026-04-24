package models

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
	Email               string     `json:"email"`
	PasswordHash        string     `json:"-"`
	Role                Role       `json:"role"`
	IsActive            bool       `json:"is_active"`
	LastLogin           *time.Time `json:"last_login,omitempty"`
	AuthMethod          string     `json:"auth_method"`
	LdapDN              *string    `json:"-"`
	ForcePasswordChange bool       `json:"force_password_change"`
	PasswordChangedAt   *time.Time `json:"password_changed_at,omitempty"`
	FailedLoginCount    int        `json:"-"`
	LockedUntil         *time.Time `json:"-"`
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

type UserWorkspacePermission struct {
	ID          uuid.UUID  `json:"id"`
	UserID      uuid.UUID  `json:"user_id"`
	WorkspaceID uuid.UUID  `json:"workspace_id"`
	CanView     bool       `json:"can_view"`
	CanEdit     bool       `json:"can_edit"`
	CanAdmin    bool       `json:"can_admin"`
	GrantedBy   *uuid.UUID `json:"granted_by,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
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
