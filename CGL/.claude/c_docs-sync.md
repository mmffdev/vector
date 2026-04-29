# Documentation Sync Rules

**Loaded on demand — read this file when documentation sync rules are needed.**

## Docs Sync Triggers

Do not wait to be asked. Update these pages in the same commit as the code change:

- **`<AR>` (Architecture)** — when **new** modules, endpoints, features, pages, communication patterns, services, or middleware are introduced. Not triggered by bug fixes, styling changes, or modifications to existing code.
- **`<PA>` (Platform Architecture)** — when **new** directories, services, or architectural layers are added, or existing ones are moved/removed. Not triggered by changes within existing files.
- **`<AS>` (Asset Register)** — when UI elements, API endpoints, or `data-asset-id` attributes are added, removed, or renamed. Includes tracking backend endpoints (method, path, description). Update `asset-register.json` and the `data-asset-id` on the DOM element in the same commit.
  - **TODO:** Move `web/documents/asset-register.json` into `web/src/components-dev/asset-register/` and update all references.

## Architecture Page Auto-Update

When any of the following are changed, **update ARC** (`web/src/components-dev/PlatformArchitecturePage.tsx`) in the same sprint session:
- New backend modules created (e.g. `docker-api.ts`)
- API endpoints added, removed, or changed
- New features added to `src/features/`
- Communication patterns changed (e.g. CLI exec → Docker API socket)
- New services, middleware, or transport layers introduced
- Directory structure changes at the backend or feature level

Do not wait to be asked. If the architecture has changed, the architecture page must reflect it.

## File Sync Rules

- **Documents are static JSX**: All document pages are static `.tsx` components in `web/src/components-user/` (user docs) and `web/src/components-dev/` (dev docs). No markdown parsing at runtime. When the user says "update Sprints", edit the sprints.json data file directly.
- **README.md**: The GitHub `README.md` at project root is separate from the in-app `ReadmePage.tsx`. They can diverge — the in-app version is the platform reference, the GitHub version is the repo introduction.
- **backend/data/documents/**: Contains the original `.md` source files for historical reference only. The live rendered content is in the `.tsx` components.

## New Page Placement Rules
- **`<devmode>`** — New dev pages go in `web/src/components-dev/`. File naming: `PageNamePage.tsx` + `PageNamePage.css`. Follow CSS naming convention (feature block name = the page name, no prefix).
- **`<usermode>`** — New user pages go in `web/src/components-user/`. File naming: `PageNamePage.tsx` + `PageNamePage.css`. Follow CSS naming convention.
- Page-scoped CSS lives alongside the component. Global/reusable classes go in `design-system.css` — never duplicate.
- All associated assets (logic files, types) live alongside the page component in the same directory.
- **After creating a new page, add its shortcut to the Page Shortcuts table in `~/.claude/CLAUDE.md`** so future conversations know it exists. Config Sync copies to project on push.

## Mermaid Diagrams
- All diagram node/box text must be short enough to fit with 10px padding
- Keep participant names short (e.g., "WordPress" not "WordPress Container (Apache + PHP)")
- Use `<br/>` for multi-line labels instead of long single lines
- If text overflows a box, shorten it — never let text clip or overlap borders
- The `MermaidDiagram` component (`web/src/components/MermaidDiagram.tsx`) has `nodePadding: 10` and `boxTextMargin: 10` configured globally
