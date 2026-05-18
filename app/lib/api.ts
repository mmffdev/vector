// Versioned base for data API calls (/samantha/v1 or /samantha/v2 — public).
// Site/BFF routes (auth, nav, me, roles, admin, workspaces, errors,
// addressables, page-help, library/releases, custom-pages, user/tab-order)
// live under /_site (PLA-0039 / B22) — use apiSite() for those.

import { hasActiveKeypair, mintProof } from "./dpop";

const API_ROOT_BASE = process.env.NEXT_PUBLIC_API_INFRA_BASE ?? "http://localhost:5100";
export const API_SITE_BASE = API_ROOT_BASE + "/_site";
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100") + "/samantha/v1";

let _accessToken: string | null = null;
// Registered by AuthContext so api() can silently refresh an expired JWT
// and retry rather than surfacing a 401 to the caller.
let _refreshCallback: (() => Promise<void>) | null = null;
// Dedup: only one refresh flight at a time; concurrent 401s share the same promise.
let _refreshPromise: Promise<void> | null = null;
// Registered by AuthContext for terminal 401s where silent refresh
// would be useless (session_revoked / session_idle_expired). api.ts
// invokes this on detection so AuthContext owns the full logout side
// effects (clear token + clear user state + hit /auth/logout + set
// sessionStorage reason flag + redirect). B16.8.11 step 4.
let _hardLogoutCallback: ((reason: string) => Promise<void>) | null = null;

export function setApiToken(t: string | null) {
  _accessToken = t;
}

export function getApiToken() {
  return _accessToken;
}

export function setRefreshCallback(fn: (() => Promise<void>) | null) {
  _refreshCallback = fn;
}

export function getRefreshCallback(): (() => Promise<void>) | null {
  return _refreshCallback;
}

export function setHardLogoutCallback(fn: ((reason: string) => Promise<void>) | null) {
  _hardLogoutCallback = fn;
}

// getHardLogoutCallback returns the registered hardLogout function (or
// null if AuthContext hasn't mounted yet). Exposed for the WS close-code
// handler (app/lib/wsClose.ts, B16.8.12) which is invoked from inside a
// WebSocket close listener — those run outside React render scope, so
// they can't go through useAuth().
export function getHardLogoutCallback(): ((reason: string) => Promise<void>) | null {
  return _hardLogoutCallback;
}

export type ApiViolation = { field: string; message: string };

// RFC 9457 Problem Details fields surfaced from error responses. `code`
// is the §3.4 extension member backend handlers set via httperr.WriteCoded
// (e.g. "session_revoked", "session_idle_expired") so callers can branch
// on machine-readable identity rather than parsing the human-readable
// `detail` string. B16.8.11 step 4.
export class ApiError extends Error {
  status: number;
  body: unknown;
  title?: string;
  code?: string;
  detail?: string;
  violations?: ApiViolation[];
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
    if (body && typeof body === "object") {
      const p = body as Record<string, unknown>;
      if (typeof p.title === "string") this.title = p.title;
      if (typeof p.code === "string") this.code = p.code;
      if (typeof p.detail === "string") this.detail = p.detail;
      if (Array.isArray(p.violations)) this.violations = p.violations as ApiViolation[];
    }
  }
}

// Problem.code values that signal a terminal session state — silent
// refresh would be useless on these because the issuing session row is
// either revoked or idle-expired, so any refresh attempt 401s on the
// same row. Mirrors backend/internal/auth/codes.go (B16.8.11 step 3);
// keep in sync when adding new codes.
const TERMINAL_SESSION_CODES = new Set(["session_revoked", "session_idle_expired"]);

type ApiOpts = RequestInit & { skipAuth?: boolean; _retried?: boolean };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

// ─── URL surface vs wire surface (PLA-0053 — feedback_url_is_path_only) ─────
// The user-visible URL is PATH-ONLY. No query state in the address bar,
// ever. /portfolio-items stays /portfolio-items — no ?scope=, ?limit=,
// ?filter=, nothing. State lives in user profile (server) + localStorage
// (client cache) + in-memory React state.
//
// The WIRE request that this fetch helper assembles is a different thing.
// It DOES carry query params (?limit=&offset=&scope=&item_type_id=…),
// because that's how the backend Go handlers receive parameters. The user
// never sees those — they're between JS and the Go server.
//
// So when you read "we binned ?scope from the URL", that means the address
// bar, NOT the wire request. The Go handlers must still read q.Get("scope")
// off the request URL — that URL is the wire URL, not the address bar.
//
// If a future Go handler needs a new parameter, this helper (or the caller)
// appends it to the wire path; the user-visible URL stays untouched.
// ─────────────────────────────────────────────────────────────────────────────

// PLA-0043 — When a GET targets an artefact-list route (work-items or
// portfolio-items), forward the active scope node ID so the backend can
// clamp reads to that topology subtree. Source of truth is the browser
// URL (?meg=<node-id>) — URL-as-state means every fetch on the same
// render reads the same value, no localStorage race. localStorage is
// kept as a fallback only for the brief window before ?meg= lands in
// the URL on first paint (TD-URL-SCOPE-PARAM-CUTOVER).
function withForwardedMeg(path: string, method: string): string {
  if (method !== "GET") return path;
  if (typeof window === "undefined") return path;
  if (!/(^|\/)(work-items|portfolio-items)(\?|\/|$)/.test(path)) return path;
  if (path.includes("meg=") || path.includes("scope=")) return path;
  try {
    let meg = new URLSearchParams(window.location.search).get("meg");
    if (!meg) meg = window.localStorage.getItem("vector.scope.activeNodeId");
    if (!meg) return path;
    const sep = path.includes("?") ? "&" : "?";
    return path + sep + "meg=" + encodeURIComponent(meg);
  } catch {
    return path;
  }
}

async function _fetch<T>(base: string, path: string, opts: ApiOpts): Promise<T> {
  const headers = new Headers(opts.headers);
  if (!headers.has("Content-Type") && opts.body && typeof opts.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  if (!opts.skipAuth && _accessToken) {
    headers.set("Authorization", `Bearer ${_accessToken}`);
  }
  const method = (opts.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrf = readCookie("csrf_token");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }

  const finalPath = withForwardedMeg(path, method);
  const fullURL = base + finalPath;

  // RFC 9449 DPoP proof (TD-SEC-DPOP-BINDING Phase 2). Minted on
  // every call when a keypair is active — even when skipAuth is set,
  // because the login endpoint itself expects an unbound proof so
  // the backend can stamp the key's thumbprint onto the new session
  // row. ath is conditional: present when an access token is on
  // hand, omitted on the pre-token mint path. Phase 2 ships the
  // header; backend enforcement flips on in Phase 3.
  if (hasActiveKeypair()) {
    const proof = await mintProof({
      htm: method,
      htu: fullURL,
      accessToken: opts.skipAuth ? undefined : (_accessToken ?? undefined),
    });
    if (proof) headers.set("DPoP", proof);
  }

  const res = await fetch(fullURL, {
    ...opts,
    headers,
    credentials: "include",
  });

  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // leave as text
  }

  if (res.status === 401 && !opts.skipAuth && !opts._retried) {
    // B16.8.11 step 4 — peek at Problem.code BEFORE deciding whether
    // to silently refresh. A terminal session-state 401
    // (session_revoked / session_idle_expired) means the issuing
    // session row is gone or idle-expired; refresh would 401 on the
    // same row and loop. Skip refresh, hand off to AuthContext's
    // hardLogout, and let the original 401 propagate to the caller
    // so any in-flight UI can unwind.
    const problemCode =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).code === "string"
        ? (body as Record<string, unknown>).code as string
        : undefined;
    if (problemCode && TERMINAL_SESSION_CODES.has(problemCode) && _hardLogoutCallback) {
      // Fire-and-forget — the 401 still throws below so the caller
      // sees the terminal failure. hardLogout handles the side
      // effects (clear token, hit /auth/logout, redirect to /login
      // with reason). We don't await it because we don't want to
      // delay the throw, and the navigation it triggers replaces
      // the page anyway.
      void _hardLogoutCallback(problemCode);
    } else if (_refreshCallback) {
      // Silent refresh-and-retry: deduplicate concurrent 401s onto one flight.
      if (!_refreshPromise) {
        _refreshPromise = _refreshCallback().finally(() => { _refreshPromise = null; });
      }
      await _refreshPromise;
      if (_accessToken) {
        // pass the original path; finalPath is re-derived inside the retry.
        return _fetch<T>(base, path, { ...opts, _retried: true });
      }
    }
  }

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && typeof (body as Record<string, unknown>).detail === "string")
        ? (body as Record<string, unknown>).detail as string
        : typeof body === "string" ? body : `HTTP ${res.status}`;
    throw new ApiError(res.status, body, message);
  }
  return body as T;
}

export async function api<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  return _fetch<T>(API_BASE, path, opts);
}

// For site/BFF routes mounted under /_site: auth, nav, me, roles, admin,
// workspaces, errors, addressables, page-help, library/releases, custom-pages,
// user/tab-order. Root-level transport infra (healthz, env, status/pipeline,
// env/switch) is reached via API_SITE_BASE without the /_site prefix — pass
// an absolute path starting with "//" to bypass, or call fetch() directly.
// PLA-0039 / B22.2.
export async function apiSite<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  return _fetch<T>(API_SITE_BASE, path, opts);
}

// Root-level transport infra (NOT site, NOT public): /healthz, /env, /env/switch,
// /status/pipeline, /ws. These intentionally live outside both /_site and
// /samantha/v2 because they describe the transport itself.
export async function apiRoot<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  return _fetch<T>(API_ROOT_BASE, path, opts);
}

const API_V2_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100") + "/samantha/v2";

// For /samantha/v2/* routes (vector_artefacts-backed endpoints).
export async function apiV2<T = unknown>(path: string, opts: ApiOpts = {}): Promise<T> {
  return _fetch<T>(API_V2_BASE, path, opts);
}
