---
name: Split stories larger than 13 points
description: A single story estimated at >13 points signals ambiguity or unclear acceptance criteria — recommend splitting, never for sprint capacity reasons.
type: feedback
originSessionId: 8a7bc621-116a-450b-b2fe-592956aaea84
---
When a single user story is estimated at **more than 13 story points**, recommend splitting it.

**Why:** The point ceiling signals the story is ambiguous, has fuzzy acceptance criteria, or hides multiple independent concerns. It's a *sizing quality* concern, not a *sprint capacity* concern. Large stories are harder to accept because acceptance criteria haven't been thought through sharply enough.

**How to apply:**
- Flag any story >13pts when created or estimated and suggest breaking it into smaller independent units
- Never recommend splitting based on total sprint points — sprints are work bundles here, not time boxes (see feedback_sprints.md)
- Acceptable splits often fall along acceptance criteria — each criterion becomes its own story
- The 13pt threshold matches Fibonacci sizing convention (1, 2, 3, 5, 8, 13 — anything beyond is uncertain)
