---
name: No browser-default alert/confirm/prompt — always in-page UI
description: Never use window.alert/confirm/prompt — every alert and confirmation must live inside the page's UI/UX system; pick the form by context.
type: feedback
originSessionId: 43139e10-f5f1-4a48-bb00-5f2c887dc814
---
Never use `window.alert`, `window.confirm`, or `window.prompt` for alerts, errors,
or destructive-action confirmations. Every notice or confirmation MUST be part
of the page's own UI/UX system.

**Why:** Browser-default dialogs break the design language, can't be styled,
disrupt layout flow, and feel out-of-product. Vector has its own visual system —
notices belong inside it.

**How to apply:**
- Pick the form by context — use common sense, no single rule:
  - Banner / full-width inline row across the page or component (notices, errors)
  - Inline message attached to the element that triggered it
  - Tick / cross icon pair next to the trigger button (lightweight binary
    confirmation — best for destructive actions on a single row, e.g. removing
    a preset/profile pill)
  - Accept / Confirm or Yes / No button pair (slightly heavier confirmation)
  - Type-to-confirm (e.g. "RESET" or "DELETE") for catastrophic, irreversible
    actions only — overkill for everyday destructive ops
- Decide whether the action even NEEDS a confirmation step. Trivial reversible
  actions don't; destructive irreversible ones do.
- If a confirmation slot does not yet exist in the component, add one inline —
  do NOT fall back to `confirm()` as a stopgap.
