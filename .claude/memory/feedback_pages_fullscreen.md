---
name: Pages default to full screen
description: All new pages created in the Vector app should be full screen by default unless the user specifies otherwise.
type: feedback
originSessionId: 8522631e-91de-4237-9d3b-24d74b99c168
---
All pages created in the Vector app are full screen by default unless the user explicitly specifies a different layout.

**Why:** User preference — stated explicitly after the DevResearchPanel was built with `max-width: 960px`.

**How to apply:** When scaffolding or building any new page component, do not constrain the container width (no `max-width`, no fixed-width wrapper). Use full-width layout. Only deviate if the user specifies a narrower layout or the design system explicitly requires it for a specific component type.
