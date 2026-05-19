# Scalar IDE — dev setup

How to make Scalar's "Send Request" button stop returning 401 when poking at the live dev backend.

## Why 401?

Scalar sends `Authorization: Bearer <whatever you typed in>`. Vector's backend has two valid bearer flavours:

1. **JWT access token** — minted by `POST /_site/auth/login` and rotated every ~15 min. Short-lived; needs MFA. The browser handles this for you; Scalar doesn't.
2. **API key** — long-lived `sam_live_*` token issued by the `admin_api_keys` table. **Stable, no MFA required, no rotation.**

For Scalar, use the API key.

## One-time backend setup

1. **A dev API key has already been provisioned** in `backend/.env.dev` as `DEV_API_KEY`. The file is gitignored — the key never leaves your machine.

2. Restart the backend so `apikeys.SeedDevKey` runs and the row lands in `admin_api_keys`:

   ```bash
   <server> -d        # restart on dev env
   ```

   Look for this line in the server log:

   ```
   ✓ seeded dev API key: sam_live_… (id: …)
   ```

   (Or `✓ dev API key already seeded` on subsequent restarts.)

3. Copy the `DEV_API_KEY` value from `backend/.env.dev` — that's the bearer token Scalar needs.

## Configuring Scalar

In Scalar IDE, open the environment that holds your `siteAPI.yaml` / `samanthaAPI.yaml` import:

1. Click the **Auth** dropdown for the API → **bearerAuth**
2. Paste the `sam_live_…` value into the token field
3. Save the environment

That token is now sent on every "Send Request".

## What works with this key today

| Surface | Status | Notes |
|---|---|---|
| `/samantha/v2/*` (64 endpoints) | ✅ Works | `apikeys.Middleware` is mounted on this transport; the key validates and downstream handlers read `subscription_id` from context. |
| `/_site/*` (204 endpoints) | ⚠️ 401 | The dual-mount is tracked as **B20.5.L** (pending — needs a synthetic-user shim in `auth.UserFromCtx` so handlers expecting a `User` in context still work under api-key auth). |
| `/healthz`, `/readyz` | ✅ Works | No auth required. |
| `/auth/login`, `/auth/refresh` | ✅ Works | Public by design — these mint the JWT in the first place. |

So for now: Scalar gives you full coverage of `/samantha/v2/*` (the public data plane — work-items, portfolio-items, topology, flows, fields, timeboxes). For `/_site` (the BFF — admin UIs, page-help, navigation prefs, etc.), keep using the browser DevTools "copy bearer token" trick until B20.5.L lands.

## Troubleshooting

- **Still 401?** Confirm the key is loaded in the DB. From the launcher psql shell:
  ```sql
  SELECT admin_api_keys_prefix, admin_api_keys_created_at, admin_api_keys_revoked_at
    FROM admin_api_keys ORDER BY admin_api_keys_created_at DESC LIMIT 5;
  ```
  The prefix is the first 16 chars of `DEV_API_KEY` (e.g. `sam_live_rcvTPweU`).

- **404 instead of 401?** You're calling a route that doesn't exist. Check the spec at `siteAPI.yaml` or `samanthaAPI.yaml` — Scalar should be using the live spec.

- **Key not seeding on boot?** Confirm `APP_ENV=development` in `backend/.env.dev`. `SeedDevKey` is a no-op in staging/production by design — defence-in-depth.

## Rotation

When the key needs to change (compromised, leaked, you want a clean slate):

```bash
python3 -c "import secrets, string; print('sam_live_' + ''.join(secrets.choice(string.ascii_letters + string.digits) for _ in range(40)))"
```

Paste the output as the new `DEV_API_KEY` in `backend/.env.dev`, restart the backend, update Scalar.

The old key isn't auto-revoked. If you want to revoke it explicitly:

```bash
curl -X POST http://localhost:5100/_site/admin/api-keys/revoke \
  -H "Authorization: Bearer <NEW key>" \
  -H "Content-Type: application/json" \
  -d '{"admin_api_keys_id":"<old key id from the list query above>"}'
```

## Why not just disable auth in dev?

Same reason the [HARD RULE — SERVER IS THE GATE](../.claude/CLAUDE.md) applies in dev: the auth boundary is part of the design surface we test against. If the gate is off in dev, contract tests can't tell whether a handler missed its `RequireAuth` annotation. The dev API key keeps the gate on AND keeps Scalar usable.
