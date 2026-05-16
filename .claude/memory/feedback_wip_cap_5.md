---
name: wip-cap-5
description: Solo-dev mode — Vector_Scope.md is WIP-capped at 5 in-flight themes. Anything beyond moves to ## Parked; touching a parked item requires parking another.
metadata:
  type: feedback
---

In **solo-dev mode** (since 2026-05-17), `Vector_Scope.md` is WIP-capped at **5 in-flight themes**. A theme = one top-level `## ` header that contains at least one `🔵 IN FLIGHT` line. Sub-items inside a theme don't count separately — moving from FE-POR-0002.1.3 to FE-POR-0002.2.1 stays inside one theme, not two.

**Why:** Multi-stream work in a solo context fragments attention without parallelism benefits. Each theme open = one context that has to be re-loaded, one set of design constraints to remember, one place where decisions can drift. Five is enough breadth to switch contexts when one stalls; more becomes thrash. The cap is empirically chosen — pulled tight when 44 in-flight items were surfacing on every session-start and most weren't being touched.

**How to apply:**

- **Default:** check the SessionStart digest before starting work. If it warns `⚠️ Solo-dev WIP cap exceeded: N themes in-flight (cap = 5)`, the WIP-cap hook ([`.claude/hooks/scope-session-start.sh`](../hooks/scope-session-start.sh)) caught a 6th theme — park one before continuing.
- **Adding a new theme** = swap. Move an existing theme to `## Parked` (verbatim, no content loss), then add the new one. Single transaction.
- **Touching a parked theme** = swap. To restart parked work, an active theme has to park. Cap stays at 5.
- **Prod-ready re-activation** unparks the WIP cap entirely — full team-style multi-stream is back on the table.

**Edge cases:**

- **A sub-item ships, theme isn't "done" yet** — theme stays in-flight; no swap needed.
- **A theme finishes** (last sub-item marked done) — slot frees up; new work can move in without parking anything.
- **Cross-cutting fix that spans two parked themes** — surface it instead of "just doing it". The point of parking is to be honest about what's getting attention. A drive-by fix to a parked theme defeats the WIP cap.

**Parking format:** parked themes live verbatim under `# Parked — solo-dev mode (since 2026-05-17)` at the bottom of `Vector_Scope.md`. Every sub-item, every priority tag, every commit ref preserved. Unpark by moving the section back above the Parked divider; mark another theme parked in the same edit.

Related: [[solo-dev-mode]], [[no-new-pla-plans]], [[scratch-outside-repo]], [[retros-auto-only]].
