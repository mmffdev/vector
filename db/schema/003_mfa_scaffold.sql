-- ============================================================
-- MMFFDev - Vector: MFA scaffolding (enforcement OFF for now)
-- Migration 003 — applied on top of 002_auth_permissions.sql
-- Adds columns so we can enable TOTP-based MFA later without
-- a schema change. No backend code reads these yet.
-- ============================================================

BEGIN;

ALTER TABLE users
    ADD COLUMN mfa_enrolled       BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN mfa_secret         TEXT,
    ADD COLUMN mfa_enrolled_at    TIMESTAMPTZ,
    ADD COLUMN mfa_recovery_codes TEXT[];

COMMIT;
