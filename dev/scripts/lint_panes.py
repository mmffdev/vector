#!/usr/bin/env python3
"""Lint paneIds: every <PaneHeader paneId="..."> in source must appear in dev/registries/paneIds.json.

Exit 0 = clean. Exit 1 = one or more usages reference an unregistered paneId.
Output is line-oriented so the Reports panel can render it as a row labelled "paneIds".
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "dev" / "registries" / "paneIds.json"
SCAN_DIRS = ["app", "dev/store", "dev/pages", "dev/components"]
PANEID_RE = re.compile(
    r'<PaneHeader\b[^>]*?\bpaneId\s*=\s*[\"\']([^\"\']+)[\"\']',
    re.DOTALL,
)


def load_registry() -> set[str]:
    data = json.loads(REGISTRY.read_text())
    return {p["paneId"] for p in data["panes"]}


def scan() -> list[tuple[pathlib.Path, int, str]]:
    hits: list[tuple[pathlib.Path, int, str]] = []
    for sub in SCAN_DIRS:
        base = ROOT / sub
        if not base.exists():
            continue
        for path in base.rglob("*.tsx"):
            if "node_modules" in path.parts or ".next" in path.parts:
                continue
            text = path.read_text(errors="ignore")
            for m in PANEID_RE.finditer(text):
                lineno = text.count("\n", 0, m.start()) + 1
                hits.append((path, lineno, m.group(1)))
    return hits


def write_report(hits, registered) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-paneIds"

    checks = []
    by_pane: dict[str, list[tuple[pathlib.Path, int]]] = {}
    for p, ln, pid in hits:
        by_pane.setdefault(pid, []).append((p, ln))

    for pid in sorted(by_pane.keys()):
        usages = by_pane[pid]
        loc = ", ".join(f"{p.relative_to(ROOT)}:{ln}" for p, ln in usages)
        if pid in registered:
            checks.append({
                "status": "pass",
                "label": pid,
                "detail": f"{len(usages)} usage(s) — {loc}",
            })
        else:
            checks.append({
                "status": "fail",
                "label": pid,
                "detail": f"unregistered — {loc}",
            })

    for pid in sorted(registered - set(by_pane.keys())):
        checks.append({
            "status": "warn",
            "label": pid,
            "detail": "registered but not used in any source file",
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
        "scopeName": "paneIds",
        "flag": "lint:panes",
        "timestamp": now.replace(microsecond=0).isoformat(),
        "checks": checks,
        "summary": summary,
    }

    out = reports_dir / f"{ts_id}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")


def main() -> int:
    registered = load_registry()
    hits = scan()
    missing = [(p, ln, pid) for (p, ln, pid) in hits if pid not in registered]

    if "--report" in sys.argv[1:]:
        write_report(hits, registered)

    if not missing:
        print(f"[lint:panes] OK — {len(hits)} usages, all registered ({len(registered)} entries).")
        return 0

    print(f"[lint:panes] FAIL — {len(missing)} unregistered paneId usage(s):")
    for path, lineno, pid in missing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}:{lineno}: paneId={pid!r} not in dev/registries/paneIds.json")
    return 1


if __name__ == "__main__":
    sys.exit(main())
