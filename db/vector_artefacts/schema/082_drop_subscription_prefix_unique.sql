-- Migration 082: drop the subscription-scoped prefix uniqueness constraint.
--
-- uq_artefacts_types_prefix_live was created in 003 when workspaces did not
-- exist (one workspace per subscription). Migration 019 added the workspace-
-- scoped replacement (uq_artefacts_types_workspace_scope_prefix). The
-- subscription-scoped index now blocks seeding the same system prefixes
-- (US, DE, RSK, TA, EP) into every workspace under a subscription.
-- uq_artefacts_types_workspace_scope_prefix is sufficient.

DROP INDEX IF EXISTS uq_artefacts_types_prefix_live;
