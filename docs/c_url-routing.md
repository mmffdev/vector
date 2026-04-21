# URL routing for work items

Work item URLs come in two forms. One is canonical and survives all renames; the other is a friendly alias that redirects.

## Canonical route — always use for storage

```
/item/<uuid>
```

`<uuid>` is the immutable item id from the item table. Every internal reference writes this form: bookmarks, audit log `resource_id` fields, GitHub commit-message hooks, Slack unfurl cards, OpenGraph meta tags. Renaming `US` → `STORY` does not touch UUIDs, so nothing breaks.

## Friendly alias — convenience, rewrites

```
/item/US-00000347
```

Parse prefix + number → look up by `(tenant_id, type_id_with_current_tag='US', key_num=347)` → **301 redirect** to `/item/<uuid>`. The alias resolves against the **current** tag. After a rename, `/item/US-00000347` stops resolving and `/item/STORY-00000347` starts — old bookmarks hit a "this item was renamed" redirect, not a raw 404.

Rule: one canonical URL per item. Never serve both forms — search engines, Slack unfurls, and share cards must all converge on the UUID route or they drift out of sync.

## What the UI renders

Humans read `US-00000347`, so that's what shows in tables, badges, breadcrumbs, everywhere. But every link *under* the render points at `/item/<uuid>`. Copy-link buttons copy the canonical UUID form.

## Rename grace period

When a tag is changed (e.g. `US` → `STORY`), stale aliases (`/item/US-00000347`) should return a friendly "this item is now `STORY-00000347`" page with a link, not a 404. Lookup: "was this (tag, key_num) ever valid for this tenant?" Cheapest answer is a small `item_key_alias` table written at rename time; deferred until first rename ships. Not needed for MVP.

## What this does NOT need from the DB

Nothing new. `execution_item_types.tag` and `portfolio_item_types.tag` are the current-tag source. `key_num` is immutable by design. The UUID is the primary key of the item row.
