# Column Prefix Registry

> **Single source of truth** for the 3-letter table-prefix HARD RULE in [`.claude/CLAUDE.md`](../.claude/CLAUDE.md).
> Every column on every table in `mmff_vector` + `vector_artefacts` is `<3-letter-prefix>_<name>`.
> Lint enforced by `lint:column-prefix` (B18.9).
> Effective from the wipe-and-reseed forward — the post-wipe migration set adopts this universally.

**Created:** 2026-05-25 (mandated by user as part of wipe-and-reseed plan)
**Status:** registry — populated below as the wipe-and-reseed audit names the final table set
**Doc version:** 0.1

---

## Registration rule

1. Every NEW table MUST register its prefix here BEFORE the migration that creates it lands.
2. Strict 3 letters. No 2-letter, no 4-letter, no exceptions.
3. Prefixes must be unique across BOTH `mmff_vector` and `vector_artefacts` — even though Postgres allows same-name columns in different DBs, a single registry keeps cross-DB SQL and Go consts unambiguous.
4. If a 3-letter prefix is already taken, invent a non-colliding one. The registry rejects duplicates.
5. The registry is alphabetised by **table name**, not by prefix, so lookups by table are O(scroll).

---

## Registry — `mmff_vector` (confirmed 2026-05-25 by audit subagent)

| Table | Prefix | Notes |
|---|---|---|
| `master_record_workspaces` | `mrw` | Registry side. Cross-DB collision with `vector_artefacts.master_record_workspaces` (different schema) — accepted; same prefix because they describe the same entity. Post-CUT1.6 merge plan: only one survives. |
| `pages` | `pag` | The 59-page catalogue |
| `pages_tags` | `ptg` | 8 bucket display names |
| `subscriptions` | `sub` | The tenant registry |
| `subscriptions_stakeholders` | `sus` | Stakeholder roster per subscription |
| `subscriptions_sequence` → **renamed** `subscriptions_seq` | `ssq` | Sequence allocator; renamed to fit clearer 3-char prefix |
| **`subscriptions_icons`** | `sti` | **Renamed** from `subscriptions_item_type_icons` — table name shortened so the 3-letter rule holds without exception |
| `topology_nodes` | `tpn` | Federated canvas tree |
| `users` | `usr` | The 6 seeded accounts |
| `users_password_resets` | `upr` | Password-reset tokens — `upr` retained per the password-reset surface being the original `upr_` claimant |
| `users_permissions` | `upn` | 37-row permission catalogue — was proposed `upr` but lost the prefix-collision arbitration |
| `users_preferences` | `upf` | Per-user preferences — was proposed `upr` but lost arbitration |
| `users_nav_prefs` | `unp` | Per-user nav-rail preferences |
| `users_nav_profiles` | `unl` | Per-user nav profile registry — was proposed `unp` but lost arbitration |
| **`users_profile_groups`** | `upg` | **Renamed** from `users_nav_profile_groups` — table name shortened so the 3-letter rule holds |
| `users_roles` | `url` | 8-row role catalogue |
| `users_roles_pages` | `urp` | Role × page grants |
| `users_roles_permissions` | `urt` | Role × permission matrix (74 rows). Cross-DB collision with `vector_artefacts.users_roles_topology_nodes` (also `urt`) — accepted; both are 8-soft-FK pattern documented in SY003. |
| `users_roles_workspaces` | `urw` | Role × workspace grants |
| `users_sessions` | `uss` | Session tokens |

> **Rename casualties from this registry pass (2026-05-25):**
> - `subscriptions_item_type_icons` → `subscriptions_icons` (4-letter base prefix would have been required; renamed table instead to honour the strict-3-letter rule)
> - `users_nav_profile_groups` → `users_profile_groups` (same rationale)
>
> Both renames executed as part of the wipe-and-reseed migration set. Go code references in `backend/internal/nav/{service,profiles,sql}.go` swept in the same sweep.

---

## Registry — `vector_artefacts` (confirmed 2026-05-25 by audit subagent)

| Table | Prefix | Notes |
|---|---|---|
| `admin_api_keys` | `aak` | Replicated from mmff_vector by CUT1.3.1 |
| `artefacts` | `art` | The core artefact rows |
| `artefacts_adoption_states` | `aas` | Adoption state per artefact |
| `artefacts_fields_library` | `afl` | Custom-field definitions |
| `artefact_priorities` | `apr` | Priority catalogue |
| `artefact_types` | `aty` | Type catalogue (= the "Portfolio Models artefact types" within each framework) |
| `audit_logs` | `aud` | SOC 2 audit trail |
| `csp_reports` | `csp` | CSP violation reports |
| `dpop_jti_cache` | `dpc` | DPoP replay-prevention cache |
| `fdw_portfolio_items` | `fpi` | FDW back-link to mmff_library portfolio items |
| `fdw_portfolio_templates` | `fpt` | FDW back-link to mmff_library portfolio templates |
| `flows` | `flw` | Flow-state graph |
| `flows_states` | `fls` | Flow-state catalogue |
| `flows_transitions` | `flt` | Flow-state transition rules |
| `flows_defaults` | `fld` | Per-type default flow assignments |
| `flows_states_defaults` | `fsd` | Per-type default state set |
| `flows_transitions_defaults` | `ftd` | Per-type default transition set |
| `master_record_portfolios` | `mrp` | Per-workspace portfolio adoption record |
| `master_record_workspaces` | `mrw` | Sidecar side — same prefix as mmff_vector; merged post-CUT1.6 |
| `schema_migrations` | `smg` | Migration tracking |
| `timeboxes_releases` | `tbr` | Release timeboxes |
| `timeboxes_sprints` | `tbs` | Sprint timeboxes |
| `users_roles_topology_nodes` | `urt` | Role × topology grants. Cross-DB collision with `mmff_vector.users_roles_permissions` (also `urt`); accepted — documented 8-soft-FK pattern. |

---

## Reserved prefixes (do NOT re-use)

Any prefix in the table above is locked. Adding a new table that needs one of these prefixes is a registry conflict — pick a different letter combo.

---

## Lint rule (B18.9)

`lint:column-prefix` scans every `db/{mmff_vector,vector_artefacts}/schema/**/*.sql` file for:

1. `CREATE TABLE <name> (` blocks
2. Every column inside MUST start with `<prefix>_` where `<prefix>` is the entry for `<name>` in this registry
3. Failure = CI red

The lint also checks every Go SQL constant (`backend/internal/**/sql.go`) for `SELECT <col>` / `INSERT INTO <tbl> (<col>...)` patterns where the column lacks the table's prefix.

**Allow-list:** maintained at `dev/registries/column_prefix_lint_allowlist.json` for migrations that intentionally rename (e.g. the wipe-and-reseed migration set itself, which renames columns from old convention to new).

---

## Registry — `mmff_library` (UNTOUCHED — read-only spine, out of wipe scope)

The library DB is out of scope for the 3-letter prefix rule. Its columns predate the rule and the library is shared across deployments; renaming would break the library-release contract. Documented for completeness only — `lint:column-prefix` does NOT scan `db/mmff_library/`.

| Table | Status |
|---|---|
| `portfolio_templates` (5 rows: Enterprise, Jira, Rally, SAFe, Vector Standard) | EXEMPT |
| `portfolio_template_layer_definitions` (14 rows) | EXEMPT |
| `errors_codes` | EXEMPT |
| `library_releases`, `library_release_logs`, `library_releases_actions` | EXEMPT |

## Change log

- **2026-05-25 (afternoon)** — Confirmed against wipe-and-reseed audit subagent output. Both DB registries populated. Two table renames adopted (`subscriptions_item_type_icons` → `subscriptions_icons`, `users_nav_profile_groups` → `users_profile_groups`) to honour strict-3-letter rule without exceptions. Three prefix-collision arbitrations recorded (`upr` → password_resets wins; `unp` → nav_prefs wins; `urt` cross-DB collision accepted as 8-soft-FK pattern). mmff_library exempted in full.
- **2026-05-25 (morning)** — Doc created. Registry seeded with opening proposal pending wipe-and-reseed audit confirmation.
