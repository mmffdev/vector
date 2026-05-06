---
name: Claude tier-test accounts (gadmin / padmin / user)
description: Three role-tier test accounts for Claude — claude_3_test@ (gadmin), claude_2_test@ (padmin), claude_1_test@ (user); password password123! on all; never change password or email
type: reference
originSessionId: 1c78088f-5e4b-44b3-a787-05861b3b8995
---
Three test accounts provisioned by the user (cookra@me.com) on 2026-05-03 for Claude to use when role-tier testing is needed without touching the protected human accounts (gadmin@/padmin@/user@).

| Email | Password | Role | Notes |
|---|---|---|---|
| `claude_3_test@mmffdev.com` | `password123!` | gadmin | use for gadmin-tier RBAC, role admin, /admin/roles, etc. |
| `claude_2_test@mmffdev.com` | `password123!` | padmin | use for padmin-tier creator-matrix tests |
| `claude_1_test@mmffdev.com` | `password123!` | user  | use for end-user / least-privilege tests |

**HARD RULE — same as protected human accounts:** never modify the `password_hash`, `email`, `is_active`, `role` (or `role_id` post-PLA-0007), or `password_changed_at` on these three rows. They are stable test fixtures controlled by the user. If a login fails, ASK — do not "fix" by overwriting credentials. CLAUDE.md HARD RULE on protected accounts (gadmin@/padmin@/user@) extends in spirit to these three.

**Use cases:**
- e2e suites that need a real gadmin/padmin/user login without using the human accounts
- PLA-0007 creator-matrix testing (claude_3_test@ creates Team Leads via the API; claude_2_test@ proves the role-ceiling)
- visual smoke during /admin/roles UI work

**Subscription:** all three live in the default fixture subscription `00000000-0000-0000-0000-000000000001` (mmffdev tenant).

The single-account `claude@mmffdev.com` (per `test_account_claude.md`) predates this tier set; both can coexist. When work needs role-tier coverage, prefer the `claude_N_test@` set.
