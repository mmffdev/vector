---
name: css-naming-convention
description: Hierarchical semantic CSS/HTML naming convention — single+double underscore hierarchy, proposal-before-write rule, dual TSX+CSS output required
metadata:
  type: feedback
---

When creating HTML/CSS for user-facing interfaces, follow strict hierarchical semantic naming conventions that prioritise human readability.

**Pattern:** `root-block__Container_Child_Grandchild_leaf`

**Separators:**
- `__` (double underscore) — used **once only**, between the root block and its first container
- `_` (single underscore) — all deeper nesting levels below the first container
- `-` (hyphen) — modifier/state only, never hierarchy (e.g. `_StreetInput-disabled`)

**Casing:**
- Root block: `kebab-case` (e.g. `nav-primary-rail-1`, `checkout-form`)
- Containers and children: `PascalCase` for multi-word containers, `camelCase` for leaf elements

**The progression map rule:** every child name is its parent name plus one segment. Strip the last segment from any class name and you get its parent's class name exactly. This encodes the full DOM tree in the names themselves.

**Example — full nesting chain:**
```
checkout-form
checkout-form__AddressPanel
checkout-form__AddressPanel_StreetInput
checkout-form__AddressPanel_StreetInput_label
checkout-form__AddressPanel_StreetInput_label-error   ← modifier state
```

**Live project examples:**
```
nav-primary-rail-1
nav-primary-rail-1__ProfileStack
nav-primary-rail-1__ProfileStack_Pill
nav-primary-rail-1__ProfileStack_Pill_Label

nav-primary-rail-2
nav-primary-rail-2__SectionHeader
nav-primary-rail-2__SectionHeader_Clock
```

**Rules:**
1. Every name reveals its full parent ancestry left to right
2. Strip the last segment — you get the parent class exactly
3. Never use generic names alone: `div1`, `container`, `wrapper`, `panel`, `box`, `inner`, `main`
4. `__` appears exactly once per name — at the root boundary only
5. No BEM `--` modifiers — use a single `-` on the final segment instead

**Always ask:** "If a human scans just the class name, will they instantly know where this lives in the DOM tree?" If no, add the parent prefix.

Applies to: all divs, sections, containers, cards, modals, forms, inputs, buttons, grids, flex children, and any nested structural element in web UI.

---

## MANDATORY PROPOSAL STEP — fires before writing any DOM element

Before writing a single class name or ID to any `.tsx`, `.jsx`, or `.css` file:

1. Output the full proposed naming chain from root to leaf
2. Show **both surfaces simultaneously** — TSX structure AND CSS selectors
3. Ask: "Does this naming structure look right before I apply it?"

**Required output format:**

```
Proposed naming chain:

TSX:
  <div id="root-block__Container" className="root-block__Container">
    <div className="root-block__Container_Child">
      <span className="root-block__Container_Child_leaf" />
    </div>
  </div>

CSS:
  .root-block__Container { }
  .root-block__Container_Child { }
  .root-block__Container_Child_leaf { }
  .root-block__Container_Child_leaf-modifier { }

Does this naming structure look right before I apply it?
```

Do not write a single class name to a file without completing this step first.
