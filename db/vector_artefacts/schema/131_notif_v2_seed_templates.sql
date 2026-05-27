-- ============================================================
-- 131_notif_v2_seed_templates.sql
--
-- Notifications v2 — initial template seeds.
--
-- Seeds 12 rows into notifications_templates (created in mig 127):
--   6 event_types × 2 channels (in_app + email) = 12 rows.
--
-- Event types covered:
--   mention.created
--   artefact.flow_state_changed
--   artefact.blocked
--   artefact.owner_changed
--   artefact.assigned
--   library.release_published
--
-- All rows: locale='en-GB', version=1, active=true.
--
-- Template bodies use {{ data.X }} placeholders. The v2 pipeline's
-- template service (backend/internal/notifications/v2/templates/)
-- interpolates these at render time from the hydrated event data map.
--
-- DOWN: DELETE FROM notifications_templates WHERE
--       notifications_templates_version = 1
--       AND notifications_templates_locale = 'en-GB'
--       AND notifications_templates_event_type IN (
--         'mention.created', 'artefact.flow_state_changed',
--         'artefact.blocked', 'artefact.owner_changed',
--         'artefact.assigned', 'library.release_published'
--       );
--
-- Part of the Notifications v2 PLA (S08 — Templates).
-- ============================================================

BEGIN;

-- ── mention.created — in_app ──────────────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'mention.created',
    'in_app',
    'en-GB',
    '{{ data.actor_display_name }} mentioned you',
    'In "{{ data.artefact_name }}": {{ data.snippet }}',
    1,
    true
);

-- ── mention.created — email ───────────────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'mention.created',
    'email',
    'en-GB',
    'You were mentioned in {{ data.artefact_name }}',
    E'{{ data.actor_display_name }} mentioned you in **{{ data.artefact_name }}**.\n\n> {{ data.snippet }}\n\nOpen {{ data.artefact_name }} to reply.',
    1,
    true
);

-- ── artefact.flow_state_changed — in_app ─────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'artefact.flow_state_changed',
    'in_app',
    'en-GB',
    '{{ data.artefact_name }} moved to {{ data.new_state }}',
    'Previous state: {{ data.old_state }}',
    1,
    true
);

-- ── artefact.flow_state_changed — email ──────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'artefact.flow_state_changed',
    'email',
    'en-GB',
    '{{ data.artefact_name }} → {{ data.new_state }}',
    E'**{{ data.artefact_name }}** has moved to a new flow state.\n\n- **Previous state:** {{ data.old_state }}\n- **New state:** {{ data.new_state }}\n\nChanged by {{ data.actor_display_name }}.',
    1,
    true
);

-- ── artefact.blocked — in_app ─────────────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'artefact.blocked',
    'in_app',
    'en-GB',
    '{{ data.artefact_name }} is blocked',
    'Blocker: {{ data.blocker_reason }}',
    1,
    true
);

-- ── artefact.blocked — email ──────────────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'artefact.blocked',
    'email',
    'en-GB',
    'Blocked: {{ data.artefact_name }}',
    E'**{{ data.artefact_name }}** has been marked as blocked.\n\n**Reason:** {{ data.blocker_reason }}\n\nBlocked by {{ data.actor_display_name }}. Review and resolve the blocker to unblock progress.',
    1,
    true
);

-- ── artefact.owner_changed — in_app ──────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'artefact.owner_changed',
    'in_app',
    'en-GB',
    '{{ data.artefact_name }} owner changed',
    'New owner: {{ data.new_owner_name }}',
    1,
    true
);

-- ── artefact.owner_changed — email ────────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'artefact.owner_changed',
    'email',
    'en-GB',
    'Ownership change: {{ data.artefact_name }}',
    E'Ownership of **{{ data.artefact_name }}** has been transferred.\n\n- **Previous owner:** {{ data.old_owner_name }}\n- **New owner:** {{ data.new_owner_name }}\n\nChanged by {{ data.actor_display_name }}.',
    1,
    true
);

-- ── artefact.assigned — in_app ────────────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'artefact.assigned',
    'in_app',
    'en-GB',
    '{{ data.actor_display_name }} assigned {{ data.artefact_name }} to you',
    '{{ data.artefact_name }} is now in your queue.',
    1,
    true
);

-- ── artefact.assigned — email ─────────────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'artefact.assigned',
    'email',
    'en-GB',
    'New assignment: {{ data.artefact_name }}',
    E'**{{ data.actor_display_name }}** has assigned **{{ data.artefact_name }}** to you.\n\nThis item is now in your queue. Open it to review the details and update its status.',
    1,
    true
);

-- ── library.release_published — in_app ───────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'library.release_published',
    'in_app',
    'en-GB',
    'New library release: v{{ data.version }}',
    '{{ data.release_notes }}',
    1,
    true
);

-- ── library.release_published — email ────────────────────────────────────────

INSERT INTO notifications_templates (
    notifications_templates_event_type,
    notifications_templates_channel,
    notifications_templates_locale,
    notifications_templates_subject,
    notifications_templates_body,
    notifications_templates_version,
    notifications_templates_active
) VALUES (
    'library.release_published',
    'email',
    'en-GB',
    'Library release v{{ data.version }} published',
    E'A new version of the shared library has been published.\n\n**Version:** {{ data.version }}\n\n{{ data.release_notes }}\n\nReview the release in the Library to adopt changes into your workspace.',
    1,
    true
);

COMMIT;
