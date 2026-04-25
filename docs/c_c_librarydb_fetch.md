# `librarydb` bundle fetcher

Phase 2 of the `mmff_library` adoption plan. Read-only spine + 5-child fetch from `mmff_library`. Lives at `backend/internal/librarydb/{bundle.go,fetch.go}`.

## What it returns

A `Bundle` struct (`bundle.go`) — typed snapshot of the spine row plus its five children:

- `Model` — `portfolio_models` (1 row)
- `Layers` — `portfolio_model_layers` (ordered by `sort_order, name`)
- `Workflows` — `portfolio_model_workflows` (ordered by `layer_id, sort_order, state_key`)
- `Transitions` — `portfolio_model_workflow_transitions` (ordered by `from_state_id, to_state_id`)
- `Artifacts` — `portfolio_model_artifacts` (ordered by `artifact_key`)
- `Terminology` — `portfolio_model_terminology` (ordered by `key`)

`portfolio_model_shares` is NOT in the bundle — it's an authorization concern, evaluated at adoption time (Phase 4+), not at fetch.

JSONB columns (`feature_flags`, `config`) are returned as `[]byte` so callers can decode them against typed shapes when the catalogue stabilises.

## Entry points

- `FetchByModelID(ctx, pool, modelID)` — load one specific row id.
- `FetchLatestByFamily(ctx, pool, familyID)` — load the highest non-archived `version` for a family. This is the normal request-path call; tenants track family ids, not row ids.

## Transaction semantics

Both entry points open a single `REPEATABLE READ READ ONLY` transaction and run all six reads inside it, then commit. The snapshot is consistent — a release that bumps the bundle mid-fetch can never produce a partial mix of old spine + new children. Cost is one tx per bundle read; the alternative (six independent queries) is wrong for the adoption cookbook (plan §10).

## Pool

Caller passes the pool. The intended caller is the `Pools.RO` pool from `db.go` (`mmff_library_ro` role, SELECT-only). The fetcher itself doesn't care which pool — but writing through Publish/Ack pools is wasted privilege.

## Errors

- `ErrBundleNotFound` — sentinel returned when the spine row is missing (no row matched the id, or no non-archived row matched the family). Callers compare with `errors.Is`.
- All other errors are wrapped with `librarydb:` prefix.

## Intended caller

The Phase 4 portfolio-adoption flow. The cross-DB cookbook (plan §10) snapshots the bundle here, then opens a SERIALIZABLE tenant-DB tx to write the mirror rows. Read snapshot lives only as long as the bundle fetch — caller doesn't hold the library tx open across the tenant write.

## Tests

`fetch_test.go` covers seeded happy path + `ErrBundleNotFound`. Connects as `mmff_library_ro` (defaults: `LIBRARY_DB_USER=mmff_library_ro`, `LIBRARY_DB_PASSWORD=change_me_ro`). Skips when the cluster is unreachable, same discipline as `grants_test.go`.

## HTTP surface (Phase 3)

The fetcher is exposed read-only at `backend/internal/portfoliomodels/handler.go`. Two routes, both gated by `RequireAuth + RequireFreshPassword + 120/min/IP` (mirrors `/api/nav` and `/api/custom-pages`):

| Method | Path | Calls | 200 body |
|---|---|---|---|
| GET | `/api/portfolio-models/{family}/latest` | `FetchLatestByFamily` | `bundleDTO` |
| GET | `/api/portfolio-models/{id}` | `FetchByModelID` | `bundleDTO` |

Status codes:

- `200` — bundle returned.
- `400` — path UUID is malformed (`invalid family id` / `invalid model id`).
- `401` — no/invalid Bearer token (auth middleware).
- `403` — `password_change_required` (fresh-password middleware).
- `404` — `ErrBundleNotFound` from the fetcher (`not found`).
- `500` — any other fetcher error (`internal error`; underlying message is **not** leaked).

`bundleDTO` mirrors `librarydb.Bundle` field-for-field. The two JSONB columns (`feature_flags`, `config`) are emitted as **embedded JSON objects** (`json.RawMessage`), not base64. Empty/null `[]byte` becomes JSON `null`.

The DTO lives in `portfoliomodels/dto.go` rather than tagging the `librarydb` structs directly because the fetcher must keep `[]byte` for the Phase 4 adoption cookbook (hand the bytes straight to the tenant-side INSERTs without a re-encode round trip).

Sharing enforcement (private/invite scopes, `portfolio_model_shares`) is **not** evaluated here — Phase 3 only ships MMFF-authored bundles which are implicitly visible to every authenticated caller. Phase 5 wires share evaluation in front of these handlers.

## Release-channel surface (also in `librarydb`)

Phase 3 added a second read path on the same RO pool: outstanding releases for a subscription. Lives at `backend/internal/librarydb/releases.go`. Cross-DB by design — release rows live in `mmff_library`, ack rows live in `mmff_vector` (no Postgres FK between them; the handler validates release id via `FindRelease` before writing the ack).

| Function | Pool(s) | Purpose |
|---|---|---|
| `ListReleasesSinceAck(ctx, libRO, vectorPool, subID, tier)` | RO + vector | Two-pass: load active releases for tier, load actions, subtract acked set. |
| `FindRelease(ctx, libRO, releaseID)` | RO | 404-pre-check before ack write. Returns `ErrReleaseNotFound`. |
| `AckRelease(ctx, vectorPool, subID, releaseID, userID, action)` | vector | Idempotent INSERT (`ON CONFLICT DO NOTHING`); returns `(created bool, err)`. Validates action via `IsValidAction` — returns `ErrInvalidAction`. |
| `CountOutstandingForSubscription(ctx, libRO, vectorPool, subID, tier)` | RO + vector | Count for the badge poll endpoint. |

Severity vocabulary: `info` / `action` / `breaking` (plan §12.1). Action keys: `upgrade_model`, `review_terminology`, `enable_flag`, `dismissed`. See [`c_c_library_release_channel.md`](c_c_library_release_channel.md) for the end-to-end flow.
