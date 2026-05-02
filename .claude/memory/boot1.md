---
name: Session bootup — PLA-0006 Topology MVP storification (24 cards 00267–00290)
description: Load when resuming after a break. Branch, story counter, what's committed, what's uncommitted, what's next.
type: project
originSessionId: 1aeaf35c-7bd9-45b9-b315-445dbe4c69b6
---
## Current state (last updated: 2026-05-02)

**Active branch:** `studio-stream001`
**Story index last issued:** `00290`
**Phase:** PH-0005 (active phase per `docs/c_story_index.md`); PLA-0006 stories carry PH-0006 label

---

## Planka card states

**In progress / Doing:**
- None — all 24 PLA-0006 stories sit in Backlog awaiting first execution pull.

**Completed (committed, move to Completed in Planka):**
- None this turn — last commit `7fd5355` shipped PLA-0004 + PLA-0005 work and predates this session's storification.

**Parked:**
- Phase X cuts in PLA-0006 (re-delegation depth ≥2, multi-admin per node, archive cascade semantics, drop-on-canvas detach-to-root, matrix orgs, org versioning, EA overlays) — explicitly out of MVP, no cards.

---

## Uncommitted on branch

Pre-existing branch state (carried in from before this session):
- `M .claude/CLAUDE.md` — pointers added for PLA-0005/PLA-0006 docs.
- `M docs/c_feature_areas.md` — registry rows for FE-SQL-0012, FE-API-0018, FE-SEC-0006, FE-UI-0006, FE-ALG-0001, FE-DEV-0008, FE-UX-0001, FE-AUD-0002, FE-GOV-0002 (this session).
- `M docs/c_story_index.md` — `Last issued: 00290` (this session).
- `M dev/plans/PLA-0005.json` — addressables plan body.
- New file `dev/plans/PLA-0006.json` — Topology MVP plan; this session populated `work_item_backlog` (24 rows) + AC `story_ids`/`card_urls` back-links + `date_last_updated: 2026-05-02`.
- New `docs/c_c_topology.md` and `docs/c_c_diagram_canvas.md` leaf docs (referenced from CLAUDE.md).
- Many untracked addressables-substrate files (db/schema/074–081, app/components/Address*, app/components/Panel/Table/Header/Navigation, backend/internal/addressables/, dev/scripts/lint_addressables.py, dev/registries/addressables_exempt.json) — all PLA-0005 work.
- Multiple `dev/research/R022.json` … `R029.json` newly added papers.
- Launcher swift files modified plus new `MMFF Vector Launcher/LockRegistry.swift`.
- Top-level `Sec Audit/` and `audits/` directories untracked.
- Deleted: `audit/security_sensitive_data_20260425.md`, `backend/internal/panehelp/*`, `dev/pages/DevPaneHelpPanel.tsx` (pane-help superseded by addressables).

---

## What shipped this session

- **`<stories>` 7-gate run for PLA-0006** — 24 cards created in Planka Backlog, IDs 00267 → 00290, all 8 mandatory labels each, Step 5c verification passed zero-defect.
- **9 new feature-area labels** created in Planka and registered in `docs/c_feature_areas.md`:
  - `FE-SQL-0012` `1765963189826095005` — org_nodes/roles/view_state/FK
  - `FE-API-0018` `1765963191738697630` — orgdesign.Service + REST surface
  - `FE-SEC-0006` `1765963194758596512` — clamp predicate middleware
  - `FE-UI-0006`  `1765963197887547298` — `<DiagramCanvas>` + /topology surfaces
  - `FE-ALG-0001` `1765963200714508196` — dagre Web Worker + d3-zoom
  - `FE-DEV-0008` `1765963203155593126` — stress harness + leaf docs
  - `FE-UX-0001`  `1765963206578145192` — empty state + preview modal + handoff inbox
  - `FE-AUD-0002` `1765963209455437738` — Topology mutation audit
  - `FE-GOV-0002` `1765963211997185964` — federated handoff governance
- **`docs/c_story_index.md`** bumped from `00266` to `00290`.
- **`dev/plans/PLA-0006.json`** populated with `work_item_backlog` (24 rows: order, story_id, title, card_id, card_url, status=todo) and AC array enriched with `story_ids`/`card_urls` back-links per AC (12 ACs covering 21 of 24 stories; 00287/00289/00290 are non-AC enabling work).
- **Mid-session duplicate-card cleanup** — second accidental run of `/tmp/create_pla_0006_stories.py` created 24 dupes; deleted via `./planka delete-card` driven by Python loop. Canonical first-run cards preserved (IDs `1765964863…` to `1765965284…`).

---

## Recent commits

```
7fd5355 Land PLA-0004 pane help system + PLA-0005 addressables plan + sweep work
94b4d3e Add MBP17 onboarding snippet to README
1492398 Untrack launcher build artifacts (.app, .xcodeproj, Info.plist)
055676a Track built launcher app, .xcodeproj, and generated Info.plist
66660fd Trim .gitignore launcher entries
dfa1a95 Add xcodegen build pipeline for MMFF Vector Launcher
513b3c2 Fix Paths.swift fallback to canonical repo path
1cf9f3f Sync launcher reorg from MBP17
```

---

## What's next

1. **Pick top of PLA-0006 backlog** — story `00267` (Migration: org_nodes table, FE-SQL-0012/F5/MED). On approval, move card Backlog → To Do, then To Do → Doing on first edit.
2. **Schema migrations 00267 → 00270** — sequence org_nodes, org_node_roles, org_node_view_state, then the two-phase backfill FK migration on portfolio_items + user_stories. Hard step: phase-2 NOT NULL switch needs zero null org_node_id rows.
3. **`orgdesign.Service` Go module (00271)** — sole-writer pattern; mirrors addressables.Service / entityrefs service shape. Cycle-checked MoveNode is the expensive bit.
4. **`<DiagramCanvas>` primitive (00274 / 00275 / 00276 / 00277)** — Canvas2D + dagre Web Worker + d3-zoom + 10px snap; 3,000-node Lloyds stress harness (00277) is the CI gate.
5. **Tip:** before merging the existing branch state, decide whether the 50+ uncommitted PLA-0005 addressables files should be split off into their own commit/PR — they're a large surface that will collide with PLA-0006 schema work.

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
- **Planka helper script:** `./.claude/bin/planka` is the SOLE entry point for board reads/writes — never use curl directly. Subcommands: `create-card`, `label-card`, `move-card`, `update-card`, `delete-card`, `create-label`, `delete-label`, `board`, `comment`, `unlabel-card`, `verify-labels`. There is no `labels` subcommand — use `./planka board | jq` for label lookups.
- **Stories skill non-idempotency:** `/tmp/create_pla_0006_stories.py` and similar driver scripts re-create all cards on every run. NEVER re-run after a successful first pass — duplicates require manual `./planka delete-card` cleanup.
- **PLA-0006 canonical card IDs** stored at `/tmp/pla_0006_canonical.json` (sid → card_id → title) — survives in /tmp until reboot.
- **Active backend env:** `dev` (set 2026-05-02 07:41) — DB tunnel at `localhost:5435`, env file `backend/.env.dev`.
- **PLA-0006 MVP cuts (Phase X):** padmin re-delegation (schema-only `can_redelegate` flag), multi-admin per node, archive cascade semantics, drop-on-canvas detach-to-root, matrix orgs, org versioning, EA overlays — all explicitly out of MVP. Don't propose stories for these.
- **Topology naming:** page is `<tenant>: Topology` (e.g. `MMFFDev: Topology`); default node noun is `Office` (overrideable per node).
- **Samantha SDK exposure:** `<DiagramCanvas>` ships behind `samantha.diagram.canvas` v1 — story 00285 is the gate for any custom-app developer access.
- **Addressables substrate (PLA-0005):** sits uncommitted on this branch and is a prerequisite of story 00286 (addressables adoption on /topology).
