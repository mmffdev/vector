# `<accounts>` — source of truth for credentials and users

Use this before guessing any credentials. Do not substitute Planka creds for app creds or vice versa.

## App users (live DB)

Requires tunnel on `:5434`. Query:

```bash
PGPASSWORD=$(grep '^DB_PASSWORD=' "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/backend/.env.local" | cut -d= -f2-) \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5434 -U mmff_dev -d mmff_vector \
  -c "SELECT email, role, is_active, force_password_change FROM users ORDER BY role, email;"
```

This is the authoritative list. If login fails, check this first — the user may not exist, may be inactive, or may have `force_password_change = true`.

## App credential locations

| What | Where |
|---|---|
| DB credentials | `backend/.env.local` — `DB_USER`, `DB_PASSWORD` |
| MASTER_KEY (encryption) | `backend/.env.local` — `MASTER_KEY` |
| JWT secret | `backend/.env.local` — `JWT_SECRET` |
| App user passwords | Hashed in `users.password_hash` — cannot be read, only reset |

## Planka board (not the app)

| Field | Value |
|---|---|
| URL | `http://localhost:3333` |
| Email | `admin@mmffdev.com` |
| Password | `changeme123!` |

These credentials are for the Planka kanban board only. They do not work for the app at `:5101`.

## Reset an app user password

```bash
# Generate a bcrypt hash for a new password (requires htpasswd or equivalent):
NEW_HASH=$(htpasswd -bnBC 10 "" "newpassword123!" | tr -d ':\n' | sed 's/^!//')

# Or use the backend's own hash endpoint if available:
curl -s -X POST http://localhost:5100/api/dev/hash -d '{"password":"newpassword123!"}' \
  -H "Content-Type: application/json"

# Then update directly:
PGPASSWORD=$(grep '^DB_PASSWORD=' backend/.env.local | cut -d= -f2-) \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5434 -U mmff_dev -d mmff_vector \
  -c "UPDATE users SET password_hash = '<hash>' WHERE email = 'user@example.com';"
```

## Connection details

- Tunnel port: `5434` (SSH tunnel → remote `5432`)  
- DB name: `mmff_vector`
- DB user: `mmff_dev`
- Psql binary: `/opt/homebrew/opt/libpq/bin/psql`
- Full connection ref: [`docs/c_postgresql.md`](../../docs/c_postgresql.md)
