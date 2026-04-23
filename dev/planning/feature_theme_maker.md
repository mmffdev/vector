# Feature — Theme maker (custom user themes)

Status: **TODO — parked.** Design captured from the 2026-04-23 session, informed by a research pass over `app/globals.css`, `docs/css-guide.md`, the `useTheme` hook, and `NavPrefsContext`. Do not start implementation until the user explicitly asks for it.

A user-facing **Theme** page that lets a person (or a tenant admin) customise Vector's appearance to match a corporate identity or personal taste. Save, edit, remove, reset. Built on the CSS-variable foundation already in place — most of the work is **exposing what we already have** plus closing tokenisation gaps.

## Why we're considering it

- **Enterprise self-service.** Banks, agencies, and brand-conscious teams want their tools to look like *their* tools. Today that's a deal-blocker for some buyers.
- **Personal taste.** Power users want to make Vector feel theirs (font weight up, denser borders, a specific accent green that doesn't fight their corporate palette).
- **The cost is small.** The CSS architecture is already token-based — `:root[data-theme]` blocks define ~25 variables that control 90% of the visual surface. Theming is mostly *exposing* those variables to a UI, not adding new ones.
- **Disambiguates from light/dark.** Light/dark stays as a coarse toggle; user themes are an additional layer that overrides on top of either base.

## User-stated controls (from the brief)

The Theme page must let the user change:

- **Page background** (`--bg`).
- **Panel background** (`--surface`) — pinned container, cards, modals.
- **Panel border colour** (`--line-1`).
- **Major text styles** — P, H1, H2, H3, H4, H5: colour, family, weight, size for each.
- **Borders generally** — both line tokens.
- **The "+++" divider** in title bars — colour (currently hardcoded to `--hot-pink`). Treated as a single overall theme setting, not per-page.
- **Nav icons** — currently inherit `currentColor` from `.sidebar-item`; controllable via `--nav-icon-color`.
- **Nav links** — normal, hover, active. Currently hover uses hardcoded `#cccccc` (gap).
- **Nav group headings** ("Personal", "Planning") — currently `--hot-pink`. Should be themeable separately from the +++ divider.
- **Form text and buttons** — input bg/text/border; button bg/text/hover/active for both primary and secondary.

Plus the actions: **save, edit, remove, reset.**

## Existing foundation (good news)

- **No CSS-in-JS, no Tailwind.** Single source: `app/globals.css` (1,889 lines), all rules already resolve to CSS custom properties at the `:root[data-theme="…"]` level. The system is *built* for variable-driven theming.
- **~25 named variables** already control the visible surface. Categories (light/dark values both defined):
  - Backgrounds: `--bg`, `--surface`, `--surface-alt`
  - Text: `--ink-1` through `--ink-4`
  - Borders: `--line-1`, `--line-2`
  - Accents: `--accent`, `--accent-soft`, `--accent-border`, `--accent-ink`
  - Semantic: `--good`, `--warn`, `--error`
  - Brand: `--hot-pink` (currently shared across themes — drives nav group headings + +++ divider)
  - Layout: `--sidebar-width`, `--sidebar-width-collapsed`, `--app-header-wrapper-height`, `--radius-sm`, `--radius-md`
  - Typography: `--font-sans`, `--font-mono`, `--font-display` (injected by `next/font`)
- **Theme switching** today: `useTheme` hook writes `data-theme` to `<html>`, persisted in `localStorage` only (not server-side).
- **Nav prefs** are server-side per user via `/api/nav/prefs` — that's the pattern user themes should follow.

## Theming gaps to fix before shipping the UI

These are hardcoded today; **the theme maker is meaningless until they go through variables.** Each fix is mechanical and small.

| Location | Current | Should become |
|---|---|---|
| `app/globals.css:191,388,393` — sidebar item hover/active bg | `#cccccc` | `var(--nav-item-hover-bg)` (new token) |
| `app/globals.css:467` — `.sidebar-section` text | `#000000` (forced black, breaks dark mode today) | `var(--ink-2)` |
| `app/globals.css:581,760` — form input border | `#666` | `var(--line-1)` |
| `app/globals.css:1183` — auth card bg | `#f5f3ee` (light only) | `var(--paper)` (define in both themes) |
| `app/globals.css:1275` — badge color | `#1f1f1f` | `var(--ink-1)` |
| `app/globals.css:955–961` — nav-manage modal action buttons | `#ff2e93`, `#c44` | semantic vars |
| Various — references to `--surface-1`, `--surface-2`, `--accent-1`, `--accent-pink`, `--border-1` | Used with fallbacks; not declared | Declare in both `:root` blocks |

**Estimate:** ~30 line changes in `globals.css`, no behavioural change in either current theme — but unlocks user theming for those areas. Do this as **Phase 0** of the feature; ship it as a small standalone PR before any UI work, so it's verifiable in isolation.

## Token model — what the user actually picks

Don't expose 25 raw CSS variables on a page; that's a developer tool, not a user feature. Group the variables into **user-facing controls**, each of which writes one or more underlying variables. Proposed grouping:

### Section 1 — Surfaces & layout
- **Page background** → `--bg`
- **Panel background** → `--surface`
- **Panel hover/header background** → `--surface-alt`
- **Border colour (panels & dividers)** → `--line-1`
- **Subtle border** → `--line-2`
- **Corner radius** → `--radius-sm`, `--radius-md` (slider, 0–12px)

### Section 2 — Text
For each of **Body**, **H1**, **H2**, **H3**, **H4**, **H5**:
- Colour (defaults: H1–H3 → `--ink-1`, H4–H5 → `--ink-2`, body → `--ink-1`)
- Font family (dropdown of bundled web-safe families + the three Google Fonts already loaded: Zen Maru Gothic, JetBrains Mono, Archivo Black)
- Weight (300 / 400 / 500 / 600 / 700)
- Size (predefined steps: rem-based, e.g. H1 = 2.0/2.4/2.8 rem)

### Section 3 — Navigation
- **Nav link colour** → `.sidebar-item` color → new var `--nav-link`
- **Nav link hover background** → new var `--nav-item-hover-bg`
- **Nav link hover colour** → new var `--nav-link-hover`
- **Nav link active background** → new var `--nav-item-active-bg`
- **Nav link active colour** → new var `--nav-link-active`
- **Nav group heading colour** ("Personal", "Planning") → new var `--nav-group-heading` (default `--hot-pink`)
- **Nav icon colour** → new var `--nav-icon-color`
- **Sidebar background** → new var `--sidebar-bg` (currently `transparent`)

### Section 4 — Forms & buttons
- **Input background** → new var `--form-input-bg`
- **Input text** → new var `--form-input-text`
- **Input border** → `--line-1` (already)
- **Input focus border** → `--accent-border`
- **Primary button bg / text / hover bg / hover text** → `--accent`, `--accent-ink`, plus new hover vars
- **Secondary button bg / text / hover bg / hover text** → new vars

### Section 5 — Brand accents
- **Accent colour** (used for primary buttons, focus rings) → `--accent` (+ derived `--accent-soft`, `--accent-border`)
- **Brand pink** → `--hot-pink` (currently used in two places; user wants the +++ divider colour to be a single overall setting, so split this into:)
  - **+++ divider colour** → new var `--divider-prefix` (defaults to `--hot-pink`)
  - **Pink accent** (kept for any other places using `--hot-pink`, e.g. role badges) → `--hot-pink`

### Section 6 — Density (defer to v2)
- Compact / Comfortable / Spacious — a single slider that adjusts a small set of spacing variables (line-heights, padding multipliers). Out of scope for v1.

**Total user-facing controls in v1:** ~30 inputs across five sections. Each maps to one (or a small set of derived) CSS variables.

## UX of the Theme page

```
/account/theme  (or /workspace/theme for tenant-default themes)
```

### Layout
- **Left pane: controls.** Five collapsible sections matching the token model above. Each control is a colour swatch / dropdown / slider.
- **Right pane: live preview.** A scaled-down miniature of the actual app — sidebar with sample group, page header with +++ divider, a form, a button row, a card. Updates in real time as the user changes any control.
- **Top toolbar:** Theme picker dropdown (saved themes), **Save**, **Save as…**, **Reset to default**, **Discard changes**.

### Saved-theme actions
- **Save** — overwrite the currently-loaded theme.
- **Save as…** — prompt for a name; create a new theme.
- **Edit** — implicit; you're always editing whichever theme is loaded. "Edit" in the picker just selects + loads.
- **Remove** — only on themes the user owns; cannot remove the built-in defaults.
- **Reset** — revert to the system default (classic light or dark, no override layer).

### Live preview details
- Renders inside an iframe-like sandboxed div with its own scoped `<style>` block carrying the in-progress variable values, so changes are instant and cannot affect the real app's chrome.
- Includes a fake sidebar item being hovered, an active item, a primary + secondary button, an input, two paragraphs of body text, H1–H5 stack, a table row, a +++ divider — a representative cross-section.
- Toggle button: "Preview against light base" / "Preview against dark base" so the user sees their overrides on both.

### Apply behaviour
- Saving applies immediately to the live app.
- A persistent "Editing theme: *<name>*" pill in the topbar while in editor mode.
- Discard changes restores from the saved version.

## Storage model

**Server-side, per-user, mirrors `nav_prefs` exactly.**

```sql
CREATE TABLE user_themes (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  user_id       uuid REFERENCES user_account(id),  -- NULL for tenant defaults
  name          text NOT NULL,
  base          text NOT NULL CHECK (base IN ('light', 'dark')),
  overrides     jsonb NOT NULL,  -- { "--bg": "#f5f3ee", "--surface": "...", ... }
  is_default    boolean DEFAULT false,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  archived_at   timestamptz
);

CREATE TABLE user_active_theme (
  user_id       uuid PRIMARY KEY REFERENCES user_account(id),
  theme_id      uuid REFERENCES user_themes(id) ON DELETE SET NULL
);
```

**Key choices:**
- `overrides` is **a sparse map of CSS-variable → value strings.** We don't validate the shape on the server beyond "is it a JSON object of strings" — the client knows the variable vocabulary.
- `user_id` nullable → lets a tenant admin create **tenant-wide default themes** all users see in their picker (e.g. "Acme Corp Brand").
- `is_default` lets the admin pin a tenant theme as the new-user default (overrides the system default).
- `user_active_theme` is a tiny join table — keeps the user record clean, allows a `SET NULL` on theme deletion to gracefully fall back to default.
- Soft-archive (`archived_at`) so a removed theme isn't lost forever (recoverable in v2 admin tool).

**API:**
- `GET /api/themes` → list themes visible to the user (own + tenant-wide).
- `GET /api/themes/active` → current active theme for the user.
- `PUT /api/themes/active` → set active theme (id, or `null` for default).
- `POST /api/themes` → create.
- `PUT /api/themes/:id` → update (only own; admins can update tenant-wide).
- `DELETE /api/themes/:id` → soft-archive.

## Injection mechanism

The cleanest path that preserves the current architecture:

1. **Server-side render** the user's active theme variables into a `<style id="user-theme-overrides">` block in the document `<head>`, after the main stylesheet. Source from `user_active_theme` JOIN `user_themes` on every page load.
2. **Client-side**, the existing `useTheme()` hook is extended to also accept theme overrides; when the user changes a theme, the hook rewrites the contents of `<style id="user-theme-overrides">` (no full re-render needed).
3. **CSS specificity:** `:root[data-theme="light"]` already has the right specificity; the override block uses the same selector, just declared later → cascade wins.
4. **Login pages** explicitly opt out — the existing `app/login/layout.tsx` already forces `data-theme="light"`; we add a `data-no-user-theme` flag that the override-injector respects, so corporate themes never break the login surface.

**Why server-side render:** avoids the flash-of-default-theme that would happen if the override block only landed client-side after hydration. It's a small amount of work in `app/layout.tsx` to fetch + inline the variables.

## Phasing

- **Phase 0 — tokenisation cleanup.** Fix the hardcoded values listed in "Theming gaps." Declare missing variables (`--surface-1`, `--surface-2`, `--accent-1`, etc.). No user-visible change. Ship as a standalone PR — small, reviewable, low-risk.
- **Phase 1 — schema + active-theme injection.** Add `user_themes` + `user_active_theme` tables. Add server-side override injection in `<head>`. Seed two built-in themes: "Vector Light" and "Vector Dark" (mirror current defaults). Theme picker in topbar (no editor yet) — user can switch between built-in + any pre-seeded themes.
- **Phase 2 — Theme page (editor).** `/account/theme` page with the five-section editor + live preview. Save / Save as / Reset / Discard. Per-user themes only (no tenant-wide).
- **Phase 3 — tenant defaults.** Admin-scoped UI to create tenant-wide themes (`user_id IS NULL`). `is_default` setting for new-user default. Visible in every user's picker as "[Tenant name] themes."
- **Phase 4 — sharing & presets.** Bundled preset themes ("High contrast," "Low light," brand presets). User-to-user theme sharing (export to JSON, import). Out of scope for v1.

## Open decisions

- **Font loading.** v1 limits font choices to those already bundled by `next/font` (Zen Maru Gothic, JetBrains Mono, Archivo Black) plus a small web-safe list. Do we want a "load any Google Font" picker in v2? It's nice but slows page loads and risks legal/CDN dependencies — defer.
- **Validation of colour values.** Browser will silently ignore garbage CSS values; do we accept anything that parses, or restrict to hex / rgb / named colours? Restrict to hex (with picker) for v1; loosen later if power users complain.
- **Per-page theme overrides.** Could a user have a different theme on a specific page? Probably no — single active theme per user is cleaner. Defer.
- **Accessibility minimums.** Should the editor warn if contrast ratios drop below WCAG AA between (text, background) pairs? Yes for v1 — small visible warning, not a hard block. Cheap to compute, big UX win, prevents users shipping illegible themes.
- **Live preview accuracy.** How faithful does the preview need to be? Recommend: representative miniature in v1, "preview in actual page" toggle in v2 (applies the theme to the real app for a "try it" period).
- **Tenant-default vs user override.** When an admin sets a tenant default, can users still override with their own theme? Recommend: yes, but the picker shows "[Tenant default] (overridden by your theme)" so it's clear.
- **Density slider** — defer to v2 entirely or include a simple Compact/Comfortable in v1? Defer.

## Risk register

- **S2 — illegible themes.** A user picks `--bg` = `#000` and `--ink-1` = `#000` and renders the app unreadable. Mitigation: WCAG AA contrast check in editor (warn, don't block). Reset-to-default always available from the topbar even if the page is illegible. Trigger: Phase 2.
- **S2 — theme override breaks login flow.** A corporate theme makes the login form unreadable. Mitigation: `data-no-user-theme` flag on auth routes; existing `app/login/layout.tsx` pattern is the model. Trigger: Phase 1.
- **S2 — server load from per-request theme JOIN.** Every page render now does an extra DB read for the active theme. Mitigation: cache the user's active theme in their session token at login; invalidate on theme change. Trigger: Phase 1.
- **S2 — schema drift in CSS variable vocabulary.** The set of variables expands; old saved themes have orphan keys, new themes lack new keys. Mitigation: client tolerates unknown keys (ignored); missing keys fall back to base theme defaults. Document the variable vocabulary as the contract; bump a `schema_version` on the theme record if a breaking rename happens. Trigger: any new theme-able variable.
- **S2 — XSS via stored theme value.** Saved variable values are inlined into a `<style>` block; a malicious value like `red; } body { display: none; }` could break the page. Mitigation: server-side validate values match `^#[0-9a-fA-F]{3,8}$|^rgb\(...\)$|^[a-z-]+$|^[0-9.]+(px|rem|em)$` before persistence; client double-checks on render. Trigger: Phase 1 (gating).
- **S3 — preview ≠ reality.** User saves a theme that looks fine in the preview but breaks an obscure page. Mitigation: "preview against actual app" mode in v2; in v1, accept that a user testing on real pages will catch issues. Trigger: Phase 2.
- **S3 — theme proliferation.** Power user creates 50 themes and the picker becomes unwieldy. Mitigation: cap per-user themes at e.g. 20; offer rename + delete in the picker management UI. Trigger: Phase 2.

## Pointers

- CSS architecture & rules: [`docs/css-guide.md`](../docs/css-guide.md)
- All current variables: `app/globals.css` lines 1–71 (root + theme blocks)
- Existing theme toggle implementation: `app/hooks/useTheme.ts`
- Mirror-this storage pattern: `app/contexts/NavPrefsContext.tsx` + `/api/nav/prefs` endpoints
- Storage-tier discipline: [`feature_event_audit_log.md`](feature_event_audit_log.md) (themes are tier-1 server-side, not browser-local — they sync across devices)
- Login route's existing theme-override pattern: `app/login/layout.tsx` line 7
