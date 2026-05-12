# Project lint rules

Custom lints — written in Python to mirror the existing `lint:addressables` convention — that enforce architectural invariants the type system cannot. Each lint has a paired exemption registry under `dev/registries/`; entries warn instead of fail, and the registry is the migration ledger. Exemptions are removed file-by-file as later stories land their refactors. The end state for every registry is an empty `exempt_paths` array; once empty, treat it as a hard architectural invariant.

All lints share the same shape:

- runnable as `npm run lint:<name>` (which calls `python3 dev/scripts/lint_<name>.py`)
- exit 0 = clean (or all violations exempt), exit 1 = at least one new violation
- `--report` flag writes a structured JSON to `dev/reports/` (rendered by the Dev → Reports tab)
- registry path: `dev/registries/<name>_exempt.json` with shape `{ "description": "...", "exempt_paths": [...] }`

| Rule | Source | Registry | Guards |
|---|---|---|---|
| `lint:addressables` | `dev/scripts/lint_addressables.py` | `addressables_exempt.json` | every panel-shaped element wrapped in `<Panel name="…">` (PLA-0005) |
| `lint:role-literals` | `dev/scripts/lint_role_literals.py` | `role_literals_exempt.json` | no `user.role === 'gadmin'`-style compares; use `useHasPermission(...)` (PLA-0007 / 00305) |
| `lint:writer-boundary` | `dev/scripts/lint_writer_boundary.py` | `writer_boundary_exempt.json` | writes to `roles` / `permissions` / `role_permissions` route through `internal/roles/` only; `page_addressables` writes route through `internal/addressables/` only |
| `lint:dev-css` | `dev/scripts/lint_dev_css.py` | _(no registry — hard gate)_ | zero `dev-*` / `dui-*` selectors in `app/globals.css`; zero imports of `app/globals.css` from anywhere under `dev/` (PLA-0013) |
| `lint:secondary-nav` | `dev/scripts/lint_secondary_nav.py` | `secondary_nav_exempt.json` | every `<SecondaryNavigation reorderable …>` carries a `pageId="…"` so per-user tab order can persist (PLA-0014 / 00420) |
| `lint:portfolio-library-read` | `dev/scripts/lint_portfolio_library_read.py` | `lint_portfolio_library_read_exemptions.json` | tenant-side code MUST NOT read `/api/library/`, `/api/portfolio-templates/`, or `mmff_library` outside the adoption saga + library admin surface — post-cutover invariant: tenant runtime reads `vector_artefacts` only, library is consulted once at adoption (PLA-0026 / 00512) |
| `lint:scope-literals` | `dev/scripts/lint_scope_literals.py` | `scope_literals_exempt.json` | inside `backend/internal/artefactitemsv2/`, `'work'` / `'strategy'` MUST NOT appear as SQL literals — bind via `$N` + `s.scope` (PLA-0037 / B21) |
| `lint:page-description` | `dev/scripts/lint_page_description.py` | `page_description_exempt.json` | every `page.tsx` under `app/(user)/` must render `<PageDescription>` so the helper-icon Panel + 30px bottom gap land consistently |
| `lint:h2-panel-only` | `dev/scripts/lint_h2_panel_only.py` | `h2_panel_only_exempt.json` | raw `<h2>` in `app/(user)/**/*.tsx` is forbidden — section titles must go through `<Panel title="…">` (which renders `<h2 class="panel__title">`) |
| `api:check` | `dev/scripts/check_routes.sh` + `dev/scripts/check_callers.py` | `dev/registries/dead-api-exemptions.txt` | Go chi router routes must be documented in `openapi.yaml`; frontend `api(...)` callers must reference a spec path; `apiInfra` and `apiV2` tracked but not hard-failed (PLA-0029) |

---

## `lint:role-literals` — detail

Detects binary equality / inequality (`===`, `!==`, `==`, `!=`) where one operand is a string literal in `{'gadmin', 'padmin', 'team_lead', 'user', 'external'}` and the other operand textually references `.role` (e.g. `user.role`, `currentUser?.role`, `u.role`). False positives can be parked in the exemption registry. Type-declaration files (`*.d.ts`) and line/JSDoc comments are skipped.

**Replacement contract** (per PLA-0007): every gate becomes a permission check.

```diff
- if (user.role === 'gadmin') { ... }
+ const canViewAdmin = useHasPermission('menu.admin.view');
+ if (canViewAdmin) { ... }
```

Migration playbook for each later PLA-0007 story:

1. Convert the file's gates from `.role` compares to `useHasPermission(...)` calls.
2. Remove the file's path from `dev/registries/role_literals_exempt.json`.
3. Run `npm run lint:role-literals` — must exit 0 with no new fails.

**ESLint equivalent** (for when the project migrates from `next lint` to the ESLint CLI):

```jsonc
// eslint.config.mjs
{
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        // string literal on the right
        "selector": "BinaryExpression[operator=/^(===|!==|==|!=)$/] > Literal[value=/^(gadmin|padmin|team_lead|user|external)$/] ~ MemberExpression[property.name='role']",
        "message": "Compare via useHasPermission(...) — role string literals are forbidden (PLA-0007)."
      },
      {
        // string literal on the left
        "selector": "BinaryExpression[operator=/^(===|!==|==|!=)$/] > MemberExpression[property.name='role'] ~ Literal[value=/^(gadmin|padmin|team_lead|user|external)$/]",
        "message": "Compare via useHasPermission(...) — role string literals are forbidden (PLA-0007)."
      }
    ]
  }
}
```

---

## `lint:writer-boundary` — detail

Scans every `*.go` under `backend/` (excluding `*_test.go` and `vendor/`) for `INSERT INTO`, `UPDATE`, or `DELETE FROM` statements naming a guarded table, and flags hits whose file is NOT inside the table's allowed package directory.

| Table | Allowed package |
|---|---|
| `roles` | `backend/internal/roles/` |
| `permissions` | `backend/internal/roles/` |
| `role_permissions` | `backend/internal/roles/` |
| `page_addressables` | `backend/internal/addressables/` |

Migration SQL files (`db/schema/*.sql`) are not scanned — migrations are the privileged bootstrap path.

**Adding a new sole-writer boundary:** edit `WRITER_BOUNDARY` in `dev/scripts/lint_writer_boundary.py` and add the new `<table> → <package>` row.

---

## `lint:dev-css` — detail

Two checks gate the dev-UI catalog (PLA-0013):

1. **No `dev-*` / `dui-*` selectors in `app/globals.css`.** The selectors `.dev-help-editor__*`, `.dev-shortcuts-th--*`, `.ui-retro__*`, etc. that leaked into globals over five generations of dev panels MUST move to `dev/styles/dev-ui.css` under the `.dui-*` namespace. `app/globals.css` is the user-facing app stylesheet only.
2. **No imports of `app/globals.css` from `dev/`.** Next.js loads `app/globals.css` once via the root layout — dev panels do not need to import it. Dev panels load `dev/styles/dev.css` + `dev/styles/dev-ui.css`.

There is no exemption registry — this lint is a hard gate. The migration stories (00409 / 00410 / 00411 / 00412) evict each cluster of bespoke selectors and the lint must remain at exit 0 once each story lands.

The detector strips `/* … */` comments before matching, so `.dev-foo` mentioned inside a comment is ignored. The selector regex requires a leading whitespace / comma / combinator / brace, so CSS custom-property names like `--dev-foo` do not trip it (they start with `--`, not `.`).

---

## `lint:secondary-nav` — detail

Walks every `<SecondaryNavigation` opening tag (multi-line JSX supported) and checks that any element using `reorderable` also passes `pageId="…"`. The per-user tab order is keyed on `(user_id, subscription_id, page_id)`; without a stable `pageId` the toggle would render but persistence would silently no-op.

The detector skips the component implementation file itself (`app/components/SecondaryNavigation.tsx`) because the component declares the props rather than consumes them. False positives can be parked in `dev/registries/secondary_nav_exempt.json`.

**Migration playbook** when adding a new reorderable nav:

1. Pick a stable string `pageId` (lowercase + dashes; mirrors the route segment — e.g. `"workspace-settings"`, `"theme"`, `"work-items"`).
2. Pass `pageId={…}` and `reorderable` together — never one without the other.
3. Run `npm run lint:secondary-nav` — must exit 0.

---

## `lint:page-description` — detail

Walks every `page.tsx` under `app/(user)/**` and requires the text `<PageDescription` to appear somewhere in the file. The primitive lives at `app/components/PageDescription.tsx` and wraps a `<Panel name="page_description" title={…}>` so the help-icon contract from `feedback_helper_icon.md` is wired automatically; the wrapper carries a `.page-description` class for the standardised 30px bottom margin. Title defaults to the deepest active secondary-nav tab label, published via `ActiveNavContext` from `app/components/SecondaryNavigation.tsx`.

**Adoption playbook** when adding (or pulling out of exemption) a page:

1. Add `import PageDescription from "@/app/components/PageDescription";` to the page.
2. Render `<PageDescription>` once at the top of the page's return tree. Pass `title="…"` only when you want to override the active-nav default.
3. Remove the path from `dev/registries/page_description_exempt.json`.
4. Run `npm run lint:page-description` — must exit 0.

The exemption registry is seeded with the 51 pre-existing pages that lacked the primitive on 2026-05-12; each is a pay-down debt entry, not a permanent exemption.

---

## `lint:h2-panel-only` — detail

The `<Panel>` primitive already renders its title as `<h2 class="panel__title">`. So any `<h2>` JSX in a user-facing file is a missed opportunity to route the section through `<Panel>` — meaning no help-icon, no addressable registration, and inconsistent heading semantics. The lint scans every `*.tsx` under `app/(user)/**` and fails on any line containing `<h2`. The Panel component itself (`app/components/Panel.tsx`) is the canonical emitter and is hard-skipped.

Anchor-target section headings (e.g. `<h2 id="section-work">Work Types</h2>` used by `PageAnchorNav` scroll targets) migrate to the pattern:

```tsx
<section id="section-work">
  <Panel name="work_types" title="Work Types">
    {/* … */}
  </Panel>
</section>
```

The wrapping `<section id="…">` preserves the scroll anchor; the `<Panel>` carries the heading, helper-icon, and addressable address. `<Panel>` does not yet expose an `id` prop, so this pattern remains the canonical wrapper.

**Adoption playbook** when introducing a new section heading:

1. Decide: is this a page section title (→ `<Panel title="…">`) or a sub-label inside an existing panel (→ keep `<h3 className="eyebrow">`)?
2. If it needs a scroll anchor, wrap the `<Panel>` in `<section id="…">`.
3. Run `npm run lint:h2-panel-only` — must exit 0.

The exemption registry seeded on 2026-05-12 carries 5 paths: two modal/wizard overlays, the `_shared` settings modal, the theme showcase (bespoke `theme-panel` family), and the webhooks page (queued for `PageDescription` migration).

---

## When the lint flags something

- **It's a known pre-migration violation** → add the path to the exemption registry with a one-line note in the registry's `description` if more justification is needed.
- **It's a new violation** → fix it, don't exempt it. The exempt list is a one-way ratchet that only ever shrinks.
- **The detector mis-fired** → tighten the regex in the script and re-run; do not exempt false positives blindly.

---

---

## `api:check` — detail (PLA-0029)

Two scripts enforce the API contract between the Go backend and the frontend:

**`check_routes.sh`** — parses `backend/cmd/server/main.go` to reconstruct the full path of every chi route (`r.Get`, `r.Post`, `r.Put`, `r.Delete`, `r.Patch`) by tracking `r.Route(...)` / `r.Group(...)` / `r.Mount(...)` nesting depth. Strips the `/samantha/v[0-9]+` prefix, normalises trailing slashes, and diffs against `openapi.yaml` paths (lines matching `^  /`). Exits 1 if any route is missing from the spec.

**`check_callers.py`** — scans every `*.ts` / `*.tsx` under `app/` (excluding `app/api/`, `node_modules`, `.next`) for `api(...)`, `apiInfra(...)`, and `apiV2(...)` call sites. `api(...)` callers must have a matching spec path — exit 1 if not. `apiInfra` and `apiV2` are tracked but skipped from hard-fail (infra is unversioned; v2 is not in the v1 spec). Side effects: writes `api-snapshots/caller-map.json` and `api-snapshots/dead-apis.txt`.

**Snapshot + breaking-change system:**

- `npm run api:snap` — copies `openapi.yaml` → `api-snapshots/vN.yaml`, generates `blast-radius-latest.md` via `oasdiff changelog`, regenerates caller-map, appends a CHANGELOG row.
- `npm run api:install-hooks` — installs `dev/scripts/pre-push.sh` as `.git/hooks/pre-push`; runs both checks + `oasdiff breaking` on every push; breaking changes blocked unless the last commit message contains `[breaking]`.
- GitHub Actions: `.github/workflows/api-contracts.yml` mirrors the pre-push hook; `[breaking]` in PR title/body bypasses the block.
- **Dead-API exemptions:** add paths to `dev/registries/dead-api-exemptions.txt` (one path per line, `#` comments ok) for spec paths with no caller that are intentionally uncalled (e.g. reserved, admin-only, docs-only).
- **oasdiff install:** `go install github.com/oasdiff/oasdiff@latest`

**Dev panel:** `http://localhost:5101/dev` → **API Changelog** tab shows the blast-radius diff, caller map (filterable), and dead-API list.

---

## Related

- [`docs/c_c_addressables.md`](c_c_addressables.md) — `lint:addressables` details and Panel adoption playbook.
- [`docs/c_c_roles_permissions.md`](c_c_roles_permissions.md) — RBAC tables protected by `lint:writer-boundary`.
- [`docs/c_security.md`](c_security.md) — security posture index; lints appear under "writer boundaries".
