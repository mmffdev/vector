# Vector artefacts — cutover COMPLETE

> Status: **Fully retired** (2026-05-08). `obj_work_items` and
> `obj_work_items_field_values` dropped via migration 137. All work-item
> reads/writes now target `vector_artefacts.artefacts` exclusively via the
> v2 backend (`workitemsv2` package, `/samantha/v2/work-items`).

## What was done

- `backend/internal/workitems/` (v1 package) deleted.
- Four v1 route blocks (`/work-items`, `/sprints`, `/custom-field-library`,
  `/work-item-templates`) removed from `main.go`.
- `ranking.Register("work_item")` retargeted to `artefacts` /
  `timebox_sprint_id` scope via `vaPool`; rank service refactored to
  single-`position` column model.
- ETL backfill (`db/artefacts_schema/015_backfill_work_items.sql`) deleted.
- DB migration `137_drop_obj_work_items.sql` created and ready to apply.
- Frontend `CORE_FIELDS` updated to `artefacts.*` column names.

## Remaining open items

See [`c_c_v2_workitems_cutover_followups.md`](c_c_v2_workitems_cutover_followups.md)
for any deferred work from the original PLA-0023 cutover.

Cross-refs: [`c_schema.md`](c_schema.md), [`c_c_ranking.md`](c_c_ranking.md).
