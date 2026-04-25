// Package errorsreport implements POST /api/errors/report.
//
// Wire contract (request body):
//
//	{ "code": "<string>",   "context": { ...free-form JSON... } }
//
// On success we return 204 No Content. The caller only reports an
// occurrence — there is no read surface here.
//
// Validation:
//   - code MUST exist in mmff_library.error_codes (lookup via libRO).
//     A bad/unknown code is a 400 with body {"error":"unknown_error_code"};
//     this is treated as the caller's bug, not an internal failure.
//   - context is optional and free-form JSON object. We pass it through
//     to the JSONB column as-is. Hard size cap (4 KiB encoded) matches
//     the column comment in db/schema/028_error_events.sql so a single
//     misbehaving caller cannot bloat the table.
//
// Storage:
//   - Insert into mmff_vector.error_events with subscription_id +
//     user_id pulled from the auth context (every authenticated role
//     is allowed — error reporting is generic across padmin/gadmin/user).
//   - request_id is captured from chi middleware.RequestID so log
//     correlation works without extra plumbing.
//   - The table is append-only (trigger in migration 028 rejects
//     UPDATE/DELETE). This handler issues a single INSERT — never a
//     read-modify-write — so the trigger is never tripped.
//
// Why no entityrefs? entityrefs is the writer for the four polymorphic
// FK relationships (entity_stakeholders, item_type_states,
// item_state_history, page_entity_refs). error_events has plain UUID
// FKs to subscriptions and users, plus an app-enforced cross-DB FK
// by value to mmff_library.error_codes.code — no polymorphism, so a
// plain pgx insert is the right tool. See docs/c_polymorphic_writes.md.
package errorsreport

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/auth"
)

// MaxContextBytes caps the encoded JSON size of the context payload.
// Matches the "< ~4 KB" guidance documented on error_events.context in
// db/schema/028_error_events.sql. Larger payloads belong in logs/traces,
// not in this table.
const MaxContextBytes = 4096

// Handler holds the two pools needed for the cross-DB validate-then-
// write flow: libRO for the error_codes existence check (mmff_library),
// vectorPool for the actual error_events insert (mmff_vector).
type Handler struct {
	LibRO      *pgxpool.Pool
	VectorPool *pgxpool.Pool
}

func NewHandler(libRO, vectorPool *pgxpool.Pool) *Handler {
	return &Handler{LibRO: libRO, VectorPool: vectorPool}
}

// reportRequest is the wire shape. context is captured as RawMessage so
// we can re-encode it verbatim into JSONB without an intermediate
// map[string]any round-trip (which would re-order keys and discard
// numeric precision).
type reportRequest struct {
	Code    string          `json:"code"`
	Context json.RawMessage `json:"context"`
}

// Report handles POST /api/errors/report.
func (h *Handler) Report(w http.ResponseWriter, r *http.Request) {
	u := auth.UserFromCtx(r.Context())
	if u == nil {
		// RequireAuth should have rejected this already; defensive guard.
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	var req reportRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, http.StatusBadRequest, "invalid_request_body")
		return
	}
	if req.Code == "" {
		writeJSONError(w, http.StatusBadRequest, "missing_code")
		return
	}
	// Reject oversize context payloads up front. The 4 KiB cap is
	// documented on the column; enforce it here so the table can't be
	// bloated by a single misbehaving caller.
	if len(req.Context) > MaxContextBytes {
		writeJSONError(w, http.StatusBadRequest, "context_too_large")
		return
	}

	// Validate the code exists in mmff_library.error_codes. Single
	// SELECT on the PK — cheap (~sub-ms with pool warm). We don't
	// cache here: the catalogue churns rarely but reports are also
	// rare relative to read traffic, and a stale cache would let a
	// just-deleted code through, which is exactly the bug we're
	// trying to prevent. Revisit if profiling shows this in the
	// hot path (TD-LIB-007 already tracks the cross-DB FK gap).
	if ok, err := h.codeExists(r.Context(), req.Code); err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	} else if !ok {
		writeJSONError(w, http.StatusBadRequest, "unknown_error_code")
		return
	}

	// Normalise empty context to NULL JSONB (instead of "null" literal)
	// so dashboards can SELECT … WHERE context IS NULL without a string
	// match. nil RawMessage encodes to NULL via pgx's JSONB codec.
	var ctxPayload any
	if len(req.Context) > 0 && string(req.Context) != "null" {
		ctxPayload = req.Context
	}

	// request_id comes from chi middleware.RequestID — TEXT, not UUID
	// (matches the column comment).
	requestID := middleware.GetReqID(r.Context())

	_, err := h.VectorPool.Exec(r.Context(), `
		INSERT INTO error_events (subscription_id, user_id, code, context, request_id)
		VALUES ($1, $2, $3, $4, $5)`,
		u.SubscriptionID, u.ID, req.Code, ctxPayload, nullIfEmpty(requestID),
	)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// codeExists returns true iff the given code is present in
// mmff_library.error_codes. Errors are propagated as-is; the caller
// distinguishes "not found" (false, nil) from "lookup failed".
func (h *Handler) codeExists(ctx context.Context, code string) (bool, error) {
	var found int
	err := h.LibRO.QueryRow(ctx,
		`SELECT 1 FROM error_codes WHERE code = $1`, code,
	).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// nullIfEmpty maps "" to a typed nil so pgx writes SQL NULL rather than
// an empty string.
func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func writeJSONError(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": code})
}
