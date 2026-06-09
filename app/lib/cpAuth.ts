// cpAuth.ts — PLAT1.9: Vector as a Control-Plane (CP) relying party (frontend).
//
// This is the OPT-IN, FLAG-GATED bridge that lets Vector authenticate against the
// MMFF Control-Plane OIDC OP instead of its own /auth/login. It is ENTIRELY
// ADDITIVE: nothing here runs unless `cpAuthEnabled()` is true (the
// NEXT_PUBLIC_CP_AUTH_ENABLED flag, default OFF), and the legacy email/password
// path in AuthContext is never touched. With the flag off this module is dead
// code at runtime.
//
// Flow (mirrors products/stub-rp in the platform repo, the reference RP):
//   1. beginCpLogin() — generate a PKCE verifier + state, stash them, and
//      redirect the browser to the CP /authorize.
//   2. (CP authenticates the user and redirects back to /cp/callback?code=&state=)
//   3. completeCpLogin() — verify state, exchange the code at the CP /token with a
//      DPoP proof, and return the access token for the session to adopt.
//
// SECURITY POSTURE: this changes how Vector obtains a session, so it is gated and
// reversible by flag. The CP-issued token is claim-byte-identical to Vector's own
// (slice E / cp_dual_accept.go on the backend already accepts it), so the rest of
// Vector — Sentinel, middleware — is unchanged once the session holds a CP token.

const CP_BASE =
  process.env.NEXT_PUBLIC_CP_BASE_URL ?? "http://localhost:8080";

const CLIENT_ID =
  process.env.NEXT_PUBLIC_CP_CLIENT_ID ?? "vector";

// Session-storage keys for the in-flight PKCE material (cleared on completion).
const SS_VERIFIER = "vector.cp.pkce_verifier";
const SS_STATE = "vector.cp.state";

/**
 * cpAuthEnabled reports whether the CP-redirect login path is active. Default
 * OFF — Vector uses its legacy /auth/login unless an operator sets
 * NEXT_PUBLIC_CP_AUTH_ENABLED to "true"/"1"/"yes". This is the single switch that
 * gates the entire PLAT1.9 frontend path.
 */
export function cpAuthEnabled(): boolean {
  const v = (process.env.NEXT_PUBLIC_CP_AUTH_ENABLED ?? "").toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/**
 * The CP redirect URI Vector registers as a relying party. It points at the
 * server route handler /api/cp/callback (NOT the client page) because the CP
 * uses response_mode=form_post — it POSTs code+state there, and that handler
 * bridges to the client /cp/callback page via sessionStorage (never the URL,
 * PLA-0053-clean).
 */
export function cpRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/api/cp/callback`;
}

// --- PKCE (RFC 7636 S256) ---------------------------------------------------

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(byteLen: number): string {
  const a = new Uint8Array(byteLen);
  crypto.getRandomValues(a);
  return base64UrlEncode(a);
}

async function s256Challenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

// --- DPoP client proof (ES256 / P-256) --------------------------------------
//
// The CP issues sender-constrained (DPoP) tokens, so the /token exchange must
// carry a DPoP proof. We generate a fresh P-256 keypair per login and sign a
// minimal proof. (Vector's own DPoP machinery in AuthContext is for its legacy
// flow; this keeps the CP path self-contained and flag-isolated.)

async function generateDpopKey(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign"],
  ) as Promise<CryptoKeyPair>;
}

async function publicJwk(key: CryptoKey): Promise<Record<string, string>> {
  const jwk = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
  // DPoP header jwk: public EC members only, in the canonical key order.
  return { kty: "EC", crv: "P-256", x: jwk.x as string, y: jwk.y as string };
}

function b64urlJson(obj: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(obj)));
}

async function mintDpopProof(
  keyPair: CryptoKeyPair,
  htm: string,
  htu: string,
): Promise<string> {
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: await publicJwk(keyPair.publicKey),
  };
  const payload = {
    jti: randomString(16),
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000),
  };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(payload)}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

// --- public API -------------------------------------------------------------

/**
 * beginCpLogin generates PKCE + state, stashes them in sessionStorage, and
 * redirects the browser to the CP /authorize. Returns only if redirect could not
 * proceed (e.g. flag off / SSR) — normally it navigates away.
 */
export async function beginCpLogin(): Promise<void> {
  if (!cpAuthEnabled() || typeof window === "undefined") return;
  const verifier = randomString(48);
  const challenge = await s256Challenge(verifier);
  const state = randomString(24);
  sessionStorage.setItem(SS_VERIFIER, verifier);
  sessionStorage.setItem(SS_STATE, state);

  const q = new URLSearchParams({
    response_type: "code",
    response_mode: "form_post", // CP POSTs code+state to the redirect URI (no URL query)
    client_id: CLIENT_ID,
    redirect_uri: cpRedirectUri(),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  window.location.assign(`${CP_BASE}/authorize?${q.toString()}`);
}

/** Result of a completed CP login: the DPoP-bound access token. */
export interface CpLoginResult {
  accessToken: string;
  tokenType: string;
}

/**
 * completeCpLogin runs on /cp/callback: it validates the returned state against
 * the stashed value, exchanges the code at the CP /token (DPoP-proofed, PKCE),
 * and returns the access token. Throws on any mismatch or exchange failure —
 * the callback page surfaces that and falls back to the legacy login.
 */
export async function completeCpLogin(
  code: string,
  state: string,
): Promise<CpLoginResult> {
  if (!cpAuthEnabled()) throw new Error("CP auth is disabled");
  const expectState = sessionStorage.getItem(SS_STATE);
  const verifier = sessionStorage.getItem(SS_VERIFIER);
  sessionStorage.removeItem(SS_STATE);
  sessionStorage.removeItem(SS_VERIFIER);
  if (!expectState || state !== expectState) {
    throw new Error("CP login state mismatch (possible CSRF)");
  }
  if (!verifier) throw new Error("missing PKCE verifier");

  const tokenUrl = `${CP_BASE}/token`;
  const dpopKey = await generateDpopKey();
  const proof = await mintDpopProof(dpopKey, "POST", tokenUrl);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    redirect_uri: cpRedirectUri(),
    code_verifier: verifier,
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", DPoP: proof },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`CP token exchange failed: ${res.status}`);
  }
  const json = (await res.json()) as { access_token: string; token_type: string };
  return { accessToken: json.access_token, tokenType: json.token_type };
}
