---
name: Session bootup — Palette flyout + theme persistence + env-mismatch investigation
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: 5b8bdf98-0f1b-4734-b76d-10cd228c3fe6
---

## Current state (last updated: 2026-04-28)

**Active branch:** `main`
**Story index last issued:** unknown (`docs/c_story_index.md` still not present in repo)
**Phase:** Palette/theme-pack feature delivery + active env-mismatch root-cause investigation (auto mode)

---

## Planka card states

**In progress / Doing:**
- (none — Palette + env work were direct asks, not card-tracked yet)

**Completed (committed, move to Completed in Planka):**
- (none new committed this session — all changes still uncommitted on main)

**Parked:**
- Pre-launch security checklist (per `project_pre_launch_security.md`)

---

## Uncommitted on branch

**Modified (this session):**
- `app/components/UserAvatarMenu.tsx` — added Palette flyout button between admin pages and Log out; hover-bridged via `onMouseEnter`/`onMouseLeave` on a wrapper; uses `useThemePack` to read/write the active pack.
- `app/globals.css` — added ~100 lines after `.avatar-menu__item`: `.avatar-menu__palette-group`, `.avatar-menu__flyout` (right of menu), `.avatar-menu__flyout-grid` (2-col), `.palette-card`, `.palette-card--active`, `.palette-card__swatches` (2×2 grid, `aspect-ratio: 2/1`).
- `backend/cmd/server/main.go` — added `/api/me` route group with `RequireAuth + RequireFreshPassword + httprate(120/min)` mounting `GET/PUT /api/me/theme-pack`. (Earlier in session: `envFromDBPort()` closure, `/healthz` env field, `/api/env` + `/api/env/switch`.)

**Modified (pre-existing, not core to this session):**
- `app/(user)/dashboard/page.tsx`, `app/(user)/theme/page.tsx`, `app/layout.tsx`, `app/login/page.tsx`, `app/login/reset/page.tsx`, `app/login/reset/confirm/page.tsx`, `middleware.ts` — login redesign + theme-page work
- `.planka` — local Planka config drift

**Untracked (this session):**
- `app/hooks/useThemePack.ts` — first paint loads from localStorage, then reconciles with `GET /api/me/theme-pack`; `choose()` applies immediately + `PUT`s in the background; swallows 401/403 (login pages) cleanly.
- `backend/internal/users/prefs.go` — `Service.GetThemePack`/`SetThemePack` + handlers; allow-list `validThemePacks` map (`default`, `vector-mono`); `ErrInvalidThemePack` sentinel; JSON shape `{"pack":"<id>"}`.
- `db/schema/039_user_theme_pack.sql` — `ALTER TABLE users ADD COLUMN theme_pack TEXT NOT NULL DEFAULT 'default'` + `CHECK (theme_pack IN ('default','vector-mono'))`. **NOT YET APPLIED to any env.**
- `public/themes/` — vector-mono.css and any other pack stylesheets the hook injects.
- `app/components/AuthBrand.tsx`, `app/components/PetalChart.tsx`, `app/components/FilledPetalChart.tsx`, `app/components/FillPetalEqualChart.tsx`, `app/components/FillPetalEqualChartRounded.tsx` — login + chart explorations.
- `dev/research/R004.json` — research export.
- Screenshots: `login-redesign-check.png`, `login-redesign-final.png`, `login-reset-confirm.png`, `login-reset.png`, `theme-page-default.png`, `themes-tab-*.png`, `vector-mono-*.png` — visual verifications during palette + login work.
- `corp-ident/`, `local-assets/pages-designs/` — design-asset folders.

---

## What shipped this session

**Palette flyout (avatar dropdown):**
- New "Palette" entry between admin pages and Log out. Hover the row → flyout opens to the right (`right: calc(100% + 6px)`), bridged via wrapper-level mouse handlers so the cursor traveling into the flyout keeps it open.
- Each pack rendered as a `.palette-card` with a 2×2 swatch grid (`aspect-ratio: 2/1`). Click → `choose(pack)` → instant CSS swap.
- `PALETTES` array in `UserAvatarMenu.tsx` is the single source for label + 4 representative swatches per pack. Adding a pack = (a) new entry here, (b) new `vector-mono`-style stylesheet under `/public/themes/`, (c) extend `PACK_HREF` in `useThemePack.ts`, (d) extend `validThemePacks` in `prefs.go`, (e) extend the SQL `CHECK` in a new migration.

**Theme persistence (DB + backend + frontend):**
- Migration 039 adds `users.theme_pack` (TEXT NOT NULL DEFAULT 'default') with CHECK constraint mirroring the backend allow-list.
- `backend/internal/users/prefs.go` exposes Service + Handler. Allow-list is the primary gate; CHECK is the safety net.
- Mounted at `/api/me/theme-pack` (GET + PUT) under `RequireAuth + RequireFreshPassword + httprate(120/min)` in `backend/cmd/server/main.go`.
- `useThemePack.ts` does **fast-paint-then-reconcile**: localStorage first to avoid palette flash on load, then GET to reconcile, then PUT on every `choose()`. 401/403 swallowed silently so login/reset pages don't spam warnings.

**Env-mismatch investigation (DIAGNOSED, NOT YET FIXED):**
- The running backend reports `env="production"` but `BACKEND_ENV` was nominally `staging` — investigated end-to-end:
  - `backend/cmd/server/main.go:166-179` — `envFromDBPort()` derives the reported env from the live `DB_PORT` (5434=production, 5435=dev, 5436=staging). `/healthz`, `/api/env`, and the EnvBadge UI all consume **this** value, not `BACKEND_ENV` or `APP_ENV`.
  - `.claude/bin/switch-server` exports `BACKEND_ENV` and execs `go run`, but **does not unset pre-existing `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD/APP_ENV`** in the parent shell. `godotenv.Load` does NOT override existing env vars, so any shell-exported value from a prior session beats the `.env.<env>` file.
  - `backend/.env.local` has `DB_PORT=5434` + `APP_ENV=development` — internally contradictory (5434 is the production tunnel).
  - `backend/.env.production` has `APP_ENV=development` — outright wrong.
  - `backend/.env.dev` (5435/development) and `backend/.env.staging` (5436/staging) are correct.
  - There is **no startup consistency check** in `main.go` that fatals when `BACKEND_ENV`'s expected mapping doesn't match the loaded `DB_PORT`/`APP_ENV`.

---

## Recent commits

```
8544dd8 Header chrome: ProfileBar moved to centered top, sidebar logo, /product placeholder
a1d04b3 Nav prefs: Custom Navigation pane + slinky pill entrance + Available count
db2e596 Memory + workspace housekeeping
131711c Migration 038: default-pin Product entity bookmark
f111140 Migration 037: scope user_nav_prefs unique-position by parent
4c21ca9 Backend env switch: /api/env + /api/env/switch + EnvBadge UI
8d32dea Tooling: MMFF Vector Launcher (v0.1) + generic builder brief
291f10e Tooling: <addpaper> research-paper shorthand + shared writer/format
```

---

## What's next

1. **Synthesize env-mismatch findings to user** (the immediate pending step from before compaction) — bullets in "What shipped" above are ready to relay.
2. **Fix `.env.local`** — either align it with dev (`DB_PORT=5435 + APP_ENV=development`) or delete it so `<server>` flag-driven env files are the only source.
3. **Fix `.env.production`** — set `APP_ENV=production` (currently incorrectly `development`).
4. **Harden `.claude/bin/switch-server`** — prepend `unset DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD APP_ENV` before the `BACKEND_ENV="$ENV" nohup go run ./cmd/server` line so the `.env.<env>` file always wins.
5. **Add startup consistency guard in `backend/cmd/server/main.go`** — after env load, if `BACKEND_ENV`'s expected `DB_PORT`/`APP_ENV` mapping doesn't match what was loaded, `log.Fatal` with a precise message naming the mismatch.
6. **Apply migration 039** — pending decision on which env (current target should be dev once env files are corrected); `cd backend && go run ./cmd/migrate -dry-run -db vector -env .env.dev` first.
7. **Commit Palette feature** — likely two logical commits: (a) `Palette: avatar flyout + theme pack switcher (frontend)`, (b) `Theme pack: migration 039 + /api/me/theme-pack handler`.
8. **Storify retroactively** if Palette should be card-tracked (per Storify-all-layers rule covers UI + backend + migration).
9. **Pre-launch security checklist** still parked.

---

## Key facts (non-obvious, not in other docs)

- **Frontend dev server:** Next.js on `:5101` (not `:3000`)
- **API routing:** `api()` helper → `http://localhost:5100` (backend direct, not Next.js proxy)
- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored content)
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` — secrets use `ENC[aes256gcm:<base64>]` envelope
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **padmin test account:** `padmin@mmffdev.com` / `changeme123!`
- **user test account:** `user@mmffdev.com` (password unknown — reset via backend hash endpoint if needed)
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Env-derivation truth source:** `/healthz.env` is derived from live `DB_PORT` (5434=production, 5435=dev, 5436=staging) via `envFromDBPort()` in `backend/cmd/server/main.go:166-179`. `BACKEND_ENV` is INTENT only; the reported env is GROUND TRUTH from the actual DB connection. They can diverge silently — that is the bug currently being fixed.
- **godotenv quirk:** `godotenv.Load(".env.<env>")` does **not** override existing process env vars. Anything exported in the parent shell wins. This is why `switch-server` must `unset` DB_*/APP_ENV before relaunch.
- **Env file health (as of 2026-04-28):** `.env.local` 5434+development (contradictory), `.env.production` 5434+development (APP_ENV wrong), `.env.dev` 5435+development (correct), `.env.staging` 5436+staging (correct).
- **Theme-pack three-way sync:** the set of valid packs lives in THREE places and must stay in lockstep — (a) `validThemePacks` map in `backend/internal/users/prefs.go`, (b) the SQL `CHECK` constraint on `users.theme_pack` (latest migration: 039), (c) `VALID_PACKS` + `PACK_HREF` in `app/hooks/useThemePack.ts`. Plus the file basename in `/public/themes/<pack>.css`. Comment at top of `prefs.go` documents this.
- **Palette flyout hover-bridging:** `.avatar-menu__palette-group` is the wrapper; mouse handlers are on the wrapper, not the row, so the cursor can travel from row → flyout without `mouseleave` firing prematurely.
- **Frontend hook reconciliation:** `useThemePack` swallows 401/403 silently because the hook may mount on auth-less pages (login, password reset). Other failures fall back to the cached pack and warn to console.
- **`docs/c_story_index.md` is missing** — the `<stories>` skill expects it. Either create it on first issuance or fix the skill.
