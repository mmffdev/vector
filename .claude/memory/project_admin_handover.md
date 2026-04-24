---
name: gadmin → padmin handover model
description: Org model — gadmin provisions a workspace/portfolio stack and hands it to a padmin to run day-to-day
type: project
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
Vector PM's intended operating model: **gadmin** (global admin) sets up a tenant's workspace + portfolio structure and seeds it, then **hands it off to a padmin** (portfolio admin) who runs the stack day-to-day — managing their team, portfolios, projects, and items within. Gadmin stays hands-off on the operating side once handover is complete; they remain the escalation path for tenant-wide config.

**Why:** This shapes a pile of downstream design decisions — permission ceilings, what each admin page exposes, which actions redirect where, who gets notified of what. The brief for Workspace/Portfolio Settings split was written with this model in mind (gadmin-only Workspace Settings, padmin+gadmin Portfolio Settings). Without capturing it, we'll keep re-deriving the same answer from first principles every session.

**How to apply:**
- Role ceilings enforce the hierarchy (see `feedback_role_ceiling.md`), but the *model* explains the intent behind them.
- When scoping admin features, ask "whose job is this on operating day" — most data-ownership work belongs to padmin; most onboarding/config work belongs to gadmin.
- Handover itself isn't built yet — no formal "hand portfolio stack to user X" action exists. Treat this as aspirational until a handover flow is spec'd.
- Forbidden-access responses should orient the user toward the right admin to contact (their padmin for portfolio issues, a gadmin for account/tenant issues).
