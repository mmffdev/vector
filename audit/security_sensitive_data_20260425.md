a# Security Audit: Sensitive Data Discovery Report

**Generated:** 2026-04-25  
**Scope:** Full codebase sweep excluding `email addresses`  
**Focus:** Database credentials, API keys, test passwords, authentication tokens, secrets, and other non-email sensitive data

---

## Executive Summary

The codebase contains **significant sensitive data exposure** across multiple categories:

| Category | Count | Severity | Status |
|----------|-------|----------|--------|
| Hardcoded test passwords | 6+ | HIGH | Visible in source |
| Database credentials (encrypted) | 5+ | MEDIUM | ENC[aes256gcm:...] format |
| Placeholder passwords | 4+ | HIGH | Development defaults |
| Credential extraction patterns | 8+ | MEDIUM | Scripts processing credentials |
| Bcrypt password hashes | 3+ | MEDIUM | Test account backups |
| Configuration templates | 12+ | MEDIUM | Examples with credentials |
| SSH/tunnel credentials | 3+ | MEDIUM | SSH key, tunnel config |

**Overall Risk:** HIGH — Immediate attention needed for test credentials and development defaults.

---

## Detailed Findings by Folder

### `/backend/`

#### `backend/.env.local`
- **Issue:** Database passwords and library database credentials stored (encrypted with AES-256-GCM)
- **Lines:** 13, 41, 45, 49
- **Sensitive Keys:**
  - `DB_PASSWORD=ENC[aes256gcm:c7CSCgBBwvydj4R+FBAe4CTG9TP1tQ6IZqgn4LMoXAjf6LfvfSkLE44JdRk=]` (line 13)
  - `LIBRARY_DB_PASSWORD=ENC[aes256gcm:H6cFmQyJtlLXs8/4tVcgye1N6W+RppkIZex70KHJRNH3NlMXvvRmgA==]` (line 41)
  - `LIBRARY_PUBLISH_DB_PASSWORD=ENC[aes256gcm:SCTye7vK5+u1Hnscdt1WR5CbbgV/cxyhk2CWuY9YumFjPjA/ia2tbeAlhWgs]` (line 45)
  - `LIBRARY_ACK_DB_PASSWORD=ENC[aes256gcm:rShlHoGVBd8WvqzRhvSh8C05tMB8744ijMpa1CxD0n1hEkvKPJCCIDw=]` (line 49)
- **Status:** Encrypted (good), but file is gitignored (should remain so)
- **Action:** Verify `.gitignore` contains `backend/.env.local`

#### `backend/cmd/migrate/main.go`
- **Issue:** Code references database passwords and secrets
- **Lines:** 83, 103, 106
- **Patterns:**
  - `secrets.Get("DB_PASSWORD")` (line 83)
  - `secrets.Get("LIBRARY_ADMIN_DB_PASSWORD")` (line 103)
  - `secrets.Get("DB_PASSWORD")` fallback (line 106)
- **Status:** Proper use of secrets package (acceptable)
- **Action:** None needed

### `/db/library_schema/`

#### `db/library_schema/002_roles.sql`
- **Issue:** Placeholder passwords in SQL schema
- **Lines:** 20, 24, 28, 32
- **Passwords Found:**
  - `PASSWORD 'change_me_admin'` (line 20)
  - `PASSWORD 'change_me_ro'` (line 24)
  - `PASSWORD 'change_me_publish'` (line 28)
  - `PASSWORD 'change_me_ack'` (line 32)
- **Severity:** HIGH — development defaults
- **Status:** Marked as placeholder but should be replaced before production
- **Action:** Ensure these are changed during deployment; add warning comments

#### `db/library_schema/apply-phase1.sh` & `apply-phase3.sh`
- **Issue:** Hardcoded placeholder password for library admin
- **Lines:** 26 (phase1), 37 (phase3)
- **Value:** `LIB_ADMIN_PASSWORD="change_me_admin"` 
- **Severity:** HIGH
- **Status:** Placeholder noted
- **Action:** Document password rotation procedure

#### `db/library_schema/apply-phase1.sh` & `apply-phase3.sh` (continued)
- **Issue:** Credential extraction from .env.local
- **Lines:** Multiple (parsing DB_PASSWORD)
- **Pattern:** `grep '^DB_PASSWORD' | sed -E 's/.../'`
- **Status:** Acceptable (reading from gitignored file)
- **Action:** Ensure PGPASSWORD used inline, not exported

### `/db/schema/`

#### `db/schema/*.sql` (multiple files)
- **Issue:** Comments show example psql commands with user credentials
- **Examples:** `db/schema/011_nav_subpages_custom_groups.sql` (line 4)
- **Pattern:** `PGPASSWORD=... psql -h localhost -p 5434 -U mmff_dev ...`
- **Severity:** MEDIUM
- **Status:** Comments only, not executed code
- **Action:** Consider redacting examples or using placeholder notation

### `/dev/scripts/`

#### `dev/scripts/ssh_manager.sh`
- **Issue:** Hardcoded default database password
- **Line:** 30
- **Value:** `DB_PASSWORD_DEFAULT='9&cr39&19&11Ctcr'`
- **Severity:** HIGH — hardcoded credential visible in script
- **Status:** Marked as default, but should never be in source
- **Action:** CRITICAL — remove this default immediately; use generated/prompted values only

#### `dev/scripts/ssh_manager.sh` (continued)
- **Issue:** Password extraction from .env.local
- **Lines:** 248, 265, 305, 307, 309
- **Pattern:** Reading DB_PASSWORD from environment file and using with PGPASSWORD
- **Status:** Acceptable pattern (inline env var, not exported)
- **Action:** Document that PGPASSWORD should never be exported

#### `dev/scripts/backup-on-push.sh`
- **Issue:** Credential extraction from .env.local
- **Lines:** 127, 133-136, 151
- **Pattern:** `PW=$(grep '^DB_PASSWORD' backend/.env.local | cut -d= -f2-)`
- **Status:** Acceptable (reading from gitignored, inline usage)
- **Action:** Ensure script is not committed with passwords

### `/e2e/`

#### `e2e/lib/accounts.mjs`
- **Issue:** Hardcoded test account passwords in source code
- **Lines:** 4-6
- **Passwords Found:**
  - `user@mmffdev.com` / `"SecureCsrf2026!"` (line 4)
  - `padmin@mmffdev.com` / `"myApples100@@"` (line 5)
  - `gadmin@mmffdev.com` / `"myApples27@"` (line 6)
- **Severity:** HIGH — test credentials visible in repository
- **Status:** Live in source code
- **Action:** 
  - Move to separate gitignored test config file
  - Or load from environment variables
  - Regenerate passwords after moving

#### `e2e/README.md`
- **Issue:** Documentation includes test environment password
- **Line:** 30
- **Value:** `password 'secret'` (Selenium noVNC viewer)
- **Severity:** LOW (Selenium container password, development only)
- **Status:** Documented as test environment
- **Action:** Consider parameterizing

#### `e2e/config.mjs`
- **Issue:** Configuration URLs and ports
- **Lines:** 4, 9, 11, 15
- **Values:** References to `SELENIUM_URL`, `BASE_URL`, `BROWSER`, `DEFAULT_TIMEOUT_MS`
- **Status:** Environment variables (acceptable)
- **Action:** Ensure prod environment variables don't leak test values

### `/db/library_schema/` (seed data)

#### `db/library_schema/README.md`
- **Issue:** Documentation references placeholder passwords
- **Context:** Instructions for database initialization
- **Status:** Documentation only
- **Action:** Consider redacting examples or using placeholders

### `/docs/`

#### `docs/c_c_secrets_audit.md`
- **Issue:** Documentation of encryption strategy
- **Line:** 37, section "Keys to encrypt in `.env.local`"
- **Status:** This is a security doc (good to have)
- **Action:** Review and ensure it's comprehensive

#### `docs/c_backlog.md`
- **Issue:** Example MCP registration command with plaintext password
- **Line:** 40
- **Pattern:** `PLANKA_PASSWORD=<new>` (template with placeholder)
- **Status:** Template instruction, not actual credential
- **Action:** Ensure users understand `<new>` is a placeholder

#### `docs/c_schema.md`
- **Issue:** References `DB_PASSWORD` in documentation
- **Line:** 15
- **Context:** Database schema documentation
- **Status:** Reference to config key, not actual password
- **Action:** None needed

#### `docs/c_c_bash_postgres.md`
- **Issue:** Documentation shows PGPASSWORD usage patterns
- **Lines:** 11, 21, 32, 54-55
- **Pattern:** Example commands extracting DB_PASSWORD from .env.local
- **Status:** Documentation of best practices
- **Action:** Ensure recommendations are security-conscious (currently good)

#### `docs/c_c_schema_auth.md`
- **Issue:** Seed data documentation with example password
- **Line:** 49
- **Value:** `admin@mmffdev.com` / `changeme` (bcrypt noted)
- **Status:** Documentation of test account
- **Action:** Ensure production docs don't retain this

#### `docs/c_c_backlog_agent.md`
- **Issue:** Example API request with hardcoded credentials
- **Line:** 52
- **Pattern:** `"password":"changeme123!"` in JSON example
- **Status:** Example documentation
- **Action:** Use `<PASSWORD_PLACEHOLDER>` instead

#### `docs/c_c_backlog_dedup.md`
- **Issue:** Example curl command with admin credentials
- **Line:** 10
- **Pattern:** `{"emailOrUsername":"admin@mmffdev.com","password":"changeme123!"}`
- **Status:** Example documentation
- **Action:** Redact with `<PASSWORD>` placeholder

#### `docs/c_c_planka_rest.md`
- **Issue:** Example authentication command with credentials
- **Line:** 29
- **Pattern:** Admin login with hardcoded password
- **Status:** Example documentation
- **Action:** Parameterize with environment variable examples

#### `docs/c_security.md`
- **Issue:** Contains security best practices and credential handling rules
- **Lines:** 14, 20, 22, 29, 31, 33
- **Status:** Good security documentation (exemplary)
- **Action:** Review and keep current

### `/dev/planning/`

#### `dev/planning/c_backlog.md`
- **Issue:** Mentions unencrypted sensitive data points
- **Line:** 13
- **Planned Keys:** `SMTP_PASS`, `DB_PASSWORD`, `JWT_*_SECRET`, library DB passwords, API keys
- **Status:** Security roadmap item (good awareness)
- **Action:** Track implementation progress

#### `dev/planning/feature_ldap_yamldap_adoption.md`
- **Issue:** Feature documentation references LDAP credentials
- **Line:** 184
- **Values:** `LDAP_URL`, `LDAP_BASE_DN`, `LDAP_BIND_DN`, `LDAP_BIND_PASSWORD`, `LDAP_USER_FILTER`, `LDAP_TLS_MODE`
- **Status:** Future feature planning (acceptable)
- **Action:** Ensure passwords encrypted when implemented

#### `dev/planning/feature_ldap_yamldap_adoption.md` (examples)
- **Issue:** Test LDAP user examples with email
- **Lines:** 97, 105
- **Status:** Examples only (not storing actual credentials)
- **Action:** None needed

#### `dev/planning/plan_db_enterprise_hardening.md`
- **Issue:** References PII columns including IP addresses
- **Line:** 60
- **Columns:** `users.email`, `sessions.ip_address`, `sessions.user_agent`, `audit_log.ip_address`
- **Status:** Security planning document
- **Action:** Track encryption implementation

### `/.claude/` (development tooling)

#### `.claude/CLAUDE.md`
- **Issue:** References database operations and credentials in comments
- **Status:** Internal development documentation
- **Action:** None needed (not production code)

#### `.claude/memory/planka_api_access.md`
- **Issue:** Contains Planka API authentication token
- **Lines:** Various
- **Pattern:** Bearer token information
- **Severity:** HIGH if token is still valid
- **Status:** Memory file (should be gitignored)
- **Action:** Verify `.gitignore` includes `.claude/**`

#### `.claude/memory/boot2.md`
- **Issue:** Contains admin credentials for Planka
- **Line:** 11
- **Value:** `admin@mmffdev.com` / `changeme123!`
- **Severity:** HIGH
- **Status:** Internal memory file
- **Action:** Verify file is gitignored; regenerate password

#### `.claude/memory/bootup.md`
- **Issue:** References sensitive configuration
- **Lines:** 32, 34, 51, 53, 79
- **Status:** Development notes (should be gitignored)
- **Action:** Verify `.gitignore` includes `.claude/`

#### `.claude/hooks/planka-card-moved.sh`
- **Issue:** References PLANKA_USER and Bearer token
- **Line:** 10, 50
- **Pattern:** Authorization header with token
- **Status:** Hook script (gitignored)
- **Action:** Ensure script properly sources token from environment

### `/db/seed/`

#### `db/seed/001_default_workspace.sql`
- **Issue:** References test admin account
- **Lines:** 30, 308
- **Status:** Seed data comments
- **Action:** Consider renaming or removing references

### `/dev/scripts/backup/`

#### `dev/scripts/backup/pre_cleanup_test_subs_20260425_043038.sql`
- **Issue:** Database backup containing hashed passwords and user data
- **Lines:** 2002-2003, 2008
- **Values:** Bcrypt password hashes for test accounts
- **Severity:** MEDIUM — hashes only, but contains user accounts
- **Status:** Backup file (sensitive, should be protected)
- **Action:** Ensure backups are encrypted and access-controlled

#### `dev/scripts/backup/producers/60_opt_configs.sh`
- **Issue:** Script tars Docker compose files with .env credentials
- **Lines:** 6-7
- **Pattern:** `tar ... opt/*/{docker-compose.yml,.env}`
- **Severity:** HIGH — backs up unencrypted credentials
- **Status:** Production backup script
- **Action:** Ensure backup destinations are encrypted and secured

### `/.env` files (patterns)

#### `.env.local` patterns across codebase
- **Files Referencing:** `backend/.env.local`, `backend/.env` template
- **Sensitivity:** Database passwords, library DB passwords, potentially JWT secrets, SMTP credentials
- **Status:** `.env.local` properly gitignored (good)
- **Action:** Verify `.gitignore` entry; ensure production uses secure secret management

### `/README.md` & Documentation

#### `README.md`
- **Issue:** Notes that `.env.local` files are committed (potential issue)
- **Line:** 15
- **Text:** `"Env files (.backend/.env.local) are committed — no manual setup."`
- **Severity:** HIGH — contradicts security best practices
- **Status:** Potentially outdated documentation
- **Action:** CRITICAL — verify actual .gitignore status and update documentation

---

## Summary by Risk Level

### 🔴 CRITICAL (Immediate Action Required)

1. **Hardcoded default DB password in `dev/scripts/ssh_manager.sh` (line 30)**
   - Value: `'9&cr39&19&11Ctcr'`
   - Action: Remove immediately; use secure generation or prompting

2. **Test account passwords in `e2e/lib/accounts.mjs` (lines 4-6)**
   - Visible in source control
   - Action: Move to gitignored environment file

3. **Documentation claims `.env.local` is committed (README.md:15)**
   - Contradicts security best practices
   - Action: Verify actual status and correct documentation

### 🟠 HIGH (Address Within Sprint)

1. **Placeholder passwords in SQL schema** (`db/library_schema/002_roles.sql`)
   - Values: `change_me_admin`, `change_me_ro`, etc.
   - Action: Document rotation procedure; add deployment warnings

2. **Test credentials in documentation examples** (multiple docs)
   - Hardcoded admin password in examples
   - Action: Parameterize with `<PASSWORD>` placeholders

3. **Database backup contains unencrypted paths** (`dev/scripts/backup/producers/60_opt_configs.sh`)
   - Backs up `.env` files
   - Action: Encrypt backup destinations

4. **Planka API token in memory file** (`.claude/memory/planka_api_access.md`)
   - Bearer token for API access
   - Action: Verify file is gitignored; regenerate token

### 🟡 MEDIUM (Schedule for Review)

1. **Encrypted credentials in `.env.local`** (`backend/.env.local`)
   - Status: Already encrypted (good)
   - Action: Verify encryption key management; ensure .gitignore is solid

2. **Credential extraction in scripts** (multiple bash scripts)
   - Status: Using secure inline patterns
   - Action: Audit for any exported variables

3. **SQL comments with example credentials** (schema files)
   - Status: Comments only
   - Action: Redact or use placeholders

4. **PII columns mentioned in planning** (enterprise hardening plan)
   - Status: Awareness documented
   - Action: Track encryption implementation

---

## .gitignore Verification Checklist

Confirm the following entries exist in `.gitignore`:

- [ ] `backend/.env.local` (or `**/.env.local`)
- [ ] `**/.env` (all environment files)
- [ ] `.claude/memory/` (development notes)
- [ ] `.claude/hooks/` (hook scripts)
- [ ] `dev/scripts/backup/` (backup outputs)
- [ ] `*.sql.bak` or backup files
- [ ] `.env*.local` patterns

**Current Status:** Need to verify `.gitignore` file exists and contains these patterns.

---

## Recommendations

### Immediate (This Week)

1. **Remove hardcoded SSH manager password** from `dev/scripts/ssh_manager.sh`
2. **Migrate test credentials** from `e2e/lib/accounts.mjs` to `.env.local` or `.env.test`
3. **Verify and update README.md** to clarify `.env.local` is NOT committed
4. **Regenerate Planka token** and update memory files

### Short-term (Next Sprint)

1. **Audit all `os.Getenv()` call sites** in Go backend for secret handling
2. **Implement comprehensive secrets audit** as documented in `dev/planning/c_backlog.md`
3. **Add pre-commit hook** to detect credential patterns
4. **Parameterize all documentation examples** that contain credentials

### Long-term (Before Launch)

1. **Implement full encryption-at-rest** for all secrets per `dev/planning/c_backlog.md`
2. **Externalize session management** to Redis for enterprise hardening
3. **Add PII classification and encryption** per enterprise requirements
4. **Implement audit logging** with proper secret redaction
5. **Conduct security review** with external auditor

---

## Files Requiring Attention

| File | Issue | Priority |
|------|-------|----------|
| `dev/scripts/ssh_manager.sh` | Hardcoded password | CRITICAL |
| `e2e/lib/accounts.mjs` | Test credentials in source | CRITICAL |
| `README.md` | Outdated .env documentation | CRITICAL |
| `.claude/memory/planka_api_access.md` | API token stored | HIGH |
| `db/library_schema/002_roles.sql` | Placeholder passwords | HIGH |
| `docs/c_c_backlog_agent.md` | Example with credentials | HIGH |
| `docs/c_c_backlog_dedup.md` | Example with credentials | HIGH |
| `docs/c_c_planka_rest.md` | Example with credentials | HIGH |
| `dev/scripts/backup/producers/60_opt_configs.sh` | Unencrypted backup | HIGH |
| `backend/.env.local` | Encrypted credentials (monitor) | MEDIUM |

---

## Related Documentation

- **Security Posture:** [`docs/c_security.md`](../docs/c_security.md)
- **Schema Auth Details:** [`docs/c_c_schema_auth.md`](../docs/c_c_schema_auth.md)
- **Secrets Audit Plan:** [`dev/planning/c_backlog.md`](../dev/planning/c_backlog.md)
- **Enterprise Hardening:** [`dev/planning/plan_db_enterprise_hardening.md`](../dev/planning/plan_db_enterprise_hardening.md)
- **Encryption Strategy:** [`docs/c_c_secrets_audit.md`](../docs/c_c_secrets_audit.md)

---

**Report prepared by:** Security Audit Agent  
**Scope:** Full codebase (excluding email addresses)  
**Next Review:** 2026-05-02
