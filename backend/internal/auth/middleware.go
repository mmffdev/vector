package auth

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/httperr"
	"github.com/mmffdev/vector-backend/internal/pageaccess"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/usermessages"
)

type ctxKey string

const (
	userCtxKey      ctxKey = "user"
	sessionIDCtxKey ctxKey = "session_id"
)

func UserFromCtx(ctx context.Context) *roletypes.User {
	u, _ := ctx.Value(userCtxKey).(*roletypes.User)
	return u
}

// SessionIDFromCtx returns the users_sessions_id that minted the access
// token authenticating this request, or uuid.Nil for legacy/grace-window
// tokens that carry no sid claim. B16.8.12 — consumed by realtime.ServeWS
// to register the WS connection with the session registry so the sweeper
// can evict it when the row is revoked or goes idle. Keeping this on the
// context (rather than on roletypes.User) preserves the per-request
// scope: the sid is a property of the authenticating token, not of the
// user.
func SessionIDFromCtx(ctx context.Context) uuid.UUID {
	sid, _ := ctx.Value(sessionIDCtxKey).(uuid.UUID)
	return sid
}

// WithUserForTest seeds a user into the context as if RequireAuth had
// run. Test-only helper — production code paths must go through
// RequireAuth so JWT validation actually happens. Lives in the auth
// package because the ctxKey is unexported.
func WithUserForTest(ctx context.Context, u *roletypes.User) context.Context {
	return context.WithValue(ctx, userCtxKey, u)
}

// WithSessionIDForTest is the SessionIDFromCtx counterpart of
// WithUserForTest. Used by realtime tests that need to exercise the
// register-on-accept path without spinning up RequireAuth.
func WithSessionIDForTest(ctx context.Context, sid uuid.UUID) context.Context {
	return context.WithValue(ctx, sessionIDCtxKey, sid)
}

func (s *Service) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Check if API key auth was already validated by apikeys middleware
		if apiKeySubID := r.Context().Value("api_key_subscription_id"); apiKeySubID != nil {
			// API key already validated upstream; proceed
			next.ServeHTTP(w, r)
			return
		}

		// Browsers cannot set Authorization headers on the WebSocket
		// upgrade handshake, so we also accept ?access_token=... for
		// the /ws route. Header takes precedence when both are sent.
		authz := r.Header.Get("Authorization")
		var raw string
		if strings.HasPrefix(authz, "Bearer ") {
			raw = strings.TrimPrefix(authz, "Bearer ")
		} else if q := r.URL.Query().Get("access_token"); q != "" {
			raw = q
		} else {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
			return
		}
		claims, err := ParseAccessToken(raw)
		if err != nil {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
			return
		}
		uid, err := uuid.Parse(claims.Subject)
		if err != nil {
			httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
			return
		}

		// B16.8.11 step 3 — when the access token carries a `sid` claim,
		// the user-row lookup is extended into a JOIN against
		// users_sessions so per-request revocation and idle-eviction
		// become first-class. Same number of DB roundtrips as before
		// (the existing FindUserByID lookup is replaced, not added to).
		// Tokens minted before step 2 (no sid) fall through to the
		// legacy FindUserByID path — the 24h grace window that keeps
		// users signed in across the deploy.
		var u *roletypes.User
		var sid uuid.UUID
		if claims.SessionID != "" {
			var perr error
			sid, perr = uuid.Parse(claims.SessionID)
			if perr != nil {
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			var st SessionState
			u, st, err = s.FindUserBySessionID(r.Context(), uid, sid)
			if err != nil || !u.IsActive {
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			if st.Revoked {
				httperr.WriteCoded(w, r, http.StatusUnauthorized, CodeSessionRevoked, usermessages.AuthSessionRevoked)
				return
			}
			idleTTL := parseDurationEnv("SESSION_IDLE_TTL", 30*time.Minute)
			if time.Since(st.LastActivityAt) > idleTTL {
				httperr.WriteCoded(w, r, http.StatusUnauthorized, CodeSessionIdleExpired, usermessages.AuthSessionIdleExpired)
				return
			}
		} else {
			// Legacy / grace-window token: no sid claim. Honour it via
			// the user-only lookup until REQUIRE_SID_CLAIM is flipped
			// on — after which any no-sid token is rejected outright.
			// B16.8.11 step 5: kill-switch for the grace window.
			//
			// Default is lenient (flag absent → grace honoured) so
			// flipping step 3 live did not boot every existing user;
			// once Rick is satisfied the deploy has been live long
			// enough that all live tokens carry sid, setting
			// REQUIRE_SID_CLAIM=true closes the door without code
			// changes. The flag accepts "true", "1", "yes" to match
			// the rest of the codebase's env-toggle conventions.
			if v := strings.ToLower(os.Getenv("REQUIRE_SID_CLAIM")); v == "true" || v == "1" || v == "yes" {
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			u, err = s.FindUserByID(r.Context(), uid)
			if err != nil || !u.IsActive {
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
		}
		// PLA-0053 / story 00575: populate u.WorkspaceID from the JWT
		// claim. The users table itself has no workspace_id column —
		// the workspace association is per-session, not per-user, and
		// lives on the access token. Legacy tokens (claim absent / "")
		// leave WorkspaceID as uuid.Nil, which WorkspaceClampMiddleware
		// treats as "fall back to FirstLiveWorkspace".
		if claims.WorkspaceID != "" {
			if wsID, perr := uuid.Parse(claims.WorkspaceID); perr == nil {
				u.WorkspaceID = wsID
			}
		}
		ctx := context.WithValue(r.Context(), userCtxKey, u)
		// B16.8.12: surface the issuing session id so realtime.ServeWS can
		// register the WS connection with the session registry. uuid.Nil
		// for legacy/no-sid tokens — realtime treats that as "skip
		// registration, behave as before."
		if sid != uuid.Nil {
			ctx = context.WithValue(ctx, sessionIDCtxKey, sid)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (s *Service) RequireFreshPassword(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u := UserFromCtx(r.Context())
		if u != nil && u.ForcePasswordChange {
			httperr.Write(w, r, http.StatusForbidden, usermessages.AuthPasswordChangeRequired)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireStepUpReauth gates a route on the caller presenting a fresh
// X-Action-Proof header bound to actionKey. The proof is a single-use,
// action-bound HMAC token issued by POST /_site/auth/reauth after the
// user re-presents password (+ TOTP if enrolled). B16.8.10.
//
// Response contract:
//   - Missing or unparseable header → 409 + Problem.Code "reauth_required"
//     so the frontend opens the reauth modal rather than redirecting to
//     /login (terminal 401 codes would trigger hardLogout).
//   - Wrong HMAC / wrong action_key / expired → 401 + "reauth_invalid".
//   - DB-level consume fails (already consumed, race) → 409
//     "reauth_required" again so the user can mint a fresh nonce.
//
// Per-action binding: a proof minted for "delete-workspace" cannot be
// replayed against "disable-mfa" — actionKey is signed into the HMAC
// AND checked against the nonces row's action_key column.
func (s *Service) RequireStepUpReauth(actionKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromCtx(r.Context())
			if u == nil {
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			proof := r.Header.Get("X-Action-Proof")
			if proof == "" {
				httperr.WriteCoded(w, r, http.StatusConflict, CodeReauthRequired, usermessages.AuthReauthRequired)
				return
			}
			nonceID, userID, perr := parseActionProof(proof, actionKey)
			if perr != nil {
				httperr.WriteCoded(w, r, http.StatusUnauthorized, CodeReauthInvalid, usermessages.AuthReauthInvalid)
				return
			}
			if userID != u.ID {
				httperr.WriteCoded(w, r, http.StatusUnauthorized, CodeReauthInvalid, usermessages.AuthReauthInvalid)
				return
			}
			ok, err := s.ConsumeReauthNonce(r.Context(), nonceID, u.ID, actionKey)
			if err != nil {
				httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
				return
			}
			if !ok {
				// Already consumed, expired, or wrong action_key in the row.
				// Same response shape as missing proof — frontend re-opens
				// the modal for a fresh round.
				httperr.WriteCoded(w, r, http.StatusConflict, CodeReauthRequired, usermessages.AuthReauthRequired)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequirePermission gates a route on the actor having ALL of the given
// permission codes (logical AND). Resolves the actor's effective code
// set via the resolver's process-local cache. Codes are defined in
// internal/permissions/catalogue.go (PLA-0007).
// API key auth (no user context) passes through without permission checks.
func RequirePermission(res *permissions.Resolver, codes ...permissions.Code) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromCtx(r.Context())
			// API key auth: no user context, but api_key_subscription_id is set — pass through
			if u == nil {
				if r.Context().Value("api_key_subscription_id") != nil {
					next.ServeHTTP(w, r)
					return
				}
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			set, err := res.PermissionsFor(r.Context(), u.ID)
			if err != nil {
				httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
				return
			}
			for _, code := range codes {
				if _, ok := set[code]; !ok {
					httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequirePageAccess gates a route on the actor having a users_roles_pages
// grant covering the page identified by keyEnum. PLA-0049 Phase 0.5.
//
// This is the page-level enforcement layer that defends against
// hand-typed URLs and stale bookmarks. Where RequirePermission gates on
// a permission code (e.g. "roles.assign_permissions"), RequirePageAccess
// gates on the actual users_roles_pages grant matrix — the same matrix
// that drives nav-rail visibility. The two layers are complementary:
// permission codes describe capabilities, page access describes which
// pages those capabilities apply to.
//
// API key auth (no user context) passes through without page-access
// checks — API keys are scoped to specific routes by their own
// middleware, not by the page model.
func RequirePageAccess(res *pageaccess.Resolver, keyEnum string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromCtx(r.Context())
			if u == nil {
				if r.Context().Value("api_key_subscription_id") != nil {
					next.ServeHTTP(w, r)
					return
				}
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			ok, err := res.Allowed(r.Context(), u.ID, keyEnum)
			if err != nil {
				httperr.Write(w, r, http.StatusInternalServerError, usermessages.InternalError)
				return
			}
			if !ok {
				httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAnyPermission gates a route on the actor having ANY of the
// given permission codes (logical OR). Useful for routes that two
// different roles can hit for different reasons.
func RequireAnyPermission(res *permissions.Resolver, codes ...permissions.Code) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := UserFromCtx(r.Context())
			if u == nil {
				httperr.Write(w, r, http.StatusUnauthorized, usermessages.AuthUnauthorized)
				return
			}
			set, err := res.PermissionsFor(r.Context(), u.ID)
			if err != nil {
				httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
				return
			}
			for _, code := range codes {
				if _, ok := set[code]; ok {
					next.ServeHTTP(w, r)
					return
				}
			}
			httperr.Write(w, r, http.StatusForbidden, usermessages.AuthForbidden)
		})
	}
}
