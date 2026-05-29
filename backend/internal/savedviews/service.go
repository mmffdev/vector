package savedviews

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"

	"github.com/google/uuid"
)

// WorkspaceAdminChecker is the minimal interface savedviews needs from
// auth.Service. Inverted dependency — keeps the service testable with a
// stub.
type WorkspaceAdminChecker interface {
	HasWorkspaceAdmin(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error)
}

// Service is the sole writer for saved_views. All writes pass through
// Create / UpdateBody / UpdateScope / Archive — each enforces:
//
//  1. Tenant integrity — the scope ID matches SubscriptionID via the
//     store's Verify* probes.
//  2. Permission — Rally-pattern: anyone creates user-scope; node
//     members create/edit node-scope; workspace admins create/edit
//     workspace-scope.
//  3. Audit log — every Create/UpdateScope/Archive emits one
//     audit_logs row (best-effort, logged on failure).
type Service struct {
	store    ViewStore
	wsAdmin  WorkspaceAdminChecker
	auditLog func(ctx context.Context, actor uuid.UUID, action string, viewID uuid.UUID, detail map[string]any)
}

// NewService wires a Service around an existing store + workspace-admin
// checker. The auditLog hook may be nil (writes still succeed; audit
// silently skipped — caller decides whether to require auditing).
func NewService(store ViewStore, wsAdmin WorkspaceAdminChecker, auditLog func(ctx context.Context, actor uuid.UUID, action string, viewID uuid.UUID, detail map[string]any)) *Service {
	return &Service{store: store, wsAdmin: wsAdmin, auditLog: auditLog}
}

// ── Reads ──────────────────────────────────────────────────────────

func (s *Service) GetByID(ctx context.Context, subID, viewID uuid.UUID) (*View, error) {
	return s.store.GetByID(ctx, subID, viewID)
}

func (s *Service) ListVisibleToUser(ctx context.Context, q ListVisibleQuery) ([]View, error) {
	return s.store.ListVisibleToUser(ctx, q)
}

// ── Writes ─────────────────────────────────────────────────────────

func (s *Service) Create(ctx context.Context, in CreateInput) (*View, error) {
	if err := s.validateCreateInput(in); err != nil {
		return nil, err
	}
	if err := s.checkScopeWritePermission(ctx, in.ActorUserID, in.Scope, in.UserID, in.NodeID, in.WorkspaceID); err != nil {
		return nil, err
	}
	if err := s.verifyTenantIntegrity(ctx, in.SubscriptionID, in.Scope, in.UserID, in.NodeID, in.WorkspaceID); err != nil {
		return nil, err
	}
	v, err := s.store.Insert(ctx, in)
	if err != nil {
		return nil, err
	}
	s.emit(ctx, in.ActorUserID, "saved_views.create", v.ID, map[string]any{
		"kind": in.Kind, "scope": in.Scope, "target": in.Target,
	})
	return v, nil
}

// UpdateBody — patch name and/or body. NULL args leave that column.
// Permission rule: owner OR any admin of the row's current scope.
func (s *Service) UpdateBody(ctx context.Context, subID, viewID, actorUserID uuid.UUID, name *string, body json.RawMessage) (*View, error) {
	if body != nil && len(body) > 65536 {
		return nil, ErrBodyTooLarge
	}
	cur, err := s.store.GetByID(ctx, subID, viewID)
	if err != nil {
		return nil, err
	}
	if err := s.checkEditPermission(ctx, actorUserID, cur); err != nil {
		return nil, err
	}
	v, err := s.store.UpdateBody(ctx, subID, viewID, name, body)
	if err != nil {
		return nil, err
	}
	s.emit(ctx, actorUserID, "saved_views.update_body", v.ID, map[string]any{
		"name_changed": name != nil,
		"body_changed": body != nil,
	})
	return v, nil
}

// UpdateScope — promote/demote. Two permission checks: actor must be
// allowed to MODIFY the existing row (checkEditPermission against cur),
// AND allowed to WRITE to the new scope (checkScopeWritePermission).
func (s *Service) UpdateScope(ctx context.Context, in UpdateScopeInput) (*View, error) {
	if err := s.validateScopeInput(in.NewScope, in.NewUserID, in.NewNodeID, in.NewWorkspaceID); err != nil {
		return nil, err
	}
	cur, err := s.store.GetByID(ctx, in.SubscriptionID, in.ViewID)
	if err != nil {
		return nil, err
	}
	if err := s.checkEditPermission(ctx, in.ActorUserID, cur); err != nil {
		return nil, err
	}
	if err := s.checkScopeWritePermission(ctx, in.ActorUserID, in.NewScope, in.NewUserID, in.NewNodeID, in.NewWorkspaceID); err != nil {
		return nil, err
	}
	if err := s.verifyTenantIntegrity(ctx, in.SubscriptionID, in.NewScope, in.NewUserID, in.NewNodeID, in.NewWorkspaceID); err != nil {
		return nil, err
	}
	v, err := s.store.UpdateScope(ctx, in)
	if err != nil {
		return nil, err
	}
	s.emit(ctx, in.ActorUserID, "saved_views.update_scope", v.ID, map[string]any{
		"old_scope": cur.Scope, "new_scope": in.NewScope,
	})
	return v, nil
}

func (s *Service) Archive(ctx context.Context, subID, viewID, actorUserID uuid.UUID) error {
	cur, err := s.store.GetByID(ctx, subID, viewID)
	if err != nil {
		return err
	}
	if err := s.checkEditPermission(ctx, actorUserID, cur); err != nil {
		return err
	}
	if err := s.store.Archive(ctx, subID, viewID); err != nil {
		return err
	}
	s.emit(ctx, actorUserID, "saved_views.archive", viewID, map[string]any{
		"kind": cur.Kind, "scope": cur.Scope,
	})
	return nil
}

// ── Permission helpers ─────────────────────────────────────────────

// checkScopeWritePermission — gate on creating/promoting into a scope.
//
//	user      → actor is the user (ActorUserID == in.UserID)
//	node      → actor is a member of in.NodeID
//	workspace → actor has workspace.admin on in.WorkspaceID
func (s *Service) checkScopeWritePermission(ctx context.Context, actor uuid.UUID, scope string, userID, nodeID, wsID *uuid.UUID) error {
	switch scope {
	case ScopeUser:
		if userID == nil || *userID != actor {
			return ErrForbidden
		}
		return nil
	case ScopeNode:
		if nodeID == nil {
			return ErrInvalidInput
		}
		ok, err := s.store.VerifyNodeMembership(ctx, actor, *nodeID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotNodeMember
		}
		return nil
	case ScopeWorkspace:
		if wsID == nil {
			return ErrInvalidInput
		}
		if s.wsAdmin == nil {
			return ErrForbidden
		}
		ok, err := s.wsAdmin.HasWorkspaceAdmin(ctx, actor, *wsID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrNotWSAdmin
		}
		return nil
	default:
		return ErrInvalidInput
	}
}

// checkEditPermission — gate on editing/deleting an existing row.
//
//	owner of any scope → always allowed
//	node-scope view    → any node admin (read: node member) may also edit
//	workspace-scope    → any workspace admin may also edit
func (s *Service) checkEditPermission(ctx context.Context, actor uuid.UUID, v *View) error {
	if v.CreatedBy == actor {
		return nil
	}
	switch v.Scope {
	case ScopeUser:
		return ErrForbidden
	case ScopeNode:
		if v.NodeID == nil {
			return ErrForbidden
		}
		// MVP: node membership grants edit. Tighten to a node-admin
		// role later if needed (additive — see TD register).
		ok, err := s.store.VerifyNodeMembership(ctx, actor, *v.NodeID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrForbidden
		}
		return nil
	case ScopeWorkspace:
		if v.WorkspaceID == nil || s.wsAdmin == nil {
			return ErrForbidden
		}
		ok, err := s.wsAdmin.HasWorkspaceAdmin(ctx, actor, *v.WorkspaceID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrForbidden
		}
		return nil
	}
	return ErrForbidden
}

// verifyTenantIntegrity — the scope ID must live in the subscription.
// Belt-and-braces against the sentinel clamp; catches cross-tenant
// scope IDs at the substrate layer regardless of upstream bugs.
func (s *Service) verifyTenantIntegrity(ctx context.Context, subID uuid.UUID, scope string, userID, nodeID, wsID *uuid.UUID) error {
	switch scope {
	case ScopeUser:
		ok, err := s.store.VerifyUserInSubscription(ctx, *userID, subID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrTenantMismatch
		}
	case ScopeNode:
		ok, err := s.store.VerifyNodeInSubscription(ctx, *nodeID, subID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrTenantMismatch
		}
	case ScopeWorkspace:
		ok, err := s.store.VerifyWorkspaceInSubscription(ctx, *wsID, subID)
		if err != nil {
			return err
		}
		if !ok {
			return ErrTenantMismatch
		}
	}
	return nil
}

// ── Input validation ───────────────────────────────────────────────

func (s *Service) validateCreateInput(in CreateInput) error {
	if in.Kind != KindObjectTree && in.Kind != KindPageLayout && in.Kind != KindPage {
		return fmt.Errorf("%w: unknown kind %q", ErrInvalidInput, in.Kind)
	}
	if in.Target == "" {
		return fmt.Errorf("%w: target required", ErrInvalidInput)
	}
	if in.Name == "" {
		return fmt.Errorf("%w: name required", ErrInvalidInput)
	}
	if len(in.Body) > 65536 {
		return ErrBodyTooLarge
	}
	return s.validateScopeInput(in.Scope, in.UserID, in.NodeID, in.WorkspaceID)
}

func (s *Service) validateScopeInput(scope string, userID, nodeID, wsID *uuid.UUID) error {
	switch scope {
	case ScopeUser:
		if userID == nil || nodeID != nil || wsID != nil {
			return fmt.Errorf("%w: scope=user requires id_user only", ErrInvalidInput)
		}
	case ScopeNode:
		if nodeID == nil || userID != nil || wsID != nil {
			return fmt.Errorf("%w: scope=node requires id_node only", ErrInvalidInput)
		}
	case ScopeWorkspace:
		if wsID == nil || userID != nil || nodeID != nil {
			return fmt.Errorf("%w: scope=workspace requires id_workspace only", ErrInvalidInput)
		}
	default:
		return fmt.Errorf("%w: unknown scope %q", ErrInvalidInput, scope)
	}
	return nil
}

// emit — fire-and-forget audit log. Failures logged, never returned.
func (s *Service) emit(ctx context.Context, actor uuid.UUID, action string, viewID uuid.UUID, detail map[string]any) {
	if s.auditLog == nil {
		return
	}
	defer func() {
		if r := recover(); r != nil {
			log.Printf("savedviews.emit: panic in audit hook: %v", r)
		}
	}()
	s.auditLog(ctx, actor, action, viewID, detail)
}

// Helper used by tests.
var _ = errors.New // keep errors import even if no direct use
