-- Migration 011: portfolio_template_layer_definitions
--
-- Canonical lookup table for portfolio layer tags. One row per tag;
-- name + description are the authoritative copy used by all templates.
-- FetchTemplateByID resolves descriptions from here at adoption time,
-- falling back to the JSONB layer description if a tag is not found.

BEGIN;

CREATE TABLE IF NOT EXISTS portfolio_template_layer_definitions (
  tag         text PRIMARY KEY,
  name        text        NOT NULL,
  description text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON portfolio_template_layer_definitions TO mmff_dev;

COMMIT;
