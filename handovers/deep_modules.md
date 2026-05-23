# Agent Handover — Deep Modules (PLA-0058)

**Date:** 2026-05-23
**Branch:** `main`
**Last commit:** `7169b879` — `feat(objecttreev2): filter-chip scope facets [solo-dev] [OBJ1]` (pre-session; nothing committed this session)
**Plan:** [PLA-0058 on /dev/reporting → Plan tab](http://localhost:5100/_site/admin/dev/reporting/PLA058)
**Scope theme:** [`RF2. Service Depth (PLA-0058)`](../Vector_Scope.md) — 13 stories, 7 phases, all `[P2] 🔵 IN FLIGHT`
**Status:** **Planning phase only — no code touched yet.** Plan filed, stories grilled to 95% confidence, scope written, refs registered. Phase 1 implementation is blocked behind RF2.0.1 stop-gate (user review of pattern doc).

> **Read-before-acting:** this handover describes a planning artefact ready to convert into code. The 13 RF2 stories are storified but `⏳` on Phase 0. **Do NOT start Phase 1 work** until RF2.0.1 in `Vector_Scope.md` flips from `⏳` to `✅ CLEARED` — the user must confirm the pattern doc before any change lands in `backend/internal/artefactitems/`. Mirrors RF1.0.3 precedent.

---

## What this session was for

Answer the question *"are we close to deep modules?"* honestly, then convert the honest answer into actionable work.

The Ousterhout *Philosophy of Software Design* lens was applied to Vector. Verdict: **6.5/10** — pockets of real depth (auth session lifecycle, `PatchWorkItem` cascade, hooks like `useStepUpAction`) inside an otherwise CRUD-shaped service layer. Worst offender: `backend/internal/artefactitems` — 1929 LoC service.go, 1167 LoC handler.go, 17 exported operations + 4 setters, 1 pass-through pair, 2 `hasWorkspace` handler branches.

Plan: collapse to **8 cohesive operation families + 4 setters = 12 public methods**. Behaviour-preserving: zero wire contract changes, zero SQL changes, zero schema changes. Pattern proves itself before any other service adopts.

This is the planning + storification + scope-write artefact. Code work happens in the next session.

### Ousterhout references (for the pattern doc)

The pattern doc in RF2.0.1 should cite the source — these are the chapters that directly back each design decision in PLA-0058. Citing them gives the pattern doc audit weight and gives the user concrete pages to push back on.

- **Ch. 4 *Modules Should Be Deep*** — the central thesis. `cost = interface − functionality`; depth maximises the ratio. Directly underwrites the "narrow the service contract" framing in PLA058 Approach. Page-equivalent: the *Red Flag: Shallow Module* sidebar applies almost verbatim to `GetWorkItem` / `GetWorkItemInWorkspace`.
- **Ch. 5 *Information Hiding (and Leakage)*** — the *secret* a module hides is what makes it deep. Justifies absorbing the workspace-clamp decision and the single-vs-list discriminator inside `Service.Read` instead of leaving them on the handler boundary. Also underwrites the "no JSON tags on operation structs" rule in RF2.1.1 (the operation-input types are an internal secret, not a wire contract).
- **Ch. 6 *General-Purpose Modules are Deeper*** — argues for slightly more general interfaces. Backs the `ReadQuery{ID, WorkspaceID, Filters}` shape vs three named methods. Also informs the *Mutation* tagged-union design (Story 7) — though with the **counter-caveat from Ch. 9 (below)** that over-generalising into a god-input is the inverse failure mode.
- **Ch. 7 *Different Layer, Different Abstraction*** — names the *pass-through method* anti-pattern. This is the chapter that makes `GetWorkItem` / `GetWorkItemInWorkspace` a textbook smell, not an opinion. Cite this directly when the user pushes back on "but the existing pair is fine."
- **Ch. 9 *Better Together or Better Apart?*** — the cohesion test. This is the chapter that resolved the Story 4 and Story 5 blockers during grilling: `ListChildren` + `ListAncestors` cohere ("share information, used together, overlap conceptually") but `ListFlowStates` fails on all three tests. Same logic split SummariseWorkItems+Facets from SummariseRisks. **The grilled-agent recommendations for blockers 1 and 2 are direct applications of this chapter's heuristics.**
- **Ch. 10 *Define Errors Out of Existence*** — informs the `ErrInvalidInput` sentinel on the new operations: invalid combos are the *only* error path, not a sprawl of per-method error types. Caller branches on one sentinel, not five.
- **Ch. 19 *Software Trends* — Object-Oriented Programming and Inheritance** — the section on *classitis* (too many small classes, each shallow) is the diagnosis of the current 17-method state. Use this framing when explaining why the pattern matters to a non-CS-trained reader.

**Counter-citations to acknowledge in the pattern doc** (so it's not dogma):
- Ousterhout argues against splitting based on *temporal decomposition* (Ch. 9). Vector's existing handler→service→sql split is justified by *information hiding* (different layers hide different secrets — HTTP transport, business logic, SQL constants), not by *when* things happen, so the layering survives the audit. The pattern doc should make this distinction explicit so a future reader doesn't read "Ousterhout hates layers" into the doc.
- Ch. 6's general-purpose argument has a known failure mode (god-input structs). PLA-0058 Risk #2 names this; the pattern doc must too. The ≤6-field rule on operation structs + nullable-as-pointer convention are the guardrails.

---

## File map — what got produced this session

### Plan artefact (DB-backed, viewable on /dev/reporting)
- **PLA058** in `mmff_dev.dev_reports` — full plan with Synopsis · Problem · Approach · Areas Impacted · Implementation Steps · Proposed Stories · Risks · Verification · Change Log. Viewable at `/dev/reporting → Plan tab`. Revised mid-session (Change Log has 2 entries) after the grilling pass surfaced 3 design blockers.

### Scope file changes
- [Vector_Scope.md](../Vector_Scope.md):
  - **TOC** (line ~18) — new entry: `- [RF2. Service Depth (PLA-0058)](#rf2-service-depth-pla-0058) 🔵 IN FLIGHT`
  - **Header** — `Last updated` extended with RF2 prepend; `Doc version` 2.52 → 2.53.
  - **RF2 section body** (~line 266, after RF1 separator, before FLOW1) — new top-level theme with 13 sub-stories across phases RF2.0 → RF2.6. All `[P2]` and `🔵 IN FLIGHT` except RF2.0.1 which is `⏳` (stop-gate pending).
- [.claude/scope-refs.map](../.claude/scope-refs.map) — 13 RF2.X.Y lines appended at the end (one per story). Commit-hook will route any commit message containing `[RF2.2.1]` etc. to the right scope line.

### Grilled story artefacts (transient, in /tmp; not committed)
- `/tmp/pla058.json` — initial plan POST body.
- `/tmp/pla058_v2.json` — revised plan POST body (post-grilling, post-blocker-resolution).
- 13 parallel Opus sub-agent outputs — full JSONL transcripts of the grilling pass. Each is the complete agent conversation including tool calls, file reads, and the final grilled-story JSON. **Do not `Read` these directly — they are large enough to overflow context.** Quote from the chat transcript instead. If you need a specific story's deep rationale, use `Bash` with `tail`/`grep` on the file, not `Read`. Paths:
  - Story 1 (pattern doc + stop-gate): `/private/tmp/claude-501/-Users-rick-Documents-MMFFDev---Projects-MMFFDev---Vector/5347c18f-7eaa-46d9-905a-661015ba65ad/tasks/a1dc574c0e03b27cb.output`
  - Story 2 (declare types): `…/tasks/a6699ca1308eae9ed.output`
  - Story 3 (Service.Read): `…/tasks/a2510f2a488bfdc33.output`
  - Story 4 (Service.Lookup — flagged blocker): `…/tasks/a7a4c4f9a058341e8.output`
  - Story 5 (Service.Summarise — flagged blocker): `…/tasks/af99bf029016ab343.output`
  - Story 6 (Service.Fields): `…/tasks/a13ec7ceb4fb81527.output`
  - Story 7 (Service.Mutate — weakest family caveat): `…/tasks/ace4ed701cd9107bb.output`
  - Story 8 (cutover read-family): `…/tasks/aac30a3de9175960a.output`
  - Story 9 (cutover MUTATE): `…/tasks/a3a7b3c812073abfe.output`
  - Story 10 (cutover BULK/FIELDS/SUMMARY): `…/tasks/adfdf0d4f8eff571e.output`
  - Story 11 (deprecate + lint — flagged cross-pkg): `…/tasks/a2c6ea5ae672570a4.output`
  - Story 12 (delete deprecated): `…/tasks/a7eea9af9b4bb5f3c.output`
  - Story 13 (metrics + TD follow-up): `…/tasks/a3dae1613e0ec5a39.output`

  Common prefix: `/private/tmp/claude-501/-Users-rick-Documents-MMFFDev---Projects-MMFFDev---Vector/5347c18f-7eaa-46d9-905a-661015ba65ad/tasks/`. **These are session-scoped — `/private/tmp/` is purged on macOS reboot and on the harness's GC sweep.** If they vanish, the grilled-story JSON is still embedded in PLA-0058's chat transcript (`context/transcripts/2026-05-23.md` if it exists) — search by story title or the agent-ID hex.

### Not touched this session
- `backend/internal/artefactitems/*` — untouched. **Do not touch until RF2.0.1 cleared.**
- `docs/c_c_service_depth_pattern.md` — does not exist yet. Story RF2.0.1 is to create it.
- `docs/c_tech_debt.md` — `TD-SVC-DEPTH-PATTERN` placeholder not added yet (Story RF2.0.1 reserves the slot; Story RF2.6.1 fills it).
- `CLAUDE.md` — pattern-doc pointer line not added yet (also RF2.0.1).
- Working tree dirty entries are all **pre-session** drift unrelated to this work (OBJ1 chip work, auth middleware, NavigationPie, etc.) — do not bundle them with the deep-modules commits when those start.

---

## What is DONE this session

1. **Ousterhout depth audit performed** — Explore subagent surveyed backend services + frontend hooks + shared primitives + pass-through smells + information-hiding wins. Verdict 6.5/10 with three deep-module exemplars named (`auth.Service`, `Service.PatchWorkItem` cascade, `useStepUpAction`/`useColumnResize`) and the artefactitems CRUD sprawl identified as the single biggest lever.

2. **Plan filed as PLA-058** — POSTed to `/_site/admin/dev/reporting/`. Two versions exist (Change Log captures the diff): initial v1, then v2 after grilling resolved blockers.

3. **13 stories grilled to 95% confidence in parallel** — 13 Opus sub-agents spawned (one per story, `run_in_background: true`). Each agent: read /tmp/pla058.json, opened the relevant service.go / handler.go lines, sharpened AC to file-line precision, flagged blockers honestly. Final confidence scores: 9 stories at 95+ (1, 2, 3, 6, 8, 9, 10, 11, 13), 1 at 96 (6), 1 caveat at 82 (7 — Mutate weakest family), 2 blockers at 70/78 (4, 5 — grouping rethink needed).

4. **3 design blockers resolved before storification** (taking grilled-agent recommendations):
   - **Lookup** = Children + Ancestors only. `ListFlowStates` folds into `Service.Read` as a `Kind=FlowStates` variant — it's type-metadata, not tree-walk.
   - **Summarise** = SummariseWorkItems + ListFacets (the ~40-LoC clamp-boilerplate cohesive pair). `SummariseRisks` stays as its own narrow method — shares only the English word "summary."
   - **Story 11 lint** widened to scan all of `backend/` — cross-package callers exist in `backend/internal/featuretests/f1_workspace_clamp_test.go` L400 (ListWorkItems) + L448 (GetWorkItemInWorkspace). Story 12 must cut those over BEFORE the delete PR.

5. **Final service shape decided** — 8 ops + 4 setters = 12 public methods (was targeting 11; SummariseRisks survives the cull because its grouping was forced). Documented in PLA058 Approach section.

6. **Scope file updated** — RF2 theme block written between RF1 (`✅ DONE`) and FLOW1. TOC updated. Doc version bumped. 13 refs registered in scope-refs.map.

---

## Where to pick up next (priority order)

### P1 — Resolve the stop-gate before any code

**RF2.0.1** is currently `⏳`. Next agent's first job:

1. Draft `docs/c_c_service_depth_pattern.md` per the AC in RF2.0.1 (≤400 lines, 7 named sections: Why deep services · Operation-family shape · Rules · Target signatures for artefactitems · Anti-patterns · When NOT to apply · Revision trigger). Include the `## Results` section as an empty placeholder (Story RF2.6.1 fills it). Open with the status banner: `> **Status:** Hypothesis — frozen until RF2.0.1 cleared; revisit after PLA-0058 Phase 2.`
2. Add CLAUDE.md one-line pointer matching authoring convention: `- **Service depth pattern (PLA-0058)** → [\`docs/c_c_service_depth_pattern.md\`](../docs/c_c_service_depth_pattern.md) — operation-family shape; required reading before adding a public service method.`
3. Reserve `TD-SVC-DEPTH-PATTERN` placeholder line in `docs/c_tech_debt.md` (S3, status: `pending — opened by PLA-0058 Phase 6`).
4. Present the doc to the user with a numbered review checklist (3-5 yes/no questions per the grilling AC) so they can confirm by number, mirroring the RF1.0.3 "5 review points" pattern.
5. On confirmation: flip RF2.0.1 line in `Vector_Scope.md` from `⏳` to `✅ ~~Write c_c_service_depth_pattern.md...~~ **CLEARED YYYY-MM-DD** — Rick confirmed [list].`
6. **Only then** start Phase 1.

### P2 — Phase 1 (after stop-gate clears)

**RF2.1.1** — Declare 5 input structs in new `backend/internal/artefactitems/operations.go`. Specifications captured in grilled-story #2 transcript. Commit message must flag "dead code until Phase 2."

### P3 — Phases 2–6 (sequential, story-by-story)

Follow RF2.2.1 → RF2.6.1 in order. Each story is a single commit. Don't bundle phases. Each commit message tagged `[RF2.X.Y]` so the scope-commit-note hook routes correctly.

---

## Known caveats

- **The 14-method deprecate-then-delete list (Phase 4/5) is approximate.** Exact survivor count depends on what stories 3-7 actually absorb. Grilling assumed: `ListWorkItems`, `GetWorkItem`, `GetWorkItemInWorkspace`, `ListChildren`, `ListAncestors`, `ListFlowStates`, `SummariseWorkItems`, `CreateWorkItem`, `PatchWorkItem`, `ListFieldValues`, `UpsertFieldValue`, `UpsertFieldValues`, `DeleteFieldValue`, `ListFacets` = 14 deprecated. `ArchiveWorkItem` and `BulkOps` keep their names. `SummariseRisks` survives the cull (NOT deprecated) per blocker-2 resolution. **Recount before Phase 4 actually marks methods.**
- **Cross-package callers in `featuretests/f1_workspace_clamp_test.go`** at L400 + L448. Story 11's lint must scan ALL of `backend/` (not just artefactitems). Story 12 must cut those callers over BEFORE the delete PR. **Do not skip the cross-package sweep.**
- **`PatchWorkItem` is the deep-module exemplar — DO NOT inline it into `Service.Mutate`.** The Mutate dispatcher must stay ≤25 LoC including switch + nil-checks. Cascade, snapshot, rule-firing, touched-ids sink all live INSIDE PatchWorkItem. The pattern doc flags Mutate as the **weakest** of the 7 families with an explicit "if a future contributor starts pulling impl up, split it back" review rule.
- **`ByIDs`, `Facets`, `ListChildren`, `ListAncestors` have NO handler test coverage.** Manual smoke is the only safety net. Phase 3 Story 8 should either add handler tests inline OR file `TD-SVC-DEPTH-READ-COVERAGE S2` if deferred.
- **`recalc_test.go` × 7 cascade tests are the cascade contract.** Story 9 (MUTATE cutover) must run them byte-identically against `Service.Mutate` — if any of these regress, revert.
- **Wire contracts MUST NOT change.** Capture curl output for every endpoint listed in PLA058 Verification block BEFORE Story 8 starts. Diff after Story 12. Procurement-evidence neutral per `c_security.md` Trust-No-One bar.
- **No wire/SQL/schema/auth/audit-log changes anywhere in this plan.** Each PR description must state this explicitly so the defence/finance audit reviewer sees the scope cap.
- **Solo-dev WIP cap = 5 active themes.** Pre-session: 2 active (FLOW1, F1). RF2 brings it to 3. **2 slots still free.** Do not start a fourth concurrent theme without checking the cap.
- **Working tree is dirty pre-session.** OBJ1 chip work + middleware + NavigationPie + others are unrelated to this handover. **Do not bundle them with RF2 commits.** Per CLAUDE.md HARD RULE: run `git diff --cached --stat` before every commit and unstage anything off-topic.

---

## How to verify

1. **Plan exists:** `curl -s -H "Authorization: Bearer $DEV_API_KEY" http://localhost:5100/_site/admin/dev/reporting/PLA058 | jq -r '.id, .title'` → `PLA058` + title.
2. **Scope theme exists:** `grep -n "## RF2\." Vector_Scope.md` → one hit at ~line 270 (`## RF2. Service Depth (PLA-0058)`).
3. **TOC entry exists:** `grep -n "RF2. Service Depth" Vector_Scope.md` → two hits (TOC + section header).
4. **13 refs registered:** `grep -cE '^RF2\.' .claude/scope-refs.map` → `13`.
5. **Stop-gate honoured:** `grep -n "RF2.0.1" Vector_Scope.md` → line begins with `⏳` (pending). **If it begins with `✅`, Phase 1 is unlocked.**
6. **No code touched yet:** `git diff backend/internal/artefactitems/` → empty.
7. **No new doc files yet:** `ls docs/c_c_service_depth_pattern.md 2>&1` → "No such file or directory."

---

## Open design questions

- **Should `ListFacets` fold into `Service.Read` (as a `Kind=Facets` projection) or `Service.Summarise` (as a sibling of WorkItems aggregation)?** Resolved during grilling → **Summarise** (cohesive ~40-LoC clamp boilerplate with SummariseWorkItems). Documented in PLA058 Change Log. Reconsider only if Phase 2 implementation shows the grouping doesn't hold.
- **`Service.Mutate` dispatcher pattern — is the `Mutation{Kind, ID, Create:*..., Patch:*...}` tagged-union ergonomic at the handler call site?** Grilling flagged this as the weakest family (confidence 82). If Phase 3 Story 9 cutover proves the call-site verbosity is worse than the named-method version, **split it back to `Create` + `Patch`** and document the regression in the pattern doc's `Revision trigger` section. Do not silently keep Mutate if it hurts.
- **Should the lint from Story 11 be repurposed as a permanent guard after Story 12, or deleted?** Grilled-story #12 recommends **repurpose as a guard** (forbids any caller of the old names anywhere) — keeps the surface from regrowing under a revert attempt. Phase 5 AC includes this. Confirm with user before Story 12 ships.
- **Adopt order for next services after PLA-0058 ships:** ranked candidates are `workspaces` (14 methods, strongest fit) then `users` (13 methods, watch auth coupling). Filed in Story 13's TD entry. **Per the cap-now/pay-down-on-trigger discipline, do NOT schedule a sweep** — adopt when each service is next substantially touched. Story 13 records this.

---

## Commits in scope

None yet — this session was planning-only. The 13 commits will accrue as Phases 1–6 land, each tagged `[RF2.X.Y]` so the scope-commit-note hook routes correctly.

Pre-session commits relevant to context (do not re-attribute):
- `7169b879` (2026-05-23) — `feat(objecttreev2): filter-chip scope facets [solo-dev] [OBJ1]` (OBJ1 work, unrelated)
- `52f74f66` (2026-05-23) — `feat(skills): <report> -p — offline planning report + handover cross-ref` (the `-p` skill used to file PLA058)
- `e5c0b690` (2026-05-23) — `docs(handover): agent_visual_app — Visualiser V1/V2 handover doc` (sibling handover, different surface)

---

**Last updated:** 2026-05-23 — added grilling transcript paths (13 sub-agent JSONL files) and Ousterhout chapter references (Ch. 4, 5, 6, 7, 9, 10, 19) for the RF2.0.1 pattern doc.
**Authored:** 2026-05-23 by Claude. If anything in this doc contradicts the code, trust the code and patch this file.
