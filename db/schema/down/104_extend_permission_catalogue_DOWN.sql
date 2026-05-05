-- DOWN for migration 104 (PLA-0007 / 00413).
--
-- Reverses the catalogue extension: removes the five new codes
-- and any role grants that reference them. Order matters —
-- role_permissions FK rows must go before permissions rows.
--
-- WARNING: any application code that calls RequirePermission with
-- one of these codes will start denying after this DOWN runs.
-- Roll back the Go-side catalogue (`internal/permissions/catalogue.go`)
-- to its pre-104 state in the same change.

BEGIN;

DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions WHERE code IN (
        'library.releases.view',
        'portfolio.model.edit',
        'portfolio_settings.view',
        'portfolio_items.view',
        'work_items.settings.edit'
    )
);

DELETE FROM permissions
WHERE code IN (
    'library.releases.view',
    'portfolio.model.edit',
    'portfolio_settings.view',
    'portfolio_items.view',
    'work_items.settings.edit'
);

COMMIT;
