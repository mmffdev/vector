---
name: Test accounts — Claude-owned + human-owned
description: All test logins in one place — Claude-owned (claude@, claude_N_test@) and human-owned (gadmin/padmin/user@); HARD RULE on human accounts.
type: reference
---

All accounts live in fixture subscription `00000000-0000-0000-0000-000000000001` on dev DB (`mmff_vector` via tunnel `:5435`). Frontend login: `http://localhost:5101/login`. Backend auth: `POST http://localhost:5100/v1/api/auth/login`.

## Claude-owned (free to use, do not modify)

| Email | Password | Role | Use for |
|---|---|---|---|
| `claude@mmffdev.com` | `password` | user | Default Claude test login; predates the tier set; `role=user` smoke tests |
| `claude_1_test@mmffdev.com` | `password123!` | user | End-user / least-privilege coverage |
| `claude_2_test@mmffdev.com` | `password123!` | padmin | Padmin-tier creator-matrix tests |
| `claude_3_test@mmffdev.com` | `password123!` | gadmin | Gadmin-tier RBAC, role admin, `/admin/roles` |

`claude@mmffdev.com` user ID: `ef289df1-fcc0-4a5b-bf1b-3d3cf59be708`.

**Soft rule:** never modify `password_hash`, `email`, `is_active`, `role`/`role_id`, or `password_changed_at` on these rows either. They are stable test fixtures controlled by the user. If a login fails, ASK — do not "fix" by overwriting credentials.

## Human-owned (HARD RULE — NEVER MODIFY)

Per `.claude/CLAUDE.md` HARD RULE: never modify any credential field on `gadmin@mmffdev.com`, `padmin@mmffdev.com`, or `user@mmffdev.com`. The user reset these to `password` on 2026-05-02. If gadmin/padmin/user-level testing is needed, use the Claude-owned accounts above — never the human ones.

| Email | Password | Role |
|---|---|---|
| `gadmin@mmffdev.com` | `password` | gadmin |
| `padmin@mmffdev.com` | `password` | padmin |
| `user@mmffdev.com` | `password` | user |

## Recreating Claude accounts in another env

Insert into `users` with bcrypt hash of the password (use `golang.org/x/crypto/bcrypt`, cost 10), `auth_method='local'`, `is_active=true`, same fixture subscription.
