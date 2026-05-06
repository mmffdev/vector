---
name: Test account — claude@mmffdev.com
description: Dedicated dev/staging test user for Claude-driven testing — role=user, subscription_id matches gadmin/padmin/user fixtures
type: reference
originSessionId: 14fcd6e6-6316-4bc6-8548-87c2be9b4b9c
---
**Login:** `claude@mmffdev.com` / `password`

**User ID:** `ef289df1-fcc0-4a5b-bf1b-3d3cf59be708`
**Subscription ID:** `00000000-0000-0000-0000-000000000001` (same fixture sub as gadmin/padmin/user)
**Role:** `user`
**Created:** 2026-05-02 in dev DB (`mmff_vector` on dev VPS via tunnel `:5435`)

**Use this account for:** Playwright tests, manual login verification, API smoke tests, anywhere a `role=user` test fixture is needed without polluting `user@mmffdev.com` (whose password is unknown).

**Auth verified:** `POST /api/auth/login` returned 200 with a valid JWT on 2026-05-02.

**To recreate (other envs):** insert into `users` with bcrypt hash of `password` (use `golang.org/x/crypto/bcrypt` from the backend module — cost 10), `role='user'`, `auth_method='local'`, `is_active=true`, same fixture subscription.
