---
name: BlockingReleaseGate — how to gate gadmin pages
description: Pattern for gating any gadmin page behind unacknowledged breaking library releases
type: project
originSessionId: 421fcf55-eca4-4ec4-8e12-4a283071d470
---
Wrap any gadmin page with `<BlockingReleaseGate>` to block access when there are unacknowledged breaking releases.

**Why:** Phase 3 §12.6 requires breaking severity releases to block page access until acknowledged. The gate is a reusable component — any new gadmin page should use it.

**How to apply:** Import `BlockingReleaseGate` from `app/components/BlockingReleaseGate.tsx` and wrap the page's return content. The `LibraryReleasesContext` (wired into the user layout) provides the `hasBlocking` flag automatically — no props needed.

**Do NOT use on padmin-only pages.** gadmin acks library releases; padmin never sees them. A padmin-only page that imports the gate is dead code (the `hasBlocking` branch is unreachable for that role). See `project_role_boundaries.md`.

Key files:
- `app/components/BlockingReleaseGate.tsx` — the gate component
- `app/contexts/LibraryReleasesContext.tsx` — shared poll loop; exposes `{count, hasBlocking}`
- `app/(user)/portfolio-model/page.tsx` — reference implementation
