//go:build integration

package templates_test

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmffdev/vector-backend/internal/notifications/v2/templates"
)

// dbPool opens a pgxpool using DATABASE_URL from env, or skips the test
// if the env var is absent. This follows the same pattern as other integration
// test helpers in this codebase (see broker/broker_integration_test.go).
func dbPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		t.Skip("DATABASE_URL not set — skipping template integration tests")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Fatalf("db ping: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// seedTemplate inserts a template row and registers a cleanup to delete it.
func seedTemplate(t *testing.T, svc templates.Service, tpl templates.Template) templates.Template {
	t.Helper()
	ctx := context.Background()
	got, err := svc.Create(ctx, tpl)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	t.Cleanup(func() {
		// Best-effort delete — ignore error (may already be gone).
		_ = svc.Delete(context.Background(), got.ID)
	})
	return got
}

// ── Tests ─────────────────────────────────────────────────────────────────────

func TestService_Render_ExactLocaleMatch(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	tpl := seedTemplate(t, svc, templates.Template{
		EventType: "test.render_exact",
		Channel:   "in_app",
		Locale:    "en-GB",
		Subject:   "Hello {{ data.name }}",
		Body:      "Body for {{ data.name }}",
		Active:    true,
	})
	_ = tpl

	subject, body, err := svc.Render(ctx, "test.render_exact", "in_app", "en-GB", map[string]any{
		"name": "Alice",
	})
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if subject != "Hello Alice" {
		t.Errorf("subject = %q; want %q", subject, "Hello Alice")
	}
	if body != "Body for Alice" {
		t.Errorf("body = %q; want %q", body, "Body for Alice")
	}
}

func TestService_Render_FallsBackToEnGB(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	// Only seed an en-GB template — no fr-FR version.
	seedTemplate(t, svc, templates.Template{
		EventType: "test.render_fallback",
		Channel:   "in_app",
		Locale:    "en-GB",
		Subject:   "Fallback subject",
		Body:      "Fallback body",
		Active:    true,
	})

	// Request fr-FR → should fall back to en-GB.
	subject, body, err := svc.Render(ctx, "test.render_fallback", "in_app", "fr-FR", nil)
	if err != nil {
		t.Fatalf("Render fallback: %v", err)
	}
	if subject != "Fallback subject" {
		t.Errorf("subject = %q; want %q", subject, "Fallback subject")
	}
	if body != "Fallback body" {
		t.Errorf("body = %q; want %q", body, "Fallback body")
	}
}

func TestService_Render_ErrTemplateMissing(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	// No template seeded for this event type.
	_, _, err := svc.Render(ctx, "test.missing_"+uuid.NewString(), "in_app", "en-GB", nil)
	if !errors.Is(err, templates.ErrTemplateMissing) {
		t.Errorf("expected ErrTemplateMissing, got %v", err)
	}
}

func TestService_RenderOverride_ByID(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	tpl := seedTemplate(t, svc, templates.Template{
		EventType: "test.override",
		Channel:   "email",
		Locale:    "en-GB",
		Subject:   "Override: {{ data.item }}",
		Body:      "Override body: {{ data.item }}",
		Active:    true,
	})

	subject, body, err := svc.RenderOverride(ctx, tpl.ID, map[string]any{"item": "PROJ-99"})
	if err != nil {
		t.Fatalf("RenderOverride: %v", err)
	}
	if subject != "Override: PROJ-99" {
		t.Errorf("subject = %q; want %q", subject, "Override: PROJ-99")
	}
	if body != "Override body: PROJ-99" {
		t.Errorf("body = %q; want %q", body, "Override body: PROJ-99")
	}
}

func TestService_RenderOverride_InactiveTemplate(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	tpl := seedTemplate(t, svc, templates.Template{
		EventType: "test.override_inactive",
		Channel:   "email",
		Locale:    "en-GB",
		Subject:   "Inactive",
		Body:      "Inactive body",
		Active:    false, // intentionally inactive
	})

	_, _, err := svc.RenderOverride(ctx, tpl.ID, nil)
	if err == nil {
		t.Fatal("expected error for inactive template, got nil")
	}
}

func TestService_VersionSelection_PicksHighest(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	et := "test.version_select_" + uuid.NewString()[:8]

	// Seed v1 and v2 of the same (event_type, channel, locale).
	seedTemplate(t, svc, templates.Template{
		EventType: et,
		Channel:   "in_app",
		Locale:    "en-GB",
		Subject:   "v1 subject",
		Body:      "v1 body",
		Version:   1,
		Active:    true,
	})
	seedTemplate(t, svc, templates.Template{
		EventType: et,
		Channel:   "in_app",
		Locale:    "en-GB",
		Subject:   "v2 subject",
		Body:      "v2 body",
		Version:   2,
		Active:    true,
	})

	subject, _, err := svc.Render(ctx, et, "in_app", "en-GB", nil)
	if err != nil {
		t.Fatalf("Render: %v", err)
	}
	if subject != "v2 subject" {
		t.Errorf("expected v2 subject to be selected, got %q", subject)
	}
}

func TestService_CRUD_RoundTrip(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	// Create
	created := seedTemplate(t, svc, templates.Template{
		EventType: "test.crud_" + uuid.NewString()[:8],
		Channel:   "email",
		Locale:    "en-GB",
		Subject:   "Original subject",
		Body:      "Original body",
		Active:    true,
	})
	if created.ID == uuid.Nil {
		t.Fatal("Create returned zero ID")
	}

	// Get
	fetched, err := svc.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if fetched.Subject != "Original subject" {
		t.Errorf("Get subject = %q; want %q", fetched.Subject, "Original subject")
	}

	// Update
	updated, err := svc.Update(ctx, created.ID, templates.Template{
		Subject: "Updated subject",
		Body:    "Updated body",
		Active:  true,
		Version: created.Version,
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if updated.Subject != "Updated subject" {
		t.Errorf("Update subject = %q; want %q", updated.Subject, "Updated subject")
	}

	// List
	list, err := svc.List(ctx, templates.ListFilter{EventType: created.EventType})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) == 0 {
		t.Fatal("List returned empty slice")
	}
	found := false
	for _, row := range list {
		if row.ID == created.ID {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("List did not include created template %s", created.ID)
	}

	// Delete
	if err := svc.Delete(ctx, created.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	// Get after delete → ErrTemplateNotFound
	_, err = svc.Get(ctx, created.ID)
	if !errors.Is(err, templates.ErrTemplateNotFound) {
		t.Errorf("Get after delete: expected ErrTemplateNotFound, got %v", err)
	}
}

func TestService_Get_NotFound(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	_, err := svc.Get(ctx, uuid.New())
	if !errors.Is(err, templates.ErrTemplateNotFound) {
		t.Errorf("expected ErrTemplateNotFound, got %v", err)
	}
}

func TestService_Delete_NotFound(t *testing.T) {
	pool := dbPool(t)
	svc := templates.NewService(pool)
	ctx := context.Background()

	err := svc.Delete(ctx, uuid.New())
	if !errors.Is(err, templates.ErrTemplateNotFound) {
		t.Errorf("expected ErrTemplateNotFound, got %v", err)
	}
}
