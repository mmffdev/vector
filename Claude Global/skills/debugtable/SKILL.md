---
name: debugtable
description: Toggle 1px red debug borders on/off for the grid or table currently being worked on.
argument-hint: [on|off] — defaults to "on" if omitted
---

# Debug Table

Toggle a 1px solid red debug border on every cell and the outer container of the grid/table currently in context.

## Behaviour

**`/debugtable` or `/debugtable on`** — Add debug borders:
1. Identify the CSS file for the grid/table currently being discussed or last edited.
2. Add `border: 1px solid red;` to:
   - The outer grid/table container
   - All cell selectors (`> span`, `> td`, `> th`, or equivalent direct-child cell rules)
3. Use a CSS comment `/* DEBUG */` at the end of each added border line so they are easy to find and strip.

**`/debugtable off`** — Remove debug borders:
1. Find all lines containing `/* DEBUG */` in the target CSS file.
2. Remove those lines entirely.
3. Verify no other changes were made.

## Rules
- Never commit debug borders — always strip before any commit.
- If the target grid/table is ambiguous, ask which one.
- Do not touch any other styles — only add/remove the debug border lines.

$ARGUMENTS
