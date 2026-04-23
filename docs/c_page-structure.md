# App Router layout

> Last verified: 2026-04-23 (post-PR-4)

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
2. The page registry (`pages` / `page_tags` / `page_roles` tables) — DB-backed catalogue served via `GET /api/nav/catalogue`; cached server-side at 60 s TTL.
3. The user's personal nav prefs (`user_nav_prefs` rows) — pinned items, position, nesting (`parent_item_key`), and custom group assignment (`group_id`).
4. User-created custom groups (`user_nav_groups`) — label + position per user; items route to them via `user_nav_prefs.group_id`.
5. Entity bookmarks (`page_entity_refs` + `pages` with `kind='entity'`) — portfolios and products pinned via `POST /api/nav/bookmark`; sit in the `bookmarks` tag group at the top of the sidebar.
6. User custom pages (`user_custom_pages` rows) — merged into the catalogue by `nav.CatalogueWithCustom`; each appears with `kind="user_custom"`, `item_key="custom:<id>"`, route `/p/<id>`. See [`c_c_custom_pages.md`](c_c_custom_pages.md).
7. Static route manifests for the `<dev>` section (mounted only when present).

Rule: never hardcode a sidebar item that isn't also gated by role + permission. A user who can't access a page should not see its link.

## URL routing for work items and custom pages

- **Work items (canonical):** `/item/<uuid>` — permanent, survives all renames.
- **Work items (alias):** `/item/US-00000347` — parses tag + key_num, 301s to the UUID.
- **Custom pages:** `/p/<page-uuid>` — UUID of the `user_custom_pages` row; `?vid=<view-id>` selects a non-default view.

Full details in [c_url-routing.md](c_url-routing.md).

## CSS / styling

- No inline styles. No Tailwind. All classes from `app/globals.css`.
- BEM-lite naming. Utilities prefixed `u-`. State classes `is-` / `has-`. JS hooks `js-`.
- Component catalog and token list in [css-guide.md](css-guide.md).

Inline-style migration is complete (2026-04-21). If `grep -R "style={{" app/` surfaces new hits, add the missing block to the catalog — do not regress.

## Form drafts

Forms that involve meaningful user input may use the IDB-backed draft system. The entry point is `app/hooks/useDraft.ts`. Keys are scoped to `${userId}:${formKey}:${scopeKey}` so drafts never cross user boundaries. Drafts for a signing-out user are purged in `AuthContext.logout`. Sensitive fields (passwords, OTP, card numbers) are excluded by `app/lib/draftClassifier.ts` (default-deny). Full contract in [`c_c_form_drafts.md`](c_c_form_drafts.md).

## Adding a page — checklist

1. Decide which route group it belongs to (`(user)` almost always).
2. Role-gate in the server component (check the session's role before rendering).
3. Wrap in `PageShell` + `.page-header` + `.page-body`.
4. Use existing block classes from [css-guide.md](css-guide.md). If you need a new block, add it to `globals.css` AND update that catalog.
5. If it's a work-item page, render human keys (`US-00000347`) but link via `/item/<uuid>` — [c_url-routing.md](c_url-routing.md).
6. If it adds a sidebar link, gate that link by the same role + permission check used in the page itself.

## Section tag vocabulary

`<user>`, `<gadmin>`, `<padmin>`, `<dev>` — defined in [c_section-tags.md](c_section-tags.md). When the user writes one of these tags in a prompt, it refers to that slice of the product.
