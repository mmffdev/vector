---
name: crypto-curve-preference
description: Government/defence buyers want ECDSA on NIST P-384 (CNSA) for signing keys — use ES384 for the control-plane OP token-signing key
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 5f6ea2fc-dfbc-4444-8955-e346d361c529
---

For the MMFF Platform control-plane OIDC OP **token-signing key** (the keypair behind `/jwks`), Rick specified **ECDSA on NIST P-384** → JWS alg **ES384**. Reason: defence/government buyers (Vector's stated market — see context/USER.md) normally mandate ECDSA P-384 per the NSA CNSA Suite / NIST 800-186, not the more common P-256.

**Why:** matches the procurement bar for the defence/finance buyer profile. P-256 (ES256) is the modern *commercial* default; P-384 (ES384) is the *government* default.

**How to apply:**
- The OP's own signing key (issues access tokens, published in JWKS) = **ES384 / ECDSA P-384**.
- BUT the **DPoP *client* proof keys stay ES256/P-256** — those are browser-WebCrypto keys on the client; Vector's existing DPoP stack hard-codes ES256/RS256 (`products/vector/backend/internal/auth/dpop.go`). Do NOT conflate the OP signing key (P-384) with the DPoP client proof keys (P-256). Two keys, two purposes.
- When offering crypto-curve choices to Rick in future, include the government P-384 option, not just commercial P-256/RS256.

Origin: 2026-06-09, PLAT1.7 OIDC OP implementation (PLA077). Related: [[platform-extraction]] if that note exists.
