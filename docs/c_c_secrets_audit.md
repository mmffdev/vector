# os.Getenv audit — sensitive keys

> Generated 2026-04-25. Load when working on the encrypt-at-rest stories.

## Sensitive call sites (14 keys across 7 files)

| File | Line | Key | Context |
|---|---|---|---|
| `backend/internal/db/db.go` | 16 | `DB_USER` | pgxpool DSN |
| `backend/internal/db/db.go` | 17 | `DB_PASSWORD` | pgxpool DSN |
| `backend/internal/auth/tokens.go` | 47 | `JWT_ACCESS_SECRET` | HMAC-SHA256 signing |
| `backend/internal/auth/tokens.go` | 71 | `JWT_ACCESS_SECRET` | HMAC-SHA256 verification |
| `backend/internal/librarydb/db.go` | 49 | `LIBRARY_DB_USER` | library RO pool DSN |
| `backend/internal/librarydb/db.go` | 50 | `LIBRARY_DB_PASSWORD` | library RO pool DSN |
| `backend/internal/librarydb/db.go` | 51 | `LIBRARY_PUBLISH_DB_USER` | library publish pool DSN |
| `backend/internal/librarydb/db.go` | 52 | `LIBRARY_PUBLISH_DB_PASSWORD` | library publish pool DSN |
| `backend/internal/librarydb/db.go` | 53 | `LIBRARY_ACK_DB_USER` | library ack pool DSN |
| `backend/internal/librarydb/db.go` | 54 | `LIBRARY_ACK_DB_PASSWORD` | library ack pool DSN |
| `backend/internal/messaging/email/service.go` | 49 | `SMTP_USER` | SMTP auth credential |
| `backend/internal/messaging/email/service.go` | 50 | `SMTP_PASS` | SMTP auth credential |
| `backend/cmd/migrate/main.go` | 81–82 | `DB_USER`, `DB_PASSWORD` | migration DSN (vector) |
| `backend/cmd/migrate/main.go` | 101–105 | `LIBRARY_ADMIN_DB_USER`, `LIBRARY_ADMIN_DB_PASSWORD` (+ fallback `DB_USER`/`DB_PASSWORD`) | migration DSN (library) |

## Test files (not in scope for encryption — read from env at test time)

`service_test.go`, `orphans_test.go`, `grants_test.go`, `releases_test.go`, `handler_test.go`, `nav/service_test.go`, `permissions/service_test.go` — all read `DB_USER`/`DB_PASSWORD` directly for integration test DB setup.

## Existing abstractions

No centralised config struct. Helper functions exist only for non-sensitive config:
- `envOr(key, def)` — fallback for HOST/PORT/NAME; in `cmd/migrate` and `librarydb`
- `parseDurationEnv(key, def)` — JWT/reset TTLs; in `auth/tokens.go`
- `envInt(key, def)` — integer flags; in `auth/service.go`

**None of these wrap sensitive keys.** The `secrets.Get(key)` wrapper (story: "Wire secrets into os.Getenv wrapper") will replace direct `os.Getenv` at all 14 sites above.

## Keys to encrypt in `.env.local`

Priority order for the sweep story:
1. `DB_PASSWORD`
2. `JWT_ACCESS_SECRET`
3. `SMTP_PASS`
4. `LIBRARY_DB_PASSWORD`, `LIBRARY_PUBLISH_DB_PASSWORD`, `LIBRARY_ACK_DB_PASSWORD`
5. `LIBRARY_ADMIN_DB_PASSWORD` (when configured)

`DB_USER`, `LIBRARY_*_USER`, `SMTP_USER` — usernames are low-sensitivity; encrypt if desired but not priority.
