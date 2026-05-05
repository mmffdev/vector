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

## When the lint flags something

- **It's a known pre-migration violation** → add the path to the exemption registry with a one-line note in the registry's `description` if more justification is needed.
- **It's a new violation** → fix it, don't exempt it. The exempt list is a one-way ratchet that only ever shrinks.
- **The detector mis-fired** → tighten the regex in the script and re-run; do not exempt false positives blindly.

---

## Related

- [`docs/c_c_addressables.md`](c_c_addressables.md) — `lint:addressables` details and Panel adoption playbook.
- [`docs/c_c_roles_permissions.md`](c_c_roles_permissions.md) — RBAC tables protected by `lint:writer-boundary`.
- [`docs/c_security.md`](c_security.md) — security posture index; lints appear under "writer boundaries".
