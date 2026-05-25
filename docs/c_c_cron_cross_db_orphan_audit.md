# Cross-DB orphan-audit cron — install & operate guide

PLA064 CUT1.0.2. Nightly cron that surfaces orphaned UUID references across the
50 cross-DB soft-FK columns documented in [SY003](/dev/reporting/SY003). Results
are posted to Dev → Reporting (System tab) as `SY-ORPHAN-YYYYMMDD` so drift is
visible before Phase-5 attempts to install Postgres FKs.

This is the **first scheduled task** in the Vector project. The launchd pattern here
is the precedent for any future cron added to this repo.

---

## What it does

1. Opens two Postgres connections: `vector_artefacts` (source) and `mmff_vector` (target).
2. Queries `information_schema.columns` **live** — column list is never baked in.
3. For each UUID column in scope: fetches distinct non-null values from `vector_artefacts`, compares against the `id` set in the referenced `mmff_vector` table.
4. Orphan = a UUID that exists in `vector_artefacts` but has no matching row in the target.
5. Posts `SY-ORPHAN-YYYYMMDD` to `/_site/admin/dev/reporting/`. Re-running on the same day replaces the row (idempotent).
6. Self-disables gracefully if `mmff_vector` is unreachable (Phase-6 drops the database) — logs advisory, exits 0, no crash.

Groups checked:

| Group | Source | Target | Columns |
|---|---|---|---|
| A | `vector_artefacts.*` | `mmff_vector.users.id` | 18 |
| B | `vector_artefacts.*` | `mmff_vector.master_record_workspaces.id` | 14 |
| C | `vector_artefacts.*` | `mmff_vector.subscriptions.id` | 17 |
| D | `vector_artefacts.*` | `mmff_vector.users_roles.id` | 1 |
| E | advisory only | `mmff_library.*` | 2 (not checked) |

---

## Prerequisites

Logs directory must exist before the plist is loaded:

```bash
mkdir -p "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/local-assets/logs"
```

psycopg2-binary must be installed for the system Python 3:

```bash
pip3 install psycopg2-binary
```

---

## Install the launchd plist

```bash
# Copy plist
cp "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/infra/launchd/com.mmffdev.vector.cron-cross-db-orphan-audit.plist" \
   ~/Library/LaunchAgents/

# Create log dir if it doesn't exist
mkdir -p "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/local-assets/logs"

# Load (does NOT run immediately — RunAtLoad is false)
launchctl load ~/Library/LaunchAgents/com.mmffdev.vector.cron-cross-db-orphan-audit.plist
```

The cron will fire at **03:00 local time** every night.

---

## Test manually (no POST)

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector"
python3 dev/scripts/cron_cross_db_orphan_audit.py --dry-run
```

Verbose column-by-column progress:

```bash
python3 dev/scripts/cron_cross_db_orphan_audit.py --dry-run --verbose
```

Real run (posts to dev_reports):

```bash
python3 dev/scripts/cron_cross_db_orphan_audit.py
```

---

## Verify it ran

Check logs:

```bash
ls -la "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/local-assets/logs/cron-cross-db-orphan-audit."*.log
tail -50 "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/local-assets/logs/cron-cross-db-orphan-audit.out.log"
```

Check dev_reports (today's entry):

```bash
KEY=$(grep '^DEV_API_KEY=' "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend/.env.dev" | cut -d= -f2)
curl -s -H "Authorization: Bearer $KEY" \
  "http://localhost:5100/_site/admin/dev/reporting/?type=system" \
  | python3 -c 'import sys,json; [print(r["id"], r["summary"][:80]) for r in json.load(sys.stdin)["reports"] if r["id"].startswith("SY-ORPHAN")]'
```

Or open Dev → Reporting → System tab in the browser and look for the `SY-ORPHAN-YYYYMMDD` row.

---

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.mmffdev.vector.cron-cross-db-orphan-audit.plist
rm ~/Library/LaunchAgents/com.mmffdev.vector.cron-cross-db-orphan-audit.plist
```

The script and plist remain in the repo until CUT1.6.1.

---

## Production deferral

**TD-CUTOVER-CRON-PRODUCTION** — A `systemd` unit equivalent for the production
Linux host is not deployed. The dev launchd surface is sufficient until the production
cutover scope opens. When production cutover begins, adapt this plist to a `systemd`
timer unit targeting the production Python install and production env file.
See [`docs/c_tech_debt.md`](c_tech_debt.md) for the full TD entry.

---

## Retirement

Archived to `dev/scripts/archive/` in CUT1.6.1 once Phase-6 has dropped `mmff_vector`
and Phase-5 FK installation has succeeded. At that point Postgres enforces orphan
integrity natively; the cron is mooted.
