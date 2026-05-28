# Varlock Findings

**Date:** 2026-05-28
**Source:** Review of `dmno-dev/varlock` against Vector's current Next.js 15 + Go + Docker Swarm setup.
**Decision:** Adopt later, starting with schema/audit/scan. Do not replace the backend secret runtime yet.

## Summary

Varlock is a good fit for Vector's env sprawl: it turns `.env` files into a typed, validated, AI-readable schema while keeping secret values out of agent context. The strongest immediate value is not secret storage replacement; it is an env contract, drift audit, and leak scanner.

## Useful Capabilities

1. **AI-safe env context** — commit `.env.schema` files so agents can understand required config names, types, defaults, and sensitivity without reading real values.
2. **Validation** — run `varlock load` before boot/build to fail fast on missing or malformed config.
3. **Drift detection** — run `varlock audit` to catch variables used in code but missing from schema, and schema entries that no code reads.
4. **Secret leak scanning** — run `varlock scan --staged` from a pre-commit/pre-push hook to catch real secret values accidentally copied into code, docs, generated reports, or agent output.
5. **Runtime redaction for JS surfaces** — useful later for Next.js, but adopt only after the low-risk CLI/schema phase.
6. **Multi-env clarity** — model dev/staging/prod/test through a single `@currentEnv` flag and explicit environment-specific files.
7. **Provider plugins** — later path to 1Password, AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, Infisical, etc.

## Vector Fit

Vector currently has several env surfaces:

- Root Next.js env: `.env.local`
- Backend envs: `backend/.env.dev`, `.env.staging`, `.env.production`, `.env.local`, `.env.example`
- Swarm secrets: `postgres_password`, `valkey_password`
- Monitoring env: `infra/monitoring/dev/.env.example`

The repo also has config-sensitive code across:

- Next.js: `process.env.NODE_ENV`, `NEXT_PUBLIC_API_BASE`, `VECTOR_ARTEFACTS_DB_URL`
- Go backend: `godotenv.Load`, `os.Getenv`, `secrets.Get`
- Docker Swarm: secret files under `/run/secrets/*`
- Scripts/docs: direct `DB_PASSWORD`, `DEV_API_KEY`, Valkey/Grafana exporter passwords

This makes Varlock useful as a single schema layer over the shape of config, even if the secret values still come from current dev env files and Docker secrets.

## Recommended Rollout

### Phase 1 - Low Risk

- Add root `.env.schema` for Next.js-facing variables.
- Add `backend/.env.schema` for backend variables.
- Mark sensitive vars explicitly: DB passwords, JWT secrets, SMTP creds, API keys, Valkey password, Grafana/exporter passwords.
- Add package scripts:
  - `env:load`: `varlock load`
  - `env:audit`: `varlock audit`
  - `secrets:scan`: `varlock scan --staged`
- Keep existing `godotenv` and `backend/internal/secrets` runtime unchanged.

### Phase 2 - Hook And CI Use

- Add `varlock scan --staged` to the local hook path.
- Add `varlock audit` to a non-blocking CI/dev check first, then promote to blocking once schema drift is clean.
- Use `@auditIgnore` for variables consumed only by Docker, Swarm, shell scripts, or external tools.

### Phase 3 - Runtime Integration

- For Go commands, use `varlock run --path backend/ -- go run ./cmd/server` only after schemas are stable.
- Consider replacing some direct backend boot paths with `varlock run`, but only after confirming launcher/server scripts can pass the right env and terminal behavior.
- Consider the Next.js integration later. It supports Next.js 15/Turbopack, but it requires Node 22+ and an `@next/env` override, so it is more invasive than the first phase warrants.

## Do Not Do First

- Do not convert backend secrets to `varlock("local:...")` immediately. Vector's Go secret wrapper currently understands `ENC[aes256gcm:...]`, not Varlock's local encryption format.
- Do not replace Docker Swarm secrets. Keep `/run/secrets/postgres_password` and `/run/secrets/valkey_password` as the swarm truth.
- Do not wire the Next.js integration until the CLI/schema path has proven itself.
- Do not remove `backend/.env.example` until `.env.schema` has become trusted as the source of truth.

## Suggested Scope Item

Track as **B18.10 Varlock env-schema and leak-scan adoption**:

- Phase 1: schema files + scripts.
- Phase 2: hooks + audit cleanup.
- Phase 3: optional runtime integration for Go/Next.

Priority: P3. It helps procurement, AI-agent safety, and developer confidence, but current dev can keep moving without it.

