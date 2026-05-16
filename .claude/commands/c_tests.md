# `<tests>` — query Tracker red-green tests

Lists Tracker-registered tests for this project (Vector) and their last known status. **No flag** = show tests for the current or most-recently-finished work (resolves by reading recent commits + matching their `[NNNNN]` story refs to plan groups). With flags, lists by group / plan / status.

The route + auth + group catalogue lives on Tracker (`localhost:5102`). This shortcut wraps the read API so future-Claude doesn't re-derive the surface every session.

## Syntax

```
<tests>                  Show tests for current/recent work (default)
<tests> -g <slug>        Show tests for a Tracker group slug
<tests> -p <PLA-NNNN>    Show tests for a plan (resolves to its group(s))
<tests> -G               List all registered groups in the project
<tests> -r               Show recent runs (latest 10)
<tests> -f               Filter to failing/red tests only (combine with other flags)
<tests> -h               Print this help
```

---

## Substrate

- **Tracker base URL:** `http://localhost:5102` (override via `RG_TRACKER_URL`)
- **Auth:** Bearer PAT, project-clamped to Vector. Token lives in [`.claude/memory/project_tracker_rg_api_key.md`](../memory/project_tracker_rg_api_key.md).
- **Read endpoints:**
  - `GET /_site/red-green/groups` — list all groups for the PAT's project
  - `GET /_site/red-green/groups/{id}/tests` — list tests under a group
  - `GET /_site/red-green/runs?limit=N` — recent runs across the project
  - `GET /_site/red-green/runs/{id}/results` — per-test results for a run
- **Write endpoints (out of scope here — use `dev/scripts/rg-rerun.sh` or `cmd/rg-runner` directly):** `POST /_site/red-green/groups`, `POST /_site/red-green/results`, `POST /_site/red-green/runs`.

A test row exists in Tracker only after at least one result has been POSTed for it via `rg-runner`. The "tests" list under a group is auto-populated by the runner — there's no separate "seed test" step.

---

## Default (no flags) — current/recent work

Show tests for whatever was being worked on in the most-recent session.

### Procedure

1. **Identify recent story IDs** from git log:
   ```bash
   git log --oneline -15 | grep -oE '\[[0-9]{5}([,.][0-9]+)?\]' | sort -u
   ```
2. **Resolve story IDs → plan IDs** by reading `dev/plans/PLA-*.json` and matching `story_id` in each plan's `work_item_backlog`. Each plan declares its `tracker_group` (or per-story `tracker_group` for feature_test rows).
3. **Look up each plan-group** on Tracker:
   ```bash
   PAT=$(grep -oE 'trk_[a-z0-9]{20,}' .claude/memory/project_tracker_rg_api_key.md | head -1)
   curl -s -H "Authorization: Bearer $PAT" http://localhost:5102/_site/red-green/groups
   ```
   Filter to groups whose slug matches the resolved `tracker_group` values, AND `backend-feature-tests` (cross-plan Go feature suite).
4. **For each matching group, list its tests:**
   ```bash
   curl -s -H "Authorization: Bearer $PAT" http://localhost:5102/_site/red-green/groups/<id>/tests
   ```
5. **Render a single table** of `Test name | Group | File | Last status | Last run`.
6. **If no recent commits carry story IDs**, fall back to `<tests> -r` (recent runs).

### Output shape

```
Recent commits cover plans: PLA-0054, PLA-0055
Resolved groups: frontend-chip-foundation, frontend-priority-customisation, backend-feature-tests

Group: backend-feature-tests (12 tests)
  ✓ TestF1_GET_CrossWorkspace_ArtefactID_404   featuretests/f1_workspace_clamp_test.go   passed   2026-05-16 22:55
  ✓ TestF3_PrioritiesTable_Exists              featuretests/f7_priority_substrate_test.go passed   2026-05-16 22:55
  ✗ TestF7_BackfillNoOrphanFK                  featuretests/f7_priority_substrate_test.go failed   2026-05-16 22:55
  …

Group: frontend-chip-foundation (10 tests)
  ✓ F5 catalogue + chip + localStorage + sidecar  app/featuretests/__tests__/f5_*.test.tsx  passed  2026-05-16 22:55
  ✓ F6 Status context + rename invariance          app/featuretests/__tests__/f6_*.test.tsx  passed  2026-05-16 22:55
  …
```

---

## `-g <slug>` — by group slug

Show every test under one Tracker group.

```bash
PAT=$(grep -oE 'trk_[a-z0-9]{20,}' .claude/memory/project_tracker_rg_api_key.md | head -1)
gid=$(curl -s -H "Authorization: Bearer $PAT" http://localhost:5102/_site/red-green/groups \
  | python3 -c "import json,sys;print(next(g['id'] for g in json.load(sys.stdin)['groups'] if g['slug']=='<slug>'))")
curl -s -H "Authorization: Bearer $PAT" "http://localhost:5102/_site/red-green/groups/$gid/tests"
```

---

## `-p <PLA-NNNN>` — by plan ID

Resolve the plan's declared `tracker_group` (top-level field, or the feature_test stories' `tracker_group`) and call `-g` for each unique group.

---

## `-G` — list all groups

Quick catalogue of every group registered for the project, sorted by `position`:

```bash
PAT=$(grep -oE 'trk_[a-z0-9]{20,}' .claude/memory/project_tracker_rg_api_key.md | head -1)
curl -s -H "Authorization: Bearer $PAT" http://localhost:5102/_site/red-green/groups \
  | python3 -c "
import json,sys
for g in sorted(json.load(sys.stdin)['groups'], key=lambda x: x['position']):
    print(f\"  {g['slug']:35s} | {g['framework']:10s} | {g['risk']} | {g['section']:10s} | {g['label']}\")"
```

---

## `-r` — recent runs

Last 10 runs across the project with their pass/fail counts:

```bash
PAT=$(grep -oE 'trk_[a-z0-9]{20,}' .claude/memory/project_tracker_rg_api_key.md | head -1)
curl -s -H "Authorization: Bearer $PAT" "http://localhost:5102/_site/red-green/runs?limit=10" \
  | python3 -m json.tool
```

---

## `-f` — failing only

Filter combine modifier — drop rows where `last_status != failed` (or `presence == orphaned`). Useful with `-g` / `-p` / default.

---

## Tracker not reachable

If `curl http://localhost:5102/healthz` doesn't return `{"status":"ok"}`, Tracker isn't running. Either:
- Start it via the Tracker repo's normal launcher, OR
- Skip silently with the message "Tracker unreachable — last-known test state unknown".

Don't fabricate test status from local `go test` / `vitest` runs; those are real signals but they're not what `<tests>` reports — this shortcut shows the registered regression-library view on Tracker.

---

## Anti-patterns (don't do these)

- **Don't write to Tracker from `<tests>`.** Reads only. Use `dev/scripts/rg-rerun.sh` or `cmd/rg-runner` for POSTs.
- **Don't fall back to local `go test` output when Tracker is up but the requested group is empty.** Empty group = "no tests have been POSTed yet" = real signal. Surface it; don't paper over it.
- **Don't probe Tracker with `curl -fsS /`** — it returns 404 (no root route). Use `/healthz`.
