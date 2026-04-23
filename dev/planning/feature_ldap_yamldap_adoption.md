# Feature Request — Enterprise LDAP Login (via yamldap test rig)

> Created: 2026-04-23
> Status: brief drafted, not yet started
> Related: `backend/internal/auth/ldap_stub.go` (placeholder), migration `002_auth_permissions.sql` (schema ready), `docs/c_security.md` (LDAP-owned-fields policy)

---

## Implementation backlog

Traceable IDs — reference in commits, PRs, and issues as `LDAP-NNN`. Update the Status column as work progresses (`todo` → `wip` → `done` / `blocked` / `dropped`). Each item links to the section of this doc that describes it.

| ID | Phase | Title | Depends on | Section | Status |
|---|---|---|---|---|---|
| LDAP-001 | 0 | Create `docker/yamldap/docker-compose.yml` on port 5389, mounts seed YAML read-only | — | [Phase 0](#1-compose-service--seed-yaml-phase-0) | todo |
| LDAP-002 | 0 | Write `docker/yamldap/directory.yaml` with base DN `dc=mmffdev,dc=local`, ou=users, ou=groups, admin + user entries, pm-admins + pm-users groups | LDAP-001 | [Seed directory shape](#seed-directory-shape-vector-pm-flavoured) | todo |
| LDAP-003 | 0 | Commit SSHA-hash helper script (Go or Python one-liner) and generate `userPassword` values from `dev_accounts.md` creds | LDAP-002 | [Seed directory shape](#seed-directory-shape-vector-pm-flavoured) | todo |
| LDAP-004 | 0 | Write `docker/yamldap/README.md` — up, ldapsearch verify commands, teardown | LDAP-001 | [Phase 0](#1-compose-service--seed-yaml-phase-0) | todo |
| LDAP-005 | 0 | Verify both `ldapsearch` queries (anonymous base search + authenticated memberOf) return expected entries | LDAP-002, LDAP-003 | [Verification (at Phase 0)](#verification-at-phase-0) | todo |
| LDAP-006 | 1 | Add `github.com/go-ldap/ldap/v3` to `backend/go.mod` and `go.sum` | — | [Phase 1](#2-real-ldapprovider-phase-1) | todo |
| LDAP-007 | 1 | Add LDAP env vars (`LDAP_URL`, `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USER_FILTER`, `LDAP_TLS_MODE`) with validation (TLS-required unless `ldap://localhost`) | LDAP-006 | [Open Q5 — TLS posture](#open-questions-for-when-we-pick-this-up) | todo |
| LDAP-008 | 1 | Replace `backend/internal/auth/ldap_stub.go` with real `LDAPProvider` using bind-then-search-then-rebind, structured errors (`ErrUserNotFound`, `ErrInvalidCredentials`, `ErrDirectoryUnreachable`) | LDAP-006, LDAP-007 | [Phase 1](#2-real-ldapprovider-phase-1) | todo |
| LDAP-009 | 1 | Write `backend/internal/auth/ldap_test.go` — happy path, wrong password, unknown user, unreachable server; gate on `LDAP_TEST_URL` | LDAP-008, LDAP-005 | [Phase 1](#2-real-ldapprovider-phase-1) | todo |
| LDAP-010 | 2 | Branch `Login()` in `backend/internal/auth/service.go` on `u.AuthMethod`; LDAP path runs lockout + last-login + session issuance | LDAP-008 | [Phase 2](#3-login-branch-phase-2) | todo |
| LDAP-011 | 2 | Enforce LDAP-owned field immutability server-side (email, display name) per `docs/c_security.md`; reject writes, don't just hide UI | LDAP-010 | [Phase 2](#3-login-branch-phase-2) | todo |
| LDAP-012 | 2 | Add admin action (CLI or UI) to flip a user to `auth_method='ldap'`, set `ldap_dn`, null `password_hash` | LDAP-010 | [Open Q3 — password hash nulling](#open-questions-for-when-we-pick-this-up) | todo |
| LDAP-013 | 2 | End-to-end manual test: LDAP-marked user logs in against local yamldap; local user unaffected | LDAP-010, LDAP-011, LDAP-012 | [Phase 2](#3-login-branch-phase-2) | todo |
| LDAP-014 | 3 | CI job: yamldap service container, runs auth test suite against it, image pull cached | LDAP-009 | [Phase 3](#4-ci-integration-phase-3) | todo |
| LDAP-015 | 3 | Update `docs/c_bash.md` (compose command) and add pointer in `docs/c_security.md` | LDAP-013 | [Where it slots in](#where-it-slots-in) | todo |
| LDAP-D1 | — | Resolve 8 open questions before Phase 2 coding starts | — | [Open questions](#open-questions-for-when-we-pick-this-up) | todo |

---

## Why

Vector PM's schema and security docs already assume enterprise LDAP login exists (`users.auth_method IN ('local','ldap')`, `users.ldap_dn`, read-only profile fields for LDAP users). The Login() path does not. Before we wire that, we need a local + CI testbed that speaks real LDAPv3 on a real socket — so the bind, search, filter, and escape code we write is validated against the same wire protocol a customer's OpenLDAP or AD would present.

yamldap is the right test rig: 4MB scratch image, YAML-defined directory, starts in milliseconds, supports the bind mechanisms and filter grammar we need, zero install friction for devs.

## What yamldap is (in one paragraph)

Rust LDAPv3 server. Reads a single YAML file for its directory. Supports simple bind, search with full RFC 4515 filters (equality, presence, substring, boolean ops, approximate, extensible match), multiple password hashes (plain/SHA/SSHA/bcrypt). Read-only (no add/modify/delete). No TLS — use stunnel or nginx in front when testing the TLS path. Distributed via `ghcr.io/rvben/yamldap:latest`, Docker Compose friendly. Source: https://github.com/rvben/yamldap.

## Scope of this doc

This is the adoption plan, not the implementation. It covers:

1. How we stand up the test rig
2. What the seed directory looks like
3. The phased path from stub → real provider → login branch
4. Verification story (manual + CI)
5. Open questions for the implementer

Actual code changes happen when this brief is picked up.

---

## Shape

### 1. Compose service + seed YAML (Phase 0)

New files:

- `docker/yamldap/docker-compose.yml` — single service on port `5389` (unprivileged; avoids the 389 reserved-port hassle on macOS). Binds the seed YAML read-only into the container.
- `docker/yamldap/directory.yaml` — the seed directory (shape below).
- `docker/yamldap/README.md` — one-page how-to: `docker compose up -d`, test with `ldapsearch`, tear down.

No changes to backend code or `backend/.env.local` yet.

#### Seed directory shape (Vector PM-flavoured)

Base DN `dc=mmffdev,dc=local`. Structure mirrors how we'd expect a real customer directory to look, so later wiring is obvious.

```yaml
directory:
  base_dn: "dc=mmffdev,dc=local"

entries:
  - dn: "dc=mmffdev,dc=local"
    objectClass: ["top", "domain"]
    dc: "mmffdev"

  - dn: "ou=users,dc=mmffdev,dc=local"
    objectClass: ["top", "organizationalUnit"]
    ou: "users"

  - dn: "ou=groups,dc=mmffdev,dc=local"
    objectClass: ["top", "organizationalUnit"]
    ou: "groups"

  # Matches dev admin account (memory: dev_accounts.md)
  - dn: "uid=admin,ou=users,dc=mmffdev,dc=local"
    objectClass: ["top", "person", "inetOrgPerson"]
    uid: "admin"
    cn: "Vector Admin"
    sn: "Admin"
    mail: "admin@mmffdev.local"
    userPassword: "{SSHA}…"   # seeded from the real dev password, hashed

  - dn: "uid=user,ou=users,dc=mmffdev,dc=local"
    objectClass: ["top", "person", "inetOrgPerson"]
    uid: "user"
    cn: "Vector User"
    sn: "User"
    mail: "user@mmffdev.local"
    userPassword: "{SSHA}…"

  - dn: "cn=pm-admins,ou=groups,dc=mmffdev,dc=local"
    objectClass: ["top", "groupOfNames"]
    cn: "pm-admins"
    member:
      - "uid=admin,ou=users,dc=mmffdev,dc=local"

  - dn: "cn=pm-users,ou=groups,dc=mmffdev,dc=local"
    objectClass: ["top", "groupOfNames"]
    cn: "pm-users"
    member:
      - "uid=user,ou=users,dc=mmffdev,dc=local"
      - "uid=admin,ou=users,dc=mmffdev,dc=local"
```

SSHA hashes generated with `slappasswd -h '{SSHA}' -s '<password>'` or a one-line Go/Python helper committed as a script.

#### Verification (at Phase 0)

```bash
docker compose -f docker/yamldap/docker-compose.yml up -d
ldapsearch -x -H ldap://localhost:5389 -b "dc=mmffdev,dc=local" "(uid=admin)"
ldapsearch -x -H ldap://localhost:5389 \
  -D "uid=admin,ou=users,dc=mmffdev,dc=local" -w '<admin-pass>' \
  -b "dc=mmffdev,dc=local" "(memberOf=cn=pm-admins,ou=groups,dc=mmffdev,dc=local)"
```

Done criteria for Phase 0: both queries return the expected entries. No backend code touched.

### 2. Real LDAPProvider (Phase 1)

- Add `github.com/go-ldap/ldap/v3` to `backend/go.mod`.
- Replace `backend/internal/auth/ldap_stub.go` with a real `LDAPProvider` implementation that:
  - Takes config (URL, base DN, bind DN template, TLS mode, timeout) from env.
  - Implements `Authenticate(username, password) (userDN string, ok bool, err error)`.
  - Uses a bind-then-search-then-rebind pattern (initial service-account bind → search for user DN by `uid`/`mail` → rebind as the user with their password).
  - Returns structured errors (`ErrUserNotFound`, `ErrInvalidCredentials`, `ErrDirectoryUnreachable`) so callers can respond correctly without leaking existence.
- Unit tests in `backend/internal/auth/ldap_test.go` that spin up yamldap in CI (or gate on a `LDAP_TEST_URL` env var) and exercise: happy path, wrong password, unknown user, locked account (absent in yamldap's read-only model — skip or fake), unreachable server.

Login flow **still uses bcrypt for all users**. The LDAP provider is dormant until Phase 2.

Done criteria for Phase 1: `go test ./internal/auth/...` passes with the CI yamldap running, and the provider's exported interface is stable enough to wire into Login().

### 3. Login branch (Phase 2)

- In `backend/internal/auth/service.go` `Login()`: branch on `u.AuthMethod`.
  - `'local'` → existing bcrypt path (unchanged).
  - `'ldap'` → call `LDAPProvider.Authenticate(u.LdapDN, password)`. On success, skip bcrypt, still run lockout + last-login + session issuance. On failure, same failed-login accounting as local.
- Admin path to mark a user `auth_method='ldap'`: a CLI or admin UI action that sets `auth_method`, sets `ldap_dn`, and clears `password_hash` (or leaves it — decide once; see open questions).
- Enforce `docs/c_security.md`: LDAP users cannot edit directory-owned fields (email, display name). API must reject those writes, not just hide the UI.

Done criteria for Phase 2: an LDAP-marked test user can log in end-to-end against the local yamldap container, and a `local` user's flow is unchanged.

### 4. CI integration (Phase 3)

- Add a GitHub Actions job (or whatever CI we land on) that spins up yamldap as a service container and runs the auth test suite against it. Seed YAML lives in `docker/yamldap/directory.yaml` and is shared between local dev and CI.
- Cache the image pull.

### 5. Later: AD-specific coverage (deferred)

yamldap covers the standard LDAP surface. AD-specific things yamldap will not help validate:

- `sAMAccountName` as the login key
- `userAccountControl` (disabled account, locked-out, password-expired)
- Nested groups via `tokenGroups`
- Referrals / forest topology
- UPN vs DN login formats

When a real customer drives that need, stand up Samba-AD or a vendor AD test tenant as a secondary CI job. Not in scope now.

---

## Where it slots in

- `backend/internal/auth/ldap_stub.go` → replaced by real provider in Phase 1
- `backend/internal/auth/service.go` → `Login()` branches in Phase 2
- `backend/internal/models/models.go` → no changes; `AuthMethod` and `LdapDN` already there
- `backend/.env.local` → new entries in Phase 1: `LDAP_URL`, `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USER_FILTER`, `LDAP_TLS_MODE`
- `docs/c_security.md` → already documents the read-only-fields policy; no doc change needed but add a pointer to this feature once it ships
- `docs/c_bash.md` → add the `docker compose -f docker/yamldap/docker-compose.yml up` command once Phase 0 lands

---

## Dependencies / touches

- Adds `github.com/go-ldap/ldap/v3` (MIT) to Go modules — Phase 1.
- Adds `ghcr.io/rvben/yamldap` image as a dev/CI dependency — Phase 0.
- No frontend changes until Phase 2 (login form may want a "Sign in with company directory" affordance, or may stay email+password and route automatically — decide in Phase 2).

---

## Open questions (for when we pick this up)

1. **Login discovery.** Does the user type their corporate email into the existing form and the backend figures out `auth_method` from their user record? Or do we split the form (local vs SSO-style)? Email-first is simpler and hides whether a user is local or LDAP — preferred.
2. **Bind DN vs search-bind.** Two patterns:
   - *DN template*: `uid={username},ou=users,{base}` — simple, brittle if directory shape varies.
   - *Search-bind*: service account searches by `(mail={email})`, then rebinds as the found DN — flexible, needs a service-account credential.
   Search-bind is the standard for enterprise; lock in.
3. **Password hash on LDAP users.** When we flip a user to `auth_method='ldap'`, do we null out `password_hash` or keep it as a fallback? Keeping it risks drift; nulling it is cleaner. Recommend null + leave schema allowing NULL.
4. **Group → role mapping.** Today roles live in `users.role`. Enterprise customers will want group-driven roles (`cn=pm-admins` → `role='admin'`). First pass: ignore, keep roles app-managed. Later pass: config-driven mapping. Don't build a half-solution.
5. **TLS posture.** yamldap has no TLS. Our client code must default to `tls=required` for production configs, `tls=none` only allowed when `LDAP_URL` starts with `ldap://localhost`. Enforce at config-validation time.
6. **First-login provisioning.** If an LDAP user binds successfully but has no `users` row yet, do we auto-provision? (Common enterprise pattern.) If yes, what tenant? What role default? Defer to per-customer config; don't ship a default that surprises someone.
7. **Account lockout for LDAP users.** Our `failed_login_count` / `locked_until` columns work for local. For LDAP, do we mirror failures locally, or trust the directory's lockout? Mirror locally — our lockout is about stopping brute force against *our* endpoint, independent of what the directory does.
8. **Session invalidation when directory disables a user.** Directory says "disabled", our session is still valid until expiry. Do we poll or trust short session lifetimes? Short lifetimes are the industry answer; note in security doc.

---

## Done (top-level)

- [ ] Phase 0: yamldap compose + seed + README + ldapsearch verifies
- [ ] Phase 1: real LDAPProvider replaces stub, unit tests pass
- [ ] Phase 2: `Login()` branches on `auth_method`, end-to-end works against yamldap
- [ ] Phase 3: CI runs yamldap as service container, auth tests pass there
- [ ] Docs updated (`docs/c_bash.md`, pointer from `docs/c_security.md`)

---

## Non-goals

- Production LDAP deployment guidance for customers (separate doc when we're closer to shipping)
- AD-specific integration (deferred; see "Later" section)
- SSO/SAML/OIDC (different feature; LDAP is enterprise directory, SSO is browser-redirect auth)
- Migrating existing local users to LDAP (migration path is a separate brief)
