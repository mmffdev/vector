"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiSite, ApiError, setApiToken, setRefreshCallback, setHardLogoutCallback } from "@/app/lib/api";
import { broadcastAuthEvent, bumpRotationMarker, coordinatedRefresh, readBoundJKT, readRotationMarker, subscribeAuthEvents, writeBoundJKT } from "@/app/lib/authChannel";
import { notify } from "@/app/lib/toast";
import { purgeDraftsFor } from "@/app/lib/draftStore";
import { cpAuthEnabled, cpRefreshToken, refreshCpSession } from "@/app/lib/cpAuth";
// DPoP (RFC 9449) keypair lifecycle. Generated before the initial
// /auth/login POST so the proof on that request carries the public
// JWK the backend stamps onto the session row; reparented under the
// real userId once /auth/login returns; deleted on logout so a
// following user doesn't inherit a binding. See TD-SEC-DPOP-BINDING.
import {
  clearKeypair,
  DPOP_ANON_KEY,
  ensureAnyActiveKeypair,
  ensureKeypair,
  getActiveJKT,
  jktFromAccessToken,
  pruneStaleKeys,
  reparentAnonKeypair,
} from "@/app/lib/dpop";

// PLA-0007: role is now a structured row from the `roles` table, not an
// enum. Consumers should branch on permission codes (useHasPermission)
// rather than role.code directly. role.code is exposed for UI labelling
// and for the small handful of legacy call sites still being migrated.
export interface Role {
  id: string;
  code: string;
  label: string;
  rank: number;
  is_system: boolean;
  is_external: boolean;
}

export interface AuthUser {
  id: string;
  subscription_id: string;
  // workspace_id is the user's active workspace within their subscription
  // (PLA-0053 / story 00580). Sourced from the JWT claim via /me.
  // Empty string when the backend's JWT predates PLA-0053 — useActiveWorkspace
  // exposes this as null to keep consumers' loading-state handling clean.
  workspace_id: string;
  email: string;
  role: Role;
  is_active: boolean;
  force_password_change: boolean;
  auth_method: "local" | "ldap";
  last_login?: string | null;
  // B16.8.10 — used by useStepUpAction to conditionally render the
  // TOTP field in the reauth modal. Sourced from /auth/me +
  // /auth/login responses.
  mfa_enrolled?: boolean;
  permissions: string[];
}

interface LoginResp {
  access_token: string;
  user: AuthUser;
}

interface MFAChallengeResp {
  mfa_required: true;
  challenge_token: string;
}

// Thrown by login() when the backend requires a TOTP second factor.
// The login page catches this, stores challenge_token in state, and
// renders the inline TOTP input. Call mfaLogin() to complete the flow.
export class MFAChallengeError extends Error {
  readonly challengeToken: string;
  constructor(token: string) {
    super("mfa_challenge");
    this.name = "MFAChallengeError";
    this.challengeToken = token;
  }
}

interface AuthState {
  user: AuthUser | null;
  role: Role | null;
  loading: boolean;
  permissions: Set<string>;
  hasPermission: (code: string) => boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  // mfaLogin exchanges a challenge_token (from MFAChallengeError) + TOTP
  // code for a full session. Pass rememberDevice=true to set a 30-day
  // device-trust cookie so future logins on this browser skip MFA.
  mfaLogin: (challengeToken: string, code: string, rememberDevice?: boolean) => Promise<AuthUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  // PLA-0053 / story 00576.5 — POST /auth/switch-workspace re-mints
  // the JWT with a new workspace_id claim + rotates the refresh
  // session, then updates user state in-place. Callers that depend
  // on the active workspace (chip filters, catalogue providers,
  // localStorage keys via useActiveWorkspace) re-render automatically.
  // Throws on 403 (no live grant for that workspace).
  switchWorkspace: (workspaceID: string) => Promise<AuthUser>;
  setUser: (u: AuthUser) => void;
  // PLAT1.9 (flag-gated) — adopt a session minted by the MMFF Control-Plane OP
  // instead of Vector's /auth/login. Only ever called from the flag-gated
  // /cp/callback page (NEXT_PUBLIC_CP_AUTH_ENABLED). Sets the CP access token +
  // resolves the user via /auth/me. See the LOUD DPoP-binding caveat on the impl
  // — full DPoP-keypair reconciliation between the CP proof key and Vector's IDB
  // keypair is the remaining work before this is production-ready.
  adoptCpSession: (accessToken: string) => Promise<AuthUser>;
}

const Ctx = createContext<AuthState | null>(null);

// AuthContext is the test-only export of Ctx. Production code uses the
// useAuth() hook; tests that need to inject a stub user (e.g. the
// B16.8.10 useStepUpAction contract tests) wrap with
// <AuthContext.Provider value={...}>.
export const AuthContext = Ctx;

// _bootstrapFlight deduplicates concurrent bootstrap calls within the same
// JS runtime lifetime (StrictMode double-mount, HMR re-runs). It is a
// module-level promise so it survives the unmount+remount cycle that a
// component-level ref cannot.
//
// On a real browser refresh, the JS module reloads from scratch: all
// module-level variables reset to null, _bootstrapFlight becomes null,
// and bootstrap runs exactly once per page load — which is correct.
//
// On HMR hot-reload, the module is patched in-place without a full reload,
// so module-level state persists. _bootstrapped (below) guards against
// re-running bootstrap after it already succeeded in this JS runtime.
//
// On duplicate tab open: each tab gets its own JS module scope, so both
// will attempt bootstrap. The backend grace-window (migration 145) handles
// the race — if both tabs send the same rt cookie within 30 s, the second
// gets the successor token rather than triggering reuse-detection.
let _bootstrapFlight: Promise<void> | null = null;
let _bootstrapped = false;

// _broadcastSeq is a monotonic counter bumped whenever this tab receives a
// "refreshed" broadcast from another tab (listener added in the channel-
// subscription effect). coordinatedRefresh's freshTokenArrived() compares a
// snapshot taken before acquiring the lock against the current value: if it
// changed, a sibling tab rotated the cookie while we queued, so we adopt that
// token instead of rotating again. A plain counter (not Date.now()) is used so
// two rotations within the same millisecond still register as distinct — a
// timestamp would collide and the !== check would miss the second rotation.
let _broadcastSeq = 0;

// B16.8.7 — session_alive is a UI-only hint cookie (no auth value;
// HttpOnly=false is fine because it's read by AuthContext on bootstrap
// to decide whether to attempt /auth/refresh). Secure flag IS required
// on HTTPS pages — browsers strip Secure cookies set over plain http://
// so this auto-detects via window.location.protocol: secure on https,
// omitted on http (local dev).
function setSessionCookie() {
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `session_alive=1; Path=/; SameSite=Strict; Max-Age=604800${secure}`;
}

function clearSessionCookie() {
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `session_alive=; Path=/; Max-Age=0${secure}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  // Mid-session dedup: collapses concurrent refresh() calls that may occur
  // when multiple components detect a 401 simultaneously. This is a ref
  // (not module-scope) because it should reset between user sessions.
  const refreshInFlight = useRef<Promise<void> | null>(null);

  // Mirror `user` into a ref so the cross-tab channel listener (whose effect
  // has empty deps) can read the CURRENT user without re-subscribing on
  // every user change.
  const userRef = useRef<AuthUser | null>(null);
  useEffect(() => { userRef.current = user; }, [user]);

  const applyLogin = useCallback((res: LoginResp) => {
    setApiToken(res.access_token);
    setUser(res.user);
    setSessionCookie();
    // Persist the session's bound DPoP thumbprint (cnf.jkt from the freshly
    // minted access token) so the NEXT page-load bootstrap can deterministically
    // select the matching IndexedDB key to sign /auth/refresh — instead of
    // guessing "newest" and tripping the backend binding check → revoke-all →
    // logout. TD-SEC-DPOP-STALE-KEY Residual A. Null on legacy/pre-Phase-3
    // tokens, which leaves bootstrap on the newest-wins fallback (no regression).
    writeBoundJKT(jktFromAccessToken(res.access_token));
    // DPoP: if the request that produced this LoginResp went out
    // under the anonymous keypair (login mint), reparent the IDB
    // record under the real userId now. On a refresh response the
    // record is already under the userId from before, so this is a
    // no-op. Fire-and-forget — proof minting on subsequent requests
    // works either way because the in-memory cache holds the same
    // CryptoKey reference; reparent only changes the IDB key.
    //
    // TD-SEC-DPOP-STALE-KEY (2026-05-31) — after reparent, prune every
    // OTHER keypair from IDB so an orphan from a prior un-cleaned session
    // can't be picked up by ensureAnyActiveKeypair on the next tab
    // refocus and sign /auth/refresh with the wrong key (which the
    // backend's cnf.jkt binding check rejects → revoke-all → logged out /
    // blank page). Chained after reparent so the surviving record is the
    // one we just bound. Fire-and-forget — a prune failure only means a
    // stale key lingers one more cycle, never a broken session.
    void reparentAnonKeypair(res.user.id).then(() => pruneStaleKeys(res.user.id));
    // Tell sibling tabs the DPoP keypair was (re)bound/pruned so any live
    // tab reloads its in-memory key from IDB instead of signing the next
    // refresh with a key we just pruned (which the backend would reject →
    // revoke-all). TD-SEC-DPOP-STALE-KEY live-tab path.
    broadcastAuthEvent({ type: "dpop-key-changed", userId: res.user.id });
  }, []);

  // PLAT1.9 (flag-gated) — adopt a Control-Plane-minted session. Sets the CP
  // access token, then resolves the user via /auth/me (the backend accepts the
  // CP ES384 token via the dual-accept path — cp_dual_accept.go, slice E — when
  // CP_AUTH_DUAL_ACCEPT is on server-side). Updates user state so the app boots
  // exactly as it would after a legacy login.
  //
  // DPoP binding (PLAT1.9): the CP access token is bound (cnf.jkt) to the DPoP
  // keypair cpAuth.completeCpLogin() generated for the /token exchange, and that
  // SAME keypair has already been persisted to Vector's IndexedDB key store under
  // the user's id (cpAuth → writeKeyRecord). So /auth/refresh — which reads that
  // store and signs with the user's key — presents the key the token's cnf.jkt
  // expects, and the backend binding check passes (no revoke-all). adoptCpSession
  // therefore mirrors applyLogin: set token + user, persist the bound jkt, and
  // broadcast the key-changed event so sibling tabs reload the right key from IDB.
  // Gated behind NEXT_PUBLIC_CP_AUTH_ENABLED (default OFF); legacy login untouched.
  const adoptCpSession = useCallback(async (accessToken: string): Promise<AuthUser> => {
    setApiToken(accessToken);
    // Activate the CP-bound keypair from IDB before the first request.
    // completeCpLogin persisted it (writeKeyRecord) but persistence alone
    // doesn't make it the dpop module's ACTIVE key — and apiSite only mints
    // a proof when one is active, so without this /auth/me goes out
    // proof-less and the backend 401s it (missing_dpop_proof).
    await ensureAnyActiveKeypair(jktFromAccessToken(accessToken));
    // Resolve the principal. /auth/me returns the same AuthUser shape login does.
    const me = await apiSite<AuthUser>("/auth/me");
    setUser(me);
    setSessionCookie();
    writeBoundJKT(jktFromAccessToken(accessToken));
    // Sibling tabs: the DPoP keypair for this user is now the CP-bound one in IDB.
    broadcastAuthEvent({ type: "dpop-key-changed", userId: me.id });
    return me;
  }, []);

  const refresh = useCallback(async () => {
    // PLAT1.12 — CP-owned session refresh. If this session was adopted from the
    // Control-Plane (a CP refresh token is stashed), refresh against the CP
    // (grant_type=refresh_token, DPoP-signed with the bound key) rather than
    // Vector's own /auth/refresh — the CP owns the session lifecycle. On success
    // adopt the rotated access token; on failure fall through to the legacy path
    // (which will 401 and bounce to login, the correct end state for a dead CP
    // session). Flag-gated: cpRefreshToken() is empty unless a CP login happened.
    const cpUser = userRef.current;
    if (cpAuthEnabled() && cpRefreshToken() && cpUser) {
      const newAccess = await refreshCpSession(cpUser.id);
      if (newAccess) {
        setApiToken(newAccess);
        writeBoundJKT(jktFromAccessToken(newAccess));
        return;
      }
      // CP refresh failed → the CP session is dead; do NOT fall through to the
      // legacy /auth/refresh (there is no Vector session row for a CP login).
      setApiToken(null);
      setUser(null);
      return;
    }
    if (refreshInFlight.current) return refreshInFlight.current;
    // Snapshot the broadcast marker BEFORE we queue for the lock. If a
    // sibling tab broadcasts a fresh token while we wait, the marker
    // advances and freshTokenArrived() returns true → we skip the network
    // refresh and adopt the broadcast token (set by the channel listener).
    const seenBefore = _broadcastSeq;
    // Snapshot the synchronously-readable localStorage rotation marker too.
    // It closes the async race where a sibling acquires the lock and rotates
    // before its BroadcastChannel message reaches us (so _broadcastSeq hasn't
    // advanced yet) — the marker write is visible the instant the sibling's
    // lock callback resolves, which happens-before our lock handoff.
    const markerBefore = readRotationMarker();
    const flight = (async () => {
      await coordinatedRefresh({
        markerBefore,
        freshTokenArrived: () => _broadcastSeq !== seenBefore,
        doRefresh: async () => {
          try {
            // Regression guard (dev only): the recurring "refresh logs me out"
            // bug is the active DPoP key's JKT not matching the session's bound
            // JKT — the backend then rejects the proof and revokes the session.
            // If that mismatch is about to happen, scream in the console with a
            // greppable marker so it's caught the instant it regresses, instead
            // of days later via a user report. NEVER throws — a mismatch is
            // recoverable (the backend will 401 and we re-auth), and throwing
            // here would convert it into a hard crash.
            if (process.env.NODE_ENV !== "production") {
              const active = getActiveJKT();
              const bound = readBoundJKT();
              if (bound && active && active !== bound) {
                // eslint-disable-next-line no-console
                console.error(
                  `DPOP_JKT_MISMATCH: about to sign /auth/refresh with key ${active} ` +
                  `but session is bound to ${bound}. This will trip the backend ` +
                  `binding check → revoke-all → logout. TD-SEC-DPOP-STALE-KEY.`,
                );
              }
            }
            const res = await apiSite<LoginResp>("/auth/refresh", { method: "POST", skipAuth: true });
            applyLogin(res);
            _bootstrapped = true;
            // Tell sibling tabs the cookie was just rotated and hand them
            // the new access token so they don't rotate it again.
            broadcastAuthEvent({ type: "refreshed", accessToken: res.access_token, userId: res.user.id });
            // Bump the synchronously-readable marker AFTER a confirmed
            // rotation so the next tab to acquire the lock sees it even if
            // our broadcast hasn't been delivered yet. Only on success.
            bumpRotationMarker();
          } catch (e) {
            // Only clear state on REAL auth failures (backend 4xx). Network
            // errors are transient (dev backend restart, mid-nav abort);
            // nuking state here caused the air-restart logout cascade.
            if (e instanceof ApiError) {
              setApiToken(null);
              setUser(null);
              clearSessionCookie();
              writeBoundJKT(null); // refresh hit a real 4xx — session is gone
              _bootstrapped = false;
            }
          }
        },
      });
    })().finally(() => {
      refreshInFlight.current = null;
    });
    refreshInFlight.current = flight;
    return flight;
  }, [applyLogin]);

  useEffect(() => {
    setRefreshCallback(refresh);
    const hasSessionHint =
      typeof document !== "undefined" &&
      document.cookie.split("; ").some((c) => c.startsWith("session_alive="));
    if (hasSessionHint) {
      // _bootstrapped: already succeeded this tab lifetime — HMR re-ran
      // the effect but the rt cookie was already rotated by the first call.
      // Firing again hits reuse-detection and nukes all sessions.
      if (_bootstrapped) {
        setLoading(false);
        return;
      }
      // _bootstrapFlight: deduplicates StrictMode's unmount+remount double-fire
      // within the same synchronous render cycle. DPoP: load the
      // signing keypair from IDB BEFORE the refresh call so the
      // outgoing request carries a proof. From Phase 3 onward, an
      // unsigned refresh would 401 immediately.
      if (!_bootstrapFlight) {
        // Select the DPoP key the session is BOUND to (persisted cnf.jkt from
        // the last login/refresh), not "newest". TD-SEC-DPOP-STALE-KEY
        // Residual A — the fix for the recurring "refresh logs me out".
        const boundJKT = readBoundJKT();
        _bootstrapFlight = ensureAnyActiveKeypair(boundJKT)
          .then((result) => {
            if (result === "unrecoverable") {
              // The session's bound key is gone from this device (pruned,
              // cleared, different browser-profile). Signing /auth/refresh with
              // any OTHER key would fail the backend binding check and revoke
              // every session. So DON'T refresh — clear the stale local hints
              // and let the user re-auth cleanly. This converts a guaranteed
              // revoke-all-logout into an honest "please sign in again".
              writeBoundJKT(null);
              clearSessionCookie();
              setApiToken(null);
              setUser(null);
              return;
            }
            return refresh();
          })
          .finally(() => {
            _bootstrapFlight = null;
            setLoading(false);
          });
      } else {
        _bootstrapFlight.finally(() => setLoading(false));
      }
    } else {
      setLoading(false);
    }
    return () => setRefreshCallback(null);
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      // DPoP: mint a fresh anonymous keypair before the request so
      // the outgoing /auth/login carries a proof. The backend reads
      // the proof's public-key thumbprint and stamps it onto the new
      // users_sessions row in Phase 3+; applyLogin re-parents the
      // record under the real userId once the response arrives.
      await ensureKeypair(DPOP_ANON_KEY);
      const res = await apiSite<LoginResp | MFAChallengeResp>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
        skipAuth: true,
      });
      if ("mfa_required" in res && res.mfa_required) {
        throw new MFAChallengeError(res.challenge_token);
      }
      applyLogin(res as LoginResp);
      return (res as LoginResp).user;
    },
    [applyLogin]
  );

  const mfaLogin = useCallback(
    async (challengeToken: string, code: string, rememberDevice = false) => {
      // DPoP: the anon keypair generated during login() is still
      // active and signs this MFA verification request too. Backend
      // will stamp the same thumbprint onto the new session row on
      // verify success.
      await ensureKeypair(DPOP_ANON_KEY);
      const res = await apiSite<LoginResp>("/auth/mfa/verify", {
        method: "POST",
        body: JSON.stringify({ challenge_token: challengeToken, code, remember_device: rememberDevice }),
        skipAuth: true,
      });
      applyLogin(res);
      return res.user;
    },
    [applyLogin]
  );

  // PLA-0053 / story 00576.5 — switch active workspace.
  //
  // PLA062 S22: triggerScopeReload() removed alongside ScopeContext.
  // Sentinel owns the workspace switch via sentinel_switch_workspace,
  // which already re-mints the JWT + re-dispatches boot atomically.
  // This legacy AuthContext.switchWorkspace stays as a thin wrapper for
  // callers that haven't migrated yet; it MUST be deleted when the auth
  // flow itself is extracted to app/lib/auth.ts (deferred from S22).
  const switchWorkspace = useCallback(
    async (workspaceID: string) => {
      const res = await apiSite<LoginResp>("/auth/switch-workspace", {
        method: "POST",
        body: JSON.stringify({ workspace_id: workspaceID }),
      });
      applyLogin(res);
      return res.user;
    },
    [applyLogin]
  );

  const logout = useCallback(async () => {
    const departingId = user?.id ?? null;
    try {
      await apiSite("/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    if (departingId) {
      // Purge drafts AND the DPoP signing keypair owned by the
      // signing-out user so neither is visible if a different user
      // signs in on the same browser. The keypair clear also wipes
      // the in-memory cache so the next request mints under a fresh
      // anon record.
      try { await purgeDraftsFor(departingId); } catch { /* IDB unavailable; ignore */ }
      try { await clearKeypair(departingId); } catch { /* IDB unavailable; ignore */ }
    }
    setApiToken(null);
    setUser(null);
    clearSessionCookie();
    writeBoundJKT(null); // drop the bound-key hint so the next user can't inherit it
    broadcastAuthEvent({ type: "logout" });
    _bootstrapped = false;
    notify.success("You've been signed out.");
    router.push("/login");
  }, [router, user]);

  // hardLogout is invoked by api.ts when the backend returns a 401
  // carrying Problem.code = "session_revoked" or "session_idle_expired"
  // (B16.8.11 step 3). Silent refresh would loop forever on those
  // codes because the issuing session row is dead. Mirrors logout()
  // for the local-state cleanup, then sets a sessionStorage flag that
  // the /login page reads (B16.8.11 step 4e) to render the matching
  // banner instead of dropping the user onto a blank login form with
  // no explanation.
  //
  // Differences vs logout():
  //   - No success toast (this is involuntary, not a user action).
  //   - sessionStorage flag carries the reason code for the banner.
  //   - window.location.assign instead of router.push — guarantees a
  //     fresh page mount so any stale React state (caches, contexts
  //     holding pre-logout data) is wiped, not just AuthContext's.
  const hardLogout = useCallback(async (reason: string) => {
    const departingId = user?.id ?? null;
    try {
      await apiSite("/auth/logout", { method: "POST" });
    } catch {
      // ignore — backend may already have nuked the session
    }
    if (departingId) {
      try { await purgeDraftsFor(departingId); } catch { /* IDB unavailable; ignore */ }
      try { await clearKeypair(departingId); } catch { /* IDB unavailable; ignore */ }
    }
    setApiToken(null);
    setUser(null);
    clearSessionCookie();
    writeBoundJKT(null); // session is dead — drop the bound-key hint
    // NO cross-tab logout broadcast here. hardLogout is the INVOLUNTARY path
    // (backend-driven: WS idle-close 4002 / session_revoked 4001, or a
    // terminal-401). Broadcasting logout from here cascaded a single tab's
    // backend-forced session death into a forced /login redirect in EVERY
    // tab — "all browsers logged themselves out after a few minutes" with no
    // user action (regression 2026-06-04). Each tab must validate its OWN
    // session on its next request: the backend is the gate per tab, and a
    // sibling tab may still hold a live session (or be able to silently
    // refresh). Only voluntary logout() — a deliberate user action — fans
    // out across tabs; involuntary death stays local to the tab that hit it.
    _bootstrapped = false;
    try {
      sessionStorage.setItem("vector.login.reason", reason);
    } catch { /* private mode; banner won't render but redirect still happens */ }
    if (typeof window !== "undefined") {
      window.location.assign("/login");
    }
  }, [user]);

  // Register/unregister hardLogout with api.ts. Separate effect from the
  // bootstrap one so it doesn't drag hardLogout (defined further down)
  // into the bootstrap effect's deps before it's been declared.
  useEffect(() => {
    setHardLogoutCallback(hardLogout);
    return () => setHardLogoutCallback(null);
  }, [hardLogout]);

  // Subscribe to cross-tab auth events. A sibling tab that refreshes
  // broadcasts the new token (we adopt it without a network call); a
  // key-change tells us to reload the DPoP key from IDB; a logout tells
  // us to clear and redirect so no authenticated tab lingers.
  useEffect(() => {
    const unsub = subscribeAuthEvents((msg) => {
      if (msg.type === "refreshed") {
        _broadcastSeq += 1;
        setApiToken(msg.accessToken);
        _bootstrapped = true;
        // Keep this tab's persisted bound JKT in sync with the sibling's
        // rotated token, so a subsequent reload of THIS tab selects the right
        // key. The session family shares one bound JKT (the backend re-stamps
        // the original boundJKT onto every rotation), so this is normally a
        // no-op, but it's correct to track the authoritative value.
        writeBoundJKT(jktFromAccessToken(msg.accessToken));
        // If this tab had no user yet (e.g. it opened AFTER a sibling
        // already established the session), the access token alone isn't
        // enough — React state needs the user object. Fetch it via
        // GET /auth/me, which is a READ and does NOT rotate the single-use
        // refresh cookie. We gate on `user == null` via the ref below so a
        // tab that already has a user doesn't refetch on every sibling
        // refresh. Fire-and-forget; a failure leaves the tab to its own
        // next refresh.
        if (!userRef.current) {
          void apiSite<AuthUser>("/auth/me")
            .then((u) => { setUser(u); })
            .catch(() => { /* transient; next refresh recovers */ });
        }
      } else if (msg.type === "dpop-key-changed") {
        // Reload the in-memory active keypair from IDB — but select the key
        // BOUND to this session (persisted cnf.jkt), NOT "newest". A sibling
        // tab's key-change broadcast must not make this tab adopt the
        // sibling's newest key and then sign its next refresh with the wrong
        // JKT → binding violation → revoke-all. Passing the bound JKT keeps
        // selection deterministic. Fire-and-forget; "unrecoverable" here just
        // leaves the current in-memory key in place until this tab's own next
        // refresh resolves it. TD-SEC-DPOP-STALE-KEY Residual A (hardening).
        void ensureAnyActiveKeypair(readBoundJKT());
      } else if (msg.type === "logout") {
        setApiToken(null);
        setUser(null);
        clearSessionCookie();
        writeBoundJKT(null); // sibling signed out the shared session
        _bootstrapped = false;
        if (typeof window !== "undefined") window.location.assign("/login");
      }
    });
    return unsub;
  }, []);

  const permissions = useMemo(
    () => new Set(user?.permissions ?? []),
    [user]
  );
  const hasPermission = useCallback(
    (code: string) => permissions.has(code),
    [permissions]
  );
  const role = user?.role ?? null;

  return (
    <Ctx.Provider value={{ user, role, loading, permissions, hasPermission, login, mfaLogin, logout, refresh, switchWorkspace, setUser, adoptCpSession }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}

// useHasPermission is the canonical way to gate UI on capability. Pass
// the permission code (e.g. "roles.list", "users.create.gadmin") and the
// hook returns true iff the current user's role grants that code.
export function useHasPermission(code: string): boolean {
  const { hasPermission } = useAuth();
  return hasPermission(code);
}

export { ApiError };
