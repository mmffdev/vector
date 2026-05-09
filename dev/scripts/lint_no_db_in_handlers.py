#!/usr/bin/env python3
"""Lint no-db-in-handlers: structural rule for PLA-0039 / Story 00524.

Rule: backend handler files (`backend/internal/**/handler*.go`,
`*_handler.go`) MUST NOT touch the database directly. The architectural
target after PLA-0039 is:

    handler  →  parses request, checks auth, calls svc.Method(), renders
    service  →  owns SQL strings + DB connections + business invariants

Detected DB-touch markers (any of these in a handler file is a fail):
  • `*sql.DB` parameter or struct field
  • `pgxpool.*`
  • `database/sql` import
  • `db.QueryRow(`, `db.Exec(`, `db.Query(` (cheap heuristic)

Files currently in violation are listed in
`dev/registries/no_db_in_handlers_exempt.json` and warn rather than fail.
Each PLA-0039 service-extraction story (00525–00530) removes its handler
from this ledger as the SQL is moved into a `service.go`. End state is an
empty `exempt_paths` array → invariant.

Exit 0 = clean. Exit 1 = a handler outside the ledger touches DB.
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "no_db_in_handlers_exempt.json"
SCAN_DIR = ROOT / "backend" / "internal"

# Match handler files only — anything matching `*handler*.go` under
# `backend/internal/**`. Exclude tests.
HANDLER_NAME_RE = re.compile(r"handler.*\.go$|.*_handler\.go$")

# DB-touch markers — any one of these in a handler is a fail (or warn if
# the file is on the exempt list).
DB_MARKERS = [
    re.compile(r'"database/sql"'),
    re.compile(r"\*sql\.DB\b"),
    re.compile(r"\bpgxpool\."),
    re.compile(r"\bdb\.(QueryRow|Query|Exec|QueryContext|ExecContext|QueryRowContext)\("),
]


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(p) for p in data.get("exempt_paths", [])}


def find_markers(text: str) -> list[str]:
    found: list[str] = []
    for rx in DB_MARKERS:
        if rx.search(text):
            found.append(rx.pattern)
    return found


def scan() -> list[tuple[pathlib.Path, list[str]]]:
    hits: list[tuple[pathlib.Path, list[str]]] = []
    if not SCAN_DIR.exists():
        return hits
    for path in SCAN_DIR.rglob("*.go"):
        if path.name.endswith("_test.go"):
            continue
        if not HANDLER_NAME_RE.search(path.name):
            continue
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        markers = find_markers(text)
        if markers:
            hits.append((path, markers))
    return hits


def write_report(hits, exempt) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-no-db-in-handlers"

    checks = []
    for p, markers in hits:
        rel = str(p.relative_to(ROOT))
        detail = f"DB markers: {', '.join(markers)}"
        if rel in exempt:
            checks.append({"status": "warn", "label": rel, "detail": f"exempt — {detail}"})
        else:
            checks.append({
                "status": "fail",
                "label": rel,
                "detail": f"handler touches DB — extract a Service — {detail}",
            })

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:no-db-in-handlers",
            "detail": "no handlers touching DB directly",
        })

    summary = {
        "pass": sum(1 for c in checks if c["status"] == "pass"),
        "warn": sum(1 for c in checks if c["status"] == "warn"),
        "fail": sum(1 for c in checks if c["status"] == "fail"),
        "fixed": 0,
    }

    report = {
        "id": ts_id,
        "scope": "H",
        "scopeName": "no-db-in-handlers",
        "flag": "lint:no-db-in-handlers",
        "timestamp": now.replace(microsecond=0).isoformat(),
        "checks": checks,
        "summary": summary,
    }

    out = reports_dir / f"{ts_id}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")


def main() -> int:
    exempt = load_exemptions()
    hits = scan()

    if "--report" in sys.argv[1:]:
        write_report(hits, exempt)

    failing = [(p, m) for (p, m) in hits if str(p.relative_to(ROOT)) not in exempt]

    if not failing:
        print(
            f"[lint:no-db-in-handlers] OK — {len(hits)} handler(s) touch DB, "
            f"all on exempt ledger ({len(exempt)} ledger entries)."
        )
        return 0

    print(
        f"[lint:no-db-in-handlers] FAIL — {len(failing)} handler(s) outside ledger "
        f"touching DB:"
    )
    for path, markers in failing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}: extract a Service — {', '.join(markers)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
