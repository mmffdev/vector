# Addressable element substrate

PLA-0005 — every panel, table, and navigation block in the product is a stable, UUID-addressable element. One DB table, one Go service, one runtime registry, one lint rule.

## Address scheme

Every addressable carries a canonical address string of the form:

```
samantha._viewport.<slot>._<kind>.<name>[._<kind>.<name>…]
```

**Hard rule — leading underscore on every system segment.** Every segment that is *not* a user-supplied name (`_viewport`, `_panel`, `_table`, `_navigation`, etc.) starts with `_`. User names never do. This makes the address self-tokenizing: any segment without a leading underscore is user input.

- `samantha` — root namespace (fixed).
- `_viewport.<slot>` — closed-vocabulary viewport slot (see below).
- `_<kind>.<name>` — repeated for each addressable in the parent chain.

**`<name>` validation:** `/^[a-z0-9_]{1,64}$/` (frontend `NAME_RE`). Hyphens are not allowed; substrate normalises legacy hyphenated names to underscores at migration time.

## Six viewport slots

`<ViewportSlot kind=…>` is the only way to seed a top-level address. The TypeScript union type rejects any other value at compile time:

| Slot | Use |
|---|---|
| `app` | Main page body (the default for nearly everything) |
| `header` | Top bar, breadcrumb, page title strip |
| `footer` | Bottom bar, status strip |
| `side_bar` | Persistent left/right rails |
| `modal` | Modal/dialog overlays |
| `toast` | Transient toast/snackbar stack |

## Tables

- **`page_addressables`** (UUID PK, `parent_id` self-FK, `kind`, `name`, `address`, `source`, `custom_app_id`, `helpable`, `soft_archived`, `last_seen_at`).
  - Sibling-unique `(parent_id, kind, name) WHERE soft_archived=false`.
  - `source` CHECK in `('build','runtime','custom_app')`. Build wins on conflict — runtime register refuses to overwrite a build row.
  - `helpable bool not null default true` (migration 081) — gadmin-controlled per-row help-icon visibility. Backfill flipped existing `kind in ('table','navigation')` rows to `false` so behaviour was byte-identical post-migration. Adopters AND this with their own optional `helpable` prop.
  - Soft-archive on disappearance; rows stay for audit; help bodies survive panel re-add.
- **`page_help`** (UUID PK, `addressable_id` FK ON DELETE RESTRICT, `body_html`, `locale` default `en`, `seeded_from`, `library_ref`, `soft_archived`, `updated_at`, `updated_by`).
  - Unique `(addressable_id, locale) WHERE soft_archived=false`.
- **`library_help_defaults`** (UUID PK, `kind`, `name_pattern`, `body_html`, `locale`).
  - Pattern format: exact `kind:name` or `kind:*` (wildcard). Lazy-seeds `page_help` on first fetch.

## `addressables.Service` — sole writer

[`backend/internal/addressables/service.go`](../backend/internal/addressables/service.go) is the **only** package permitted to issue `INSERT`/`UPDATE`/`DELETE` against `page_addressables` or `page_help`. CI greps for SQL touching these tables outside this package and fails the build.

Surface:

| Method | Caller | Role |
|---|---|---|
| `RegisterFromBuild(pageRoute, configTree)` | CI build-reconcile job | Bulk reconcile: insert new, soft-archive missing, bump `last_seen_at` on matched. One transaction. |
| `RegisterFromRuntime(pageRoute, parentAddress, kind, name, source, customAppId)` | Runtime register endpoint (dev / custom-app) | Idempotent on collision; refuses to overwrite `source='build'` rows; returns existing row if conflict. |
| `Snapshot(pageRoute)` | Snapshot endpoint | Depth-first tree for runtime registry hydration. |
| `UpdateHelp(addressableId, bodyHtml, updatedBy)` | gadmin /dev/page-help editor | Bumps `updated_at` + `updated_by`; flips `seeded_from` to `manual`. |
| `ArchiveHelp(addressableId)` | gadmin editor | Soft-archives the help row, not the addressable. |

## REST endpoints

| Method + path | Auth | Purpose |
|---|---|---|
| `POST /api/addressables/build-reconcile` | `X-CI-Token` (CI service-account) | One-shot per-route reconcile from build output. Returns `{inserted, archived, unchanged}`. |
| `POST /api/addressables/register` | `NODE_ENV != production` OR custom-app token | Runtime register from `useRegisterAddressable`; returns `{id, address}`. 403 in prod without custom-app auth. |
| `GET /api/addressables/snapshot?route=…` | Authenticated | Tree for the route. Hydrates `DomRegistry`. |
| `GET /api/page-help/:addressable_id` | Authenticated | Help body for an addressable; lazy-seeds from `library_help_defaults` on first fetch. |
| `PUT /api/page-help/admin/:id` | gadmin | Updates body via `addressables.Service.UpdateHelp`. |
| `DELETE /api/page-help/admin/:id` | gadmin | Soft-archives via `addressables.Service.ArchiveHelp`. |
| `GET /api/page-help/admin/list` | gadmin | Grouped list for the editor. |
| `PATCH /api/addressables/admin/:id/helpable` | gadmin | Flips the per-row `helpable` bit via `addressables.Service.UpdateHelpable`. |

**Removed** (return `410 Gone` with `Link: /api/page-help/{addressable_id}`): `/api/pane-help`, `/api/pane-help/admin`, `/api/pane-help/{id}`. The `backend/internal/panehelp/` package is deleted.

## Frontend substrate

- `<DomRegistryProvider>` — wraps the app root. Hydrates an in-memory registry from `/api/addressables/snapshot` on first render.
- `<ViewportSlot kind="app|…">` — seeds `AddressContext` with `samantha._viewport.<slot>`.
- `useRegisterAddressable({kind, name})` — reads parent address from `AddressContext`, returns `{address, addressable_id, Provider}`. Calls `/api/addressables/register` when the context-derived address is missing from the snapshot.
- `<StrictRoute>` — wraps a route's body to flip strict mode: orphan addressables (rendered outside any `<ViewportSlot>`) become a dev-time error instead of a `samantha._orphan.…` console warning.
- Adopters: `<Panel>` (with TbHelpHexagon trigger + popover + click-to-copy address pill), `<Table>`, `<Navigation>`, `<Header>` (identity strip — borderless, registers `kind='header'`, optional `helpable`). Adopters are ~10 lines on top of the substrate; they MUST be the only way to render a panel/table/nav/header-shaped element.

## /dev/page-help workflow

[`dev/pages/DevPageHelpPanel.tsx`](../dev/pages/DevPageHelpPanel.tsx) — gadmin editor; URL `/dev?tab=page-help` (legacy `pane-help` redirects). Lists every `page_help` row joined to addressables, grouped by `page_route`. Each row shows address, kind, current body preview, library-default badge if `seeded_from='library'` and never edited, last-updated, last-editor. Inline editor with live HTML preview; Save routes through `addressables.Service.UpdateHelp` (not a bare PUT); archive button soft-archives the help row only.

## `lint:addressables` rule

`npm run lint:addressables` — structural rule:

> Any `<div>`/`<section>` whose first child is a heading element (`<h1>`–`<h6>`) AND that uses border + padding tokens MUST be `<Panel>` (or one of the audited exemption components: `<InfoPanel>`, `<SectionHeading>`).

Implementation: [`dev/scripts/lint_addressables.py`](../dev/scripts/lint_addressables.py). Fails on offending file with line number.

- **Pre-commit hook** runs `lint_addressables.py --report` (writes `dev/reports/<ts>-addressables.json`); blocks commit on non-zero.
- **Per-page exemption list** at [`dev/registries/addressables_exempt.json`](../dev/registries/addressables_exempt.json) — intentionally **empty** as a hard architectural invariant. Do not add entries.
- **/dev → Reports tab** renders the latest `addressables.json` row.

## Samantha SDK help-manifest contract

Custom apps written via the Samantha SDK pick up addresses automatically by composition. The contract:

1. Wrap the custom-app frame in `<SamanthaSdkProvider customAppId={…} helpDefaults={manifest.helpDefaults}>` ([`app/contexts/SamanthaSdkContext.tsx`](../app/contexts/SamanthaSdkContext.tsx)).
2. Every addressable registered inside that frame is tagged with `source='custom_app'` + `custom_app_id` by the substrate (not the app — the substrate reads context).
3. **Help resolution order at popover open:** `page_help` row → `library_help_defaults` row → SDK `helpDefaults` entry → `null`. Backend wins so gadmin-authored copy always overrides a custom-app's bundled defaults.

`helpDefaults` is `Record<string, string>` keyed by `<kind>:<name>` (exact) or `<kind>:*` (wildcard, kind-wide default). Resolved at the frontend via `resolveSdkHelp(helpDefaults, kind, name)`. The optional field lives on `UiAppManifest` ([`app/store/shared/types.ts`](../app/store/shared/types.ts)).

**Collision rule:** if a custom-app addressable's `(parent_id, kind, name)` collides with an existing `source='build'` row, the register endpoint returns 409 with the existing canonical address; the custom-app must rename. Build always wins.

## Help body sanitiser (PLA-0008 / 00330)

Every `body_html` value passes through [`SanitiseHelpBodyHTML`](../backend/internal/addressables/sanitise.go) before it reaches `page_help`. Allowlist: `p, br, hr, blockquote, strong, b, em, i, u, code, pre, ul, ol, li, h2, h3, h4, a`. Only `<a>` accepts attributes (`href`, `title`, `rel`, `target=_blank`); `href` schemes are restricted to `http://`, `https://`, `mailto:`. Everything else — `<script>`, `<style>`, `<iframe>`, on-handlers, inline `style`, `javascript:` / `data:` URLs — is dropped at write time. Frontend `dangerouslySetInnerHTML` therefore renders pre-sanitised content; renderer-side URL re-checks (YouTube + image schemes) remain as defence-in-depth in case a row predates this sanitiser. Video URLs are validated by [`ValidateYouTubeURL`](../backend/internal/addressables/sanitise.go) (canonical 11-char ID extracted from `youtu.be/<id>`, `?v=<id>`, `/embed/<id>`, `/shorts/<id>` on `youtube.com`, `www.youtube.com`, `m.youtube.com`).

## PLA-0004 closure note

This plan **supersedes** PLA-0004 (reusable per-panel Help popover with paneId registry):

- `<PaneHeader>` is replaced by `<Panel>`; the component file (`app/components/PaneHeader.tsx`) was deleted in story 00291.
- `pane_help` table is dropped (migration 076); rows migrated forward to `page_help` keyed by registry UUIDs.
- `dev/registries/paneIds.json` is deleted; the substrate is now the source of truth.
- `/dev/pane-help` editor renames to `/dev/page-help` with the same UX but a substrate-keyed backend.
- `/api/pane-help` endpoints removed entirely in story 00291 (previously 410-Gone redirect; now no route).
- `dev/scripts/lint_panes.py` + the `lint:panes` npm script + the pre-commit hook entry are deleted (story 00291).
- The orphaned `.pane-header*` CSS block in `app/globals.css` is deleted (story 00291).

PLA-0004's 5 nav-prefs panels are the proof of concept that the substrate carries forward — they are not rewritten, they are migrated.
