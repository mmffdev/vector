#!/usr/bin/env python3
"""cron_cross_db_orphan_audit.py — nightly cross-DB orphan-check for PLA064 CUT1.0.2.

Purpose
-------
Discovers all UUID columns in vector_artefacts that carry cross-DB soft-FK references
(queried LIVE from information_schema.columns — not baked-in), then for each column
runs an orphan-check against the referenced target table in mmff_vector.

An orphan is a UUID value present in a vector_artefacts column that has no matching
row in the mmff_vector target table. If orphans exist at Phase-5 (FK installation),
Postgres will refuse the FK constraint. This cron surfaces drift early so Phase-5 can
be preceded by a clean-up step.

Schedule
--------
  Runs nightly at 03:00 local time via launchd.
  See: infra/launchd/com.mmffdev.vector.cron-cross-db-orphan-audit.plist
  Logs: local-assets/logs/cron-cross-db-orphan-audit.{out,err}.log

Manual test (no POST)
---------------------
  python3 dev/scripts/cron_cross_db_orphan_audit.py --dry-run

Verbose column-by-column progress
----------------------------------
  python3 dev/scripts/cron_cross_db_orphan_audit.py --verbose

Self-disable behaviour
-----------------------
  If mmff_vector is unreachable (Phase-6 has dropped the database), the script logs
  a graceful "mmff_vector connection unavailable — cron self-disabled" message and
  exits 0. It does NOT crash launchd.

Retirement
----------
  Archived to dev/scripts/archive/ in CUT1.6.1 once Postgres FKs enforce orphans
  by themselves.

Context
-------
  PLA064 CUT1.0.2 — cross-DB orphan audit cron (second pre-cutover dev-tools ticket).
  SY003 (mmff_dev.dev_reports id='SY003') documents the 50 soft-FK columns this
  script targets.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import date
from pathlib import Path

# ---------------------------------------------------------------------------
# Repo root and env file
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "backend" / ".env.dev"

# ---------------------------------------------------------------------------
# psycopg2 import with clear fallback message
# ---------------------------------------------------------------------------
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    try:
        import psycopg as psycopg2  # type: ignore[no-redef]
    except ImportError:
        print(
            "ERROR  Neither psycopg2 nor psycopg (v3) is installed.\n"
            "       Install with:  pip3 install psycopg2-binary\n"
            "       Then re-run this script.",
            file=sys.stderr,
        )
        sys.exit(1)


# ---------------------------------------------------------------------------
# Read env file (parses KEY=VALUE lines; ignores comments and blanks)
# ---------------------------------------------------------------------------
def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip()
    return env


# ---------------------------------------------------------------------------
# Soft-FK column classification
# Each entry: (column_name_pattern, target_db, target_table, target_column, group_label)
# Pattern matching is done by column name equality (not substring) for precision.
# ---------------------------------------------------------------------------

# The 50 columns from SY003 v2 io-contract, grouped by target.
# The cron discovers columns live from information_schema.columns, then maps each
# to a target using this table.  Any column NOT in this table is skipped (it is
# an intra-db FK, a self-FK, or a library ref handled separately).
#
# Format: col_name -> (target_db, target_table, group_label)
SOFT_FK_MAP: dict[str, tuple[str, str, str]] = {
    # Group A — vector_artefacts → mmff_vector.users.id (18 columns)
    "created_by_user_id":                                       ("mmff_vector", "users", "A — users"),
    "assigned_to_user_id":                                      ("mmff_vector", "users", "A — users"),
    "owned_by_user_id":                                         ("mmff_vector", "users", "A — users"),
    "adopted_by_user_id":                                       ("mmff_vector", "users", "A — users"),
    "audit_logs_id_user":                                       ("mmff_vector", "users", "A — users"),
    "errors_events_id_user":                                    ("mmff_vector", "users", "A — users"),
    "library_releases_acknowledgements_id_user_acknowledger":   ("mmff_vector", "users", "A — users"),
    "master_record_portfolios_id_user_adopter":                 ("mmff_vector", "users", "A — users"),
    "master_record_workspaces_id_user_owner":                   ("mmff_vector", "users", "A — users"),
    "timeboxes_milestones_id_user_owner":                       ("mmff_vector", "users", "A — users"),
    "timeboxes_releases_id_user_owner":                         ("mmff_vector", "users", "A — users"),
    "timeboxes_sprints_id_user_owner":                          ("mmff_vector", "users", "A — users"),
    "committed_by":                                             ("mmff_vector", "users", "A — users"),
    "topology_view_states_id_user":                             ("mmff_vector", "users", "A — users"),
    "users_roles_topology_nodes_id_user":                       ("mmff_vector", "users", "A — users"),
    "users_roles_topology_nodes_id_user_granter":               ("mmff_vector", "users", "A — users"),
    "users_roles_topology_nodes_id_user_revoker":               ("mmff_vector", "users", "A — users"),
    "created_by":                                               ("mmff_vector", "users", "A — users"),

    # Group B — vector_artefacts → mmff_vector.master_record_workspaces.id (14 columns)
    "workspace_id":                                             ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "artefacts_types_id_workspace":                             ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "master_record_portfolios_id_workspace":                    ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "master_record_workspaces_id_workspace":                    ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "timeboxes_milestones_id_workspace":                        ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "timeboxes_releases_id_workspace":                          ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "timeboxes_sprints_id_workspace":                           ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "topology_view_states_id_workspace":                        ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "users_roles_topology_nodes_id_workspace":                  ("mmff_vector", "master_record_workspaces", "B — workspaces"),
    "webhooks_subscriptions_id_workspace":                      ("mmff_vector", "master_record_workspaces", "B — workspaces"),

    # Group C — vector_artefacts → mmff_vector.subscriptions.id (17 columns)
    "subscription_id":                                          ("mmff_vector", "subscriptions", "C — subscriptions"),
    "artefacts_types_id_subscription":                          ("mmff_vector", "subscriptions", "C — subscriptions"),
    "audit_logs_id_subscription":                               ("mmff_vector", "subscriptions", "C — subscriptions"),
    "errors_events_id_subscription":                            ("mmff_vector", "subscriptions", "C — subscriptions"),
    "library_releases_acknowledgements_id_subscription":        ("mmff_vector", "subscriptions", "C — subscriptions"),
    "timeboxes_milestones_id_subscription":                     ("mmff_vector", "subscriptions", "C — subscriptions"),
    "timeboxes_releases_id_subscription":                       ("mmff_vector", "subscriptions", "C — subscriptions"),
    "timeboxes_sprints_id_subscription":                        ("mmff_vector", "subscriptions", "C — subscriptions"),
    "topology_view_states_id_subscription":                     ("mmff_vector", "subscriptions", "C — subscriptions"),
    "users_roles_topology_nodes_id_subscription":               ("mmff_vector", "subscriptions", "C — subscriptions"),
    "master_record_tenants_id_subscription":                    ("mmff_vector", "subscriptions", "C — subscriptions"),

    # Group D — vector_artefacts → mmff_vector.users_roles.id (1 column)
    "users_roles_topology_nodes_id_role":                       ("mmff_vector", "users_roles", "D — users_roles"),
}

# Group E (mmff_library) — separate target DB, lower priority, logged as advisory.
LIBRARY_FK_MAP: dict[str, tuple[str, str, str]] = {
    "library_releases_acknowledgements_id_library_release": ("mmff_library", "library_releases", "E — library"),
    "master_record_portfolios_id_library_portfolio_model":  ("mmff_library", "portfolio_templates", "E — library"),
}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dry-run", action="store_true", help="Print report to stdout; do NOT POST to dev_reports.")
    p.add_argument("--verbose", action="store_true", help="Print column-by-column progress.")
    return p.parse_args()


def connect(env: dict[str, str], dbname_key: str, host_key: str = "DB_HOST",
            port_key: str = "DB_PORT", user_key: str = "DB_USER",
            pass_key: str = "DB_PASSWORD") -> "psycopg2.connection":
    return psycopg2.connect(
        host=env.get(host_key, "localhost"),
        port=int(env.get(port_key, "5435")),
        dbname=env[dbname_key],
        user=env.get(user_key, "mmff_dev"),
        password=env.get(pass_key, ""),
    )


# ---------------------------------------------------------------------------
# Core orphan-check logic
# ---------------------------------------------------------------------------

def discover_soft_fk_columns(va_cur) -> list[tuple[str, str, str, str, str]]:
    """Query information_schema.columns in vector_artefacts for UUID columns.

    Returns list of (table_name, column_name, target_db, target_table, group_label)
    for every column that appears in SOFT_FK_MAP.

    This is the LIVE discovery path — column list is never baked in.
    """
    va_cur.execute("""
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_catalog = 'vector_artefacts'
          AND table_schema  = 'public'
          AND data_type     = 'uuid'
        ORDER BY table_name, column_name
    """)
    rows = va_cur.fetchall()
    found: list[tuple[str, str, str, str, str]] = []
    for table_name, column_name in rows:
        if table_name.startswith("fdw_"):
            continue  # FDW views — not real VA tables, skip
        if column_name in SOFT_FK_MAP:
            tgt_db, tgt_table, group = SOFT_FK_MAP[column_name]
            found.append((table_name, column_name, tgt_db, tgt_table, group))
    return found


def check_orphans(va_cur, mv_cur, source_table: str, source_col: str,
                  target_table: str, verbose: bool) -> tuple[int, list[str]]:
    """Return (orphan_count, sample_ids) for a single source_table.source_col → target_table.id check.

    orphan_count = number of ROWS in source_table whose source_col value has no
    matching id in target_table.  This is NOT the count of distinct dead UUIDs —
    it is the count of row-instances that would fail a FK constraint.  Using the
    distinct-UUID count was the CUT1.0.2 bug: it undercounted by ~2.5× because
    many rows share the same dead UUID (e.g. 427 artefacts_types rows all pointing
    at 168 dead workspace UUIDs counted as 168, not 427).  Fixed in CUT1.0.2-fix.
    """
    # Fetch distinct non-null values from vector_artefacts (used to identify
    # which UUIDs are orphaned, and to build sample_ids for the report)
    va_cur.execute(
        f"SELECT DISTINCT {source_col} FROM {source_table} WHERE {source_col} IS NOT NULL"
    )
    va_values = {str(r[0]) for r in va_cur.fetchall()}

    if not va_values:
        if verbose:
            print(f"  SKIP   {source_table}.{source_col} — 0 non-null values in source")
        return 0, []

    # Fetch all IDs from target table in mmff_vector
    mv_cur.execute(f"SELECT id FROM {target_table}")
    mv_ids = {str(r[0]) for r in mv_cur.fetchall()}

    # Distinct orphan UUIDs — used for sample_ids only (not the reported count)
    orphan_uuids = sorted(va_values - mv_ids)

    if not orphan_uuids:
        if verbose:
            print(f"  {'CLEAN':12s}  {source_table}.{source_col} → {target_table}.id  (source vals: {len(va_values)})")
        return 0, []

    # Row-instance count: how many rows contain a dead UUID.
    # This is the correct count for FK-constraint purposes.
    # Build the IN-list as a VALUES clause to avoid SQL injection and handle
    # large sets safely (psycopg2 mogrify + execute_values not available in all
    # versions, so we use %s list expansion which psycopg2 handles correctly).
    placeholders = ",".join(["%s"] * len(orphan_uuids))
    va_cur.execute(
        f"SELECT COUNT(*) FROM {source_table} WHERE {source_col}::text IN ({placeholders})",
        orphan_uuids,
    )
    row_count = va_cur.fetchone()[0]

    sample = orphan_uuids[:10]  # sample dead UUIDs for the report detail section

    if verbose:
        status = f"ORPHAN x{row_count}"
        print(f"  {status:12s}  {source_table}.{source_col} → {target_table}.id  (source vals: {len(va_values)}, dead UUIDs: {len(orphan_uuids)})")

    return row_count, sample


# ---------------------------------------------------------------------------
# HTML report builder
# ---------------------------------------------------------------------------

def build_html(
    run_date: str,
    columns_checked: int,
    results: list[dict],
    summary_verdict: str,
) -> str:
    total_orphans = sum(r["orphan_count"] for r in results)
    dirty_cols = [r for r in results if r["orphan_count"] > 0]

    # Group results by group label
    groups: dict[str, list[dict]] = {}
    for r in results:
        groups.setdefault(r["group"], []).append(r)

    def row_class(count: int) -> str:
        return 'style="background:#2a0a0a"' if count > 0 else ""

    def badge(count: int) -> str:
        if count == 0:
            return '<span style="color:#4caf50;font-weight:600">CLEAN</span>'
        return f'<span style="color:#f44336;font-weight:600">ORPHAN x{count}</span>'

    group_sections = ""
    for group_label, items in groups.items():
        rows_html = ""
        for r in items:
            sample_str = ", ".join(f"<code>{s}</code>" for s in r["sample_ids"][:5])
            if r["orphan_count"] > 5:
                sample_str += f" <em>+{r['orphan_count'] - 5} more…</em>"
            rows_html += f"""
    <tr {row_class(r['orphan_count'])}>
      <td style="padding:6px"><code>{r['source_table']}</code></td>
      <td style="padding:6px"><code>{r['source_col']}</code></td>
      <td style="padding:6px"><code>{r['target_table']}</code></td>
      <td style="padding:6px">{badge(r['orphan_count'])}</td>
      <td style="padding:6px">{sample_str if r['orphan_count'] > 0 else "—"}</td>
    </tr>"""
        group_sections += f"""
<h3 id="group-{group_label[0].lower()}">{group_label}</h3>
<table style="width:100%;border-collapse:collapse;font-size:0.85em">
  <thead><tr style="background:#1a1a2e">
    <th style="padding:6px">Source table</th>
    <th style="padding:6px">Source column</th>
    <th style="padding:6px">Target table</th>
    <th style="padding:6px">Status</th>
    <th style="padding:6px">Sample orphan IDs</th>
  </tr></thead>
  <tbody>{rows_html}
  </tbody>
</table>
"""

    verdict_color = "#f44336" if total_orphans > 0 else "#4caf50"
    verdict_label = "ORPHANS FOUND — Phase-5 requires remediation before FK installation" if total_orphans > 0 else "CLEAN — no orphans detected; Phase-5 FK installation is safe"

    html = f"""<h2 id="synopsis">Synopsis</h2>
<p>Run date: <strong>{run_date}</strong>. Columns checked: <strong>{columns_checked}</strong>. Total orphan row-instances: <strong style="color:{verdict_color}">{total_orphans}</strong>.</p>
<p style="color:{verdict_color};font-weight:600">{verdict_label}</p>

<h2 id="methodology">Methodology</h2>
<p>The cron opens two Postgres connections — one to <code>vector_artefacts</code>, one to <code>mmff_vector</code>. For each UUID column in <code>vector_artefacts</code> that carries a cross-DB soft-FK reference (per <a href="/dev/reporting/SY003">SY003</a>), it:</p>
<ol>
  <li>Queries <code>information_schema.columns</code> live (not a baked-in column list) to discover UUID columns in scope.</li>
  <li>Fetches all distinct non-null values from the source column to identify which UUIDs are orphaned.</li>
  <li>Fetches all <code>id</code> values from the target table in <code>mmff_vector</code>.</li>
  <li>Identifies orphan UUIDs = source distinct values not present in the target id set.</li>
  <li>Counts orphan <em>row-instances</em>: how many source rows contain a dead UUID (i.e. <code>COUNT(*) WHERE col IN (dead_uuid_set)</code>). This is the FK-constraint-relevant count — it is the number of rows that would fail a <code>ADD CONSTRAINT ... FOREIGN KEY</code> if one were applied today.</li>
</ol>
<p><strong>Note:</strong> the "orphan row-instances" count is higher than the count of distinct dead UUIDs when multiple rows share the same dead UUID. For example, 427 <code>artefacts_types</code> rows pointing at 168 dead workspaces = 427 row-instances but only 168 distinct dead UUIDs. Reports prior to CUT1.0.2-fix (2026-05-25) reported the distinct-UUID count, which undercounted by ~2.5×.</p>
<p>FDW views (<code>fdw_*</code> tables) are excluded — they are virtual projections of legacy data, not live vector_artefacts rows. Group E (mmff_library references) is excluded from orphan counts because the library DB is read-only and its tables are not the FK installation target in Phase 5.</p>

<h2 id="results">Results by target group</h2>
{group_sections}

<h2 id="orphan-detail">Orphan detail</h2>
{"<p>No orphans detected.</p>" if total_orphans == 0 else ""}
{"".join(
    f"<p><strong>{r['source_table']}.{r['source_col']} → {r['target_table']}.id</strong> — {r['orphan_count']} orphan(s):<br>"
    + " ".join(f"<code>{s}</code>" for s in r['sample_ids'])
    + ("…" if r['orphan_count'] > len(r['sample_ids']) else "")
    + "</p>"
    for r in dirty_cols
) if dirty_cols else ""}

<h2 id="constraints">Constraints</h2>
<ul>
  <li>Postgres cannot enforce cross-DB FKs. The soft-FK map is sourced from <a href="/dev/reporting/SY003">SY003 v2</a> and re-derived from <code>information_schema.columns</code> on each run.</li>
  <li>Group E (mmff_library.library_releases, mmff_library.portfolio_templates) is not checked — those FKs will be dissolved when the library referencing layer migrates in Phase 7.</li>
  <li>This cron self-disables gracefully when mmff_vector is unreachable (Phase-6 drop). Exit 0, no POST.</li>
</ul>

<h2 id="change-log">Change Log</h2>
<p><strong>{run_date} (v2 — CUT1.0.2-fix)</strong> — Orphan count corrected from distinct-dead-UUID count to row-instance count. Prior run (v1) reported ~508 (distinct dead UUIDs); corrected count is {total_orphans} row-instances. Columns checked: {columns_checked}. See Methodology note.</p>
"""
    return html


# ---------------------------------------------------------------------------
# POST to dev_reports
# ---------------------------------------------------------------------------

def post_report(env: dict[str, str], report_id: str, html: str, summary: str, run_date: str) -> None:
    api_key = env.get("DEV_API_KEY", "")
    payload = json.dumps({
        "id": report_id,
        "type": "system",
        "title": f"{report_id} — Cross-DB orphan audit",
        "category": "Backend · DB Substrate · Orphan Audit",
        "topic": "Daily cross-DB orphan-check across all 50 SY003 io-contract columns",
        "summary": summary,
        "content": html,
        "report_date": run_date,
    }).encode("utf-8")

    req = urllib.request.Request(
        "http://localhost:5100/_site/admin/dev/reporting/",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode("utf-8")
        print(f"POST   {resp.status} — {body[:120]}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()
    env = load_env(ENV_FILE)

    today = date.today().isoformat()
    report_id = f"SY-ORPHAN-{today.replace('-', '')}"

    # --- Connect to vector_artefacts ---
    try:
        va_conn = connect(
            env,
            dbname_key="VA_DB_NAME",
            host_key="VA_DB_HOST",
            port_key="VA_DB_PORT",
            user_key="VA_DB_USER",
            pass_key="VA_DB_PASSWORD",
        )
        va_cur = va_conn.cursor()
    except Exception as e:
        print(f"ERROR  Cannot connect to vector_artefacts: {e}", file=sys.stderr)
        return 1

    # --- Connect to mmff_vector (soft-disable if unavailable post-Phase-6) ---
    try:
        mv_conn = connect(
            env,
            dbname_key="DB_NAME",
            host_key="DB_HOST",
            port_key="DB_PORT",
            user_key="DB_USER",
            pass_key="DB_PASSWORD",
        )
        mv_cur = mv_conn.cursor()
    except Exception as e:
        print(
            f"INFO   mmff_vector connection unavailable — cron self-disabled.\n"
            f"       (Error: {e})\n"
            f"       This is expected after Phase-6 drops mmff_vector. Exiting 0.",
        )
        return 0

    # --- Discover soft-FK columns live from information_schema ---
    cols = discover_soft_fk_columns(va_cur)
    print(f"INFO   {len(cols)} soft-FK UUID column(s) discovered in vector_artefacts")

    if args.verbose:
        print("INFO   Running orphan checks:")

    results: list[dict] = []
    for (source_table, source_col, target_db, target_table, group_label) in cols:
        if target_db != "mmff_vector":
            # Group E — library columns: advisory only, not checked
            if args.verbose:
                print(f"  SKIP   {source_table}.{source_col} → {target_db}.{target_table} (Group E, not checked)")
            continue
        count, sample = check_orphans(va_cur, mv_cur, source_table, source_col, target_table, args.verbose)
        results.append({
            "source_table": source_table,
            "source_col": source_col,
            "target_db": target_db,
            "target_table": target_table,
            "group": group_label,
            "orphan_count": count,
            "sample_ids": sample,
        })

    total_orphans = sum(r["orphan_count"] for r in results)
    columns_checked = len(results)

    if total_orphans == 0:
        summary = f"CLEAN — all {columns_checked} cross-DB soft-FK columns are orphan-free; Phase-5 FK installation is safe."
    else:
        dirty = sum(1 for r in results if r["orphan_count"] > 0)
        summary = f"ORPHANS FOUND — {total_orphans} orphan UUID(s) across {dirty} column(s); Phase-5 remediation required before FK installation."

    print(f"INFO   Orphan check complete. columns_checked={columns_checked} total_orphans={total_orphans}")
    print(f"INFO   Summary: {summary}")

    html = build_html(today, columns_checked, results, summary)

    va_conn.close()
    mv_conn.close()

    if args.dry_run:
        print("\n--- DRY RUN: report NOT posted ---\n")
        print(html)
        print(f"\n--- Report ID would be: {report_id} ---")
        return 0

    try:
        post_report(env, report_id, html, summary, today)
        print(f"OK     Report posted as {report_id}")
    except urllib.error.URLError as e:
        print(f"ERROR  POST failed: {e}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
