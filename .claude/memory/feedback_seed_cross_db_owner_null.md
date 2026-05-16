---
name: Cross-DB owner_user_id — store NULL in seed, resolve at runtime
description: When seeding cross-DB soft FKs (owner_user_id in vector_artefacts pointing to mmff_vector.users), store NULL in the seed and let the workspace seed or application resolve it
type: feedback
originSessionId: 8557abbb-001d-4b82-a39e-1bc746941c47
---
When a seed script targets `vector_artefacts` but the owner user lives in `mmff_vector`, store `NULL` for `tenant_owner_user_id` (and equivalent soft-FK owner columns) in the seed. The subsequent workspace seed or application session resolves the correct UUID.

**Why:** Confirmed 2026-05-09 during master reset seed (010_master_reset.sql). Cross-DB queries are impossible in a single Postgres session; hardcoding a UUID would rot as the user row gets recreated.

**How to apply:** In any `vector_artefacts` seed that references a mmff_vector user UUID, store NULL and add a comment: "resolved by workspace seed / application on first load."
