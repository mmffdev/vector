// Versioned base for data API calls (/samantha/v1 or /samantha/v2 — public).
// Site/BFF routes (auth, nav, me, roles, admin, workspaces, errors,
// addressables, page-help, library/releases, custom-pages, user/tab-order)
// live under /_site (PLA-0039 / B22) — use apiSite() for those.
const API_ROOT_BASE = process.env.NEXT_PUBLIC_API_INFRA_BASE ?? "http://localhost:5100";
export const API_SITE_BASE = API_ROOT_BASE + "/_site";
const API_BASE = (process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100") + "/samantha/v1";

let _accessToken: string | null = null;
// Registered by AuthContext so api() can silently refresh an expired JWT
// and retry rather than surfacing a 401 to the caller.
let _refreshCallback: (() => Promise<void>) | null = null;
// Dedup: only one refresh flight at a time; concurrent 401s share the same promise.
let _refreshPromise: Promise<void> | null = null;

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

export type ApiViolation = { field: string; message: string };

// RFC 9457 Problem Details fields surfaced from error responses.
export class ApiError extends Error {
  status: number;
  body: unknown;
  title?: string;
  detail?: string;
  violations?: ApiViolation[];
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
    if (body && typeof body === "object") {
      const p = body as Record<string, unknown>;
      if (typeof p.title === "string") this.title = p.title;
      if (typeof p.detail === "string") this.detail = p.detail;
      if (Array.isArray(p.violations)) this.violations = p.violations as ApiViolation[];
    }
  }
}

type ApiOpts = RequestInit & { skipAuth?: boolean; _retried?: boolean };

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
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

  const res = await fetch(base + path, {
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

  if (res.status === 401 && !opts.skipAuth && !opts._retried && _refreshCallback) {
    // Silent refresh-and-retry: deduplicate concurrent 401s onto one flight.
    if (!_refreshPromise) {
      _refreshPromise = _refreshCallback().finally(() => { _refreshPromise = null; });
    }
    await _refreshPromise;
    if (_accessToken) {
      return _fetch<T>(base, path, { ...opts, _retried: true });
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
