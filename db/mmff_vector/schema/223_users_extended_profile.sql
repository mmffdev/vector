-- B20.4.2 (2026-05-19) — extended user-profile fields + deferred-entity
-- stub UUID columns. Forward-only.
--
-- Real fields land now:
--   middle_name                — full name component
--   display_name               — "shown to others" name (B20.4.8 edit panel)
--   phone_work / phone_mobile  — E.164, validated in Go service layer
--                                (regex ^\+[1-9]\d{1,14}$). DB stores raw text.
--   timezone                   — mirrors tenant_timezone enum (Go validates)
--   date_format                — mirrors tenant_date_format enum
--   datetime_format            — mirrors tenant_datetime_format enum
--   email_notifications_enabled — per-user notification opt-out
--   password_reset_required    — flag rendered by B20.4.6; set-flag UI deferred
--
-- Stub columns for deferred entities (NULL only until their owning
-- story promotes the column to a real FK; see plan doc
-- context/plans/USERS-CONSOLIDATION.md "Stub-field discipline"):
--   cost_centre_id             — promoted by B20.4.3 (in scope)
--   office_location_id         — promoted by B20.4.7 (deferred, vector-admin)
--   profile_image_url          — populated by B20.4.9 (deferred, asset pipeline)
--
-- Why stubs now: schema is forward-compatible, UI binding stays stable,
-- and later migrations only need to (a) backfill string→UUID and (b)
-- add the FOREIGN KEY constraint — no column rename, no shape change.
--
-- All columns nullable; no defaults that would imply data was set when
-- it wasn't. Existing rows untouched.

BEGIN;

-- Real fields
ALTER TABLE users
  ADD COLUMN middle_name                  text,
  ADD COLUMN display_name                 text,
  ADD COLUMN phone_work                   text,
  ADD COLUMN phone_mobile                 text,
  ADD COLUMN timezone                     text,
  ADD COLUMN date_format                  text,
  ADD COLUMN datetime_format              text,
  ADD COLUMN email_notifications_enabled  boolean NOT NULL DEFAULT TRUE,
  ADD COLUMN password_reset_required      boolean NOT NULL DEFAULT FALSE;

-- TD-STUB-COST-CENTRES (promoted by B20.4.3)
ALTER TABLE users
  ADD COLUMN cost_centre_id               uuid;

-- TD-STUB-OFFICE-LOCATIONS (promoted by B20.4.7 — deferred, vector-admin)
ALTER TABLE users
  ADD COLUMN office_location_id           uuid;

-- TD-STUB-PROFILE-IMAGE (populated by B20.4.9 — deferred, asset pipeline)
ALTER TABLE users
  ADD COLUMN profile_image_url            text;

COMMIT;
