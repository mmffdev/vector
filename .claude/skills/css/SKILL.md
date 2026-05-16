# `<css>` Skill

Audits a named UI element against the CSS/HTML naming convention and proposes corrected class names. Can also apply fixes after confirmation.

**Convention spec:** [`.claude/memory/css_naming_convention.md`](../../memory/css_naming_convention.md)

---

## Invocation

```
<css> <target>
<css> <target> --apply
<css> <target> --strip-debug
```

- **`<target>`** — a natural-language description of the element to audit (e.g. `navigation rail 1`, `AccountFlyout`, `work items table header`)
- **`--apply`** — after the audit and proposal, apply all confirmed renames without a second prompt
- **`--strip-debug`** — locate and remove all debug `style={{ border: "..." }}` attributes in the target files

---

## Steps

### 1 — Resolve the target

Search the codebase for files matching `<target>`:

1. Grep `app/redesign/components/`, `app/components/`, `app/(user)/` for TSX files whose filename or component name loosely matches the target words.
2. Grep `app/redesign/shell.css`, `app/globals.css`, and any co-located `.css` files for selectors matching the target words.
3. If zero matches: ask the user to clarify — output the closest candidates found and ask which one(s) to audit.
4. If multiple distinct components match: list them and ask which to audit, or confirm to audit all.
5. If one clear match: proceed without asking.

### 2 — Read the files

Read all matched TSX and CSS files in full. Do not skip lines.

### 3 — Extract all class names and IDs

For the target element and all its descendants:

- Collect every `className="..."`, `className={\`...\`}`, `id="..."` value.
- Also collect every CSS selector (class, ID, attribute) from the matched CSS files.
- Build a flat inventory:

```
INVENTORY:
  TSX className  → "rd-flyout"
  TSX className  → "rd-flyout__title"
  TSX id         → "flyout-section"
  CSS selector   → .rd-flyout { }
  CSS selector   → .rd-flyout__title { }
```

### 4 — Audit against the convention

For each name in the inventory, check:

| Rule | Pass / Fail |
|---|---|
| Root block is `kebab-case` | |
| `__` appears exactly once — at root boundary | |
| All nesting below root uses `_` (not `__`) | |
| Modifiers use single `-` on final segment only | |
| No generic names: `wrapper`, `container`, `box`, `inner`, `panel`, `main`, `div1` | |
| Strip last `_Segment` → equals parent class exactly (progression map rule) | |
| TSX `className` and CSS selector are in sync (no orphaned CSS) | |

Flag every violation with:
```
VIOLATION: "rd-flyout__title"
  → __ used at root boundary ✓
  → but root block "rd-flyout" is not the correct name for this element
  RULE: root block should reflect component identity
```

### 5 — Propose full corrected naming chain

Output the complete proposed chain from root to all leaves. Show **both surfaces simultaneously**:

```
Proposed naming chain:

TSX:
  <aside id="nav-primary-rail-2" className="nav-primary-rail-2">
    <div id="nav-primary-rail-2__SectionHeader" className="nav-primary-rail-2__SectionHeader">
      <h3 className="nav-primary-rail-2__SectionHeader_Title">…</h3>
      <p className="nav-primary-rail-2__SectionHeader_Clock">…</p>
    </div>
    <div id="nav-primary-rail-2__PageList" className="nav-primary-rail-2__PageList">
      <div className="nav-primary-rail-2__PageList_Group">
        <div className="nav-primary-rail-2__PageList_GroupLabel">…</div>
        <a className="nav-primary-rail-2__PageList_Row">
          <span className="nav-primary-rail-2__PageList_RowIcon">…</span>
          <span className="nav-primary-rail-2__PageList_RowLabel">…</span>
        </a>
      </div>
    </div>
  </aside>

CSS:
  .nav-primary-rail-2 { }
  .nav-primary-rail-2__SectionHeader { }
  .nav-primary-rail-2__SectionHeader_Title { }
  .nav-primary-rail-2__SectionHeader_Clock { }
  .nav-primary-rail-2__PageList { }
  .nav-primary-rail-2__PageList_Group { }
  .nav-primary-rail-2__PageList_GroupLabel { }
  .nav-primary-rail-2__PageList_Row { }
  .nav-primary-rail-2__PageList_Row-active { }  ← modifier
  .nav-primary-rail-2__PageList_RowIcon { }
  .nav-primary-rail-2__PageList_RowLabel { }
```

If no violations were found, output:
```
AUDIT PASS: all class names and IDs conform to the naming convention.
```
and stop.

### 6 — Confirm before applying

After outputting the proposed chain, ask:

> Does this naming chain look right? Reply **yes** to apply all renames, or correct any names before I write.

If `--apply` flag was passed, skip this prompt and apply immediately after showing the proposal.

### 7 — Apply renames

For each rename:

1. Edit the TSX file — replace old `className` values and `id` values with the new names.
2. Edit the CSS file — replace old selectors with new selectors. Preserve all declarations; change selector strings only.
3. If a CSS selector had no TSX counterpart (orphan), flag it and ask whether to delete it.
4. After all edits, grep for the old names across the whole codebase — report any remaining references that were not in the target files.

### 8 — Strip debug borders (if `--strip-debug`)

Search the target TSX files for any `style={{ border:` or `style={{ border:` patterns and remove those attributes. Report each removal.

---

## Rules

- Never rename a CSS custom property (e.g. `--rd-rail-w`) — only class names and IDs.
- Never rename a class that belongs to a third-party library (e.g. `is-active`, `btn`, `pill`).
- State classes (`is-active`, `is-nested`, `has-children`) are not subject to the naming convention — leave them as-is.
- Always show the full chain — never show just the changed names in isolation.
- If the target spans more than 3 files, list the files before reading and ask: "I'll audit these N files — confirm?" before proceeding (unless `--apply` is set).
- `--apply` does not skip the proposal display — it only skips the confirmation question.
