---
name: project-tracker-rg-api-key
description: "Tracker API key for the <rg> runner, project-clamped to Vector. Used by cmd/rg-runner to POST results back to Tracker's /api/red-green/* endpoints."
metadata: 
  node_type: memory
  type: project
  originSessionId: a6f06cda-e2b1-46ea-ab3d-9cd3a4f9d9e5
---

The `<rg>` runner authenticates to Tracker via a PAT issued under `services@mmffdev.com` and **clamped to Vector** (`project_id = 72ccf19e-e03b-4217-a2b0-a94c9bcb9c8e`).

- **Name:** `Vector-Red-Green-001`
- **Prefix:** `trk_d6fd154a`
- **Plaintext** (one-shot at creation, Rick shared 2026-05-15): `trk_d6fd154aa74619a5d06c97b2f4b9bbeca602330c03631f878fd7ec15ec72bc2d`
- **Project clamp:** Vector — `apikeys.Authenticate()` returns `(user_id, project_id=72ccf19e-...)` so the runner doesn't need a `--project` flag; downstream service writes auto-scope.

**Why:** When the runner POSTs to `/api/red-green/runs` or `/api/red-green/results`, the auth middleware resolves the key, drops `project_id` onto `authctx`, and the redgreen handler uses `authctx.GetProject(ctx)` to scope all writes. No project ID is sent over the wire from the runner — the key carries it.

**How to apply:** Hand the plaintext token to `rg-runner --api-key trk_xxx` or set `RG_API_KEY=trk_xxx` in env. If this key is revoked or rotated, mint a fresh one under `services@mmffdev.com` clamped to the Vector project via the Tracker UI's API Keys page.

Linked: [[feedback-shared-methods-home]] [[reference-db-routing-doc]]
