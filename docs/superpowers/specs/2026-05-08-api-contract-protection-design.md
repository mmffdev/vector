# Design: API Contract Protection & Blast Radius Toolchain

**Date:** 2026-05-08
**Status:** Approved
**Author:** Claude (brainstorming session)
**Plan:** PLA-0029

---

## Problem

The API surface (`openapi.yaml`, 106 paths) is manually maintained with no enforcement. Three failure modes are currently undetected:

1. A Go route ships without a spec entry (undocumented API).
2. A frontend `api()` call references a path that doesn't exist in the spec (caller/spec drift).
3. A breaking change lands without intent being recorded (silent contract regression).

No external clients exist yet — this is the right time to install the toolchain before any consumer adoption.

---

## Decision

Four layers, three scripts, one git hook, one Dev panel tab. All tooling follows the existing `dev/scripts/` pattern (Python lint scripts + shell smoke tests). Snapshot artefacts live in a new `api-snapshots/` directory at the repo root.

---

## Architecture

```text
git push
  → pre-push hook
      → check_routes.sh     (Go router ↔ spec — fail if route undocumented)
      → check_callers.py    (api() call sites ↔ spec — fail if caller has no spec entry)
      → oasdiff breaking    (spec vs latest snapshot — fail unless [breaking] in commit msg)

snapshot bump (manual, npm run api:snap)
  → snap_api.sh
      → copies openapi.yaml → api-snapshots/vN.yaml
      → oasdiff changelog   → api-snapshots/blast-radius-latest.md
      → check_callers.py    → api-snapshots/caller-map.json (regenerated)
      → appends             → api-snapshots/CHANGELOG.md

/dev → API Changelog tab
  → DevApiChangelogPanel
      → renders blast-radius-latest.md
      → renders caller-map.json as searchable table
      → renders dead-apis.txt
```

---

## Layer 1 — Map

### `dev/scripts/check_routes.sh`

Greps `backend/cmd/server/main.go` for all `r.Get`, `r.Post`, `r.Put`, `r.Delete`, `r.Patch` path strings. Normalises chi path params (`{id}`) to OpenAPI format (`{id}` — same, no transform needed). Strips the `/samantha/v1` mount prefix to get the resource path, then checks against `openapi.yaml`.

**Rules:**

- Go route present, spec path absent → **exit 1** (undocumented route — hard fail)
- Spec path present, Go route absent → **warn only** (spec-first workflow allowed)
- Infra routes (`/healthz`, `/env`, `/status/pipeline`, `/ws`) are on an allow-list and skipped

**Invocation:** `bash dev/scripts/check_routes.sh`

Exit 0 = clean. Exit 1 = one or more undocumented routes, list printed to stderr.

---

### `dev/scripts/check_callers.py`

Greps `app/` (excluding `app/api/v2/` Next.js PoC handlers and `node_modules`) for all `api("…")` and `apiInfra("…")` call-site path strings via regex. `apiInfra` calls map to unversioned root paths (`/env`, `/status/pipeline`, `/env/switch`) — these are on the infra allow-list and checked against the unversioned routes section of the spec, not the `/samantha/v1` block. Strips query strings. Checks each caller path against `openapi.yaml` paths.

**Rules:**

- Caller path present, spec entry absent → **exit 1** (frontend calling undocumented endpoint — hard fail)
- Spec path present, no caller → **warn only**, appended to `api-snapshots/dead-apis.txt`

**Side effect:** always writes `api-snapshots/caller-map.json`:

```json
{
  "/work-items": ["app/components/WorkItemsTree.tsx:88", "app/hooks/useWorkItemsWindow.ts:12"],
  "/auth/login":  ["app/contexts/AuthContext.tsx:44"]
}
```

**Invocation:** `python3 dev/scripts/check_callers.py`

Exit 0 = clean. Exit 1 = one or more callers reference undocumented paths.

---

## Layer 2 — Protect

### `.git/hooks/pre-push`

Installed via `npm run api:install-hooks` (copies `dev/scripts/pre-push.sh` → `.git/hooks/pre-push`, sets executable bit). The hook itself is version-controlled at `dev/scripts/pre-push.sh`.

**Sequence:**

1. Run `check_routes.sh` — exit 1 blocks push
2. Run `check_callers.py` — exit 1 blocks push
3. Determine highest existing snapshot in `api-snapshots/` (e.g. `v1.yaml`)
4. Run `oasdiff breaking <snapshot> openapi.yaml`
5. If breaking changes found:
   - Read last commit message (`git log -1 --format=%s%b`)
   - If message contains `[breaking]` → allow, print "intentional breaking change — recorded in git log"
   - If message does not contain `[breaking]` → block push, print oasdiff breaking diff

**No snapshot yet** (before first `api:snap`): breaking check is skipped with a warning "no snapshot found — run `npm run api:snap` to establish baseline".

---

### `api-snapshots/` directory structure

```text
api-snapshots/
  v1.yaml                  ← frozen at PLA-0028 rename commit
  v2.yaml                  ← added when v2 surface ships
  CHANGELOG.md             ← one entry per snap, auto-appended
  blast-radius-latest.md   ← overwritten on each snap
  caller-map.json          ← overwritten on each snap
  dead-apis.txt            ← overwritten on each snap
```

Files are committed to git. `blast-radius-latest.md`, `caller-map.json`, and `dead-apis.txt` represent the state at the last snap — they are not regenerated on every push, only on `npm run api:snap`.

---

## Layer 3 — Consumer-Driven Contracts

No Pact broker. The frontend `api()` call sites are the consumer. `caller-map.json` is the contract artefact — it is committed alongside each snapshot and maps every spec path to the frontend files that call it.

**`api-snapshots/dead-apis.txt`** — spec paths with zero frontend callers. Warning only. Reviewed manually; a path may be intentionally uncalled (used by external clients or scripts) and can be added to a `dev/registries/dead-api-exemptions.txt` allow-list to suppress the warning.

---

## Layer 4 — Blast Radius

### `dev/scripts/snap_api.sh`

Called by `npm run api:snap`. Steps:

1. Determine next version: scan `api-snapshots/` for highest `vN.yaml`, increment N. First run = `v1`.
1. Copy `openapi.yaml` → `api-snapshots/vN.yaml`
1. If previous snapshot exists: run `oasdiff changelog api-snapshots/v{N-1}.yaml openapi.yaml --format=markdown` → `api-snapshots/blast-radius-latest.md`
1. Run `python3 dev/scripts/check_callers.py` → regenerates `api-snapshots/caller-map.json` and `dead-apis.txt`
1. Append to `api-snapshots/CHANGELOG.md`:

```markdown
## vN — 2026-05-08
Snapshot of openapi.yaml at <git SHA>. Breaking changes: <yes|no>.
```

1. Print summary to stdout

---

### Dev panel — `DevApiChangelogPanel`

New standalone panel registered in `dev/pages/DevPage.tsx`. Route: accessible via Dev Setup nav.

**Sections:**

1. **Changelog** — renders `blast-radius-latest.md` as markdown (via existing markdown renderer or `dangerouslySetInnerHTML` with sanitisation)
2. **Caller Map** — renders `caller-map.json` as a searchable table: columns `Endpoint`, `Callers`. Filter input narrows by endpoint or filename.
3. **Dead APIs** — renders `dead-apis.txt` as a simple list. If empty, shows "No dead APIs detected."
4. **Refresh** button — re-fetches all three files via `/api/dev/api-changelog` route (new Next.js route handler that reads from `api-snapshots/`)

**Data source:** `/api/dev/api-changelog` GET handler returns:

```json
{
  "changelog": "<markdown string>",
  "caller_map": { "/path": ["file:line"] },
  "dead_apis": ["/path"],
  "snapshot_version": "v1",
  "snapshot_date": "2026-05-08"
}
```

**CSS:** `.dui-*` catalog only — no bespoke classes.

---

## npm scripts (additions to `package.json`)

| Script | Action |
| --- | --- |
| `npm run api:snap` | Run `snap_api.sh` — bump snapshot, generate blast radius report |
| `npm run api:check` | Run `check_routes.sh` + `check_callers.py` — Layer 1+2 checks without the oasdiff gate |
| `npm run api:install-hooks` | Copy `dev/scripts/pre-push.sh` → `.git/hooks/pre-push` |

---

## oasdiff installation

Installed via `go install github.com/tufin/oasdiff@latest` — added to `README.md` dev setup instructions. Not a Node dependency. The pre-push hook checks for `oasdiff` on PATH and skips the breaking-change check with a warning if not found (avoids blocking engineers who haven't installed it yet).

---

## Layer 5 — CI (GitHub Actions)

Workflow file: `.github/workflows/api-contracts.yml`. Stubbed in this plan — ready to enable the moment a GitHub remote is added. The workflow is inert until then (no remote = no triggers).

**Trigger:** `pull_request` targeting `main`.

**Jobs:**

1. **`api-map`** — runs `check_routes.sh` + `check_callers.py`. Fails the PR if any undocumented route or caller drift is found. Annotates the PR with the offending paths.
2. **`api-protect`** — runs `oasdiff breaking api-snapshots/<latest>.yaml openapi.yaml`. If breaking changes found and the PR title/body does not contain `[breaking]`, the job fails and blocks merge. If `[breaking]` is present, the job passes with a warning annotation listing the breaks.

Both jobs run on `ubuntu-latest` using the repo's Go version (from `go.mod`) for `oasdiff` install and Python 3 for `check_callers.py`.

**No snap job in CI** — snapshot bumps remain a deliberate manual act (`npm run api:snap`), never automated on merge.

---

## Out of scope

- Pact broker or external contract registry (add when first real external client onboards)
- Auto-generating `openapi.yaml` from Go annotations (separate concern, separate plan)
- Response body schema validation against live traffic (future: `schemathesis` or `oasdiff` lint mode)

---

## Files created / modified

| File | Action |
| --- | --- |
| `api-snapshots/v1.yaml` | Created — first snapshot (at PLA-0028 rename commit) |
| `api-snapshots/CHANGELOG.md` | Created |
| `dev/scripts/check_routes.sh` | Created |
| `dev/scripts/check_callers.py` | Created |
| `dev/scripts/snap_api.sh` | Created |
| `dev/scripts/pre-push.sh` | Created (version-controlled hook source) |
| `dev/pages/DevApiChangelogPanel.tsx` | Created |
| `app/api/dev/api-changelog/route.ts` | Created |
| `package.json` | Modified — 3 new scripts |
| `docs/c_c_lint_rules.md` | Modified — add check_routes + check_callers entries |
| `README.md` | Modified — add `oasdiff` to dev setup |
| `.github/workflows/api-contracts.yml` | Created — stubbed GH Actions workflow (inert until remote added) |
