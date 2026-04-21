# dev — plug-and-play developer tooling module

Ringfenced module shared across MMFFDev apps. The host app provides the chrome (topbar, sidebar, footer); everything inside the content area is owned by `dev/`.

## Mount contract

The host needs to do two things:

1. **Provide the shell route.** Render a page that re-exports a dev entry:
   ```tsx
   // app/(user)/dev/page.tsx
   export { default } from "@dev/pages/DevPage";
   ```
2. **Expose the theme tokens.** Dev reads `--ink-1/2/3`, `--line-1/2`, `--accent*`, `--surface*`, `--bg`, `--font-sans`, `--font-mono`, `--radius-sm/md` from `:root` — the host's existing token set.

That's it. No shared components, no shared state, no shared API.

## Path alias

`tsconfig.json` registers `@dev/*` → `./dev/*`. Imports from the host use that alias so the folder can move without touching JSX.

## Detach procedure

Removing dev from a host is:
1. Delete the `dev/` folder
2. Delete the host route file that re-exports it (`app/(user)/dev/page.tsx`)
3. Remove the sidebar entry
4. Remove the `@dev/*` alias from `tsconfig.json` (optional but tidy)

No host code should import dev internals — only the entry points under `dev/pages/*`.

## Layout

```
dev/
  pages/      # route-level components the host re-exports
  components/ # dev-internal widgets (nothing the host imports)
  scripts/    # shell scripts, SSH manager, etc.
  api/        # (future) Next API handlers, if dev needs its own endpoints
  README.md
```
