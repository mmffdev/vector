package navmap

import (
	"encoding/json"
	"net/http"
)

// Handler exposes the navmap spine over HTTP. Mounts under
//
//	/_site/admin/dev/architecture
//
// Same gadmin gate as the rest of /dev/* (caller wires the permission
// middleware at mount-time in main.go).
type Handler struct {
	Svc *Service
}

func NewHandler(s *Service) *Handler { return &Handler{Svc: s} }

// GetSpine handles GET /_site/admin/dev/architecture/spine.
// Returns the complete, unfiltered bucket->page tree for the <report> -a map.
func (h *Handler) GetSpine(w http.ResponseWriter, r *http.Request) {
	spine, err := h.Svc.Spine(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "navmap: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, spine)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
