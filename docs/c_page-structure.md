# App Router layout

> Last verified: 2026-04-21

How pages are organised, how role gating works, and the contract every page must honour.

## Route groups

Next.js App Router. Three top-level groups:

| Group | Purpose | Role gating | Detail |
|---|---|---|---|
| `app/(user)/` | The shipped product — what customers see | role-based (`user`, `padmin`, `gadmin`) | [c_section-tags.md](c_section-tags.md) |
| `app/login/`, `app/change-password/` | Login / reset / forced password change flows | unauthenticated (login/reset) or authenticated-but-locked (change-password) | |
| `dev/` | Ringfenced dev tooling | independent plugin | see `dev/README.md` |

Everything admin-ish (both product admin and global admin) sits *inside* `(user)/` and is role-gated at render time — they are not separate route groups. See [c_section-tags.md](c_section-tags.md) for the `<user>` / `<gadmin>` / `<padmin>` / `<dev>` vocabulary.

## PageShell contract

Every top-level page renders inside `PageShell` (or the equivalent layout primitive). The shell provides:

- Sidebar (from the current user's role + permission grid).
- Topbar with brand + actions slot.
- Content container (`.app-content-container`) and viewport container (`.app-viewport-container`).

Pages supply their own `.page-header` + `.page-body` — don't reinvent the chrome.

## Sidebar data source

Sidebar items are derived from:

1. The user's `role` (from `users.role` — `user`, `padmin`, `gadmin`).
2. For padmins: rows in `user_workspace_permissions` (`can_view` / `can_edit` / `can_admin` per workspace).
3. Static route manifests for the `<dev>` section (mounted only when present).

Rule: never hardcode a sidebar item that isn't also gated by role + permission. A user who can't access a page should not see its link.

## URL routing for work items

Two forms, canonical and friendly alias:

- **Canonical:** `/item/<uuid>` — permanent, survives all renames.
- **Alias:** `/item/US-00000347` — parses tag + key_num, 301s to the UUID.

Full details in [c_url-routing.md](c_url-routing.md).

## CSS / styling

- No inline styles. No Tailwind. All classes from `app/globals.css`.
- BEM-lite naming. Utilities prefixed `u-`. State classes `is-` / `has-`. JS hooks `js-`.
- Component catalog and token list in [css-guide.md](css-guide.md).

Inline-style migration is complete (2026-04-21). If `grep -R "style={{" app/` surfaces new hits, add the missing block to the catalog — do not regress.

## Adding a page — checklist

1. Decide which route group it belongs to (`(user)` almost always).
2. Role-gate in the server component (check the session's role before rendering).
3. Wrap in `PageShell` + `.page-header` + `.page-body`.
4. Use existing block classes from [css-guide.md](css-guide.md). If you need a new block, add it to `globals.css` AND update that catalog.
5. If it's a work-item page, render human keys (`US-00000347`) but link via `/item/<uuid>` — [c_url-routing.md](c_url-routing.md).
6. If it adds a sidebar link, gate that link by the same role + permission check used in the page itself.

## Section tag vocabulary

`<user>`, `<gadmin>`, `<padmin>`, `<dev>` — defined in [c_section-tags.md](c_section-tags.md). When the user writes one of these tags in a prompt, it refers to that slice of the product.
