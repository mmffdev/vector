---
name: Never change user account passwords (HARD RULE)
description: Hard rule — never modify passwords (or any credential field) on user accounts; use the test account or look up creds.
type: feedback
---
**Rule:** NEVER run `UPDATE users SET password_hash = ...` or otherwise modify the password of any account belonging to the user (`gadmin@mmffdev.com`, `padmin@mmffdev.com`, `cookra@me.com`, `user@mmffdev.com`, or any other personal account). Not "to align with the test password", not "to recover from a 401", not for any reason.

**Why:** Rick was locked out of all dev accounts after passwords were changed without permission during a debugging loop. He restated the rule on 2026-05-02 after I copied claude@'s password_hash onto gadmin@ to "fix" a login 401: "Don't change the fucking password for my account ever again. You don't need to. You can look them up." Resetting credentials on the user's accounts can lock them out, contaminate the audit trail (`updated_by_user_id`, `updated_at`), and risks shared/synced password managers. The credentials exist in `<accounts>` and the `claude@mmffdev.com` test account exists for exactly this purpose.

**How to apply:**
- If a 401 happens while logged in as a user account: stop and ask, or look up the password in `.claude/commands/c_accounts.md` / `<accounts>`.
- If you need to test a gadmin-only endpoint: use `gadmin@mmffdev.com` with the documented password, or create a NEW dedicated test account (e.g., `claude-gadmin@mmffdev.com`) — never reuse a real account.
- If the documented password doesn't work: that means the docs are stale; report it, do NOT silently "fix" it by overwriting the row.
- The ONLY accounts whose password I may modify are ones I created myself for testing (`claude@mmffdev.com` and any future `claude-*@mmffdev.com` accounts).
- This rule applies to ALL credential fields, not just `password_hash`: do not touch `email`, `is_active`, `role`, `password_changed_at`, etc. on the user's accounts.
