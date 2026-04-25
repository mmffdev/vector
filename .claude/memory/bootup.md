---
name: Session bootup prompt
description: Read at the start of every session to restore full working context — branch, what's done, what's next, key facts
type: project
originSessionId: bbf83995-114e-4228-9963-88c777ddc53b
---
## Project: MMFFDev — Vector (PM tool)

**Repo:** `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM`
**Active branch:** `feat/migration-017-subscriptions-rename`
**Main branch:** `main`

---

## What was just completed (session 2026-04-25)

### Graph engine — built, deployed, then unwired

Standalone, reusable graph engine at `app/lib/graph-engine/`:
- `types.ts` — pure TS types (`Graph`, `LaidOutGraph`, `LayoutFn`, `InteractionConfig`).
- `layout/hierarchy.ts` + `layout/index.ts` — top-down tree layout with square L-routing, `levels` shorthand, marks leaf edges as `kind: "story"`. Registry: `layoutByName`.
- `view/{Node,Edges,GraphCanvas}.tsx` — DOM-positioned nodes + SVG edge overlay. Markers `orient="0"` so arrowheads stay vertical.
- `interactions/{drag,hover,index}.ts` — flag-gated scaffolds, no-op when `enabled: false`.
- `graph-engine.css` — dedicated stylesheet, `.ge-` prefix, no border-radius, leaf nodes red border.

Stories `00025–00029` (FE-SEC0004) all moved to Completed. Engine kept in repo for later reuse.

### ModelHierarchyAccordion — removed

User decision: drop the accordion system, keep the engine for later reuse.
- Deleted `app/(user)/portfolio-model/ModelHierarchyAccordion.tsx`.
- Removed import + JSX usage from `WizardModelCardList.tsx`.
- Stripped dead CSS from `app/globals.css` (lines ~3047–3265: `.model-hierarchy-accordion__*`, `@keyframes accordionExpand`, `.hierarchy-tree__*`).
- `.layer-hierarchy*` rules **retained** — still used by `WizardModelCardList` cards + `LayerHierarchyDiagram.tsx`.

Typecheck clean after removal.

### Skill + label hardening

- `~/.claude/skills/storify/SKILL.md` — hard rule + BLOCKING Step 0 + verification script in Step 3c. Catches missing `NNNNN —` prefix, `PH-NNNN`, `FE-SECNNNN`, `storify` label.
- New feature label: `FE-SEC0004 — Graph engine (reusable hierarchy / data-view rendering)` — Planka label ID `1760908389019289311`, color tank-green.
- `docs/c_feature_labels.md` — user added parallel `FE-DEVNNNN` namespace for dev-mode tooling features.
- `docs/c_story_index.md` — last issued `00030`.

---

## What's next (parked, asked-and-paused)

**User asked, then parked:** *"we need to ensure the pages we build are browser-width friendly… we need fluid designs for all app viewports"*

Resumption plan when user picks this back up:
1. **Audit pass first** — grep for `min-width`, fixed `width: NNNpx`, `overflow-x` on top-level containers. Don't patch blindly.
2. Fix the shell (PageShell + route-group layouts) so the page never exceeds viewport.
3. Per-surface fixes (tables, wizard cards, graph canvas) — pick strategy each: stack, internal scroll, or scale.
4. Graph engine canvas uses pixel-precise absolute positioning — bound it inside a responsive scroll container, don't rewrite the layout.

Other pending work (from prior session):

| Story | Area |
|---|---|
| Schema migration 026 | `work_items` table + wire `item_state_history` FK |
| Schema migration 027 | `item_key_aliases` |
| Schema migration 028 | `config_roots` + nullable `config_root_id` (defer to enterprise tier) |

---

## Key facts

- **Two-DB architecture:** `mmff_vector` (tenant data) + `mmff_library` (MMFF-authored)
- **SSH tunnel:** `localhost:5434` → remote Postgres; `localhost:3333` → Planka
- **psql binary:** `/opt/homebrew/Cellar/libpq/18.3/bin/psql`
- **DB password:** `grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-` — contains `&`, never shell-source
- **Backend:** `go run ./cmd/server` from `backend/`, health at `:5100/healthz`
- **gadmin test account:** `gadmin@mmffdev.com` / `myApples100@`
- **secrets package:** `backend/internal/secrets` — `Encrypt/Decrypt(string, []byte)`, `ErrNotEncrypted` sentinel, `ENC[aes256gcm:<base64>]` envelope
- **secrets.Get:** transparent decrypt wrapper — reads `MASTER_KEY` env, panics on misconfiguration
- **encsecret CLI:** `go run ./cmd/encsecret -value <plaintext>` (encrypt) or `-decrypt -value 'ENC[...]'`
- **Migration tool:** `go run ./backend/cmd/migrate [-dry-run] [-db vector|library|both]`
- **Planka MCP create_card:** pass `labels[]` array at creation — curl label endpoint silently drops on E_NOT_FOUND
- **Planka card move:** PATCH needs both `listId` + `position` — see `docs/c_c_planka_rest.md`
- **Mandatory card attributes:** `NNNNN —` title prefix, `PH-NNNN`, `FE-SECNNNN`, `storify`. Storify SKILL has BLOCKING gate.
- **Graph engine:** `app/lib/graph-engine/` — DOM nodes + SVG edges, levels shorthand, leaf edges red dashed. Drag/hover scaffolded but `enabled: false`.
- **Standing rule:** never create tech debt — fix now or surface immediately

---

## Schema — next migrations planned

| Migration | Contents |
|---|---|
| 026 | `work_items` table + wire `item_state_history` FK |
| 027 | `item_key_aliases` |
| 028 | `config_roots` + nullable `config_root_id` (defer to enterprise tier) |

---

## Pending uncommitted (at session end 2026-04-25)

Modified — graph engine work + accordion removal:
- `app/(user)/layout.tsx`
- `app/(user)/portfolio-model/LayerHierarchyDiagram.tsx`
- `app/(user)/portfolio-model/WizardModelCardList.tsx` (accordion import + JSX removed)
- `app/globals.css` (dead accordion + hierarchy-tree CSS removed)
- `dev/pages/DevPage.tsx`
- `dev/planning/c_planka_cycle_handoff.md`
- `docs/c_feature_labels.md` (FE-SEC0004 added; FE-DEV namespace added)
- `docs/c_story_index.md` (last issued 00030)

Untracked — engine + supporting work:
- `app/contexts/MasterDebugContext.tsx`
- `app/lib/graph-engine/` (whole directory: types, layout, view, interactions, css)
- `audit/`
- `db/library_schema/seed/003_extra_models.sql`

Never commit:
- `backend/.env.local` (creds)
- `backend/server`, `backend/encsecret`, `backend/migrate` (compiled binaries)
- `dev/scripts/backup/`
- `portfolio-model-login-redirect.png`
- `.claude/memory/`, `.claude/worktrees/`, `.planka/`
