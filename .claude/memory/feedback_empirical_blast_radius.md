---
name: feedback-empirical-blast-radius
description: Before recommending or making any non-trivial change, verify blast radius empirically — read the actual files, run the actual scripts, check the actual snapshots — never rely on a prior agent's second-hand summary.
metadata:
  type: feedback
---

Before making a change with any cross-cutting risk (CI workflow, route topology, schema, build pipeline, lint config), I must do the blast-radius work myself — not just quote what a previous Explore/research agent said.

**Why:** Second-hand findings get stale, mis-summarised, or miss adjacent files. On 2026-05-13 I told Rick "the CI workflow only diffs `paths:` so server URL changes are safe" based on a sub-agent report — without ever reading `.github/workflows/api-contracts.yml` myself. He called it out: "have you assessed blast radius". I had not, properly.

**How to apply:**
- Before recommending a deletion/cleanup that touches CI gates, lint rules, snapshots, schemas, or routing topology: open the actual workflow files, run the actual scripts dry, inspect the actual snapshot/baseline dirs.
- "An agent said" is a hypothesis, not evidence.
- A blast-radius assessment without commands run + files read is not an assessment.
- When in doubt, run the script and read the output instead of predicting it.
- If I cannot empirically verify (e.g. requires production access), say so explicitly: "I haven't verified X because Y — proceed with caution."
