package erd

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandler_Get_RejectsAnonymous(t *testing.T) {
	h := NewHandler(NewService(nil, nil, "testdata/system_areas_min.yaml"), t.TempDir())
	req := httptest.NewRequest("GET", "/_site/admin/dev/erd", nil)
	rec := httptest.NewRecorder()
	h.Get(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestHandler_Snapshot_RejectsAnonymous(t *testing.T) {
	h := NewHandler(NewService(nil, nil, "testdata/system_areas_min.yaml"), t.TempDir())
	req := httptest.NewRequest("POST", "/_site/admin/dev/erd", nil)
	rec := httptest.NewRecorder()
	h.Snapshot(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}
