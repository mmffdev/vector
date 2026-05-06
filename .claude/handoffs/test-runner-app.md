# Handoff — Vector Test Runner (standalone desktop app)

**For:** an agent picking this up cold. Read top to bottom; everything you need is here.

**Working name:** `vector-test-runner` (final name TBD; ask Rick before publishing).

---

## Mission

Build a standalone desktop application that authors, lists, runs, and reports the outcomes of test suites belonging to the Vector project (and, eventually, any project). It is a developer tool, not a CI replacement: Rick double-clicks the app, picks a suite, hits Run, and sees clear pass/fail with drill-in.

The app must run **offline**, ship as a **single binary** per platform, and have **no subscription dependencies**. OSS-licensed components only (MIT / BSD / Apache-2.0 / MPL-2.0).

---

## Stack — pinned, do not relitigate

| Layer | Choice | Why |
|---|---|---|
| Shell | **Wails v2** (latest stable) | Single Go binary + system WebView; no Node runtime shipped |
| Backend / runner | **Go 1.23** | Rick is fluent in Go; spawn `go test`, `vitest`, `playwright test` from the same process |
| Frontend | **React 19 + Vite + TypeScript** | Matches Vector's idiom; Wails v2 ships a Vite template |
| Persistence | **SQLite via [`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite)** | Pure Go, no CGO — keeps cross-compilation trivial |
| Schema migration | hand-rolled `db/schema/NNN_*.sql` runner (mirror Vector's pattern) | Consistency with Rick's existing Go projects |
| Toasts | **Sonner** | Same pattern as Vector |
| Tables | port Vector's `<Table>` primitive (PLA-0015) | Catalog-first styling — no bespoke table CSS |
| DnD (if needed for ordering suites) | `@dnd-kit/sortable` | Same as Vector |
| Test result schema | **JUnit XML** as the lingua franca | Every runner can emit it; one parser to write |

**Rejected alternatives** (don't revisit unless Rick asks):
- Tauri — Rust, friction since Rick doesn't write Rust.
- Electron — 150MB binaries, ships Node runtime per app.
- Pure web app — needs hosting, no offline use.

---

## Where it lives

Create a new sibling directory: `/Users/rick/Documents/MMFFDev-Projects/MMFFDev-Vector-TestRunner/`. New git repo. Initial branch `main`. Do not commit until Rick has confirmed the scaffold.

Reuse from Vector (copy files, do not import):
- Design tokens — CSS variables from `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - Vector Assets/Vector Design System/`
- `<Table>` primitive — `app/components/Table.tsx`
- `<Toaster>` + `notify` — `app/components/Toaster.tsx` + `app/lib/toast.ts`
- Catalog CSS classes — Vector's `app/globals.css` `.btn`, `.pill`, `.tree_accordion-dense__scroll`, etc.

Adapt, don't import — Vector's files include backend hooks (`api()`, AuthContext, addressables). Strip those out.

---

## Data model (SQLite)

```sql
-- A "suite" is one runnable thing: a vitest project, a Go package tree, a Playwright config.
CREATE TABLE suites (
  id            TEXT PRIMARY KEY,         -- ULID
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,            -- 'vitest' | 'go' | 'playwright' | 'shell'
  working_dir   TEXT NOT NULL,            -- absolute path
  command       TEXT NOT NULL,            -- e.g. 'go test -json ./...'
  env_json      TEXT NOT NULL DEFAULT '{}', -- JSON map of env overrides
  reporter_path TEXT,                     -- where the runner writes JUnit/JSON; null = stdout capture
  position      INTEGER NOT NULL DEFAULT 0,
  archived_at   TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A "run" is one invocation of a suite. Multiple runs accumulate over time.
CREATE TABLE runs (
  id           TEXT PRIMARY KEY,           -- ULID
  suite_id     TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,              -- 'running' | 'passed' | 'failed' | 'errored' | 'cancelled'
  started_at   TIMESTAMP NOT NULL,
  finished_at  TIMESTAMP,
  duration_ms  INTEGER,
  exit_code    INTEGER,
  stdout_path  TEXT,                       -- file path under app data dir
  stderr_path  TEXT,
  reporter_raw TEXT                        -- raw JUnit/JSON ingested
);

-- A "case" is one individual test inside a run. Tree-shaped via parent_id for nested describes.
CREATE TABLE cases (
  id          TEXT PRIMARY KEY,            -- ULID
  run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES cases(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  classname   TEXT,                        -- package / file / describe block
  status      TEXT NOT NULL,               -- 'passed' | 'failed' | 'skipped' | 'errored'
  duration_ms INTEGER,
  failure_message TEXT,
  failure_stack   TEXT,
  position    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_runs_suite_started ON runs(suite_id, started_at DESC);
CREATE INDEX idx_cases_run          ON cases(run_id);
CREATE INDEX idx_cases_parent       ON cases(parent_id);
```

App data dir: `~/Library/Application Support/VectorTestRunner/` on macOS (use Wails' `runtime.Environment` to resolve cross-platform).

---

## MVP feature list (Phase 1 — ~2 weeks)

1. **Suite CRUD UI** — full-screen page listing all suites; click → drawer/panel for edit. Fields: name, kind (dropdown), working dir (path picker), command, env vars (key/value rows), archive toggle.
2. **Run a suite** — Run button → Go side spawns `exec.Cmd` with the suite's command + working dir + env, streams stdout/stderr to disk, writes a `runs` row, parses the reporter output on exit, populates `cases`.
3. **Result tree** — for a given run, render `cases` as a collapsible tree (suite → describe blocks → individual cases). Use Vector's `<Table>` in nested mode or `tree_accordion-dense__scroll` style.
4. **Drill-in on failed cases** — click a failed case → side panel with `failure_message` + `failure_stack` in monospace. Copy-to-clipboard.
5. **Run history** — for each suite, list last N runs with timestamp, duration, pass/fail counts. Sparkline of pass-rate over time is a nice-to-have but not required.
6. **Targeted re-run** — on the result tree, right-click a failing case (or whole describe block) → "Run only this" generates a filter-string for the runner (`-run TestFoo` for Go, `--testNamePattern` for vitest, `--grep` for playwright) and dispatches a new run.

### Reporter parsers (one Go file each)

- `parsers/junit.go` — JUnit XML (`<testsuites>/<testsuite>/<testcase>`); primary path. Used by vitest `--reporter=junit`, Playwright `--reporter=junit`, and `gotestsum --junitfile`.
- `parsers/gotest.go` — fallback for `go test -json` if user doesn't want gotestsum installed; emits the same internal `Case` struct as junit.go.
- All parsers emit `[]Case` matching the table schema.

### Frontend layout

- **Sidebar:** suite list (sortable via dnd-kit), with archive filter toggle, "+ New suite" button.
- **Main area:**
  - When a suite is selected: tabs `Runs` | `Edit`.
  - `Runs` tab: list of historical runs at top, when one is clicked a result tree fills the bottom half.
  - `Edit` tab: the CRUD form.
- **Toasts:** Sonner for "Run started", "Run finished — 12 passed, 1 failed", "Save failed: ..."
- Full-screen pages, no max-width (Vector convention — see project memory `feedback_pages_fullscreen`).

---

## Out of scope for MVP — do not build

- CI integration / running on a remote machine.
- Multi-user / multi-machine result aggregation.
- Authentication.
- Recording browser flows (that's Vector's Phase 2 hinted at in [docs/c_c_addressables.md] — not this app's job).
- Code coverage reporting.
- Test impact analysis.
- Cloud storage / sync.
- Plugins / scripting API.

If a feature isn't in the MVP list above, ask Rick before adding it.

---

## Phased build plan

**Day 1–2 — scaffold**
- `wails init -n vector-test-runner -t react-ts`
- Wire SQLite + migration runner.
- Port `<Table>`, design tokens, Sonner. App should boot to a "Hello, world" page styled like Vector.
- Commit checkpoint.

**Day 3–5 — Suite CRUD**
- Schema migration 001 (suites table).
- Go: `internal/suites` service (Create, List, Update, Archive, Reorder).
- Wails bindings.
- React: `<SuiteList>` sidebar + `<SuiteEditDrawer>`.

**Day 6–8 — Runner**
- Schema migration 002 (runs + cases tables).
- Go: `internal/runner` — spawns command, captures streams, calls reporter parser.
- Go: `parsers/junit.go` (start here — covers vitest + playwright + gotestsum in one shot).
- Test it manually against `vector-backend` Go tests via `gotestsum --junitfile`.

**Day 9–11 — Results UI**
- `<RunHistory>` table.
- `<ResultTree>` recursive component.
- `<FailureDetail>` side panel.

**Day 12–14 — Targeted re-run + polish**
- Right-click context menu on result tree.
- Filter-flag generation per kind (`go` → `-run`, `vitest` → `-t`, `playwright` → `--grep`).
- Toast on run start / completion.
- macOS .dmg via `wails build` + a basic icon (commission later).

---

## Acceptance criteria for MVP done

A new agent or Rick should be able to:

1. Open the app, click `+ New suite`, fill in: name=`vector backend`, kind=`go`, working dir=`/Users/rick/Documents/MMFFDev-Projects/MMFFDev - Vector/backend`, command=`gotestsum --junitfile=$REPORTER_PATH ./...`. Save.
2. Hit **Run**. See a "Running…" indicator within 100ms. See a toast on completion.
3. Click the run in history. See a tree of packages → tests with green/red dots and per-test duration.
4. Click a failed test. See its failure message and stack trace in a side panel.
5. Right-click that failed test → **Run only this**. New run dispatches with `-run TestFoo` appended. Tree shows just that one case.
6. Quit the app, relaunch. All state persists. Last 10 runs still in history.

If all six work end-to-end on macOS, MVP is shipped.

---

## Constraints (hard)

- **OSS-only:** every dependency must be MIT / BSD / Apache-2.0 / MPL-2.0. No GPL, no commercial.
- **No subscription / no cloud** in MVP. Every feature works offline.
- **No bespoke CSS classes** without a catalog primitive (Vector's rule, ported here). If a primitive is missing, extend the catalog — don't invent one-offs.
- **No browser alerts** (`window.alert/confirm/prompt`). Use in-app UI for confirmations (Vector's rule, ported here).
- **No human-account credentials embedded.** This app talks to nobody's DB.
- **Cross-platform later.** macOS first; Windows/Linux is a nice-to-have once macOS is solid. Don't pre-optimize for Windows path quirks until you ship macOS.

---

## Open questions for Rick (answer before agent starts)

1. **Repo name confirmed?** Suggested: `MMFFDev-Vector-TestRunner`. OK or rename?
2. **Should the app eventually live as part of Vector** (subdirectory + part of the monorepo) **or stay standalone forever?** Affects whether to publish a Wails plugin or a separate binary.
3. **Code-signing on macOS** for distribution to teammates — needed in MVP, or fine to ship unsigned with right-click-Open?
4. **Icon / branding** — placeholder icon for MVP, real icon later? Or block on the design step?
5. **Primary test target** — start with Vector's Go backend tests, then add the Next.js side via vitest? Or build for vitest first?

If Rick is unreachable, defaults: name `vector-test-runner`, standalone forever, unsigned for MVP, placeholder icon, Go backend first.

---

## Reference — runner-flag cheat sheet (for the targeted-rerun feature)

| Kind | Flag | Example |
|---|---|---|
| `go` | `-run <regex>` | `go test -run "TestFoo$" ./pkg/...` |
| `vitest` | `-t <pattern>` | `vitest run -t "creates a workspace"` |
| `playwright` | `--grep <regex>` | `npx playwright test --grep "login flow"` |
| `shell` | (no standard) | Suite owner sets `$VTR_FILTER` env var; their command interpolates it |

Generate the flag from the case's `name` field. For Go, escape regex metachars. For vitest, use exact-match by quoting. For Playwright, escape regex.

---

## What to do first

1. Read this file end-to-end. Confirm the open questions above with Rick.
2. Create the new repo at the suggested path with `wails init`.
3. Get a "hello world" UI running with Vector design tokens applied.
4. Commit the scaffold. Stop. Show Rick.

Do not skip step 4. The scaffold is the highest-risk-of-rework moment — get sign-off before building features.
