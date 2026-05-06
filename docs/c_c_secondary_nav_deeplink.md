# Secondary Navigation — URL deep-linking convention

Tab deep-linking uses **Jira-style path-segment routing**: each tab is a real Next.js App Router page at its own URL. There are no query params, no `urlKey` prop, and no registry.

## How it works

Pages that want deep-linked tabs become route groups:

```
app/(user)/workspace-settings/
  layout.tsx          ← shared shell: PageShell + SecondaryNavigation + {children}
  page.tsx            ← redirect("/workspace-settings/organization")
  organization/
    page.tsx          ← OrganizationTab content
  workspaces/
    page.tsx          ← WorkspacesTab content
  users/
    page.tsx          ← UsersTab content
```

The **layout** owns the nav and the auth guard. It reads `usePathname()` to derive the active tab:

```tsx
// layout.tsx
const pathname = usePathname();
const lastSeg  = pathname.split("/").filter(Boolean).pop() ?? "";
const activeTab = SEG_TO_KEY[lastSeg] ?? "organization";

<SecondaryNavigation
  active={activeTab}
  onChange={(key) => router.push(`/workspace-settings/${segmentForKey(key)}`)}
  pageId="workspace-settings"
  reorderable
  items={ITEMS}
/>
{children}
```

Each sub-page (`organization/page.tsx`, `workspaces/page.tsx`, …) renders only its own content — no nav, no shell.

## Adding a new tabbed page (developer checklist)

When creating a new file-system page that needs tab deep-linking:

1. **Create `layout.tsx`** in the page's route folder. Copy `app/(user)/workspace-settings/layout.tsx` as a template. Change:
   - The `TABS` const and `TAB_HEADERS` map for your tabs
   - The `KEY_TO_SEG` / `SEG_TO_KEY` maps (only needed for keys that differ from their segment, e.g. `snake_case` → `kebab-case`)
   - The base path in `router.push()`
   - The `pageId` and `ariaLabel` on `SecondaryNavigation`
   - Any permission guards

2. **Replace `page.tsx`** with a redirect to the default tab:
   ```tsx
   import { redirect } from "next/navigation";
   export default function MyPage() { redirect("/my-page/first-tab"); }
   ```

3. **Create a subfolder per tab** with a `page.tsx` containing only that tab's content (no `PageShell`, no `SecondaryNavigation`).

4. **Adding a tab later** to an already-converted page: create the subfolder + `page.tsx`, add the key to `TABS`, `TAB_HEADERS`, and the `items` array in `layout.tsx`. The URL, routing, and lint guard follow automatically from the file existing.

## Adding a new tab to an existing tabbed page

No layout changes needed if the key matches the segment (e.g. key `"reports"` → segment `reports`):

1. Create `my-page/reports/page.tsx` with the tab content.
2. Add `"reports"` to `TABS`, `TAB_HEADERS`, and `items` in `layout.tsx`.

If the key uses underscores (e.g. `"my_reports"`), add entries to `KEY_TO_SEG` and `SEG_TO_KEY` in the layout and create the folder as `my-reports/`.

## Tab key → URL segment mapping

Tab keys that don't match their path segment need an explicit map entry (snake_case keys → kebab-case segments):

| Tab key          | URL segment       |
|------------------|-------------------|
| `organization`   | `organization`    |
| `workspaces`     | `workspaces`      |
| `users`          | `users`           |
| `permissions`    | `permissions`     |
| `topology`       | `topology`        |
| `portfolio_model`| `portfolio-model` |
| `work_items`     | `work-items`      |

The file system enforces uniqueness — a duplicate path segment is a build error, not a human-error risk.

## When to use this pattern vs `useTabState`

- **Path-segment routing** (this doc) — use for any page where the active tab should be bookmarkable, shareable, or browser-back-navigable. Each tab becomes its own URL.
- **`useTabState`** — use when tabs are transient UI state that should not change the URL (e.g., a detail panel with internal sub-views that don't need direct links).

## User-created pages (navigation editor / `/p/<uuid>` routes)

**Path-segment routing does not apply to user-created custom pages.** Those pages are served from a dynamic route (`app/(user)/p/[uuid]/page.tsx`) backed by the `user_custom_pages` table — there is no file-system route to create subfolders under.

If a user-created page has tabs, the options are:
- `useTabState` — writes `?tab=<key>` to the URL; works today with zero schema change.
- A future `user_custom_page_tabs` table — would allow tabs to be persisted per page and deep-linked via a dynamic nested route. Not yet designed.

Until that table exists, user-created pages use `useTabState` for tab state. Do not attempt to apply this pattern to `/p/<uuid>` routes.

## Combining with `reorderable` and `pageId`

`pageId`/`reorderable` (PLA-0014 drag-to-reorder) are independent and composable with path-segment routing. Pass both to the layout's `SecondaryNavigation`. The `pageId` persists the user's drag order; `usePathname()` drives the active indicator.

## Adopted pages

| Page | Path | Implemented |
|------|------|-------------|
| Workspace Settings | `/workspace-settings` | 2026-05-06 |

## Lint rule

`npm run lint:tab-deep-link` (script: `dev/scripts/lint_tab_deep_link.py`) checks that:
1. No `urlKey` prop appears anywhere (the nuqs approach was superseded).
2. No sub-page inside a path-segment-routed layout calls `useTabState` (double-management guard).

## Research

`dev/research/R040.json` — deep-linking patterns for nested secondary tab bars in Next.js App Router.
