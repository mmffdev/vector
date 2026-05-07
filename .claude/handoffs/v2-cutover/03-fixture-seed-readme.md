# 03 — Work Items v2 Fixture Seed (handover)

Companion to `03-fixture-seed.sql`. This README is the application + acceptance brief
for the next agent picking the fixture up to commit it to the artefacts-schema seed dir.

## Target

- **Database:** `vector_artefacts` (the unified-artefact PoC DB).
- **Subscription:** `00000000-0000-0000-0000-000000000001` (MMFFDev dev tenant) —
  same as `db/seed/002_work_items_poc.sql` and `db/artefacts_schema/011_seed_system_strategy_types.sql`.
- **Tunnel host/port:** `localhost:<DEV_DB_PORT>` — resolve via
  `dev/scripts/resolve-dev-db-port.sh` (canonical `5435`, fallback `5434`).

## How to apply

```bash
# Resolve the dev tunnel port from the canonical resolver (no hard-coding).
DEV_DB_PORT=$(./dev/scripts/resolve-dev-db-port.sh | cut -f1)

PGPASSWORD="<dev-pw>" psql \
    -h localhost -p "$DEV_DB_PORT" -U mmff_dev \
    -d vector_artefacts \
    -v ON_ERROR_STOP=1 \
    -f .claude/handoffs/v2-cutover/03-fixture-seed.sql
```

The seed runs inside a single `BEGIN; ... COMMIT;` transaction with a top-level
`DO $$ ... $$` block. On success it emits:

```
NOTICE:  Work Items v2 fixture seed complete (15 artefacts: 3 epic, 6 story, 4 task, 2 defect).
```

## Idempotency guarantee

Every `INSERT` targets `artefacts.id` (the primary key) with
`ON CONFLICT (id) DO NOTHING`. The 15 row UUIDs are deterministic
(`10000000-0000-0000-0000-0000000001xx | 0002xx | 0003xx | 0004xx`),
mirrored verbatim from `db/seed/002_work_items_poc.sql`. Re-running the file
is a no-op — no duplicates, no errors. The pre-flight type lookup is purely
read-only and the flow-state lookups are `SELECT INTO` only.

## Prerequisites

The seed will `RAISE EXCEPTION` (and the transaction will roll back) if any
prerequisite is missing. Two are required:

1. **Schema migrations applied** — `db/artefacts_schema/001..009` must have
   been run against `vector_artefacts`. (Migration `011` is also typically
   present but is not strictly required by this fixture.)

2. **System work types seeded for the PoC subscription** — the four work
   `artefact_types` rows (Story `US`, Defect `DE`, Task `TA`, Epic `EP`)
   plus their default flow + canonical `todo|in_progress|done|cancelled`
   states. The seeding function lives in
   `db/artefacts_schema/010_seed_system_artefact_types.sql` but **is NOT
   auto-invoked by that file** (only `011_seed_system_strategy_types.sql`
   self-invokes for `00000000-...-0001`). You must run, before this fixture:

   ```sql
   SELECT seed_system_artefact_types('00000000-0000-0000-0000-000000000001'::uuid);
   ```

   Recommendation for the next agent: when committing this fixture, also
   add a self-invoking `SELECT seed_system_artefact_types(...)` line at the
   bottom of `010_seed_system_artefact_types.sql` mirroring the pattern in
   `011`. That removes the implicit ordering trap. Surfaced as **PREREQ-1**
   below.

### Prerequisite ledger

| #         | Item                                                          | Status                    | Owner action                                                                                                                  |
| --------- | ------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| PREREQ-1  | `seed_system_artefact_types(<sub>)` not auto-invoked          | **MISSING** in 010 file   | Either invoke before applying this fixture, or patch 010 to self-invoke for `00000000-...-0001` (matching pattern in 011).    |
| PREREQ-2  | `field_library` rows for sprint / priority / story-points     | Not seeded                | Out of scope for this fixture. The legacy `o_execution_custom_field_library` rows are NOT mirrored. Track separately.         |
| PREREQ-3  | `mmff_vector.workspace` row aligned with fixture workspace_id | N/A (soft FK, not pinned) | Fixture uses `20000000-0000-0000-0000-000000000001` as a fixture-only workspace UUID. Document if production needs alignment. |

## Row count + summary

**15 rows** inserted into `artefacts` (zero into supporting tables):

- **3 epics** — top-level (no parent), per-type counter `1..3`.
- **6 stories** — two children per epic, per-type counter `1..6`.
- **4 tasks** — children of stories `US-3` / `US-4`, per-type counter `1..4`.
- **2 defects** — children of stories `US-2` / `US-4`, per-type counter `1..2`.

Public IDs (rendered as `prefix-number`) match the source fixture's intent:
`EP-1..3`, `US-1..6`, `TA-1..4`, `DE-1..2`. Note the legacy seed used a
single `key_num` counter `1..15` across all types; the new model gives each
type its own counter, so the numeric portion of the public ID changes
deliberately. The UUIDs are unchanged, so any code joining across the two
DBs by `id` continues to line up.

`flow_state_id` is set on every row using the per-type default flow's
`(todo | in_progress | done)` state, mapped from the source row's `status`:

| source `status` | mapped `flow_states.kind` |
| --------------- | ------------------------- |
| `open`          | `todo`                    |
| `in_progress`   | `in_progress`             |
| `done`          | `done`                    |

## What is NOT seeded (deliberately)

The legacy fixture seeds five categories that have no 1:1 home yet in the
new schema; they are out of scope and tracked under PREREQ-2:

- **Sprints** (`sprints` table) — sprint membership in the new model belongs
  in `artefact_field_values` against a `field_library` "sprint" entry. Not
  wired.
- **Custom field library** (`o_execution_custom_field_library`) — the new
  equivalent is `field_library`, but no rows are seeded here.
- **Templates** (`o_execution_work_item_templates` + `_template_fields`) —
  no templating concept in the unified-artefact PoC schema.
- **Priority / story-points** — both are custom fields in the new model;
  not wired.
- **`status` text column** — replaced by `flow_state_id`. The mapping above
  preserves the visible state-kind on every row, so the v2 page renders
  the correct pill.

## Verification queries

After applying the fixture, the next agent can sanity-check with:

```sql
-- Expect 15 rows (3 + 6 + 4 + 2).
SELECT count(*) FROM artefacts
 WHERE subscription_id = '00000000-0000-0000-0000-000000000001';

-- Expect 4 rows, one per work prefix.
SELECT prefix, count(*) FROM artefacts a
  JOIN artefact_types t ON t.id = a.artefact_type_id
 WHERE a.subscription_id = '00000000-0000-0000-0000-000000000001'
 GROUP BY prefix ORDER BY prefix;

-- Per-type counter sanity: max(number) should equal the row count for that type.
SELECT t.prefix, max(a.number) AS max_number, count(*) AS rows
  FROM artefacts a JOIN artefact_types t ON t.id = a.artefact_type_id
 WHERE a.subscription_id = '00000000-0000-0000-0000-000000000001'
 GROUP BY t.prefix ORDER BY t.prefix;

-- All rows should land on a real flow_state of the matching type.
SELECT count(*) AS unmapped FROM artefacts a
 WHERE a.subscription_id = '00000000-0000-0000-0000-000000000001'
   AND a.flow_state_id IS NULL;  -- expect 0
```

The v2 page (`app/v2/work-items/page.tsx`) should render all 15 rows in the
single flat table with correctly-coloured state pills, once `/api/v2/*`
points at `vector_artefacts`.

## Final destination if accepted

There is **no `db/artefacts_schema/seed/` directory yet** in the repo. The
recommended path for the accepted file is:

```
db/artefacts_schema/seed/01_work_items_fixture.sql
```

Rationale:

- Mirror the existing `db/seed/NN_*.sql` numeric-prefix style used for
  `mmff_vector` seeds (`001_default_workspace.sql`, `002_work_items_poc.sql`,
  `003_load_test_work_items*.sql`).
- Use `01` (the lowest free number) since the directory is empty.
- Keep the filename theme (`work_items_fixture`) so the cutover narrative
  reads naturally next to the legacy `002_work_items_poc.sql`.

If the agent decides numeric-prefix style under `db/artefacts_schema/seed/`
should be three-digit (`001_…`) to match the migration files in the parent
directory, that's also fine — flag the choice in the commit message.

## Open questions blocking the seed

None — the fixture is ready to apply once **PREREQ-1** is satisfied. The
two remaining ledger items (**PREREQ-2**, **PREREQ-3**) are explicit
out-of-scope decisions, not blockers.
