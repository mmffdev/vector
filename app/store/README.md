# UI App Store

Custom apps users can add to a page. Each app is self-contained, lazy-loaded, and gated by role.

- **Add a user-facing app** → [`docs/c_make-app.md`](../../docs/c_make-app.md) — trigger: `<makeapp> -<name> -<scope>`.
- **Add a dev-only app** → [`docs/c_make-dev-app.md`](../../docs/c_make-dev-app.md) — trigger: `<makedevapp> -<name> -<scope>`, scaffolds into `dev/store/ui_apps/`.

Shared primitives live in `shared/` (`types.ts`, `Widget.tsx`). The central registry + role filter is `registry.ts`.
