# `<makedevapp>` — scaffold a developer-only UI app

Trigger: `<makedevapp> -<name> -<scope>`

Same shape as `<makeapp>` but lives in the ringfenced dev tree — only visible to us (the dev team), never shipped to users.

- `-<name>` → slug (lowercase, `a-z0-9_`).
- `-<scope>` → one-line description.

Example: `<makedevapp> -dbinspect -inspect live Postgres state`

## What to create

Folder: `dev/store/ui_apps/ui_app_<name>/`

Three files, all prefixed `d_store_app_<name>` (note: `d_` not `c_` — marks the file as dev-tree):

### 1. `d_store_app_<name>.manifest.ts`

```ts
import type { UiAppManifest } from "@/app/store/shared/types";

const manifest: UiAppManifest = {
  id: "ui_app_<name>",
  name: "<Name>",
  description: "<scope>",
  icon: "square",
  version: "0.1.0",
  author: "MMFFDev",
  category: "utility",
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  allowedRoles: ["gadmin"],
  requiredScopes: [],
  configurable: false,
};

export default manifest;
```

Dev apps default to `allowedRoles: ["gadmin"]` — never expose to `user` or `padmin`.

### 2. `d_store_app_<name>-index.tsx`

```tsx
"use client";

import Widget from "@/app/store/shared/Widget";
import type { UiAppProps } from "@/app/store/shared/types";
import "./d_store_app_<name>.css";

export default function UiAppDev<Name>({ appId }: UiAppProps) {
  return (
    <Widget title="<Name>" className="ui-app-<name>">
      <p className="ui-app-<name>__placeholder">
        <scope> — {appId}
      </p>
    </Widget>
  );
}
```

Note: import `./d_store_app_<name>.css` (matches the file prefix).

### 3. `d_store_app_<name>.css`

```css
/* Scoped styles for ui_app_<name> (dev) — prefix every class with .ui-app-<name>__ */

.ui-app-<name> {
  display: block;
}

.ui-app-<name>__placeholder {
  color: var(--ink-3);
  font-size: 14px;
}
```

## Registry

Dev store has no registry today — dev apps are mounted by whatever dev tooling surface loads them. Do **not** add dev apps to `app/store/registry.ts`.

If/when a dev registry exists (`dev/store/registry.ts`), follow the same pattern as `<makeapp>`, but import the manifest from `./ui_apps/ui_app_<name>/d_store_app_<name>.manifest` and gate on `gadmin` only.

## Verification

- TypeScript must compile.
- CSS classes all prefixed `.ui-app-<name>__*`.
- `allowedRoles` must NOT include `user` or `padmin`.

## House rules

- Dev apps never leak into `app/store/registry.ts`.
- BEM-lite, no inline styles — see `docs/css-guide.md`.
- Types are still imported from `@/app/store/shared/types` — do not duplicate.
