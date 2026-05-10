package flows

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/messages"
)

// POST /_site/flows/reset/preview
//
// Diffs the live default flow against its frozen snapshot for one artefact
// type and returns the planned changes — never mutates anything.
func (h *Handler) ResetPreview(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())

	var in ResetPreviewInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if in.ArtefactTypeID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "artefact_type_id is required")
		return
	}

	out, err := h.Svc.PreviewReset(r.Context(), u.SubscriptionID.String(), in)
	if errors.Is(err, ErrNoSnapshot) {
		httperr.Write(w, r, http.StatusNotFound, "no factory default snapshot for this artefact type")
		return
	}
	if errors.Is(err, ErrNoSurvivor) {
		httperr.Write(w, r, http.StatusConflict, "snapshot has no pill to rebind artefacts to")
		return
	}
	if errors.Is(err, ErrFlowNotFound) {
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /_site/flows/reset/apply
//
// Rewrites the live default flow to match its snapshot in a single
// transaction: rebinds artefacts onto the deterministic walk-back successor,
// archives removed pills, updates kept pills' attributes, inserts new pills,
// and rewrites transitions.
func (h *Handler) ResetApply(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())

	var in ResetPreviewInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httperr.Write(w, r, http.StatusBadRequest, "invalid request body")
		return
	}
	if in.ArtefactTypeID == "" {
		httperr.Write(w, r, http.StatusBadRequest, "artefact_type_id is required")
		return
	}

	out, err := h.Svc.ApplyReset(r.Context(), u.SubscriptionID.String(), in)
	if errors.Is(err, ErrNoSnapshot) {
		httperr.Write(w, r, http.StatusNotFound, "no factory default snapshot for this artefact type")
		return
	}
	if errors.Is(err, ErrNoSurvivor) {
		httperr.Write(w, r, http.StatusConflict, "snapshot has no pill to rebind artefacts to")
		return
	}
	if errors.Is(err, ErrFlowNotFound) {
		httperr.Write(w, r, http.StatusNotFound, messages.NotFound)
		return
	}
	if err != nil {
		httperr.Write(w, r, http.StatusInternalServerError, messages.InternalError)
		return
	}
	writeJSON(w, http.StatusOK, out)
}
