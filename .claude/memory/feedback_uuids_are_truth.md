---
name: feedback-uuids-are-truth
description: "UUIDs and enum codes are the contract; topology/workspace/role display names are user-editable labels that drift. Don't gate logic or warnings on names. If an apparent mismatch surfaces, ask Rick before second-guessing."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 29b5639a-3ec7-4597-bd09-52042a16511e
---

UUIDs (and enum codes like `gadmin`/`padmin`/`backlog`/`work`/`strategy`) are the source of truth. Display names — topology node names, workspace names, role labels — are mutable user-facing strings that can be renamed at any time, and frequently are during demo setup.

**Why:** 2026-05-18 — during the topology-pinning task, the node `79a3dd22…` was named "B2C Insurance Team B" when I ran the first ILIKE search, then renamed by Rick to "B2B Insurance Team B" between queries. I burned a turn worrying about a name mismatch when the UUID was what mattered.

**How to apply:**
- Identify rows by UUID or enum code in every SQL, verification, and assertion. Names go in display-only columns of the result set, never in `WHERE`.
- Don't query by name (`WHERE name ILIKE …`) when a UUID is available. Use ILIKE only for first-pass discovery, then capture the UUID and reference that from then on.
- Don't flag "the name doesn't match what you said" as a warning or trigger a re-confirmation flow. If the UUID is the one Rick confirmed, proceed. The display name catching up is housekeeping.
- When summarising what was done, lead with UUIDs and treat names as parenthetical: `node 79a3dd22… ("B2B Insurance Team B")`, not the other way around.
- **Exception — apparent error or contradiction:** if while working you spot a mismatch that looks like a real error (UUID resolves to a row that contradicts what Rick said in plain language; an enum value not in the catalogue; a foreign-key target that does not exist; a fact that breaks the user's stated intent), STOP and ask Rick before deciding whether to proceed. Don't silently guess and don't silently "fix" — the name-drift case above is housekeeping; a genuine contradiction is a clarifying-question moment.
