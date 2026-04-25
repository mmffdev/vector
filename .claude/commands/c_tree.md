# `<tree>` — lazy-loading audit + fix

Audit the CLAUDE.md docs tree against the **Authoring rule (hard)** in `.claude/CLAUDE.md` and patch any violations in-place.

## What the rule says

Every entry in `.claude/CLAUDE.md` and every descendant `docs/c_*.md` / `docs/c_c_*.md` / deeper that acts as an **index** is one line: bold label → markdown link to the child → half-sentence hook. Index docs may not have multi-line entries. **Leaf docs** (terminal reference content — tables, schema dumps, command flag references, security policies) may be long.

If you catch a multi-line entry in an index, push the body down one level (`c_x.md` → `c_c_x_y.md`) and replace the parent entry with a one-line pointer.

## Audit procedure

1. **List the tree.** `ls docs/c_*.md .claude/commands/c_*.md` and record line counts. The smallest files are usually pure indexes; the largest are usually leaves — but verify, don't assume.
2. **Classify each file** as **index** (mostly pointers/tables of links to children) or **leaf** (terminal reference content). A file can be hybrid: index section at the top, leaf content below — that's allowed.
3. **For each index doc / index section:**
   - Open it, scan every bullet/row.
   - Each entry must be one line (≤ ~150 chars). If an entry has a colon-then-paragraph or multi-line body, it's a violation.
   - Violation → either (a) the body belongs in an existing child leaf (move it, leave a one-line pointer), or (b) create a new `c_c_*.md` child with the body and link to it.
4. **For each leaf doc:** verify it's actually leaf content. If it's grown an index-shaped section in front (a "see also" list of children with multi-line descriptions), apply the rule to that section.
5. **Check pointer freshness.** `.claude/CLAUDE.md` should have one pointer per top-level `docs/c_*.md`. If a top-level doc exists with no pointer, add one. If a pointer references a missing file, remove it.
6. **Patch in-place** with `Edit`. Don't create planning docs. Don't write a summary file.
7. **Report.** Print one completion line: `tree: audited N docs, patched M, created K children, removed P stale pointers.`

## What NOT to do

- Don't split leaf docs that are intentionally consolidated (e.g. `c_schema.md` is golden-source by design — its 25 per-table sections are leaf content, not index entries).
- Don't flatten leaf docs into the parent. Hierarchy is the point.
- Don't commit. Patches only; the human commits on the next natural boundary.
- Don't touch code, tests, or migrations. Docs only.

## Scope

- **In:** `.claude/CLAUDE.md`, `docs/c_*.md` and deeper, `.claude/commands/c_*.md`.
- **Out:** `dev/planning/**`, code, agent definitions, settings, hooks.

## Related

- [`.claude/CLAUDE.md`](../CLAUDE.md) — the **Authoring rule (hard)** lives here.
- [c_librarian.md](c_librarian.md) — sibling discipline; `<librarian>` patches code↔doc drift, `<tree>` patches doc-shape drift.
