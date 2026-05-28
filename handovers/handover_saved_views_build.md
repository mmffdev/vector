# Handover — Saved Views build

**Filed:** 2026-05-28
**Filed by:** Claude (Opus 4.7) executing the plan at `docs/superpowers/plans/2026-05-28-saved-views.md`
**State at filing:** 11 / 21 tasks complete. Backend substrate + tests + lints all shipped and verified against the live API. Frontend phase has not started.

---

## What is DONE

### Phase 1 — Database (1/1)
- ✅ **Task 1** Migration 145 — `saved_views` table + 4 partial indexes + 5 CHECK constraints + updated_at trigger. Applied to dev `vector_artefacts` on tunnel `:5435`. Commit `b7614f89`.
  - **Important deviation noted by subagent at apply time:** the migrate tool (`go run ./cmd/migrate -db vector_artefacts`) wanted to re-apply 30+ pre-existing migrations because `schema_migrations` was inconsistent with disk (rows 093-130 + 137 missing despite the schemas being applied). To avoid the risky scan, the subagent applied 145 via `psql -f` and manually wrote the `schema_migrations` row. End state matches what `applyFile()` would produce for one file. The plan's `-apply` flag does not exist; the tool applies by default.

### Phase 2 — Backend Go package (6/6)
- ✅ **Task 2** `doc.go` + `types.go` — wire types, sentinel errors (`ErrNotFound`, `ErrForbidden`, `ErrInvalidInput`, `ErrNotNodeMember`, `ErrNotWSAdmin`, `ErrTenantMismatch`, `ErrBodyTooLarge`), scope/kind constants, `ListVisibleQuery`/`CreateInput`/`UpdateScopeInput` parameter structs.
- ✅ **Task 3** `sql.go` — 11 named SQL constants for reads, writes, tenant-integrity probes. Commit `3592c303`.
- ✅ **Task 4** `store.go` — `ViewStore` interface + `PostgresViewStore` implementation (9 methods including tenant-integrity probes). Substrate boundary for future-proofing per spec §5/§8. Commit `0a8a8252`.
- ✅ **Task 5** `service.go` — Service with Rally-pattern permission gating (permissive at node level, admin-gated at workspace level), tenant-integrity verification, audit-log emit hook (currently `nil` — wired in Task 19), fire-and-forget panic-recovered audit. Companion changes: `sqlVerifyNodeMembership` constant + `VerifyNodeMembership` method on store. Commit `f4044338`.
- ✅ **Task 6** `handler.go` — 6 endpoints over chi. Auth-context adaptations: plan said `u.UserID` / `usermessages.RequestMissingField` but real shape is `u.ID` / `RequestMissingFields` (plural). Subagent adapted correctly. Commit `d2041100`.
- ✅ **Task 7** `main.go` wire-up — **plan was deliberately adapted by the orchestrator because the plan's assumed methods `HasWorkspaceAdmin` / `ListNodeMembershipsForUser` don't exist in this codebase.** Adaptation shipped:
  - **Workspace-admin check**: `savedViewsWSAdminAdapter` uses `permissions.Resolver.Has(WorkspaceArchive)` as proxy. `WorkspaceArchive` is gadmin/padmin-only by default — matches Rally's "subscription or workspace admin can share" rule. A proper `workspace.share_views` permission code is future work (TD entry suggested but not yet filed).
  - **Node-membership probe**: inlined SQL closure in main.go, not pushed into `topology.Service`. Single tiny query for this one endpoint; coupling kept narrow.
  - **Live API smoke verified**: `GET /_site/saved-views?kind=objecttree&target=objecttree:work_items` returns `200 {"views":[]}` with valid auth, `401` without, `404` on bogus path. Route + auth gate + handler are all real.
  - Commit `5cdfdde9` (bundled in auto-regenerated `siteAPI.yaml` via pre-commit hook — that's normal for backend route additions).

### Phase 3 — Backend tests (2/2)
- ✅ **Task 8** `service_test.go` — 12 unit tests against a fake `ViewStore` + fake `WorkspaceAdminChecker`. Cover scope creation (user/node/workspace, allowed/rejected), tenant mismatch, invalid kind, body-too-large, edit non-owner rejected, promote-to-node-member allowed, archive non-owner rejected. All PASS. Commit `957719ab`.
- ✅ **Task 9** `service_integration_test.go` — 3 tests behind `//go:build integration` tag. CHECK constraint rejection + body size cap **PASS**; round-trip user-scope SKIPS because `rick@mmffdev.com` isn't in dev seed (documented acceptable fallback in the plan). Commit `51417245`.

### Phase 4 — Lints (2/2)
- ✅ **Task 10** `dev/scripts/lint_savedviews_writer_only.py` — blocks raw INSERT/UPDATE/DELETE on `saved_views` outside `backend/internal/savedviews/`. Commit `19435778`.
- ✅ **Task 11** `dev/scripts/lint_savedviews_context_free.py` — blocks `useRouter` / `window.location` / `usePathname` / `useSearchParams` / `next/navigation` imports inside `app/components/SavedViews/` (target dir doesn't exist yet — lint exits OK with "target dir does not exist yet" message). Commit `f506361f`.

---

## Where to pick up next

**Phase 5 — Frontend reusable component family (5 tasks, Tasks 12-16)**, plus Phase 6-7 (wire-up + audit + docs + final gate, Tasks 17-21).

### Immediate next step: Task 12

Create the frontend types + headless hook. Per the plan at `docs/superpowers/plans/2026-05-28-saved-views.md` Task 12:

- Create `app/components/SavedViews/types.ts` — wire shapes matching backend `View` struct field names (e.g. `saved_views_id`, `saved_views_scope`, `saved_views_target`, `saved_views_body`).
- Create `app/components/SavedViews/useSavedViews.ts` — headless hook backed by `apiSite()` calls, mirrors `useFieldsForType` pattern, schema-agnostic about body.

Two adaptations to be aware of when reading the plan code:
1. The plan uses `import { apiSite } from "@/app/lib/api"` — confirmed correct path; same import shape `useColumnCatalogue` uses.
2. `View` field names use snake_case prefixes (`saved_views_id` etc.) — they're the actual wire shape, not camelCased. Frontend reads them verbatim.

### Then in sequence

| Task | What | Notes |
|---|---|---|
| 13 | `SaveAsNewViewModal.tsx` | Name input + Scope dropdown. Matches Rally screenshot 3/4. |
| 14 | `ManageSavedViewsModal.tsx` | Table list + multi-select + inline rename + scope change. Rally screenshot 1/2. Currently passes a `onChangeScope` no-op stub — that's intentional v1 (the plan flags it as a deferred enhancement). |
| 15 | `SavedViewsDropdown` + `SaveChangesIndicator` + `SavedViewsControl` umbrella | The header dropdown (Rally screenshot 5) + the dirty-state Save Changes button + the umbrella component that composes everything. **`SavedViewsControl` is where the context-free contract lives — props only, no globals.** |
| 16 | CSS `.saved-views__*` family in `app/globals.css` | Insert after the existing `.column-picker__*` block. ~260 lines. |
| 17 | Mount `<SavedViewsControl>` in `<ObjectTree>` chrome + wire `app/(user)/work-items/page.tsx` | Adds `savedViews={{ kind, target }}` prop pass-through. Per-page wire-up is one constant + one prop. |
| 18 | Wire `isDirty` / `onLoad` / `onClearView` / `canShareToWorkspace` to column-picker state | This is where Task 17's stubs become real. Computes diff between active view body and current picker state; loads body into picker; resets to defaults on clear; uses `useHasPermission` for workspace-admin gate. |
| 19 | Wire audit-log emission in `main.go` | Replace the `nil` audit hook with a real `audit.Event` emitter. Requires inspecting the existing `audit_logs` Go surface for exact `Event` field names. |
| 20 | Docs + SY003 regen | Add `saved_views` to `docs/c_c_db_routing.md` + `docs/c_schema.md` + `.claude/CLAUDE.md` pointer. Then `<report> -sy` to regenerate SY003 per the HARD RULE. |
| 21 | Final verification gate | Full test suite + tsc + all lints + manual browser smoke against the 10 acceptance criteria in spec §14. |

---

## Known caveats / things to remember

### Build-mode rules (orchestrator-only memory)

- **Subagents do NOT use git.** Each task subagent writes code, runs tests/builds, reports back. The orchestrator (me — main Claude) stages and commits. Every task in the plan ends with a "Step N: Commit" prompt that the subagent skips and the orchestrator executes.
- **Sub-agent context isolation**: each task gets a fresh subagent prompt. Don't carry over assumptions — re-state the plan ref, the working directory, and the no-git rule in every dispatch.
- **70% context = handover trigger**. This handover is the trigger artefact. Read this file back in next session to restore state.

### Worktree state

- **Worktree path**: `/Users/rick/Documents/MMFFDev - Projects/Vector-feat-objecttree-fields-picker`
- **Branch**: `feat/objecttree-fields-picker`
- **Parallel main worktree**: `/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector` (on `main`, untouched by this branch).
- **User has VS Code open on main**. Don't switch the worktree the user is looking at.
- **node_modules in the feature worktree is a symlink** to the main worktree's `node_modules`. Gitignored; safe.
- **`backend/.env.dev` in feature worktree is gitignored** — was copied from main worktree by Task 1's subagent. If a future session finds it missing, copy it again.

### Active branch state

```
f506361f feat(lint): lint:savedviews-context-free
19435778 feat(lint): lint:savedviews-writer-only
51417245 test(savedviews): integration tests against live DB
957719ab test(savedviews): 12 permission + tenant-integrity tests against fake ViewStore
5cdfdde9 feat(savedviews): wire constructor + mount /_site/saved-views in main.go
d2041100 feat(savedviews): chi handler — six endpoints
f4044338 feat(savedviews): Service with permission gating + tenant integrity + audit emission
0a8a8252 feat(savedviews): ViewStore interface + PostgresViewStore impl
3592c303 feat(savedviews): sql.go
[Task 2 commit]
b7614f89 feat(db): mig 145 — saved_views table + indexes + trigger
e86762cb docs(plan): saved-views implementation plan
abca685b docs(spec): saved-views — tighten target convention etc.
[…earlier spec / scope-sanitisation / ColumnPicker work…]
```

### Backend live state

- Dev server normally runs at `http://localhost:5100` (user's running instance — PID 1832 was observed during Task 7 smoke).
- Migration 145 has been applied. `saved_views` table exists in `vector_artefacts`.
- Live endpoint `/_site/saved-views` is mounted, auth-gated, and responds correctly. Verified during Task 7 against a fresh-built binary on port 5199 to avoid disturbing the user's `:5100` server.
- The dev API key is in `backend/.env.dev` as `DEV_API_KEY`.

### Test surface

- `go test ./internal/savedviews/...` (no tags) → 12 unit tests PASS in ~0.3s.
- `go test -tags=integration ./internal/savedviews/... -v -run TestIntegration` → 2 pass, 1 skip.
- All other backend tests untouched.

### Future TD entries that should be filed (not yet filed)

1. **`TD-SAVEDVIEWS-WORKSPACE-SHARE-PERM-CODE`** — currently `WorkspaceArchive` is used as the proxy for "workspace admin" in `savedViewsWSAdminAdapter`. The proper fix is a dedicated `workspace.share_views` permission code added to `backend/internal/permissions/catalogue.go` + a migration that seeds it onto the gadmin/padmin roles. Trigger: any user feedback that workspace.archive permission is too restrictive OR procurement question about share permissions.

2. **`TD-SAVEDVIEWS-MANAGE-MODAL-SCOPE-CHANGE`** — the `ManageSavedViewsModal` (Task 14) passes a no-op `onChangeScope` stub. Real scope-change UX (a per-row scope dropdown) is deferred to a follow-up. Trigger: first user reports trying to promote a personal view to team from the manage modal and finding nothing happens.

### What's NOT broken / don't refactor

- The ColumnPicker shipped earlier on this branch (`0b656858`) is fine; Task 18 will connect saved views to it via `onLoad` / `onSerialise`.
- The ColumnCatalogue hook (`f2cfb2b2`) is fine; not touched by saved views.
- Vector_Scope sanitisation (`34010805`) and the broken commit-appender hook (disabled in the same commit) — leave both alone.

---

## Resume protocol

When picking this up in a new session:

1. Read this entire handover doc first.
2. Re-read the spec at `docs/superpowers/specs/2026-05-28-saved-views-design.md`.
3. Re-read the plan at `docs/superpowers/plans/2026-05-28-saved-views.md` for the relevant phase.
4. Confirm `git log --oneline -15` matches the "Active branch state" section above.
5. Confirm `cd backend && go build ./... && go test ./internal/savedviews/...` is clean.
6. Pick up at Task 12, following the dispatch-to-subagent pattern used for Tasks 1-11.
7. Commit cadence: each task = one commit, with the message wording the plan suggests.

The plan itself is the source of truth. This handover is the state-restoration aid.
