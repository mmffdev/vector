---
name: update
description: Update documentation in-place for components and systems we're actively working on. Umbrella skill — flags select what gets updated. `-c <name>` inserts/refreshes a Dev → Components entry (TOC + body article) for the named component or system, with Synopsis · Architecture & file map · Wire contract · Backlog (logical order). More flags will be added over time.
argument-hint: -c <name>   (e.g. `-c worktree`, `-c notifications`)
allowed-tools: Read Write Edit Grep Glob Bash Agent
---

# `<update>` Skill — keep "currently working on" docs in sync

`<update>` is an **umbrella** for in-place documentation updates. Each flag chooses what to update. The whole point: when we add or change something significant, the next agent or human engineer can pick it up without re-discovering it from scratch.

## Flags

| Flag | Action | Status |
|------|--------|--------|
| `-c <name>` | **Add / refresh** a Dev → Components entry for `<name>` (component or system) — TOC + body article | implemented |
| (future) | more flags to be added | planned |

When invoked with **no flag** or an **unknown flag**, list the available flags and stop. Do not pick a default.

---

## `-c <name>` — Dev → Components entry

### Intent

Add (or refresh) an entry on `/dev/components` documenting `<name>` — a component, hook, primitive, or system we're currently building/changing. The entry tells the next reader:

- **What is it / what does it solve?** (Synopsis)
- **What files make it up + what imports / depends on it?** (Architecture & file map)
- **How does it talk to the rest of the system?** (Wire contract / API surface)
- **What's left to do, in the order it should be done?** (Backlog)

It writes directly into [`dev/pages/DevComponentsPanel.tsx`](../../../dev/pages/DevComponentsPanel.tsx) — both the TOC `COMPONENTS` array AND a matching `<article>` block. The page is hand-written TSX; the skill edits TSX, not data.

### Step 1 — Parse the flag

From the current user invocation, extract `<name>` — the bare token after `-c`. Examples:

- `<update> -c worktree` → name = `worktree`
- `<update> -c object-tree-v2` → name = `object-tree-v2` (kebab is fine)
- `<update> -c "Notification rules"` → name = `Notification rules` (free text is fine; the skill kebab-cases it for the slug)

If `<name>` is missing or only whitespace, STOP and ask: *"What should I document? Run `<update> -c <name>` — e.g. `<update> -c worktree`."*

Compute:
- **`slug`** — `<name>` lowercased, spaces/underscores → hyphens, non-`[a-z0-9-]` stripped. (e.g. `Object Tree V2` → `object-tree-v2`.) Must match `^[a-z][a-z0-9-]{1,40}$`. Reject otherwise.
- **`label`** — the user's verbatim `<name>` (preserve case + spaces; this is what appears in the TOC).

### Step 2 — Locate what to document

The user said `<update> -c worktree`. The name is a **handle**, not a path. Find what they mean:

1. **IDE selection / chat attachment first.** If a file is attached or `ide_selection` is present, use THAT file as the anchor — the name labels it.
2. **Otherwise grep the codebase** for `<name>` (case-insensitive) in the most-likely roots, in order:
   - `app/components/`
   - `app/hooks/`
   - `app/lib/`
   - `app/contexts/`
   - `backend/internal/`
   - `docs/`

   Collect the top ~15 hits with file path + 1-line context.

3. **Disambiguate**:
   - **0 hits** — STOP and ask the user: *"I can't find anything called `<name>` in the codebase. Drop the entry file into chat or paste its path."*
   - **1 clear cluster** (e.g. all hits in one directory tree like `app/components/Worktree/`) — proceed with that as the anchor.
   - **Multiple clusters** — STOP and ask the user to pick. Show the clusters as bullet points with a representative file each. Don't guess.

4. Once anchored, expand the discovery:
   - Run `Grep` for `import.*<Name>` (and for snake/kebab forms) across `app/` + `backend/` to find **callers / consumers**.
   - Open the anchor file(s) and list **dependencies** (imports + types referenced).
   - Look for adjacent **wire surfaces**: route files under `app/api/`, backend handlers under `backend/internal/<pkg>/handler.go`, OpenAPI snippets under `api-reference/`.
   - Look for **docs**: any `docs/c_*<name>*.md` or `docs/c_c_*<name>*.md` files.
   - Note **dirty / recent commits** touching the anchor (look at `git log -10 --oneline -- <path>`).

This discovery seeds the article body. **Do not invent facts** — only document what you found.

### Step 3 — Check if the slug already exists in `COMPONENTS`

Read [`dev/pages/DevComponentsPanel.tsx`](../../../dev/pages/DevComponentsPanel.tsx). Find the `COMPONENTS` array (starts around line 34 with `const COMPONENTS: TocEntry[] = [`).

- **If `slug` already exists** in `COMPONENTS`: this is a **refresh**, not an insert. Ask the user *briefly*: *"`<slug>` already has an entry in Dev → Components. Refresh it (rewrite the article body), append-only (add a 'Recent updates' subsection), or skip?"* Default to refresh-rewrite if they say yes and don't specify.
- **If `slug` is new**: this is an **insert** at the end of the array (per project preference — append, don't sort, don't prepend).

### Step 4 — Plan the H2 sections

The chosen default sections for `-c` entries (locked in when the skill was authored):

| H2 id pattern | Label | Required | What goes here |
|---|---|---|---|
| `<slug>-synopsis` | Synopsis | always | 1–3 paragraphs. What is it? What does it solve? What's the headline shape? |
| `<slug>-architecture` | Architecture & file map | always | Code-fenced tree of files + 1-line role per file. Include front-end primitives, hooks, contexts AND backend service/sql files if relevant. Also a section for "External dependencies (consumed)" listing imports the anchor depends on. |
| `<slug>-wire-contract` | Wire contract | conditional — include if there IS a wire surface (HTTP route, props contract, schema). Omit cleanly otherwise. | API endpoints + request/response shapes; OR React props table for components without a wire; OR DB schema if the system is a substrate. |
| `<slug>-backlog` | Backlog (logical order) | always | Numbered ordered list. Each item: bold one-line title, then 1–3 lines including a *Forcing function:* note (what would push this up). Order them so earlier items unblock later ones. |

Section labels are literal — the TOC reads them verbatim. The id pattern MUST be `<slug>-<section>` so the IntersectionObserver scroll-spy works.

### Step 5 — Edit `COMPONENTS` array (TOC)

Use the `Edit` tool. The pattern is to find the closing `];` of the array and insert just before it. Match `old_string` against the last existing entry's closing `},` + the `];` line so you can insert without disturbing anything else.

Template for the new entry (substitute `<slug>` and `<label>`, and drop the `wire-contract` line if there's no wire surface):

```tsx
  {
    slug: "<slug>",
    label: "<label>",
    h2s: [
      { id: "<slug>-synopsis",      label: "Synopsis" },
      { id: "<slug>-architecture",  label: "Architecture & file map" },
      { id: "<slug>-wire-contract", label: "Wire contract" },
      { id: "<slug>-backlog",       label: "Backlog (logical order)" },
    ],
  },
```

For **refresh**, replace the entry in place with the new `h2s` list (the section order may have changed if the wire-contract section flipped from present to absent).

### Step 6 — Edit the body to add the `<article>` block

Find the closing of the body container in the page:

```tsx
        </article>
      </div>
    </div>
  );
}
```

The last `</article>` before `</div>` is the insertion anchor. Insert the new `<article>` between the last existing `</article>` and the next `</div>`. Use the `Edit` tool with enough surrounding context to make the match unique (read the file first to see exactly which last-article tag the file currently has — the page changes).

**Article template:**

```tsx
        {/* ══════════════════════════════════════════════════════
            <LABEL UPPERCASE>
        ══════════════════════════════════════════════════════ */}
        <article style={{ marginTop: "var(--space-6)" }}>
          <h1 className="dui-doc__h1" id="<slug>"><label></h1>
          <p className="dui-doc__lead">
            {/* One-paragraph lead: what is it + where does it live (cite anchor path in <code>) */}
          </p>

          {/* ── Synopsis ── */}
          <section id="<slug>-synopsis">
            <h2 className="dui-doc__h2">Synopsis</h2>
            <p className="dui-doc__p">
              {/* What it solves; what shape it has; 1–3 paragraphs */}
            </p>
          </section>

          {/* ── Architecture & file map ── */}
          <section id="<slug>-architecture">
            <h2 className="dui-doc__h2">Architecture &amp; file map</h2>

            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">{/* e.g. "Primitives" or "Front-end" */}</div>
              <pre className="dui-doc__code">{`<file-tree-with-role-comments>`}</pre>
            </div>

            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Backend</div>
              <pre className="dui-doc__code">{`<backend-files-if-any>`}</pre>
            </div>

            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">External dependencies (consumed)</div>
              <pre className="dui-doc__code">{`<imports-the-anchor-depends-on>`}</pre>
            </div>
          </section>

          {/* ── Wire contract ── (OMIT THIS WHOLE SECTION IF NO WIRE SURFACE) */}
          <section id="<slug>-wire-contract">
            <h2 className="dui-doc__h2">Wire contract</h2>
            <p className="dui-doc__p">{/* endpoints / payloads / props table / schema */}</p>
            <pre className="dui-doc__code">{`<example-request-response-or-props>`}</pre>
          </section>

          {/* ── Backlog ── */}
          <section id="<slug>-backlog">
            <h2 className="dui-doc__h2">Backlog (logical order)</h2>
            <p className="dui-doc__p">
              In the order they should be picked up. Each item is independently shippable; later
              items unblock as earlier ones land.
            </p>
            <ol className="dui-doc__list dui-doc__list--ordered">
              <li>
                <strong>{/* item title */}</strong>{" "}
                {/* description */} <em>Forcing function: {/* what would push this up */}</em>
              </li>
              {/* …more items, ordered */}
            </ol>
          </section>
        </article>
```

**TSX gotchas to respect (project conventions):**

- Use `{` ` `}` template literals only inside `<pre>` blocks where you need to keep `${…}` literal. For headings/paragraphs, plain JSX is fine.
- Always escape `&` in HTML entities as `&amp;` (e.g. `Architecture &amp; file map`).
- Use `<code>filename.ext</code>` inline for paths.
- Use the `dui-cat__section` / `dui-cat__demo-label` / `dui-doc__code` / `dui-doc__p` / `dui-doc__list` classes — they're project-specific and already in `dev/styles/dev-ui.css`. Do NOT invent new class names.
- Do NOT use `<table>` for the file map — use `<pre>` with ASCII tree art (matches existing ObjectTreeV2 / Notifications style).

### Step 7 — Sanity-check the edit

After the two `Edit` calls (one for TOC, one for body):

1. Read the section you modified to confirm the article matches the TOC h2 ids exactly. The IntersectionObserver in the page collects all ids via `COMPONENTS.flatMap((c) => c.h2s.map((h) => h.id))` — a mismatch silently breaks scroll-spy for that entry.
2. Run `grep -n '<slug>-' dev/pages/DevComponentsPanel.tsx` and verify every id you put in the TOC has a matching `id=` attribute in the body. Report any miss.
3. Don't run the dev server, don't `npm run lint`, don't `tsc` — those are user actions. Just point out if the read-back shows a structural problem.

### Step 8 — Confirm

Report back in this exact form:

```
<update> -c <name> complete
  Slug:     <slug>
  Action:   <inserted | refreshed>
  TOC:      dev/pages/DevComponentsPanel.tsx#COMPONENTS (entry #<N>)
  Article:  dev/pages/DevComponentsPanel.tsx — <slug>
  Sections: Synopsis · Architecture & file map · [Wire contract ·] Backlog
  View:     http://localhost:5101/dev/components#<slug>-synopsis
```

If you skipped the wire-contract section, note that explicitly (`Sections: Synopsis · Architecture & file map · Backlog (no wire surface)`).

---

## Rules — non-negotiable

1. **Never invent facts.** If you can't find the file, the import, or the endpoint, leave it out. The whole point of this skill is that the next reader trusts the entry.
2. **Append, don't reorder.** New TOC entries go at the END of `COMPONENTS`. Existing entries are not moved.
3. **Slug must match `^[a-z][a-z0-9-]{1,40}$`.** Reject anything else — invalid slugs break the URL fragment + scroll-spy.
4. **Section ids MUST follow `<slug>-<section>`.** The page's IntersectionObserver depends on this pattern.
5. **Ambiguity stops the skill.** If grep returns multiple clusters, ASK. Don't pick one and hope.
6. **No CSS invention.** Use the existing `dui-*` classes only. New styles go through a separate task.
7. **Refresh-in-place over deletion.** If the user runs `<update> -c <name>` for an existing entry, rewrite the article body, don't delete + re-insert (loses git diff context).

## Notes

- The `<code> -d` skill ([.claude/skills/code/SKILL.md](../code/SKILL.md)) is the closest sibling — both inspect the codebase and write a structured artefact. Difference: `<code> -d` writes a JSON snapshot to `dev/code/`; `<update> -c` edits the live `/dev/components` TSX page in place.
- Future flags can target other dev pages (`-d` for `/dev/docs`, `-r` for `/dev/research`-style auto-refresh, etc.) — keep this skill the single umbrella for in-place doc updates.
- The page is hand-written TSX, not data-driven. That's deliberate — sections are heterogeneous (some have playgrounds, some have file maps). Don't refactor it into a JSON-driven page without a separate spec.

$ARGUMENTS
