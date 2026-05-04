# Proposal: Soft-delete for `user_custom_pages`

**Status:** Draft  
**Date:** 2026-05-04  
**Trigger:** Two user pages ("AAA", "test") were permanently destroyed with no recovery path. The current `DELETE FROM user_custom_pages` at `backend/internal/custompages/service.go:280–291` is irreversible.

---

## Problem

Deleting a custom page is a hard `DELETE`. Views cascade. Nav-pref `item_key` references (`custom:<uuid>`) become dangling string keys with no FK to clean them up (acknowledged in `docs/c_c_custom_pages.md`). Once deleted, a page and its views are gone — no undo, no admin recovery.

---

## Proposal: Add `deleted_at TIMESTAMPTZ NULL`

Flip the `Delete` path from a hard `DELETE` to a soft `UPDATE … SET deleted_at = NOW()`. All read paths gain a `AND deleted_at IS NULL` filter. A Trash panel lets users restore or permanently purge.

---

## Migration sketch

**File:** `db/schema/037_user_custom_pages_soft_delete.sql`

```sql
BEGIN;

-- 1. Add the soft-delete column.
ALTER TABLE user_custom_pages
    ADD COLUMN deleted_at TIMESTAMPTZ NULL;

-- 2. The existing named unique constraint covers all rows (including
--    soft-deleted ones), which would prevent re-creating a page with
--    the same label after a soft-delete. Replace it with a partial
--    unique index that only covers live rows.
ALTER TABLE user_custom_pages
    DROP CONSTRAINT user_custom_pages_label_unique;

CREATE UNIQUE INDEX user_custom_pages_label_active_unique
    ON user_custom_pages (user_id, subscription_id, label)
    WHERE deleted_at IS NULL;

-- 3. Make the primary owner lookup index partial (live rows only).
--    Keep a separate index for trash queries.
DROP INDEX IF EXISTS idx_user_custom_pages_owner;

CREATE INDEX idx_user_custom_pages_owner_active
    ON user_custom_pages (user_id, subscription_id)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_user_custom_pages_owner_deleted
    ON user_custom_pages (user_id, subscription_id, deleted_at)
    WHERE deleted_at IS NOT NULL;

COMMIT;
```

No table lock beyond metadata-only DDL for `ADD COLUMN NULL`. The unique constraint swap requires a short exclusive lock on an in-practice small table (capped at 100 rows per user).

> **Note (doc drift):** `docs/c_c_custom_pages.md` states the cap is 50 pages; the service constant `MaxPagesPerUser` is 100 (`service.go:23`). The doc needs updating independently of this proposal.

---

## List / Get filter changes

Every query in `backend/internal/custompages/service.go` gains `AND deleted_at IS NULL`:

| Call site | Change |
|---|---|
| `ListPagesOnly` (line 86–90) | `WHERE user_id=$1 AND subscription_id=$2 AND deleted_at IS NULL` |
| `Get` (line 114–118) | add `AND deleted_at IS NULL` — soft-deleted rows return 404 |
| Cap count in `Create` (line 187–188) | add `AND deleted_at IS NULL` — soft-deleted rows don't count toward the cap |
| `Delete` (line 280–283) | change to `UPDATE … SET deleted_at = NOW()` |

New methods added (no schema change):

- `ListDeleted(ctx, userID, subscriptionID)` — returns soft-deleted pages for the Trash UI, ordered by `deleted_at DESC`.
- `Restore(ctx, userID, subscriptionID, pageID)` — `UPDATE … SET deleted_at = NULL`.
- `PurgeDeleted(ctx, userID, subscriptionID, pageID)` — hard `DELETE` on a row that is already soft-deleted (Trash → permanent delete).

---

## Retention policy

**Recommended: 90-day automatic purge.**

A lightweight scheduled job (application-level `time.Ticker` in the server process, or `pg_cron` if available) runs:

```sql
DELETE FROM user_custom_pages
WHERE deleted_at IS NOT NULL
  AND deleted_at < NOW() - INTERVAL '90 days';
```

This cascades to `user_custom_page_views`. Nav-pref cleanup of dangling `custom:<uuid>` keys already happens client-side on delete; no additional purge logic needed there.

Alternatives considered:
- **User-controlled only** (no auto-purge): simpler, but dead rows accumulate indefinitely. Not recommended.
- **30 days:** More aggressive. May surprise users who expect undo to work after a month. 90 days aligns with common SaaS convention.

---

## Restore UX

Minimal surface: a collapsible "Trash" section at the bottom of **Preferences → Navigation**, beneath the pool. Each trash row shows the page label, icon, and `deleted_at` (e.g., "Deleted 3 days ago"), with two actions:

- **Restore** → `PATCH /api/custom-pages/{id}/restore` (clears `deleted_at`, re-pinnable after).
- **Delete permanently** → `DELETE /api/custom-pages/{id}?permanent=true` (requires explicit confirmation modal).

A banner on the page informs: *"Pages in Trash are permanently deleted after 90 days."*

No new top-level route needed. The Trash section can be hidden when empty.

---

## Storage cost estimate

| Variable | Value |
|---|---|
| Row size (id + user_id + sub_id + label + icon + 4 × timestamps) | ≈ 160 B raw |
| Heap + index overhead | ≈ 400 B / row on disk |
| Cap per user | 100 pages |
| Worst-case dead rows per user (full churn per quarter) | 100 rows / 90 days → always ≤ 100 dead rows live |
| Dead weight per user | ≤ 40 KB |
| At 10 000 users | ≤ 400 MB total (bounded by 90-day purge) |
| Without auto-purge (worst case, 1 000 creates+deletes / user / year) | ≤ 400 B × 1 000 = 400 KB / user / year |

Storage impact is negligible at any plausible user count. The constraint driving this proposal is recoverability, not storage.

---

## Not in scope

- Admin-side restore (gadmin/padmin restoring another user's deleted pages).
- Bulk soft-delete.
- Soft-delete for `user_custom_page_views` (views are meaningless without their parent page; they continue to cascade-delete on hard purge).
- Changes to the nav-prefs cleanup flow (already handled client-side).

---

## Open questions

1. Should `Restore` enforce the label-uniqueness check at the service layer, or rely on the DB partial-unique index to surface a conflict error?
2. Should restoring a page also re-pin it in nav-prefs, or leave re-pinning to the user?
3. 90-day retention — should this be a configurable env var from launch, or hardcoded and changed later?
