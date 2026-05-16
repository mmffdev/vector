#!/usr/bin/env python3
"""Lint column-prefix-convention: §2.3 of c_c_naming_conventions.md.

PLA-0048 / RF1.4.4. Hard gate on the §2.3 column-prefix convention.

§2.3 rule: every column on a table carries the table name as prefix.
E.g. on `users_sessions`, columns are `users_sessions_id`,
`users_sessions_token_hash`, `users_sessions_user_id`, etc. — not
bare `id`, `token_hash`, `user_id`.

This lint scans SQL string literals inside `backend/internal/<pkg>/sql.go`
for INSERT / UPDATE statements on renamed (§2.6 root family) tables
whose column lists still use bare names.

Detection (regex-based; not a real SQL parser):
  • Find every `INTO <table> (...)` and `UPDATE <table> SET ...` clause.
  • If <table> is in the renamed set (built from RF1.4.2 + RF1.4.4
    migrations), inspect the column list. Any identifier that doesn't
    start with `<table>_` is a violation.
  • Skip identifiers that are SQL keywords (NULL, NOW(), DEFAULT, etc.),
    placeholders ($1), and column aliases.

Exit code:
  0 — clean.
  1 — at least one violation found in a non-exempt package.

History: the lint ran in warn-only mode from 2026-05-14 (baseline 245
findings, 9 packages) until 2026-05-14 when the final pay-down (mig
190 — users_nav family) landed. Migrations: 186 (users_password_resets),
063 (master_record_tenants), 187 (users_sessions), 064
(artefacts_fields_values + artefactitemsv2→artefactitems rename),
188 (users_roles_workspaces), 189 (RBAC triangle), 065 (flows family),
066 (artefacts_types), 190 (users_nav family). Total 9 pay-downs, 245
→ 0 findings.

Ledger: dev/registries/column_prefix_exempt.json — empty array means
the lint is the new architectural invariant. Any package added back to
the ledger is a regression that needs review.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "column_prefix_exempt.json"
SCAN_DIR = ROOT / "backend" / "internal"

# Tables whose column-prefix is already on (full §2.3). Reads on these
# are silent. Anything NOT in this set but in RENAMED_TABLES is in scope.
FULL_PREFIX_TABLES = {
    "timeboxes_sprints",
    "timeboxes_releases",
    "webhooks_subscriptions",
    "webhooks_deliveries",
    "audit_logs",
    "errors_events",
    "library_releases_acknowledgements",
}

# Tables renamed in RF1.4.2 but whose column-prefix is deferred under
# TD-NAME-001. These are the targets we want to clean up.
RENAMED_TABLES = {
    "users_roles",
    "users_permissions",
    "users_roles_permissions",
    "users_roles_workspaces",
    "users_roles_pages",
    "users_sessions",
    "users_password_resets",
    "users_nav_prefs",
    "users_nav_groups",
    "users_nav_profiles",
    "users_nav_profile_groups",
    "users_tab_order",
    "users_custom_pages",
    "users_custom_page_views",
    "users_roles_topology_nodes",
    "admin_api_keys",
    "pages_tags",
    "pages_addressables",
    "pages_help",
    "subscriptions_sequence",
    "subscriptions_item_type_icons",
    "subscriptions_stakeholders",
    "master_record_portfolios",
    "master_record_tenants",
    "topology_view_states",
    "artefacts_types",
    "artefacts_types_fields",
    "artefacts_fields_library",
    "artefacts_fields_values",
    "workspaces_fields",
    "flows",
    "flows_states",
    "flows_transitions",
    "flows_states_exit_rules",
    "flows_defaults",
    "flows_states_defaults",
    "flows_transitions_defaults",
}

# Identifiers that appear in column lists but aren't real columns.
SQL_NOISE = {
    "NULL", "DEFAULT", "NOW", "TRUE", "FALSE",
    "VALUES", "RETURNING", "ON", "CONFLICT", "DO", "UPDATE",
    "EXCLUDED", "SET", "WHERE", "FROM", "JOIN", "USING",
    "AND", "OR", "NOT", "IS", "AS", "IN", "ANY", "ALL",
}

INSERT_RE = re.compile(
    r"\bINSERT\s+INTO\s+(\w+)\s*\(\s*([^)]+)\)",
    re.IGNORECASE | re.DOTALL,
)
UPDATE_RE = re.compile(
    r"\bUPDATE\s+(\w+)\s+SET\s+(.+?)(?:\bWHERE\b|\bRETURNING\b|`)",
    re.IGNORECASE | re.DOTALL,
)


def load_exemptions() -> dict:
    if not EXEMPT_REGISTRY.exists():
        return {"exempt_packages": []}
    return json.loads(EXEMPT_REGISTRY.read_text())


def extract_column_names(column_blob: str) -> list[str]:
    """From a comma-separated INSERT column list or UPDATE SET clause,
    pull bare identifier names. We strip whitespace, commas, '=' targets,
    placeholders ($1), and SQL noise tokens."""
    out: list[str] = []
    for chunk in re.split(r"[,\n]", column_blob):
        chunk = chunk.strip()
        if not chunk:
            continue
        # UPDATE SET: "col = $1" → take left of '='.
        if "=" in chunk:
            chunk = chunk.split("=", 1)[0].strip()
        # Drop quoting / backticks / parens.
        chunk = chunk.strip('"`()[]')
        # Skip placeholders, numerics, noise.
        if not chunk or chunk.startswith("$"):
            continue
        if chunk.upper() in SQL_NOISE:
            continue
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", chunk):
            continue
        out.append(chunk)
    return out


def scan_sql_file(path: pathlib.Path) -> list[tuple[str, str, str]]:
    """Return (table, column, kind) tuples for each violation in this file."""
    findings: list[tuple[str, str, str]] = []
    text = path.read_text()
    for m in INSERT_RE.finditer(text):
        table, cols_blob = m.group(1), m.group(2)
        if table not in RENAMED_TABLES:
            continue
        for col in extract_column_names(cols_blob):
            if not col.startswith(table + "_") and col != table + "_id":
                findings.append((table, col, "INSERT"))
    for m in UPDATE_RE.finditer(text):
        table, set_blob = m.group(1), m.group(2)
        if table not in RENAMED_TABLES:
            continue
        for col in extract_column_names(set_blob):
            if not col.startswith(table + "_") and col != table + "_id":
                findings.append((table, col, "UPDATE"))
    return findings


def main() -> int:
    exempt = set(load_exemptions().get("exempt_packages", []))
    by_pkg: dict[str, list[tuple[str, str, str, str]]] = defaultdict(list)
    total = 0
    for sql_file in SCAN_DIR.glob("*/sql.go"):
        pkg = sql_file.parent.name
        findings = scan_sql_file(sql_file)
        if not findings:
            continue
        rel = str(sql_file.relative_to(ROOT))
        for table, col, kind in findings:
            by_pkg[pkg].append((rel, table, col, kind))
            total += 1

    if not by_pkg:
        print("lint:column-prefix-convention OK — no violations.")
        return 0

    # Partition findings into "on the ledger" (warn — escape hatch
    # for legitimate regressions in flight) vs "NOT on ledger" (hard fail).
    on_ledger: list[str] = []
    off_ledger: list[str] = []

    for pkg in sorted(by_pkg):
        marker = "(on ledger)" if pkg in exempt else "(NOT on ledger)"
        rows = by_pkg[pkg]
        block = [f"  {pkg} — {len(rows)} finding(s) {marker}"]
        for rel, table, col, kind in rows[:3]:
            block.append(f"    • {rel}: {kind} {table} → bare column `{col}`")
        if len(rows) > 3:
            block.append(f"    … {len(rows) - 3} more")
        target = on_ledger if pkg in exempt else off_ledger
        target.extend(block)

    if off_ledger:
        print(f"lint:column-prefix-convention FAIL — {total} bare-column "
              f"reference(s) across {len(by_pkg)} package(s).\n")
        for line in off_ledger:
            print(line)
        if on_ledger:
            print("\nAlso on the warn-only ledger (not failing):")
            for line in on_ledger:
                print(line)
        print("\nFix: add the table-name prefix to every column on the")
        print("§2.6 root-family table that this SQL writes. See")
        print("docs/c_c_naming_conventions.md §2.3 for the rule.")
        print(f"Ledger: dev/registries/column_prefix_exempt.json")
        return 1

    # All findings are on the ledger — warn only.
    print(f"lint:column-prefix-convention WARN — {total} bare-column "
          f"reference(s) across {len(by_pkg)} package(s) (all on ledger).\n")
    for line in on_ledger:
        print(line)
    print("\nThese packages are exempt; remove from the ledger after the")
    print("column-rename migration for that domain ships.")
    print(f"Ledger: dev/registries/column_prefix_exempt.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
