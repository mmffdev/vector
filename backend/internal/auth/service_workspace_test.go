package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

type stubWorkspaceResolver struct {
	workspaceForFocusNodeFn       func(ctx context.Context, focusNodeID, tenantID uuid.UUID) (uuid.UUID, error)
	firstGrantedWorkspaceFn       func(ctx context.Context, userID, tenantID uuid.UUID) (uuid.UUID, error)
	userHasActiveGrantWorkspaceFn func(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error)
}

func (s stubWorkspaceResolver) WorkspaceForFocusNode(ctx context.Context, focusNodeID, tenantID uuid.UUID) (uuid.UUID, error) {
	if s.workspaceForFocusNodeFn == nil {
		return uuid.Nil, pgx.ErrNoRows
	}
	return s.workspaceForFocusNodeFn(ctx, focusNodeID, tenantID)
}

func (s stubWorkspaceResolver) FirstGrantedWorkspace(ctx context.Context, userID, tenantID uuid.UUID) (uuid.UUID, error) {
	if s.firstGrantedWorkspaceFn == nil {
		return uuid.Nil, errors.New("unexpected FirstGrantedWorkspace call")
	}
	return s.firstGrantedWorkspaceFn(ctx, userID, tenantID)
}

func (s stubWorkspaceResolver) UserHasActiveGrantOnWorkspace(ctx context.Context, userID, workspaceID uuid.UUID) (bool, error) {
	if s.userHasActiveGrantWorkspaceFn == nil {
		return false, errors.New("unexpected UserHasActiveGrantOnWorkspace call")
	}
	return s.userHasActiveGrantWorkspaceFn(ctx, userID, workspaceID)
}

func TestDeriveWorkspaceForSession_DefaultFocusWorkspaceWins(t *testing.T) {
	userID := uuid.New()
	tenantID := uuid.New()
	focusID := uuid.New()
	focusWorkspaceID := uuid.New()
	firstGrantedID := uuid.New()
	u := &roletypes.User{
		ID:                 userID,
		SubscriptionID:     tenantID,
		DefaultFocusNodeID: &focusID,
	}
	svc := &Service{
		WorkspaceResolver: stubWorkspaceResolver{
			workspaceForFocusNodeFn: func(_ context.Context, gotFocusID, gotTenantID uuid.UUID) (uuid.UUID, error) {
				if gotFocusID != focusID || gotTenantID != tenantID {
					t.Fatalf("WorkspaceForFocusNode got (%s, %s), want (%s, %s)", gotFocusID, gotTenantID, focusID, tenantID)
				}
				return focusWorkspaceID, nil
			},
			userHasActiveGrantWorkspaceFn: func(_ context.Context, gotUserID, gotWorkspaceID uuid.UUID) (bool, error) {
				if gotUserID != userID || gotWorkspaceID != focusWorkspaceID {
					t.Fatalf("UserHasActiveGrantOnWorkspace got (%s, %s), want (%s, %s)", gotUserID, gotWorkspaceID, userID, focusWorkspaceID)
				}
				return true, nil
			},
			firstGrantedWorkspaceFn: func(context.Context, uuid.UUID, uuid.UUID) (uuid.UUID, error) {
				t.Fatal("FirstGrantedWorkspace should not run when saved home workspace is still granted")
				return firstGrantedID, nil
			},
		},
	}

	svc.deriveWorkspaceForSession(context.Background(), u)

	if u.WorkspaceID != focusWorkspaceID {
		t.Fatalf("WorkspaceID = %s, want saved-home workspace %s", u.WorkspaceID, focusWorkspaceID)
	}
}

func TestDeriveWorkspaceForSession_StaleDefaultFallsBackToFirstGrantedWorkspace(t *testing.T) {
	userID := uuid.New()
	tenantID := uuid.New()
	focusID := uuid.New()
	firstGrantedID := uuid.New()
	u := &roletypes.User{
		ID:                 userID,
		SubscriptionID:     tenantID,
		DefaultFocusNodeID: &focusID,
	}
	svc := &Service{
		WorkspaceResolver: stubWorkspaceResolver{
			workspaceForFocusNodeFn: func(context.Context, uuid.UUID, uuid.UUID) (uuid.UUID, error) {
				return uuid.Nil, pgx.ErrNoRows
			},
			firstGrantedWorkspaceFn: func(_ context.Context, gotUserID, gotTenantID uuid.UUID) (uuid.UUID, error) {
				if gotUserID != userID || gotTenantID != tenantID {
					t.Fatalf("FirstGrantedWorkspace got (%s, %s), want (%s, %s)", gotUserID, gotTenantID, userID, tenantID)
				}
				return firstGrantedID, nil
			},
			userHasActiveGrantWorkspaceFn: func(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
				t.Fatal("grant check should not run when the saved focus node no longer resolves")
				return false, nil
			},
		},
	}

	svc.deriveWorkspaceForSession(context.Background(), u)

	if u.WorkspaceID != firstGrantedID {
		t.Fatalf("WorkspaceID = %s, want first granted workspace %s", u.WorkspaceID, firstGrantedID)
	}
}

func TestDeriveWorkspaceForSession_RevokedDefaultWorkspaceGrantFallsBackToFirstGrantedWorkspace(t *testing.T) {
	userID := uuid.New()
	tenantID := uuid.New()
	focusID := uuid.New()
	focusWorkspaceID := uuid.New()
	firstGrantedID := uuid.New()
	u := &roletypes.User{
		ID:                 userID,
		SubscriptionID:     tenantID,
		DefaultFocusNodeID: &focusID,
	}
	svc := &Service{
		WorkspaceResolver: stubWorkspaceResolver{
			workspaceForFocusNodeFn: func(context.Context, uuid.UUID, uuid.UUID) (uuid.UUID, error) {
				return focusWorkspaceID, nil
			},
			userHasActiveGrantWorkspaceFn: func(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
				return false, nil
			},
			firstGrantedWorkspaceFn: func(context.Context, uuid.UUID, uuid.UUID) (uuid.UUID, error) {
				return firstGrantedID, nil
			},
		},
	}

	svc.deriveWorkspaceForSession(context.Background(), u)

	if u.WorkspaceID != firstGrantedID {
		t.Fatalf("WorkspaceID = %s, want fallback workspace %s", u.WorkspaceID, firstGrantedID)
	}
}
