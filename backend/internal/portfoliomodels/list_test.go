package portfoliomodels

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// Smoke test: the list endpoint returns the seeded MMFF Standard model
// with a populated layer summary. Mirrors the testRoPool/skip discipline
// the rest of this package uses (see handler_test.go) so a missing
// tunnel produces a skip rather than a hard failure.
func TestList_OK(t *testing.T) {
	pool := testRoPool(t)
	defer pool.Close()

	r := chi.NewRouter()
	h := NewHandler(pool)
	r.Get("/api/portfolio-models", h.List)
	srv := httptest.NewServer(r)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/api/portfolio-models")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: want 200, got %d", resp.StatusCode)
	}

	var body modelListResponseDTO
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Seed (db/library_schema/seed/001_mmff_model.sql) inserts one MMFF
	// Standard model with scope='system', visibility='public', 5 layers.
	// The list MUST surface it.
	wantID := uuid.MustParse("00000000-0000-0000-0000-00000000aa01")
	var found *modelListItemDTO
	for i, m := range body.Models {
		if m.ID == wantID {
			found = &body.Models[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("seeded MMFF model %s missing from list (got %d entries)", wantID, len(body.Models))
	}
	if found.Name != "MMFF Standard" {
		t.Errorf("model.name: want %q, got %q", "MMFF Standard", found.Name)
	}
	if found.LayerCount != 5 {
		t.Errorf("layer_count: want 5, got %d", found.LayerCount)
	}
	if found.LayerSummary == "" {
		t.Errorf("layer_summary: want non-empty (comma-joined layer names), got empty string")
	}
	if found.Description == nil || *found.Description == "" {
		t.Errorf("description: want non-empty pointer, got %v", found.Description)
	}
}
