# Agent Handover — Visual App (Vector Relationship Explorer)

**Date:** 2026-05-22
**Branch:** `main`
**Last commit:** `eaaf21b` — `feat(dev/visualiser): V2 Relationship Explorer — SCADA shell + groups + diff + K-hops`
**Page:** `/dev/visualiser` (DB-driven nav entry from migrations 240/241)
**Status:** V1 preserved as historical reference. V2 ships shell + cubes + click-fix + Files + Selected + K-hops + Groups + Diff + Fullscreen. Future panels (Search, lasso, auto-cluster, syntax highlighting) deliberately not built yet.

> **Read-before-acting:** this handover describes a working surface, not a frozen branch. The visualiser is `main` and active. Console traces (`[viz-v2] …`) are intentionally left in for diagnostics — strip them once V2 click behaviour is confirmed in your environment.

---

## What this surface is for

Not "a code visualiser." The **prototype of Vector's relationship-explorer surface** — a navigable, scannable, manipulable view of any graph the platform produces. Today the data feed is `dev/audits/codegraph.json` (TS + Go files + imports + HTTP bridges). Tomorrow the same chrome hosts:

- **Artefact relationships** — defect ↔ story ↔ test ↔ scope ↔ workspace.
- **Topology** — `topology_nodes` tree with role grants overlaid.
- **RBAC** — users → roles → permissions → resources.
- **Workflow cascades** — flow → state → transition graphs.

Codegraph is the test bed because it's exhaustive, on disk, and free to regenerate. **The chrome is the product**, the cubes are how we render one slice of it.

Reference inspiration: DevLens (open source, AGPL — read but don't import) for the rail+panels IA, Tumblr Q1 2013 infographic for the editorial-dark palette, MiScout SCADA for industrial information density. Composite gives Vector's design language for this surface.

---

## File map — where things live

### Entry + shell
- [app/(user)/dev/[tab]/page.tsx](../app/(user)/dev/[tab]/page.tsx) at line 25 + 47 + 81 — registers the `visualiser` tab, renders `DevVisualiserPanel`.
- [dev/pages/DevVisualiserPanel.tsx](../dev/pages/DevVisualiserPanel.tsx) — **thin tabs shell** (V1 / V2 switcher). Adding V3 is two lines: import + push onto `VERSIONS` array. Defaults to V2.

### V1 (preserved as-is)
- [dev/pages/DevVisualiserPanelV1.tsx](../dev/pages/DevVisualiserPanelV1.tsx) — original cubes + cluster-drag + click-to-frame + (broken) File Explorer prototype. Kept for regression comparison. **Don't modify** unless restoring a behaviour V2 lost.
- Known issues in V1 (deliberately preserved):
  - Click handler captures stale closures after Folders/Files toggle.
  - File Explorer auto-switches view, causing 300ms blank.
  - Inline `style={{}}` blocks throughout (violates `.dui-*` CSS rule).

### V2 (active)
- [dev/pages/DevVisualiserPanelV2.tsx](../dev/pages/DevVisualiserPanelV2.tsx) — the next-gen build, ~1364 lines. Single file because the features (shell, renderer, panels, click, drag, groups, diff, k-hops) share state and refs.
- [dev/styles/dev-ui.css](../dev/styles/dev-ui.css) — V2 + shell CSS appended at the end (~970 lines from line ~2052 onward). All classes prefixed `.dui-viz-v2__*` or `.dui-viz-shell__*`. Editorial-dark palette as scoped CSS vars on the V2 root (`--vs-canvas`, `--vs-accent`, `--vs-magenta`, etc.).

### Backend
- [backend/internal/portfoliomodels/dev_reset.go](../backend/internal/portfoliomodels/dev_reset.go):
  - `Codegraph()` (line ~283) — serves `dev/audits/codegraph.json` snapshot.
  - `Source()` (added in `eaaf21b`) — `GET /_site/admin/dev/source?path=<rel>` for the Selected panel's source preview. Path-traversal via `filepath.EvalSymlinks` + prefix check. Extension allowlist. 2 MiB cap. File-only. `X-Content-Type-Options: nosniff`.
- [backend/cmd/server/main.go](../backend/cmd/server/main.go) line 1322-1323 — mounts both routes under the existing dev-tools admin route block.

### Audit pipeline (the data)
- [dev/scripts/audit_codegraph.sh](../dev/scripts/audit_codegraph.sh) — walks `app/**`, `dev/**`, `backend/**`. Emits `dev/audits/codegraph.json`. Run via `bash dev/scripts/audit_codegraph.sh` or `<audit> -graph`.
- [dev/audits/codegraph.json](../dev/audits/codegraph.json) — current snapshot. Shape: `{ generated_at, stats, nodes[], edges[] }`. Node fields: `id`, `side` (`frontend`/`backend`), `folder`, `layer`. Edge fields: `source`, `target`, `kind` (`import`/`bridge`).

### Nav registration (DB)
- [db/mmff_vector/schema/240_dev_visualiser_page.sql](../db/mmff_vector/schema/240_dev_visualiser_page.sql) — adds `dev-visualiser` to the `pages` table (`/dev/visualiser`, icon `graph`, tag `dev_tools`).
- [db/mmff_vector/schema/241_dev_visualiser_page_role_grants.sql](../db/mmff_vector/schema/241_dev_visualiser_page_role_grants.sql) — grants page to the 5 group roles beyond grp_global.
- DOWN migrations at [db/mmff_vector/schema/down/240](../db/mmff_vector/schema/down/240_dev_visualiser_page_DOWN.sql) / [241](../db/mmff_vector/schema/down/241_dev_visualiser_page_role_grants_DOWN.sql).

---

## What V2 ships (the feature set)

### Layout
```
┌─ topbar ─ brand · KPI strip · view toggle · refresh · fullscreen ───┐
├──┬───────────────┬─────────────────────────────────┬─────────────────┤
│ R│ active panel  │  3D canvas (cubes)              │  Selected node  │
│ a│ Files/Search/ │                                 │  panel (right)  │
│ i│ Groups/Diff   │                                 │  on click        │
│ l│ (320px)       │                                 │  (380px)         │
├──┴───────────────┴─────────────────────────────────┴─────────────────┤
│  status bar — snapshot · layers · selection · health                │
└────────────────────────────────────────────────────────────────────┘
```

### Renderer
- **`3d-force-graph`** with **cubes** as the node geometry. Card face is a `THREE.CanvasTexture` baked from a 2D canvas (filename · folder crumb · layer chip · score chip · side stripe).
- Cube depth encodes score: `clamp(1, 6, 1 + log2(score+1))`.
- Spring physics crushed via `d3VelocityDecay(0.85)` + `cooldownTicks(60)` — no bouncing.
- Drag pins via `fx/fy/fz`. Cluster drag: grabbing a node translates its entire connected component as a rigid block. On drag-end every cluster member pins.
- Click-to-frame: camera flies to `(node.x, node.y, node.z + standoff)` with `lookAt` at node centre. `camera.up` reset to world `+Y` so cards land square. Standoff computed from cube width + camera FOV + viewport aspect — every clicked card occupies the same screen fraction.
- Edge labels via `three-spritetext` billboarded at edge midpoints (`import` dim, `bridge` teal).

### Selected node panel (right)
- Path · layer chip · side chip · score chip.
- **K-Hops isolate slider** — 0-5. BFS reachability from selected node. Nodes outside set dim (lower opacity card + faded sides).
- **Edge lists** — incoming + outgoing, grouped by kind, click an edge to frame the other end.
- **Source preview** — fetches `/_site/admin/dev/source?path=<rel>`. Plain monospace `<pre>` for now (no syntax highlighting yet).

### Files panel (left rail)
- Search box (cyan-focus border).
- Folder-grouped tree with sticky folder headings.
- Layer-colour swatch + leaf filename per row.
- Click → frame the node AND open source preview. If currently in Folders view, auto-switches to Files and waits 300ms for sim settle.

### Groups panel (left rail)
- **Shift-click cards** to add/remove from a working selection set.
- Name the selection → save → it becomes a named group with auto-assigned editorial palette colour (magenta/violet/indigo/teal/amber/rose/sky/emerald cycle).
- Groups recolour their members on the canvas — visible chunks of the graph.
- Each group: toggle visibility, delete.
- **Persists to localStorage** under `viz-v2-groups` + `viz-v2-groups-visibility` — survives reload, per-browser.

### Diff panel (left rail)
- Upload a prior `codegraph.json` via file picker (FileReader; no backend storage).
- Diff per node: **added** (green), **score-up ≥ +2** (mint), **score-down ≤ -2** (amber). **Removed** counted in summary but absent from current graph so don't render.
- Diff colour wins over group colour wins over layer colour.
- Summary block shows file counts before/after.

### Fullscreen
- `⤡` icon in topbar → `requestFullscreen()` on the V2 root.
- Tracked via `fullscreenchange` listener. Icon swaps to `⤢` when active, height grid expands to `100vh`.

### Status bar
- Snapshot age · layer-kind count · selection state · green "online" dot.

### Console traces (left in for diagnostics)
- `[viz-v2] onNodeClick fired { id, x, y, z, shift }` on every node click.
- `[viz-v2] frameNode entry / flying camera / pivot set` for the camera flight.
- Warnings on aborts (no FG instance, stale ref miss, sim not warm).
- **Strip these once V2 click behaviour is confirmed stable in production-like usage** — they're scaffolding, not product.

---

## Why the click bug existed (and how V2 fixed it)

**Symptom in V1:** clicks needed a second try after a toggle.

**Root cause:** V1's effect re-ran on Folders/Files/Edge-labels changes and called `fgRef.current.graphData(freshCopies)` — but only re-bound the *visual* callbacks (`nodeThreeObject`, `linkThreeObject`). The `onNodeClick` handler from the **first** mount kept its closure over the **first** mount's `nodes` and `clusterOf`. After a toggle, clicks arrived on new node objects whose `x/y/z` weren't bound to the closure's data → camera flew to origin / nothing happened. Second click after sim warmed worked because positions caught up.

**V2 fix (in `DevVisualiserPanelV2.tsx`):**
1. `liveNodesRef`, `liveAdjRef`, `liveClusterRef` declared outside the effect.
2. Every effect run writes the fresh data to those refs.
3. Click + drag handlers are rebuilt every effect run AND rebound on the `else` re-bind branch — so they always close over the latest refs.
4. Click handler does `liveNodesRef.current.find(n => n.id === node.id)` — guarantees fresh data.
5. Position-warmth guard: if sim hasn't assigned `x/y/z` yet, `requestAnimationFrame(() => frameNode(node.id))` retries next paint.

If clicks misbehave in your environment, look at the console traces in this order:
- Did `onNodeClick fired` print? If no → click isn't reaching `3d-force-graph` (canvas covered, `enablePointerInteraction` off, pointer-events: none on a wrapper).
- Did `handleClick aborted — id not in liveNodesRef` print? Stale ref — investigate the effect's dependency array and whether refs are being written before handler invocation.
- Did `rAF retry` print? Sim warmth issue — usually self-recovers on retry.
- Did `frameNode flying camera` print but camera didn't move? OrbitControls fighting the tween, or `cameraPosition` got an invalid coord.

---

## Where to pick up next (priority order)

### P1 — Strip console traces
Once V2 click is confirmed reliable, remove the `console.log("[viz-v2]…")` calls in:
- `frameNode` (5 trace points)
- `handleClick` (2 trace points)

These were intentional diagnostics. Not for production.

### P2 — Search panel
Currently a placeholder. Build:
- Text input → matches against `node.id` substring (case-insensitive).
- Result list with same styling as Files panel.
- Click → frame + open Selected.
- Optional: dim non-matching nodes on canvas while a search is active.

### P3 — Syntax highlighting in source preview
Plain `<pre>` today. Add `highlight.js` (already in DevLens; ~10 lines to wire):
- Register `typescript`, `javascript`, `go`, `sql` languages.
- Wrap source content in `hljs.highlight(...)` based on file extension.
- Import GitHub Dark theme CSS once.

### P4 — Lasso multi-select
Currently `shift-click` builds the working selection — works but tedious for large groups. Lasso wants:
- `shift+mouse-drag` over the canvas → screen-space rectangle.
- Project each cube centre to screen coords via `THREE.Vector3.project(camera)`.
- Test point-in-rectangle, add to `selectionSet`.
- OrbitControls already ignores `shift+drag` so no key conflict.
- ~80 lines, but worth holding off until shift-click usage tells you it's needed.

### P5 — Auto-cluster by layer
Currently force-directed clusters by connectivity. Add a "cluster by layer" mode:
- d3-force's `forceCluster` or hand-rolled per-layer centre points.
- Toggle in topbar — pulls nodes of the same layer kind together.
- Strong visual story for "show me the shape of this codebase by tier".

### P6 — Data feed swap (the real product)
The whole point of V2 is to host **artefact relationships** later. The architecture is ready:
- All UI keyed on `node.id`, `node.layer`, `node.folder`, `node.side`. Nothing assumes file system semantics.
- New endpoint serves a similar `{ nodes[], edges[] }` shape from artefact/topology/RBAC data.
- Files panel → "Artefacts" panel; folder grouping → workspace grouping; layer colour → artefact-type colour.
- Source preview → artefact detail view.
- Groups → user-defined artefact collections.
- Diff → "what changed between sprint N and N+1".

This is the actual feature ship. V2 today is the prototype that proves the surface works.

---

## Known caveats (worth knowing before changing things)

### V1 still has bugs and inline styles
Preserved deliberately. **Don't fix V1.** If you find yourself "tidying" V1, stop — its job is to be a regression reference. Build the fix in V2.

### Console traces are diagnostic
Strip when click is stable. Don't grow them.

### Folders view shows folder-level nodes only
`rollupToFolder` collapses files into their folder. Clicking a folder-level node from the Files panel is fine, but clicking a *file* (with extension) when in Folders view auto-switches to Files view because the file node doesn't exist in the folder-rollup simulation. There's an unavoidable 300ms sim-settle wait. If this feels janky, options are:
- Keep Folders view and just open source preview without framing.
- Force the user to switch first.
- Don't show files in the Files panel when in Folders view.

### Groups persistence is per-browser
`localStorage` only. Cross-device sync would need a `users_visualiser_groups` table. Probably worth doing when artefact-relationship-mode lands.

### Diff is local-only
Upload via file picker; nothing is stored server-side. If you want commit-to-commit diff in CI/PR review later, you'd:
- Store named snapshots server-side (`dev/audits/codegraph_<commit>.json`).
- Drop-down in Diff panel: pick any snapshot to compare against current.
- Backend endpoint to list available snapshots.

### Source endpoint is dev-only
`/_site/admin/dev/source` is mounted under the dev-tools admin block — only `gadmin`-tier users reach it. If artefact-relationship mode wants to show artefact-attached source/docs, that's a different (tenanted) endpoint with different auth.

### CSS scoping
V2 uses scoped CSS vars on `.dui-viz-v2` (e.g. `--vs-canvas`). This intentionally diverges from the rest of the `.dui-*` catalog because V2's design language (editorial-dark) is distinct. The vars don't leak — they're declared on the V2 root and scoped to its descendants. If you build V3 with a different palette, do the same: scope tokens on the version root, don't pollute the global token table.

### Path-traversal guards on Source endpoint
The `Source()` handler uses `filepath.EvalSymlinks` + prefix check against the resolved repo root. The extension allowlist gives defence-in-depth. If you change this handler:
- Don't bypass `EvalSymlinks` — that's the symlink-escape guard.
- Don't widen the extension allowlist beyond source/text formats.
- Don't remove the size cap.
- Don't drop `X-Content-Type-Options: nosniff`.

---

## Commits in scope

```
eaaf21b feat(dev/visualiser): V2 Relationship Explorer — SCADA shell + groups + diff + K-hops
0cb4a17 fix(dev/visualiser): standardise click-to-frame — square cards, uniform zoom   ← V1 era
bb4c3e0 docs: scope-tracker breadcrumbs + PLA-0043 handover update                      ← unrelated
026c8f6 feat(dev): Visualiser — unified TS+Go code graph + cubes renderer              ← V1 era origin
867aad0 fix(build): install TipTap v3 packages + migrate v2 imports                    ← unrelated
```

`eaaf21b` is the V2 landing commit (9 files, +3597/-1059). All earlier visualiser commits are V1-era and serve as historical reference.

---

## How to verify the surface is alive

1. Backend dev server on `:5100` (env `dev`).
2. Frontend dev server on `:5101` (`bun dev` or `<npm>`).
3. Open `/dev/visualiser`.
4. Confirm two tabs visible at the top: **V1** + **V2 (active)**.
5. Click **V2**. Verify:
   - Topbar shows brand · KPIs · toggles · refresh + fullscreen icons.
   - Left rail shows 4 buttons (📁 🔍 ◆ ⇄).
   - Canvas renders cubes.
   - Click a cube → flies camera + opens right panel.
   - Click `📁 Files` rail button → opens File Explorer.
   - Click a file in Files panel → frames + loads source.
   - Click `◆ Groups`, shift-click 3 cards on canvas, name + save → group appears with colour, cards recolour.
   - Click `⇄ Diff`, upload your current `codegraph.json` (or any older copy) → diff stats appear.
   - Click `⤡` fullscreen icon → whole canvas takes browser.
6. Open browser console — confirm `[viz-v2]` traces appear on click.
7. Refresh the page — groups should persist.

If any step fails, check:
- Browser console for `[viz-v2]` traces and uncaught errors.
- Network tab for failed `GET /_site/admin/dev/codegraph` or `GET /_site/admin/dev/source`.
- Backend log for the request hitting `Codegraph()` / `Source()`.
- `dev/audits/codegraph.json` exists on disk (`<audit> -graph` to regenerate).

---

## Open design questions

These are deliberately unanswered — pick them up when you're closer to the artefact-relationship use case:

1. **What's the right reach for "select cluster"?** Currently drag-pull moves the whole connected component as a rigid block. For artefact mode, "everything under this scope node" is more meaningful than "everything topologically connected." Consider a scope-aware cluster.

2. **Should K-hops be directional?** Currently undirected BFS. For dependency analysis ("what depends on X" vs "what does X depend on"), directional matters. The graph has direction (`source` → `target`); we just collapse it.

3. **Group sharing across users?** localStorage today. Cross-tenant collaboration on saved relationship views is a real product feature in artefact mode.

4. **How does this nest inside Vector's chrome?** Today it's a dev page. When it becomes user-facing for artefact relationships, it needs to live inside `PageShell`, respect the standard nav, breadcrumb correctly. Decide before that ship.

5. **Right-click context menu?** Long-term, right-click a node should give "open in", "add to group", "show neighbours", "hide", etc. Not yet built.

---

**Authored:** 2026-05-22 by Claude. If anything in this doc contradicts the code, trust the code and patch this file.
