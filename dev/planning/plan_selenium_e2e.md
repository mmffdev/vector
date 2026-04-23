# Plan — Selenium E2E for Vector PM

Standing up Selenium-driven end-to-end tests against the Next.js dev server,
using the existing `Selenium-Vector` container
(`selenium/standalone-all-browsers:nightly`,
id `b3408ae9f51c7e5355ddd6a18e32f73a37652e35f93935f5c912c3d57f3d4b19`).

## Current state (snapshot)

- Container running on bridge network, IP `172.17.0.2`.
- Ports declared but **not published to host** (`4442/4443/4444/5900/9000`).
- Vector PM dev server on `:5101`.
- Repo has **zero test infrastructure** — no scripts, no devDependencies for
  testing. `.playwright-mcp/` is MCP scratch logs, not actual Playwright tests.

## Phase 0 — connectivity (one-off, ~10 min)

- **Decision:** republish container with `-p 4444:4444 -p 7900:7900`
  (`7900` is the noVNC web viewer for watching tests run live), or keep ports
  unpublished and run tests from inside another container on the bridge
  network. Default recommendation: republish.
- Verify Selenium reachable: `curl http://localhost:4444/status`.
- Grid UI: **http://localhost:4444/ui/** — note trailing slash; without it the
  bundle 404s and the page renders blank.
- Verify the container can reach the Next.js dev server at
  `host.docker.internal:5101` (Docker Desktop on macOS supports this).

## Phase 1 — minimal scaffolding

- New top-level dir: `e2e/` (sibling to `app/`, `db/`, `dev/`) so it stays
  out-of-tree from the Next.js build.
- **Decision:** WebDriver client.
  - **(a) `selenium-webdriver`** (official, lowest abstraction) paired with
    `node:test` runner. No extra magic. Recommended for first cut.
  - **(b) WebdriverIO** — heavier but better DX (auto-waits, services).
  - **(c) Playwright with Selenium Grid endpoint** — overkill since Playwright
    MCP is already set up separately.
- Add to `package.json`: `selenium-webdriver`, `@types/selenium-webdriver`,
  plus an `e2e` script: `node --test e2e/**/*.spec.mjs`.
- One config file `e2e/config.mjs` reading `SELENIUM_URL`
  (default `http://localhost:4444/wd/hub`) and `BASE_URL`
  (default `http://host.docker.internal:5101`).

## Phase 2 — first smoke test

- `e2e/login.spec.mjs`: hit `BASE_URL`, log in as `gadmin` test account
  (creds in saved memory `dev_accounts.md`), assert dashboard renders. Proves
  the whole loop end-to-end before adding more.
- Helper: `e2e/lib/login.mjs` — takes role (`user` / `padmin` / `gadmin`),
  uses dev accounts.

## Phase 3 — first real coverage area

**Suggested target: nav-prefs modal.** Reasons:
1. Just shipped, has bugs surfacing (e.g. `onPickIcon` crash this session).
2. Role-dependent rendering — exactly the kind of behaviour unit tests miss.
3. Involves drag/sortable interactions — where Selenium adds value.

Tests:
- `e2e/nav-prefs/pin-unpin.spec.mjs`
- `e2e/nav-prefs/role-visibility.spec.mjs` (run as user / padmin / gadmin,
  assert different catalogue items appear)

## Phase 4 — ergonomics (only after Phase 3 lands)

- Screenshot on failure → write to `e2e/.artifacts/`.
- Optional: parallel browser matrix (chrome/firefox) — the
  `-all-browsers` image supports both.
- Optional: push-time hook / CI integration (probably not needed near term).

## Out of scope (deliberate)

- DB seeding/teardown — rely on existing dev accounts; accept some test-order
  coupling for v1.
- Page Object Model abstractions — premature; add only if selectors start
  duplicating.
- Visual regression — separate concern.

## Open questions (carry forward when we start work)

1. Republish container ports (Phase 0a) or run tests inside Docker (Phase 0b)?
2. `selenium-webdriver` vs WebdriverIO (Phase 1)?
3. Run tests against the live dev server, or spin up a dedicated test instance
   on a different port?

## Where we left off (2026-04-23)

Phase 0–2 done. Phase 3 partially done.

**Landed:**
- Container republished with `-p 4444:4444 -p 7900:7900` (noVNC viewer at
  http://localhost:7900, password `secret`).
- `<seleniumup>` shortcut → `docs/c_selenium.md`.
- `selenium-webdriver` + `node:test` runner; `npm run e2e` script.
- Chrome `--host-resolver-rules` maps `localhost:5101`/`5100` →
  `host.docker.internal` so the container browser sees the same origins as a
  Mac dev session (keeps backend CORS allowlist happy).
- `e2e/config.mjs`, `e2e/lib/{driver,login,accounts}.mjs`.
- **Passing:** `e2e/login.spec.mjs` (gadmin → /dashboard).
- **Passing:** `e2e/nav-prefs/render.spec.mjs` (3 panes render, no SEVERE
  console errors).
- **Partially passing:** `e2e/nav-prefs/role-visibility.spec.mjs`
  - `user` ✅ — sees Account Settings, doesn't see Workspace/Portfolio.
  - `padmin` ❌ and `gadmin` ❌ — page renders both "Nothing pinned" AND
    "Everything visible to your role is already pinned", i.e. the catalogue
    is empty for them.

**Suspected real bug (not test issue):**
Role-gating query for the page-registry catalogue appears inverted — `user`
sees items but `padmin`/`gadmin` (which should be supersets) see nothing.
Investigate `db/schema/009_page_registry.sql` and the catalogue endpoint
(probably `=` where it needs `<=` on a role-rank comparison, or
`page_roles` seed missing rows for higher tiers). The role-visibility test
is currently the canary for this — leave it failing as the regression marker
until the bug is fixed.

**Next session — pick up here:**
1. Investigate the catalogue/role-gating bug surfaced above (high value —
   E2E did its job).
2. Then resume Phase 3 with `pin-unpin.spec.mjs`.
3. Then Phase 4 ergonomics (screenshot-on-failure first).
