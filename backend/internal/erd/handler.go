package erd

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/mmffdev/vector-backend/internal/auth"
)

type Handler struct {
	svc         *Service
	snapshotDir string // absolute or relative path to repo dev/audits/
}

func NewHandler(svc *Service, snapshotDir string) *Handler {
	return &Handler{svc: svc, snapshotDir: snapshotDir}
}

// Get — GET /_site/admin/dev/erd. Returns the live ERD payload.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if auth.UserFromCtx(r.Context()) == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	resp, err := h.svc.Build(r.Context(), false)
	if err != nil {
		http.Error(w, fmt.Sprintf("erd build: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// Snapshot — POST /_site/admin/dev/erd. Forces a fresh Build, writes
// dev/audits/erd.json atomically, returns the payload.
func (h *Handler) Snapshot(w http.ResponseWriter, r *http.Request) {
	if auth.UserFromCtx(r.Context()) == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	resp, err := h.svc.Build(r.Context(), true)
	if err != nil {
		http.Error(w, fmt.Sprintf("erd build: %v", err), http.StatusInternalServerError)
		return
	}
	if err := h.writeSnapshot(resp); err != nil {
		http.Error(w, fmt.Sprintf("snapshot write: %v", err), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

func (h *Handler) writeSnapshot(resp *Response) error {
	if err := os.MkdirAll(h.snapshotDir, 0o755); err != nil {
		return err
	}
	finalPath := filepath.Join(h.snapshotDir, "erd.json")
	tmpPath := finalPath + ".tmp"
	b, err := json.MarshalIndent(resp, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmpPath, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, finalPath)
}
