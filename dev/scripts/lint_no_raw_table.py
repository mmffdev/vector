#!/usr/bin/env python3
"""Lint raw <table> usage outside the sanctioned <Table> primitive.

PLA-0015 / Story 00427b. After the sweep, every data table in app/ must
go through the single canonical `app/components/Table.tsx` primitive.
Bare `<table>` in JSX bypasses the addressable substrate, the toolbar
contract, the inline-edit `useDraft` integration, and the
`tree_accordion-dense__*` class catalog — so the rule blocks them.

A small allow-list lives at `dev/registries/raw_table_exempt.json`:

  - **tree exceptions** — work-items tree views compose from raw <table>
    deliberately (the row-fragment per-leaf model doesn't fit columns +
    rows shape).
  - **provisional exceptions** — call sites that need a feature the v1
    `<Table>` API doesn't yet provide (section-header rows, dense
    multi-cell grids inside flyouts). Each provisional entry should be
    paired with a follow-up story that either extends the API or
    refactors the consumer.

Component implementation files (Table.tsx itself) are skipped
automatically — the regex matches `<table` JSX literals only when the
file is NOT the implementation.

Exit 0 = clean. Exit 1 = at least one non-exempt raw `<table>`.
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "raw_table_exempt.json"
SCAN_DIRS = ["app"]
SELF_FILES = {"app/components/Table.tsx"}

OPEN_RE = re.compile(r"<table\b")


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(p) for p in data.get("exempt_paths", [])}


def scan() -> list[tuple[pathlib.Path, int, str]]:
    hits: list[tuple[pathlib.Path, int, str]] = []
    for sub in SCAN_DIRS:
        base = ROOT / sub
        if not base.exists():
            continue
        for path in base.rglob("*.tsx"):
            if "node_modules" in path.parts or ".next" in path.parts:
                continue
            rel = str(path.relative_to(ROOT))
            if rel in SELF_FILES:
                continue
            try:
                text = path.read_text(errors="ignore")
            except OSError:
                continue
            for m in OPEN_RE.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                line_start = text.rfind("\n", 0, m.start()) + 1
                line_end = text.find("\n", m.start())
                if line_end < 0:
                    line_end = len(text)
                snippet = text[line_start:line_end].strip()
                if len(snippet) > 120:
                    snippet = snippet[:117] + "..."
                hits.append((path, line_no, snippet))
    return hits


def write_report(hits, exempt) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-no-raw-table"

    checks = []
    for p, ln, sig in hits:
        rel = str(p.relative_to(ROOT))
        if rel in exempt:
            checks.append({
                "status": "warn",
                "label": f"{rel}:{ln}",
                "detail": f"exempt — {sig}",
            })
        else:
            checks.append({
                "status": "fail",
                "label": f"{rel}:{ln}",
                "detail": f"raw <table> — use <Table> from @/app/components/Table — {sig}",
            })

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:no-raw-table",
            "detail": f"no raw <table> usages found across {len(SCAN_DIRS)} scan dir(s)",
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
        "scopeName": "no-raw-table",
        "flag": "lint:no-raw-table",
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

    failing = [(p, ln, sig) for (p, ln, sig) in hits if str(p.relative_to(ROOT)) not in exempt]

    if not failing:
        print(f"[lint:no-raw-table] OK — {len(hits)} match(es), all exempt ({len(exempt)} exempt path(s)).")
        return 0

    print(f"[lint:no-raw-table] FAIL — {len(failing)} raw <table> usage(s) outside the allow-list:")
    for path, lineno, sig in failing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}:{lineno}: use <Table> from @/app/components/Table — {sig}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
