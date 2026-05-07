# v2 work-items cutover — deferred-work register

**Plan:** PLA-0023
**Status:** in progress (filled as cutover stories land)
**Last updated:** 2026-05-07

## Why this exists

The v2 work-items cutover (PLA-0023) consciously defers a number of items so the
read-only cutover can ship without scope creep. Each deferral below has a trigger
condition; when the trigger fires, the item gets storified and addressed.

## Deferred items

| Item | Why deferred | Trigger | Owner | Status |
|------|-------------|---------|-------|--------|
| `flow_state_code` 5→4 vocabulary collapse | v2 schema doesn't carry 'ready'/'accepted' kinds; SELECT-side CASE projects them as 'backlog'/'completed' | if any frontend toggle requires the lost fidelity | _pending fill_ | open |
| EAV custom-field reads not wired into v2 list | cutover scope is the production wire shape only; custom fields are a separate surface | when first custom-field consumer migrates | _pending fill_ | open |
| ranking NOTIFY trigger not re-attached to `vector_artefacts.artefacts` | live drag-and-drop currently fires on `obj_work_items`; v2 list has no NOTIFY emitter yet | when WORK_ITEMS_V2=true on dev and DnD breaks | _pending fill_ | open |
| `entityrefs` vocabulary missing 'artefact_work' / 'artefact_strategy' entries | cross-DB FK pattern needs new entityrefs codes for the new substrate | when first feature lands that needs cross-DB references to artefacts | _pending fill_ | open |
| `obj_work_items` + per-type sibling tables not dropped | keep them live for 7+ days post-cutover for safe rollback; drop is a separate plan | 7 days post WORK_ITEMS_V2=true on dev with zero rollback | _pending fill_ | open |
| templates UX surface unbuilt for v2 | templates are write-side; cutover is read-only | when write-side cutover plan is drafted | _pending fill_ | open |
| `key_num` per-type renumbering deferred | cutover preserves WI-NN public IDs; per-type prefixed numbering is a UX improvement, not a parity bug | when product wants visible-by-type IDs | _pending fill_ | open |
| `created_by_user_id` nullability loosening (S3 debt) | v2 schema allows null; v1 wire emits `coalesce(...,'')` | if any consumer hits the empty string path | _pending fill_ | open |
| missing fine-grained `work_items.read` permission (S3 debt) | inherits v1 gap; promote when permission catalogue grows | when fine-grained read permissions are added | _pending fill_ | open |
