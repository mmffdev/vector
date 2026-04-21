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

type User struct {
	ID                  uuid.UUID  `json:"id"`
	TenantID            uuid.UUID  `json:"tenant_id"`
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
