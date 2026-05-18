---
name: user-buyer-profile
description: "Vector is positioned as enterprise SaaS for defence and finance buyers — security and compliance defaults must match those sectors, not generic consumer SaaS."
metadata: 
  node_type: memory
  type: user
  originSessionId: 29b5639a-3ec7-4597-bd09-52042a16511e
---

Vector's buyer profile is **defence + finance**. Rick confirmed 2026-05-18.

This changes the defaults for every security/compliance decision:

- **Standards to design against:** NIST 800-53 mod/high, NIST 800-63B AAL2/AAL3, DoD CMMC L2/L3, UK MoD JSP 440 (defence side); FFIEC 2021, PCI-DSS 4.0, SOC 2 Type II, ISO 27001 (finance side).
- **"Convention says X is out of scope" is the wrong answer.** Buyers in these sectors expect compensating controls even where prevention is impossible. The honest framing is "we can't fully prevent it, but we have layered controls that detect/contain/audit it." Examples that came up:
  - Malicious browser extensions: cannot prevent, but counter with short-lived tokens + DPoP binding + session anomaly detection + audit trail.
  - XSS: prevent with strict CSP + SRI, not by hoping it doesn't happen.
- **Counter-stack defaults** (already filed in [docs/c_tech_debt.md](../../../../docs/c_tech_debt.md) as TD-SEC-*):
  - Strict CSP with nonces + SRI on third-party scripts (S1 — already firing gap).
  - One-time-use refresh-token rotation with reuse detection.
  - DPoP (RFC 9449) device-bound tokens.
  - Session anomaly detection (IP/ASN/country/UA/TLS-fingerprint drift).
  - WebAuthn / FIDO2 step-up for privileged actions.
  - mTLS for defence-tier accounts (infra-tier, not app-tier — separate roadmap).
- **Audit narrative matters as much as the control.** Procurement evidence requests are answered with both the control and the standard it maps to. Keep the standards-references in TD entries so future evidence-prep is straightforward.

**How to apply:** when designing any auth, session, secret-storage, or audit-logging behaviour, default to the defence/finance bar — not to consumer-SaaS convention. When you find yourself writing "this is the standard pattern" — check whether the standard pattern is for the right threat model.
