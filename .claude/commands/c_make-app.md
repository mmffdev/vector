# `<makeapp>` — scaffold a user-facing UI app

Trigger: `<makeapp> -<name> -<scope>`

- `-<name>` → slug used for folder, id, className, component (lowercase, `a-z0-9_`).
- `-<scope>` → one-line description stored in the manifest (`description` field) and used to seed the body.

Example: `<makeapp> -kanban -board for tracking work items by status`

## What to create

Folder: `app/store/ui_apps/ui_app_<name>/`

Three files, all prefixed `c_store_app_<name>`:

### 1. `c_store_app_<name>.manifest.ts`

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
  allowedRoles: ["user", "padmin", "gadmin"],
  requiredScopes: [],
  configurable: false,
};

export default manifest;
```

### 2. `c_store_app_<name>-index.tsx`

```tsx
"use client";

import Widget from "@/app/store/shared/Widget";
import type { UiAppProps } from "@/app/store/shared/types";
import "./c_store_app_<name>.css";

export default function UiApp<Name>({ appId }: UiAppProps) {
  return (
    <Widget title="<Name>" className="ui-app-<name>">
      <p className="ui-app-<name>__placeholder">
        <scope> — {appId}
      </p>
    </Widget>
  );
}
```

`<Name>` = PascalCase (`kanban` → `Kanban`). Component name: `UiAppKanban`.

### 3. `c_store_app_<name>.css`

```css
/* Scoped styles for ui_app_<name> — prefix every class with .ui-app-<name>__ */

.ui-app-<name> {
  display: block;
}

.ui-app-<name>__placeholder {
  color: var(--ink-3);
  font-size: 14px;
}
```

## Registry update

Edit `app/store/registry.ts`:

1. Add import near the top, next to the existing `nameManifest` import:
   ```ts
   import <name>Manifest from "./ui_apps/ui_app_<name>/c_store_app_<name>.manifest";
   ```
2. Add an entry to `appRegistry`:
   ```ts
   [<name>Manifest.id]: {
     manifest: <name>Manifest,
     component: dynamic(() => import("./ui_apps/ui_app_<name>/c_store_app_<name>-index"), {
       loading: () => null,
       ssr: false,
     }),
   },
   ```

## Verification

- TypeScript must compile — run `npx tsc --noEmit` or rely on the dev server HMR.
- `listAppsForRole("user")` should return the new manifest.
- CSS classes must all be prefixed `.ui-app-<name>__*` — no global bleed.

## House rules

- BEM-lite, no inline styles, no Tailwind — see `docs/css-guide.md`.
- Do NOT edit `app/store/shared/*` when scaffolding a new app.
- Do NOT register the app under multiple ids.
- `allowedRoles` is the single gate — keep it honest.
