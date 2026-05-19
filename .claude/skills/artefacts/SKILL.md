---
name: artefacts
description: Tenant-wide artefacts maintenance against vector_artefacts via the backend API (apiSite endpoints). Flags — `-d` wipe all artefacts for the active tenant (server-side cascade of fields_values + search_outbox; preserves types, topology, flows, fields). Always GETs a pre-flight count, demands an explicit "yes" confirmation, dev-only. More flags will be added later.
---

# `<artefacts>` Skill

Tenant-wide maintenance of the `artefacts` table on `vector_artefacts` (vaPool). All actions go through the backend HTTP API (the bash equivalent of `apiSite()` — `curl` against `http://localhost:5100/_site/admin/dev/...` with a session cookie). The skill **never** runs psql directly — that violates the **Server Is The Gate** HARD RULE.

Current flags:
| Flag | Endpoint | Action |
|---|---|---|
| `-d` | `POST /_site/admin/dev/artefacts-wipe` | Hard-delete every artefact (live + soft-archived) for the caller's tenant. Server cascades `artefacts_fields_values` + `artefacts_search_outbox` and resets `artefacts_number_sequences`. Preserves `artefacts_types`, `topology_nodes`, `flows*`, `timeboxes_*`, `artefacts_fields_library`, users/roles/workspaces. |

Pre-flight (always runs before `-d`):
| Endpoint | Returns |
|---|---|
| `GET /_site/admin/dev/artefacts-count` | `{ subscription_id, live, archived, total }` for the caller's tenant. |

Future flags will live alongside `-d`; never break the `-d` contract.

---

## HARD RULES — non-negotiable

1. **Backend is the gate.** All actions route through `/_site/admin/dev/*` endpoints. The Go handler re-derives `subscription_id` from the auth context — the skill cannot widen the blast radius by passing a different tenant. Body must include `{"confirm":"yes"}` (server re-checks). This skill must NOT run `psql` for any destructive action.
2. **Dev only.** The backend env is pinned to `dev` (CLAUDE.md HARD RULE). Backend on `localhost:5100`. If `nc -z localhost 5100` fails, abort with "Backend not running — start it via `<npm>` or the launcher."
3. **Pre-flight counts first.** Before `-d` ever fires, GET `/_site/admin/dev/artefacts-count` and show the user the live/archived/total breakdown for THEIR tenant. If `total = 0`, report "Nothing to delete." and exit — no confirmation needed.
4. **Explicit confirmation per invocation.** Never reuse a previous "yes". The prompt is literally:
   > "Confirm: DELETE all `<N>` artefacts (`<live>` live + `<archived>` archived) for tenant `<tenant-uuid>` via `POST /_site/admin/dev/artefacts-wipe`? Type `yes` to proceed."
   Accept only an exact `yes` (case-insensitive). Anything else → "Aborted — nothing deleted."
5. **Use the Claude test gadmin account, not the human one.** Per CLAUDE.md HARD RULE, never log in as `gadmin@mmffdev.com`. Use `claude_3_test@mmffdev.com / password123!` (the dedicated Claude gadmin test account — see [`.claude/memory/test_accounts.md`](../../memory/test_accounts.md)).
6. **Reference the cookbook entry.** SQL-level "what this wipe touches" reference lives in [`docs/c_sql_cookbook.md`](../../../docs/c_sql_cookbook.md) under "Wipe ALL artefacts for one tenant (clean-sheet reset)" — keep that entry in sync with the handler if the cascade behaviour ever changes.

---

## Preconditions

- Backend reachable: `nc -z localhost 5100` succeeds.
- `curl` and `jq` available on `PATH` (both standard on macOS dev).
- The active subscription is whichever tenant the gadmin account belongs to — by default the dev fixture `00000000-0000-0000-0000-000000000001`. Override is impossible from the skill side (server takes `subscription_id` from JWT), which is the whole point.

---

## Flow — `-d` (delete all)

### Step 0 — Setup helpers

Two reusable variables for the whole flow (cookie jar, base URL):

```bash
JAR=$(mktemp -t artefacts-skill-XXXXXX)
trap 'rm -f "$JAR"' EXIT
API="http://localhost:5100"
```

### Step 1 — Login (apiSite session cookie)

```bash
curl -sS -c "$JAR" -X POST "$API/_site/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"claude_3_test@mmffdev.com","password":"password123!"}' \
  | jq -e '.user.role' > /dev/null
```

If the login response doesn't include a `user.role`, abort with "Login failed — check `claude_3_test@mmffdev.com` exists and `password123!` is current. Per HARD RULE, do NOT touch that account's row; ask the user."

### Step 2 — Pre-flight count (GET artefacts-count)

```bash
COUNTS=$(curl -sS -b "$JAR" "$API/_site/admin/dev/artefacts-count")
LIVE=$(echo "$COUNTS" | jq -r '.live')
ARCHIVED=$(echo "$COUNTS" | jq -r '.archived')
TOTAL=$(echo "$COUNTS" | jq -r '.total')
SUB=$(echo "$COUNTS" | jq -r '.subscription_id')
```

If `TOTAL = 0` → report "Nothing to delete on tenant `$SUB`." and exit.

### Step 3 — Confirmation prompt

Surface the numbers and ask, verbatim:

> "Confirm: DELETE all `<TOTAL>` artefacts (`<LIVE>` live + `<ARCHIVED>` archived) for tenant `<SUB>` via `POST /_site/admin/dev/artefacts-wipe`? Type `yes` to proceed."

Wait for the next user message. Accept only an exact case-insensitive `yes`. Any other reply → "Aborted — nothing deleted." and stop.

### Step 4 — Wipe (POST artefacts-wipe)

```bash
RESULT=$(curl -sS -b "$JAR" -X POST "$API/_site/admin/dev/artefacts-wipe" \
  -H "Content-Type: application/json" \
  -d '{"confirm":"yes"}')
```

Surface the result fields: `artefacts_deleted`, `artefacts_fields_values_deleted`, `artefacts_number_sequences_reset`.

### Step 5 — Verify

Re-GET `/_site/admin/dev/artefacts-count`. All three counts (`live`, `archived`, `total`) should be `0`. Report the final state.

---

## Output format

After the delete completes, summarise:

```
Wiped tenant <subscription_id> via /_site/admin/dev/artefacts-wipe:
  artefacts:                  <N> deleted
  artefacts_fields_values:    <M> cascaded
  artefacts_number_sequences: <K> reset
  (artefacts_search_outbox cascaded automatically by FK)
Survived: artefacts_types, topology_nodes, flows*, timeboxes_*, artefacts_fields_library.
```

Then: "Ready for fresh seed."

---

## Error handling

| Failure | Response |
|---|---|
| Backend down (`nc -z localhost 5100` fails) | "Backend not running on :5100 — start it via `<npm>` or the launcher." Do not retry. |
| Login 401/403 | "Login failed for `claude_3_test@mmffdev.com`. Per HARD RULE do not modify the row — ask the user to verify the account exists and the password is current." |
| Pre-flight 5xx | Surface `curl -i` headers + body verbatim. Do not retry. |
| Wipe returns non-2xx | Tx rolled back server-side (single transaction). Surface body verbatim. Re-run pre-flight to confirm nothing changed. |
| Unknown flag | List current flags (`-d`) and exit. |

---

## See also

- [`backend/internal/portfoliomodels/dev_reset.go`](../../../backend/internal/portfoliomodels/dev_reset.go) — `ArtefactsCount` + `ArtefactsWipe` handlers (the SQL lives in [`sql.go`](../../../backend/internal/portfoliomodels/sql.go) per `lint:sql-in-sqlfile-only`).
- [`backend/cmd/server/main.go`](../../../backend/cmd/server/main.go) — route mounts at `/dev/artefacts-count` (GET) + `/dev/artefacts-wipe` (POST), behind the same `permissions.PortfolioList` gate as the other `/dev/*` reset tools.
- [`docs/c_sql_cookbook.md`](../../../docs/c_sql_cookbook.md) — canonical SQL reference for the wipe (read-only, kept in sync with the handler).
- [`docs/c_c_db_routing.md`](../../../docs/c_c_db_routing.md) — `vector_artefacts` is the vaPool DB; `artefacts` lives there.
- [`.claude/memory/test_accounts.md`](../../memory/test_accounts.md) — `claude_3_test@mmffdev.com / password123!` is the Claude-owned gadmin test account.
- [`.claude/CLAUDE.md`](../../CLAUDE.md) HARD RULES — Server Is The Gate, backend pinned to dev, human accounts off-limits.
