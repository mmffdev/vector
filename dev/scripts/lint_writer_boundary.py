#!/usr/bin/env python3
"""Lint writer-boundary: PLA-0007 / Story 00305.

Rule: writes to the RBAC tables (`roles`, `permissions`,
`role_permissions`) MUST go through the sole-writer service at
`backend/internal/roles/`. This mirrors the existing addressables
contract — writes to `page_addressables` are restricted to
`backend/internal/addressables/`.

The detector scans every Go file under `backend/` for INSERT / UPDATE /
DELETE statements naming any of the writer-boundary tables, and flags
hits that do NOT live inside the allowed package directories. Migration
SQL (`db/schema/*.sql`) is exempt — migrations are the privileged
bootstrap path.

Allowed packages by table (extend as new sole-writer services land):

    roles, permissions, role_permissions   →  backend/internal/roles/
    page_addressables                       →  backend/internal/addressables/
    workspaces, workspace_roles             →  backend/internal/workspaces/
    master_record_portfolio                 →  backend/internal/portfolio/

Test files (`*_test.go`) are exempt — tests legitimately seed/clean
fixtures.

Exit 0 = clean. Exit 1 = one or more rogue writes detected. Output is
line-oriented for the Reports panel (renders as "writer-boundary" row).
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "writer_boundary_exempt.json"

# table_name -> allowed package directory (relative to repo root)
WRITER_BOUNDARY: dict[str, str] = {
    "roles":                   "backend/internal/roles",
    "permissions":             "backend/internal/roles",
    "role_permissions":        "backend/internal/roles",
    "page_addressables":       "backend/internal/addressables",
    "workspaces":              "backend/internal/workspaces",
    "workspace_roles":         "backend/internal/workspaces",
    "master_record_portfolio": "backend/internal/portfolio",
}

# Match `INSERT INTO <table>`, `UPDATE <table>`, `DELETE FROM <table>` —
# only at word boundaries so `roles_xyz` doesn't trigger on `roles`.
def _re_for(table: str) -> re.Pattern[str]:
    return re.compile(
        rf"""\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+{re.escape(table)}\b""",
        re.IGNORECASE,
    )


PATTERNS = {table: _re_for(table) for table in WRITER_BOUNDARY}


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(p) for p in data.get("exempt_paths", [])}


def is_allowed(rel_path: str, allowed_dir: str) -> bool:
    """True if rel_path is inside the allowed package directory."""
    norm = rel_path.replace("\\", "/")
    return norm.startswith(allowed_dir.rstrip("/") + "/") or norm == allowed_dir


def scan() -> list[tuple[pathlib.Path, int, str, str, str]]:
    """Return list of (path, line, table, allowed_dir, snippet)."""
    hits: list[tuple[pathlib.Path, int, str, str, str]] = []
    backend = ROOT / "backend"
    if not backend.exists():
        return hits
    for path in backend.rglob("*.go"):
        if "vendor" in path.parts or "node_modules" in path.parts:
            continue
        # tests are exempt — they seed fixtures legitimately
        if path.name.endswith("_test.go"):
            continue
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        rel = str(path.relative_to(ROOT))
        for table, allowed_dir in WRITER_BOUNDARY.items():
            if is_allowed(rel, allowed_dir):
                continue
            pat = PATTERNS[table]
            for line_no, line in enumerate(text.splitlines(), start=1):
                m = pat.search(line)
                if not m:
                    continue
                snippet = line.strip()[:80]
                hits.append((path, line_no, table, allowed_dir, snippet))
    return hits


def write_report(hits, exempt) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-writer-boundary"

    checks = []
    for p, ln, table, allowed_dir, snippet in hits:
        rel = str(p.relative_to(ROOT))
        if rel in exempt:
            checks.append({
                "status": "warn",
                "label": f"{rel}:{ln}",
                "detail": f"exempt — {table} write — {snippet}",
            })
        else:
            checks.append({
                "status": "fail",
                "label": f"{rel}:{ln}",
                "detail": f"{table} write outside {allowed_dir}/ — route through sole-writer service — {snippet}",
            })

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:writer-boundary",
            "detail": f"no rogue writes across {len(WRITER_BOUNDARY)} guarded table(s)",
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
        "scopeName": "writer-boundary",
        "flag": "lint:writer-boundary",
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

    failing = [
        (p, ln, table, allowed_dir, snippet)
        for (p, ln, table, allowed_dir, snippet) in hits
        if str(p.relative_to(ROOT)) not in exempt
    ]

    if not failing:
        print(
            f"[lint:writer-boundary] OK — {len(hits)} match(es), all exempt "
            f"({len(exempt)} exempt path(s)); {len(WRITER_BOUNDARY)} guarded table(s)."
        )
        return 0

    print(f"[lint:writer-boundary] FAIL — {len(failing)} rogue write(s) found:")
    for path, lineno, table, allowed_dir, snippet in failing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}:{lineno}: {table} write must go through {allowed_dir}/ — {snippet}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
