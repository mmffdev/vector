---
name: Claude is dev-only — every content protocol is a spec for a future E2E feature
description: Claude edits files during dev only; not present operationally. Every Claude content-protocol (addpaper, updatepaper, mstories, defect, changelog, research, etc.) is a dev-time stopgap that must be rebuilt as a full E2E stack (UI form + authenticated API + DB write) before go-live. Treat the protocols as executable specs, not final features.
type: project
originSessionId: 571e2a16-f673-4553-b0bb-9db64dd7a2e6
---

Claude is **only used during development** on this project. When the app is live in a workplace, Claude is not in scope — all content creation and mutation must happen through the app itself, authenticated by the logged-in user's session.

**Why:** In an operational workplace, one human owns one session — no shared accounts, no anonymous writes, no out-of-band filesystem edits. Every mutation must carry the acting user's identity for security, audit, and accountability. Claude editing files directly bypasses that chain entirely, which is fine in dev but unacceptable in prod.

The current Claude-driven shortcuts are **executable specifications** — they prove the data shape, the UX flow, and the field set before engineering effort is committed to the real endpoint + UI. When the app goes live, each shortcut becomes a proper feature: a UI control (button / form / modal) → authenticated API route → DB write → list refresh. The spec is already locked in by the time the code gets built.

**How to apply:**
- Do not design features that assume Claude will be there to run them at runtime (e.g. "Claude stamps this field", "Claude creates the file").
- Every content-writing shortcut is a **dev-time stopgap**. The known set includes but is not limited to:
  - `<addpaper>`, `<research>`, `<updatepaper>` — research papers
  - `<mstories>`, `<ustories>` — user stories / backlog
  - `<defect>` — defect log
  - `<changelog>` — changelog entries
  - `<ATS>`, `<FE>` — scope additions, feature scaffolds
  - `<idea>` — idea capture
- Each of the above needs an in-app equivalent before go-live: UI entry point + session-authenticated API endpoint + DB write stamping `created_by` / `updated_by` from the verified session token.
- Attribution fields must be populated by the **backend** from the verified session token, not guessed by Claude from `users.db`. Claude reading sessions is an inferred link, not cryptographic proof.
- When building the operational equivalent of a protocol, use the protocol file itself as the source of truth for the field set, validation rules, and UX expectations — the protocol has already been exercised against real data.
- **Known gaps** (no in-app path yet — Claude is the only writer):
  - Research papers: no create/edit UI
  - Stories, defects, changelog: have read UI but writes go through Claude protocols rather than app forms
- Flag any new protocol that writes content on the filesystem as "dev-only — needs in-app equivalent" so it joins the pre-go-live punch list.
