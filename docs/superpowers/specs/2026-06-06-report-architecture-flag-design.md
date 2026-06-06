# `<report> -a` — Architecture Site Map — Design Spec

**Date:** 2026-06-06
**Status:** Approved (brainstorm) — pending implementation plan
**Branch:** main (no feature branch; user directive 2026-06-06)
**Author:** Claude (Opus 4.8) + Rick

---

## 1. Purpose

Add an `-a` (architecture) flag to the `<report>` skill that builds and maintains a **single, comprehensive, living map of the entire Vector site** — every Rail1 bucket, every page under it, every page's purpose and its full component tree, plus a reverse "used-by" component registry. The map exists so Claude and Rick can cross-reference any conversation by stable IDs (e.g. "the toolbar on `PLAN-WI.02`").

This is **not** a point-in-time report. Unlike every other `<report>` flag (which mints a new `RES###`/`PLA###`/`SY###` per run), `-a` always writes the **same** report (`ARC001`) and **updates it in place**, prepending a Change Log entry on each run. Stable IDs are the whole point — they must survive re-runs.

---

## 2. Non-goals (explicit scope boundary)

- **Not** a code-quality audit (that is `-b`).
- **Not** a security audit (`-s`) or dependency trace (`-c`).
- **Not** a per-page deep-dive system paper (`-sy`) — `-a` is breadth (whole site), `-sy` is depth (one system).
- **Does not** mutate any application data, nav tables, or schema. Read-only against the live DB + filesystem; the only writes are: `ARC001` in `dev_reports`, and two `.claude/` registry/cache files.
- **Does not** create a new report per invocation — single living doc, always `ARC001`.

---

## 3. Artefacts maintained

| Artefact | Location | Role |
|----------|----------|------|
| `ARC001` report | `mmff_dev.dev_reports` (`type='architecture'`) | The rendered HTML site map, viewable on Dev → Reporting → **Architecture** tab. |
| ID registry | `.claude/arch-map-ids.json` | Locks `bucket-slug` / `page-slug` / `component-name` → stable ID. Makes re-runs non-destructive. Retired pages keep their ID (flagged `retired`, never reused). |
| Analysis cache | `.claude/arch-map-cache.json` | Per-page content hash + last-resolved component tree. Subsequent runs re-analyse only changed pages. |

Both `.claude/` files are committed (they are project knowledge, like `scope-refs.map`).

---

## 4. ID scheme — bucket-prefixed, registry-backed

```
PLAN                    Planning (Rail1 bucket)
  PLAN-WI               Work Items (page)
    PLAN-WI.01          Header / PageDescription (section)
    PLAN-WI.02          Grid toolbar
    PLAN-WI.03          Grid tree
  PLAN-SC               Scope (page)
DELIV                   Delivery (bucket)
  DELIV-SR              Sprint Review (page)
```

- **Bucket ID** = uppercase short code derived from the Rail1 bucket (page_tags group) name. Locked in the registry on first sight.
- **Page ID** = `<BUCKET>-<PAGESLUG>` where PAGESLUG is a short uppercase code derived from the page name/route. Locked in registry.
- **Section ID** = `<PAGEID>.NN` (zero-padded, ordered top-to-bottom within the page).
- **Component IDs** in the registry are keyed by component name (`<Grid>` etc.), not numeric — they are looked up by name in cross-reference.

### Stability rules

1. On first build, every bucket/page/section gets an ID written to `.claude/arch-map-ids.json`.
2. On re-run, IDs are **looked up** from the registry by slug — never regenerated. Same slug → same ID, forever.
3. A new page gets the next free ID under its bucket.
4. A page that disappears from both DB and code is marked `"status": "retired"` in the registry; its ID is **never reused**.
5. Section numbers within a page are stable as long as the section's identity (its heading slug) is unchanged; new sections append, removed sections leave a gap (registry tracks retired section slugs).

---

## 5. Data spine — DB nav + code reconciliation

The authoritative bucket→page tree comes from the **live nav data** (what users actually see on Rail1), reconciled against code routes for drift.

### Step 1 — DB spine (authoritative)
Query the live Rail1 tree via the nav dev API using a **reference role that sees everything** (gadmin) so the map is complete, not role-filtered. Source tables (per `backend/internal/nav/registry.go`): `pages`, `page_tags` (buckets), `page_roles`. This covers both public-facing and dev-tools-facing surfaces.

### Step 2 — Code reconciliation
Walk `app/(user)/**/page.tsx` + `dev/pages/*.tsx`. Match each route to a nav page. Produce a **Drift Report**:
- **Orphans** — code routes with no nav entry (e.g. `/work-items-2`).
- **Dead links** — nav entries with no matching route.
- **Matched** — the healthy set (counted, not listed individually).

The DB spine drives the map structure; the drift report is a side artefact in its own section.

---

## 6. Per-page anatomy

Each page renders as one `<h2 id="<PAGEID>">` with `<h3 id="<PAGEID>.NN">` sub-sections. For every page:

- **Name** — display name from nav.
- **Route** — the `app/(user)/…` or `dev/pages` path.
- **Known purpose** — Claude's understanding of what the page does (from PageDescription, route, and component reading).
- **Component tree** — the **full transitive render tree**, tiered to stay navigable:
  - **Primary** — page-specific assemblers (e.g. `GridWorkItems`, `sprintReviewTreeData`).
  - **Shared** — `app/components/` primitives (`<Grid>`, `<Panel>`, `<Badge>`).
  - **Leaf** — icons, pure utils, tiny wrappers — **collapsed to a count + names list**, not expanded, so the tree doesn't drown in `MdOutline*` imports.

Tiering is by file location + heuristics (path under `app/components/icons` or react-icons → Leaf; page-local file → Primary; `app/components/` → Shared).

---

## 7. Component registry — reverse "used-by" index

A dedicated `<h2 id="component-registry">` section. Built by **inverting** every page's transitive tree:

For each component:
- **Name** — `<Grid>`.
- **Stored at** — `app/components/Grid/Grid.tsx`.
- **Tier** — Primary / Shared / Leaf.
- **Used by** — list of page IDs + names: `PLAN-WI` Work Items, `DELIV-SR` Sprint Review, `PLAN-SC` Scope.

This is the artefact that answers "if I change `<Grid>`, what breaks?" — the cross-reference Rick asked for.

---

## 8. Build engine — sequential batched sub-agents

The full transitive graph across every page is heavy, so the **initial** build fans out:

1. Resolve the DB spine + code routes (main session, one pass).
2. For each page, spawn a sub-agent **in batches of ~5 sequential**. Each agent resolves one page's transitive component tree via `lsp-ts` references + import parsing, returns structured JSON `{ page, route, purpose, tree: [...] }`.
3. Main session synthesises: assigns/looks-up IDs, builds the reverse registry, computes drift, renders HTML.
4. Writes `ARC001`, updates both `.claude/` files.

### Incremental re-run
On subsequent `-a`:
- Recompute each page's content hash (route file + its primary-tier files).
- Skip pages whose hash is unchanged (reuse cached tree).
- Re-analyse only changed/new pages.
- Rebuild registry + drift + HTML from cached + fresh trees.
- Prepend a Change Log entry summarising what changed (pages added/removed/re-analysed).

---

## 9. Skill + storage wiring (4 code touch-points)

| File | Change |
|------|--------|
| `backend/internal/devreports/types.go:22` | Add `"architecture"` to `ValidTypes`. |
| `app/lib/apiSite/index.ts:524` | Add `"architecture"` to the `DevReportType` union. |
| `dev/pages/DevReportingPanel.tsx:16` | Add `{ value: "architecture", label: "Architecture" }` to `TYPE_TABS`. |
| `.claude/skills/report/SKILL.md` | Add the `-a` flag row to the flags table + a full `## -a — Architecture site map` protocol section + section template. |

No backend handler change beyond the enum — the existing upsert path handles a new type transparently.

---

## 10. Report section template (canonical `<h2 id>` order)

| Section | id slug | Content |
|---------|---------|---------|
| Synopsis | `synopsis` | 2–4 sentences: what the map covers, when last built, headline counts (N buckets, N pages, N components). |
| Site Overview | `site-overview` | Bucket-level summary table: each bucket, its ID, page count. The "table of contents at altitude". |
| Buckets & Pages | `buckets-and-pages` | The body. Per-bucket → per-page `<h3>` anatomy (§6). The bulk of the document. |
| Component Registry | `component-registry` | Reverse used-by index (§7). |
| Drift Report | `drift-report` | Orphans + dead links (§5 step 2). |
| Change Log | `change-log` | Newest-first; prepended each run. First run = "Initial build." |

The Dev → Reporting panel rebuilds the TOC client-side from these headings + the per-page `<h3>` anchors, so the whole map is navigable by ID.

---

## 11. POST payload shape

```json
{
  "id": "ARC001",
  "type": "architecture",
  "title": "Vector Architecture Site Map",
  "category": "Architecture · Site Map",
  "topic": "Comprehensive bucket-by-bucket, page-by-page map of the Vector site with transitive component trees and a reverse used-by registry.",
  "summary": "<Synopsis text>",
  "content": "<HTML body matching §10>",
  "report_date": "YYYY-MM-DD"
}
```

On re-run: GET `ARC001` first, parse + prepend Change Log, POST the same ID (upsert replaces the row).

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Full transitive tree is noisy (icons/utils flood the map). | Leaf tier collapsed to count + names; only Primary/Shared expand. |
| ID drift on re-run defeats the cross-reference purpose. | Registry file (`.claude/arch-map-ids.json`) locks slug→ID; re-runs look up, never regenerate; retired IDs never reused. |
| Initial build token cost is large. | Sequential batches of ~5; incremental runs skip unchanged pages via content hash. |
| Nav spine needs an everything-seeing role. | Use gadmin reference role via the dev API key (no browser session); documented in the protocol. |
| Backend rejects unknown type. | `ValidTypes` updated in the same change set (§9) before first POST. |
| Map and substrate drift apart. | `-a` is re-runnable on demand; Change Log records each rebuild. (Not auto-triggered — manual, like the other report flags.) |

---

## 13. Verification

- **Wiring:** `go build ./...` green after the `ValidTypes` add; `tsc` green after the union + tab add; the Architecture tab appears on /dev/reporting with a count of 1 after first build.
- **ID stability:** run `-a` twice with no code changes → `ARC001` content identical except the Change Log entry; `.claude/arch-map-ids.json` byte-identical (no renumbering).
- **Incremental:** touch one page's primary file, run `-a` → Change Log notes exactly that one page re-analysed; other pages' trees unchanged.
- **Cross-reference:** every `<h3>` in the body has an `id` matching a registry entry; every Component Registry "used-by" page ID resolves to a real `<h2>` in the map.
- **Drift:** `/work-items-2` (known code route, nav status uncertain) appears correctly in either Matched or Orphans per its live nav state.

---

## 14. Open implementation questions (for the plan, not blocking design)

- Exact dev API endpoint for the full gadmin Rail1 tree (nav registry exposes it; confirm the route + auth in the plan).
- Short-code generation algorithm for bucket/page slugs (deterministic, collision-handled via registry).
- Whether the analysis cache hash should include shared-component file mtimes (a `<Grid>` change affects every page that uses it) — likely yes for the registry section, no for per-page trees; resolve in plan.
