#!/usr/bin/env python3
"""Lint custom-field-prefix: Rule 2 (2026-05-29 — Rick).

Every CUSTOM field row in `artefacts_fields_library` must have its
`artefacts_fields_library_field_name` value prefixed `c_artefacts_`
followed by lower_snake_case identifier characters. This script is
the schema-time / catalogue-state gate that complements:

  • Handler-side validator at `backend/internal/fields/handler.go`
    (createFieldIn → 400 on bad prefix) — the API caller gate.
  • Postgres CHECK constraint
    `artefacts_fields_library_field_name_c_prefix_check`
    (mig 160 — db/vector_artefacts/schema/160_custom_fields_c_prefix_rule2.sql)
    — the final SQL gate (defence-in-depth).

This lint queries the live dev DB via tunnel `localhost:5435`, so it
catches drift caused by direct psql writes or rogue migrations even
when the CHECK constraint somehow gets dropped.

Generalisation note (Rick decision 3, 2026-05-29): every CUSTOM field
row in a per-table fields catalogue must have its name prefixed
`c_<tablename>_`. Today only `artefacts_fields_library` exists, so
this rule checks that one table. If more catalogue tables ever appear
(e.g. `workspaces_fields_library`), generalise this script to walk
every `*_fields_library` table and apply the rule per table —
`c_<stripped_suffix>_<column>` where the stripped suffix removes
`_fields_library` from the table name. See
dev/research/column_prefix_compliance_audit.md §F-4 for the
generalisation path.

Exit code:
  0 — clean (every row in artefacts_fields_library matches the regex).
  1 — at least one row violates.
  2 — connection / config error (treated as soft-fail; lint runner
       should not pass when this fires).

Configuration:
  Reads DB creds from `backend/.env.dev`. Variables expected:
    DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.
"""
from __future__ import annotations

import os
import pathlib
import re
import sys

# psycopg2/psycopg3 may not be installed everywhere; prefer the
# already-present psycopg fallback chain. If neither is available we
# fall back to shelling out to psql (libpq is required either way).
try:
    import psycopg2  # type: ignore
    _PSYCOPG = "psycopg2"
except ImportError:
    try:
        import psycopg  # type: ignore
        _PSYCOPG = "psycopg"
    except ImportError:
        _PSYCOPG = None

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / "backend" / ".env.dev"

# Today's catalogue table. Generalise per the §F-4 note above if a
# second `*_fields_library` table ever appears.
CATALOGUE_TABLE = "artefacts_fields_library"
NAME_COLUMN = "artefacts_fields_library_field_name"
PREFIX = "c_artefacts_"
RULE_REGEX = re.compile(r"^c_artefacts_[a-z][a-z0-9_]*$")


def load_env(path: pathlib.Path) -> dict[str, str]:
    """Parse a flat `KEY=VALUE` file. Lines starting with `#` are skipped.
    Values are returned verbatim — no quoting unwrap (env file is plain)."""
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def fetch_names_via_psql(host: str, port: str, user: str, password: str, db: str) -> list[str]:
    """Fallback path when psycopg is unavailable. Shells out to psql.

    Returns the list of artefacts_fields_library_field_name values, one per
    row, in arbitrary order. Raises on non-zero exit.
    """
    import subprocess
    psql = "/opt/homebrew/Cellar/libpq/18.3/bin/psql"
    if not pathlib.Path(psql).exists():
        # Try the symlinked path used elsewhere.
        psql = "/opt/homebrew/opt/libpq/bin/psql"
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    result = subprocess.run(
        [
            psql, "-h", host, "-p", port, "-U", user, "-d", db,
            "-At", "-c",
            f"SELECT {NAME_COLUMN} FROM {CATALOGUE_TABLE};",
        ],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print(f"lint:custom-field-prefix CONFIG-ERROR — psql failed: {result.stderr.strip()}",
              file=sys.stderr)
        sys.exit(2)
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def fetch_names_via_psycopg(host: str, port: str, user: str, password: str, db: str) -> list[str]:
    """Preferred path — connect via libpq directly."""
    if _PSYCOPG == "psycopg2":
        import psycopg2  # type: ignore
        conn = psycopg2.connect(
            host=host, port=int(port), user=user, password=password, dbname=db,
        )
    else:
        import psycopg  # type: ignore
        conn = psycopg.connect(
            host=host, port=int(port), user=user, password=password, dbname=db,
        )
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT {NAME_COLUMN} FROM {CATALOGUE_TABLE};")
            rows = cur.fetchall()
        return [r[0] for r in rows if r and r[0]]
    finally:
        conn.close()


def main() -> int:
    env = load_env(ENV_FILE)
    required = ("DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD")
    missing = [k for k in required if not env.get(k)]
    if missing:
        print(f"lint:custom-field-prefix CONFIG-ERROR — missing env keys in "
              f"{ENV_FILE.relative_to(ROOT)}: {', '.join(missing)}",
              file=sys.stderr)
        return 2

    host, port = env["DB_HOST"], env["DB_PORT"]
    user, password, db = env["DB_USER"], env["DB_PASSWORD"], env["DB_NAME"]

    try:
        if _PSYCOPG is not None:
            names = fetch_names_via_psycopg(host, port, user, password, db)
        else:
            names = fetch_names_via_psql(host, port, user, password, db)
    except Exception as exc:  # noqa: BLE001
        print(f"lint:custom-field-prefix CONFIG-ERROR — DB connection: {exc}",
              file=sys.stderr)
        return 2

    violations = [n for n in names if not RULE_REGEX.match(n)]
    total = len(names)

    if not violations:
        print(f"lint:custom-field-prefix OK — {total} row(s) in "
              f"{CATALOGUE_TABLE}; all comply with Rule 2 "
              f"(^{PREFIX}[a-z][a-z0-9_]*$).")
        return 0

    print(f"lint:custom-field-prefix FAIL — {len(violations)} of {total} row(s) "
          f"in {CATALOGUE_TABLE} violate Rule 2.\n")
    for n in violations[:20]:
        suggested = f"{PREFIX}{n}" if not n.startswith(PREFIX) else n
        print(f"  • {n!r} — suggested: {suggested!r}")
    if len(violations) > 20:
        print(f"  … {len(violations) - 20} more")
    print(
        "\nFix: every row in artefacts_fields_library must have its "
        "field_name match `^c_artefacts_[a-z][a-z0-9_]*$`. The handler "
        "validator (backend/internal/fields/handler.go) blocks new "
        "violations at the API; the Postgres CHECK constraint "
        "`artefacts_fields_library_field_name_c_prefix_check` (mig 160) "
        "blocks them at the DB. If this lint fires, something bypassed "
        "both — investigate the path that wrote the row.\n"
        "Rule reference: dev/research/column_prefix_compliance_audit.md §C-F."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
