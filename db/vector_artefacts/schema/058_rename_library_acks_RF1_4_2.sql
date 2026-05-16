-- RF1.4.2.library (VA side) — library_acknowledgements → library_releases_acknowledgements
-- (hierarchical: acks belong to releases per §2.2).
BEGIN;

ALTER TABLE library_acknowledgements RENAME TO library_releases_acknowledgements;

ALTER TABLE library_releases_acknowledgements RENAME COLUMN subscription_id         TO library_releases_acknowledgements_id_subscription;
ALTER TABLE library_releases_acknowledgements RENAME COLUMN release_id              TO library_releases_acknowledgements_id_library_release;
ALTER TABLE library_releases_acknowledgements RENAME COLUMN acknowledged_at         TO library_releases_acknowledgements_acknowledged_at;
ALTER TABLE library_releases_acknowledgements RENAME COLUMN acknowledged_by_user_id TO library_releases_acknowledgements_id_user_acknowledger;
ALTER TABLE library_releases_acknowledgements RENAME COLUMN action_taken            TO library_releases_acknowledgements_action_taken;

ALTER INDEX idx_library_acks_release      RENAME TO library_releases_acknowledgements_id_library_release_idx;
ALTER INDEX idx_library_acks_subscription RENAME TO library_releases_acknowledgements_id_subscription_idx;

ALTER TABLE library_releases_acknowledgements RENAME CONSTRAINT library_acknowledgements_pkey
                                                             TO library_releases_acknowledgements_pkey;
ALTER TABLE library_releases_acknowledgements RENAME CONSTRAINT library_acknowledgements_action_taken_check
                                                             TO library_releases_acknowledgements_action_taken_check;

COMMIT;
