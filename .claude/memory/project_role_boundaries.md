---
name: Role boundaries — gadmin vs padmin vs user
description: Canonical definition of what each tenant role owns; informs page gating, nav visibility, and feature ownership decisions
type: project
originSessionId: 421fcf55-eca4-4ec4-8e12-4a283071d470
---
**The roles:**
- **gadmin** = tech/support admin. Owns infrastructure, accounts, system configuration, library release acknowledgement. Does NOT own product decisions.
- **padmin** = product admin. Owns the portfolio model, portfolios, projects, work items, and everything in the product framework. The "product person."
- **user** = end consumer. Operates within the portfolios padmin set up.

**Mental model:** padmin sets the rules of the game; gadmin keeps the lights on; user plays the game.

**Why:** Confirmed 2026-04-25 during Phase 4 wizard design. Earlier scoping had the portfolio-model wizard as gadmin work, which was wrong — picking a portfolio model is a product decision, not a tech-admin decision. Tech admins normally have nothing to do with product. Clean separation between product people and support staff.

**How to apply:**
- **Portfolio model pages** (`/portfolio-model`, `/portfolio-model/custom`, future subroutes): padmin-only. gadmin redirected like `user` is. Page does not exist in gadmin's world — also hidden from their sidebar nav.
- **`BlockingReleaseGate`**: only on gadmin-reachable pages (gadmin acks library releases). Padmin pages must NOT import it.
- **Adoption-state ownership** (subscription_portfolio_model_state.adopted_by): padmin user ID, not gadmin.
- **When designing a new feature, ask first**: is this a product decision (padmin) or a system/tech decision (gadmin)? If unclear, the role boundary itself is unclear and needs clarification before code.
- **Nav visibility** follows route gating: if a role can't reach a page, it must not appear in their sidebar nav (route-gating without nav-hiding leaves dead links).

**gadmin admin-settings scope (closed list):**
gadmin's entire admin-settings surface is just two pages: **Workspace settings** and **Library releases**. That's it. Any other admin/config page belongs to padmin (product config) or stays out of admin-settings entirely.

When adding a new admin-settings page, default to padmin ownership. Only place it under gadmin if it's clearly tech/system/library-release work — and if it would be the third gadmin admin-settings page, stop and confirm the scope is genuinely expanding rather than misclassified product work.
