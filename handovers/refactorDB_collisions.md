# Collision Resolution — Step 0 of refactorDB

**Created:** 2026-05-26
**For:** `handovers/refactorDB.md` Pillar 2 prep
**Scope:** 4 non-MRW collisions between `mmff_vector` and `vector_artefacts`
**DBs queried:** `mmff_vector` + `vector_artefacts` (live, via remote `vector-dev-pg` SSH + docker exec — read-only introspection)

---

## Summary table

| Table | mmff_vector cols | vector_artefacts cols | Verdict | Notes |
|---|---|---|---|---|
| `admin_api_keys` | 11 | 11 | **parity-drop** | Byte-identical column shape + identical indexes + already fully prefix-swept. Only delta is two outbound FKs that VA cannot have (parent tables `subscriptions`/`users` live in mmff_vector). VA copy is empty (0 rows); mmff_vector copy is live (50 rows). |
| `users_sessions` | 16 | 16 | **parity-drop** | Same story — byte-identical column shape + identical indexes + already fully prefix-swept. mmff_vector has FK to `users(id)`; VA does not. VA copy 0 rows; mmff_vector 1409 rows. |
| `csp_reports` | 17 | 17 | **parity-drop** | Byte-identical column shape; both still bare-column (Pillar 1 will sweep). No FKs in either direction. Both 0 rows — ephemeral CSP violation log. |
| `dpop_jti_cache` | 2 | 2 | **parity-drop** | Byte-identical column shape; both still bare-column (Pillar 1 will sweep). No FKs. mmff_vector 15 rows, VA 0 — ephemeral DPoP replay-prevention cache, rows TTL out by `expires_at`. |

**Headline:** all 4 collisions are parity-drops. In every case the column shape, types, defaults, PK and unique constraints, and index list are byte-identical between the two DBs. The only differences are outbound FK constraints (which exist in mmff_vector because that DB hosts the parent tables `subscriptions` + `users`, and which VA cannot have because Postgres forbids cross-DB FKs). VA's copies are empty placeholder shells from a prior cutover attempt; the live data lives in mmff_vector and stays there until Pillar 2 moves it.

---

## admin_api_keys

### mmff_vector.admin_api_keys

- **Row count:** 50
- **Columns (11):**
  | # | name | type | nullable | default |
  |---|---|---|---|---|
  | 1 | `admin_api_keys_id` | uuid | NO | `gen_random_uuid()` |
  | 2 | `admin_api_keys_id_subscription` | uuid | NO | — |
  | 3 | `admin_api_keys_prefix` | text | NO | — |
  | 4 | `admin_api_keys_hash` | bytea | NO | — |
  | 5 | `admin_api_keys_scopes` | text[] | NO | `'{}'::text[]` |
  | 6 | `admin_api_keys_rate_limit_config` | jsonb | YES | — |
  | 7 | `admin_api_keys_created_at` | timestamptz | NO | `now()` |
  | 8 | `admin_api_keys_expires_at` | timestamptz | YES | — |
  | 9 | `admin_api_keys_revoked_at` | timestamptz | YES | — |
  | 10 | `admin_api_keys_last_used_at` | timestamptz | YES | — |
  | 11 | `admin_api_keys_id_user_creator` | uuid | YES | — |
- **Constraints:**
  - `api_keys_pkey` PRIMARY KEY (`admin_api_keys_id`)
  - `admin_api_keys_hash_key` UNIQUE (`admin_api_keys_hash`)
  - `admin_api_keys_prefix_key` UNIQUE (`admin_api_keys_prefix`)
  - `admin_api_keys_id_subscription_fkey` FK → `subscriptions(id)` ON DELETE CASCADE
  - `admin_api_keys_id_user_creator_fkey` FK → `users(id)` ON DELETE SET NULL
- **Indexes:**
  - `api_keys_pkey` (PK)
  - `admin_api_keys_hash_key` (unique)
  - `admin_api_keys_prefix_key` (unique)
  - `idx_admin_api_keys_expires_at`
  - `idx_admin_api_keys_id_subscription`
  - `idx_admin_api_keys_prefix`
  - `idx_admin_api_keys_revoked_at`
- **Inbound FKs:** none.

### vector_artefacts.admin_api_keys

- **Row count:** 0
- **Columns (11):** identical to mmff_vector — same names, types, nullability, defaults, ordering.
- **Constraints:**
  - `api_keys_pkey` PRIMARY KEY (`admin_api_keys_id`)
  - `admin_api_keys_hash_key` UNIQUE (`admin_api_keys_hash`)
  - `admin_api_keys_prefix_key` UNIQUE (`admin_api_keys_prefix`)
  - **No FK constraints** (subscriptions + users don't exist in this DB).
- **Indexes:** identical 7-index list to mmff_vector.
- **Inbound FKs:** none.

### Diff

- **Columns only in mmff_vector:** none.
- **Columns only in vector_artefacts:** none.
- **Type mismatches:** none.
- **Constraint differences:** mmff_vector has 2 outbound FKs that VA lacks — mandatory because the FK targets (`subscriptions`, `users`) live in mmff_vector and Postgres cannot enforce cross-DB FKs. Both FKs become enforceable real FKs the moment Pillar 2 lands `subscriptions` + `users` in VA.
- **Index differences:** none.

### Verdict: **parity-drop**

**Justification:** The column shape, types, defaults, PK, unique constraints, and index list are byte-identical. The only structural difference is two outbound FK constraints that exist in mmff_vector and cannot exist in VA, purely because the parent tables live in mmff_vector. Once `subscriptions` + `users` move (Pillar 2 waves earlier in the dependency order), the FKs become re-creatable. The live data lives in mmff_vector (50 rows); VA's copy is an empty shell. This is a textbook parity-drop with a small "and re-attach the FKs" caveat.

**Pillar 2 action:** Drop `vector_artefacts.admin_api_keys` (it's empty), then run the standard mmff_vector→VA move recipe for this table — pre-create schema in VA via migration, INSERT … SELECT via dblink, re-add the two FK constraints (to the freshly-moved `subscriptions` + `users` in VA), verify row count 50, drop mmff_vector source. Order: the `subscriptions` + `users` table moves must complete BEFORE this table's move, so that the FK targets exist in VA at move time.

**Pillar 1 implication:** Both copies are already fully prefix-swept (this happened in the earlier 2026-05-14 partial sweep, migrations 186–190 region). **No Pillar 1 work needed for either side of this collision.** Confirm by re-running the bare-column gap query in both DBs — admin_api_keys should not appear.

---

## users_sessions

### mmff_vector.users_sessions

- **Row count:** 1409
- **Columns (16):**
  | # | name | type | nullable | default |
  |---|---|---|---|---|
  | 1 | `users_sessions_id` | uuid | NO | `gen_random_uuid()` |
  | 2 | `users_sessions_id_user` | uuid | NO | — |
  | 3 | `users_sessions_token_hash` | text | NO | — |
  | 4 | `users_sessions_created_at` | timestamptz | NO | `now()` |
  | 5 | `users_sessions_expires_at` | timestamptz | NO | — |
  | 6 | `users_sessions_last_used_at` | timestamptz | NO | `now()` |
  | 7 | `users_sessions_ip_address` | inet | YES | — |
  | 8 | `users_sessions_user_agent` | text | YES | — |
  | 9 | `users_sessions_revoked` | boolean | NO | `false` |
  | 10 | `users_sessions_rotated_at` | timestamptz | YES | — |
  | 11 | `users_sessions_successor_hash` | text | YES | — |
  | 12 | `users_sessions_dpop_jkt` | text | NO | — |
  | 13 | `users_sessions_first_ip` | inet | YES | — |
  | 14 | `users_sessions_first_asn` | text | YES | — |
  | 15 | `users_sessions_first_country` | text | YES | — |
  | 16 | `users_sessions_first_ua_fp` | text | YES | — |
- **Constraints:**
  - `users_sessions_pkey` PRIMARY KEY (`users_sessions_id`)
  - `users_sessions_token_hash_key` UNIQUE (`users_sessions_token_hash`)
  - `users_sessions_id_user_fkey` FK → `users(id)` ON DELETE CASCADE
- **Indexes:**
  - `users_sessions_pkey` (PK)
  - `users_sessions_token_hash_key` (unique)
  - `idx_users_sessions_expires_at`
  - `idx_users_sessions_id_user`
  - `idx_users_sessions_successor_hash` — **partial index** `WHERE users_sessions_successor_hash IS NOT NULL`
  - `idx_users_sessions_token_hash`
- **Inbound FKs:** none.

### vector_artefacts.users_sessions

- **Row count:** 0
- **Columns (16):** identical to mmff_vector.
- **Constraints:**
  - `users_sessions_pkey` PRIMARY KEY (`users_sessions_id`)
  - `users_sessions_token_hash_key` UNIQUE (`users_sessions_token_hash`)
  - **No FK constraint** to `users` (table not present in this DB).
- **Indexes:** identical 6-index list to mmff_vector, including the partial successor_hash index.
- **Inbound FKs:** none.

### Diff

- **Columns only in mmff_vector:** none.
- **Columns only in vector_artefacts:** none.
- **Type mismatches:** none.
- **Constraint differences:** mmff_vector has FK → `users(id)`; VA lacks it (cross-DB FK impossible).
- **Index differences:** none.

### Verdict: **parity-drop**

**Justification:** Identical column shape, types, defaults, PK, unique, and index list (including the partial index condition). Only delta is the outbound FK to `users`, which VA cannot host until `users` itself moves in Pillar 2. Live data is in mmff_vector (1409 sessions); VA's copy is empty. Standard parity-drop.

**Pillar 2 action:** Drop `vector_artefacts.users_sessions` (empty), then standard move recipe: pre-create schema in VA, INSERT … SELECT via dblink, re-add the FK to `users(id)` after `users` has landed in VA, verify 1409 rows, drop mmff_vector source. The `users` table must move first in the dependency order.

**Pillar 1 implication:** Both copies fully prefix-swept already. **No Pillar 1 work needed.**

---

## csp_reports

### mmff_vector.csp_reports

- **Row count:** 0
- **Columns (17):** **bare-column** (not yet prefix-swept).
  | # | name | type | nullable | default |
  |---|---|---|---|---|
  | 1 | `id` | uuid | NO | `gen_random_uuid()` |
  | 2 | `received_at` | timestamptz | NO | `now()` |
  | 3 | `document_uri` | text | YES | — |
  | 4 | `referrer` | text | YES | — |
  | 5 | `violated_directive` | text | YES | — |
  | 6 | `effective_directive` | text | YES | — |
  | 7 | `original_policy` | text | YES | — |
  | 8 | `disposition` | text | YES | — |
  | 9 | `blocked_uri` | text | YES | — |
  | 10 | `source_file` | text | YES | — |
  | 11 | `line_number` | integer | YES | — |
  | 12 | `column_number` | integer | YES | — |
  | 13 | `status_code` | integer | YES | — |
  | 14 | `user_agent` | text | YES | — |
  | 15 | `remote_ip` | inet | YES | — |
  | 16 | `raw` | jsonb | NO | — |
  | 17 | `subscription_id` | uuid | YES | — |
- **Constraints:**
  - `csp_reports_pkey` PRIMARY KEY (`id`)
  - No FK constraints (note: `subscription_id` is an app-level soft reference, not a real FK).
- **Indexes:**
  - `csp_reports_pkey` (PK)
  - `idx_csp_reports_received_at_desc` on (`received_at` DESC)
  - `idx_csp_reports_violated_directive` on (`violated_directive`, `received_at` DESC)
- **Inbound FKs:** none.

### vector_artefacts.csp_reports

- **Row count:** 0
- **Columns (17):** identical to mmff_vector — also bare-column.
- **Constraints:** `csp_reports_pkey` only — identical to mmff_vector.
- **Indexes:** identical 3-index list.
- **Inbound FKs:** none.

### Diff

- **Columns only in mmff_vector:** none.
- **Columns only in vector_artefacts:** none.
- **Type mismatches:** none.
- **Constraint differences:** none.
- **Index differences:** none.

### Verdict: **parity-drop**

**Justification:** Byte-identical shape on both sides, both bare-column, both 0 rows. This is an ephemeral CSP-violation log table — defensive defence-in-depth telemetry, rows aged out by `received_at`. No live data anywhere, no inbound FKs, no outbound FKs.

**Pillar 2 action:** Drop `vector_artefacts.csp_reports` (empty) and `mmff_vector.csp_reports` (also empty). Pre-create a single canonical version in vector_artefacts via the move migration. Because both copies are empty, there is literally no data copy step — just create-fresh in VA and drop both sources. The backend handler that INSERTs CSP reports gets repointed from `pool` → `vaPool` in Pillar 3.

**Pillar 1 implication:** **Skip Pillar 1 work entirely for both copies.** This is the strongest "wasted work" case in the four-collision register: the table is empty in both DBs and the move-fresh-create migration in Pillar 2 can adopt the prefix-swept shape directly, with no INSERT step and no risk. Pillar 1 effort on this table = pure waste. Flag clearly in the Pillar 1 dispatch brief to skip `csp_reports` in both DBs.

---

## dpop_jti_cache

### mmff_vector.dpop_jti_cache

- **Row count:** 15
- **Columns (2):** **bare-column** (not yet prefix-swept).
  | # | name | type | nullable | default |
  |---|---|---|---|---|
  | 1 | `jti` | text | NO | — |
  | 2 | `expires_at` | timestamptz | NO | — |
- **Constraints:** `dpop_jti_cache_pkey` PRIMARY KEY (`jti`).
- **Indexes:**
  - `dpop_jti_cache_pkey` (PK)
  - `idx_dpop_jti_cache_expires_at` on (`expires_at`)
- **Inbound FKs:** none.

### vector_artefacts.dpop_jti_cache

- **Row count:** 0
- **Columns (2):** identical to mmff_vector — also bare-column.
- **Constraints:** `dpop_jti_cache_pkey` only — identical.
- **Indexes:** identical 2-index list.
- **Inbound FKs:** none.

### Diff

- **Columns only in mmff_vector:** none.
- **Columns only in vector_artefacts:** none.
- **Type mismatches:** none.
- **Constraint differences:** none.
- **Index differences:** none.

### Verdict: **parity-drop**

**Justification:** Byte-identical 2-column ephemeral cache. Rows TTL out by `expires_at` (DPoP proof JTI replay-prevention surface, RFC 9449). mmff_vector has 15 live rows that may or may not have already expired — they age out within minutes either way. No inbound FKs, no outbound FKs.

**Pillar 2 action:** Drop `vector_artefacts.dpop_jti_cache` (empty). For `mmff_vector.dpop_jti_cache`'s 15 rows: optional copy. The cache rebuilds itself in seconds because every active session refreshes its DPoP nonces frequently; treat the 15 rows as discardable. Safest path: pre-create empty in VA, run a cleanup pass (`DELETE FROM mmff_vector.dpop_jti_cache WHERE expires_at < now()`) to confirm any leftover rows are already-expired noise, then drop the mmff_vector source. The auth/DPoP handler in `backend/internal/auth/` gets repointed `pool` → `vaPool` in Pillar 3.

**Pillar 1 implication:** **Skip Pillar 1 work entirely for both copies.** Same reasoning as `csp_reports` — table is essentially empty (15 rows, all imminently expiring), Pillar 2's move-migration can create the fresh prefix-swept shape directly. Pillar 1 effort = waste.

---

## Pillar 1 dispatch implications (consolidated)

Of the 4 collisions:

- `admin_api_keys` — **already prefix-swept on both sides**, Pillar 1 has nothing to do here.
- `users_sessions` — **already prefix-swept on both sides**, Pillar 1 has nothing to do here.
- `csp_reports` — **skip Pillar 1** (both sides empty, parity-drop, fresh-create in Pillar 2).
- `dpop_jti_cache` — **skip Pillar 1** (both sides effectively empty, parity-drop, fresh-create in Pillar 2).

**Removed from Pillar 1 scope:** 4 tables × 2 DBs = 8 migrations that would otherwise have been written. The Pillar 1 dispatch brief should explicitly name these 4 collisions as "skip — resolved by Pillar 2 parity-drop."

Refresh the bare-column gap list before Pillar 1 dispatch to confirm — the handover's gap list (mmff_vector: 13 tables / vector_artefacts: 14 tables) includes `csp_reports` and `dpop_jti_cache` on both sides, and these now drop out, taking the gap-list counts to **mmff_vector: 11 tables** + **vector_artefacts: 12 tables**.

---

## Pillar 2 dispatch implications (consolidated)

All 4 collisions are parity-drops. The Pillar 2 dispatch brief should:

1. **Drop the empty vector_artefacts copies first**, in any order — they hold no data:
   - `DROP TABLE vector_artefacts.admin_api_keys` (0 rows)
   - `DROP TABLE vector_artefacts.users_sessions` (0 rows)
   - `DROP TABLE vector_artefacts.csp_reports` (0 rows)
   - `DROP TABLE vector_artefacts.dpop_jti_cache` (0 rows)
2. **Move the mmff_vector data using the standard recipe**, in the right FK-safe order:
   - `subscriptions` + `users` must land in VA before `admin_api_keys` and `users_sessions` (because those two re-acquire their FKs at move time).
   - `csp_reports` + `dpop_jti_cache` are leaf tables with no FK dependencies — move them at any point; simplest is "create empty fresh in VA, skip the data copy entirely" because both are ephemeral telemetry.
3. **Re-add the FK constraints** after the parent tables have moved:
   - `admin_api_keys.admin_api_keys_id_subscription` → `subscriptions(<pk>)` ON DELETE CASCADE
   - `admin_api_keys.admin_api_keys_id_user_creator` → `users(<pk>)` ON DELETE SET NULL
   - `users_sessions.users_sessions_id_user` → `users(<pk>)` ON DELETE CASCADE
   - (Exact target PK column name depends on Pillar 1's PK normalization — almost certainly `users_id` and `subscriptions_id` per §2.4.)

---

## Open questions for the user

**None.** Every collision resolves to parity-drop with high confidence. No fold-vs-rename ambiguity. The only "judgement call" was whether `csp_reports` and `dpop_jti_cache` warrant the data-copy step (they're empty / ephemeral) — both are documented above as "create-fresh in Pillar 2, skip the copy," which is the obvious right call but easy to revert to standard recipe if the user prefers belt-and-braces. Flagged for awareness, not blocking.
