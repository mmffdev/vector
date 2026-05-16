---
name: Minimum font size — 13px site standard
description: Never use a font size below 13px on user-facing pages; eyebrow labels (11px) are the only exception
type: feedback
originSessionId: df609967-a682-4d82-9ea1-de98050b22cc
---
Minimum font size across the entire site is **13px**. No element on a user-facing page may go smaller unless explicitly requested by the user.

**Why:** User confirmed this as a site-wide standard on 2026-05-11 while reviewing the anchor nav sub-nav text size.

**How to apply:** When writing any new component or editing existing text sizes, default to 13px if no larger size fits the context. Never use `0.7rem`, `0.75rem`, `0.8rem` etc. without checking the computed px value. The only sanctioned exception is the `.eyebrow` micro-label (11px, uppercase, font-weight 600).
