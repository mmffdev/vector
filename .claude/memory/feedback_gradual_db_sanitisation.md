---
name: Sanitise legacy DB gradually, drop tables as they become unused
description: Migration strategy preference — never big-bang; drop legacy tables/columns one at a time as their last consumer is removed
type: feedback
---

When migrating data or schema away from a legacy database (e.g. mmff_vector → vector_artefacts), the user's preferred strategy is to **sanitise the old DB slowly, dropping tables/columns as they become unreferenced**, never a big-bang demolition.

**Why:** Big-bang DB cutovers break unrelated systems, leave broken FKs, and lose audit history. Gradual sanitisation lets each handler/feature migrate at its own pace while the legacy table sits frozen but readable for backstop. As the last consumer of each legacy table is removed, that table is dropped — small, reversible, traceable change set.

**How to apply:**
- Don't propose to delete a legacy table in the same PR that introduces its replacement. Drop comes in a follow-up PR after the last reader is migrated.
- When proposing a schema cutover, plan for a coexistence window: legacy tables stay live (read-only or write-frozen) until every handler/page is migrated, then a "drop unused" PR removes them.
- Track the deferred drops in [`docs/c_c_v2_workitems_cutover_followups.md`](../docs/c_c_v2_workitems_cutover_followups.md) (or equivalent register) — every legacy table has a row with trigger condition + owner + status.
- Don't denormalise data INTO the new table just to avoid a cross-DB join. The legacy column stays where it is; the new table only holds NEW concerns.
