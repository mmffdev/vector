---
name: Never change passwords
description: Never change user account passwords under any circumstances
type: feedback
originSessionId: 1cc1402b-cf28-4e3f-abce-e87c7cd19978
---
Never change user passwords. Ever. Not for testing, not to "reset to known state", not for any reason.

**Why:** Rick was locked out of all dev accounts because passwords were changed without permission during a debugging loop. This caused real disruption.

**How to apply:** If you need credentials to test something, ask Rick. If you need a new account, ask Rick. If login is failing, diagnose the cause — never touch password_hash in the DB.
