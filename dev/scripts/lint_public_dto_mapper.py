#!/usr/bin/env python3
"""lint:public-dto-mapper — PLA-0039 / Story 00532.

Rule: handler files under public-transport packages (mounted at /samantha/v2)
MUST NOT import internal/models and serialize those types directly. Instead,
they must use a MapPublic* function to project an internal struct into a
public DTO (e.g. dto.WorkItemPublic, dto.UserPublic).

Detection heuristic:
  A handler file is considered "violating" if it:
    1. Imports "internal/models"   AND
    2. Does NOT contain the string "MapPublic" anywhere in the file.

Public-transport packages are listed in dev/registries/public_transport_packages.json.
The handler-file pattern mirrors lint:no-db-in-handlers: handler*.go / *_handler.go.
Test files (_test.go) are excluded.

Violations against the exemption ledger
(dev/registries/public_dto_mapper_exempt.json) produce warnings; violations
outside it produce failures (exit 1).

End state: empty exempt_paths → invariant.
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY    = ROOT / "dev" / "registries" / "public_dto_mapper_exempt.json"
PACKAGES_REGISTRY  = ROOT / "dev" / "registries" / "public_transport_packages.json"
SCAN_DIR           = ROOT / "backend" / "internal"

HANDLER_NAME_RE = re.compile(r"handler.*\.go$|.*_handler\.go$")
MODELS_IMPORT_RE = re.compile(r'"github\.com/mmffdev/vector-backend/internal/models"')
MAP_PUBLIC_RE    = re.compile(r'\bMapPublic\b')


def load_json(path: pathlib.Path, key: str) -> set[str]:
    if not path.exists():
        return set()
    data = json.loads(path.read_text())
    return {str(p) for p in data.get(key, [])}


def scan(public_pkgs: set[str]) -> list[tuple[pathlib.Path, str]]:
    """Return list of (handler_path, reason) that violate the rule."""
    hits: list[tuple[pathlib.Path, str]] = []
    if not SCAN_DIR.exists():
        return hits
    for path in SCAN_DIR.rglob("*.go"):
        if path.name.endswith("_test.go"):
            continue
        if not HANDLER_NAME_RE.search(path.name):
            continue
        # Only care about public-transport packages.
        pkg = str(path.parent.relative_to(SCAN_DIR))
        if pkg not in public_pkgs:
            continue
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        if MODELS_IMPORT_RE.search(text) and not MAP_PUBLIC_RE.search(text):
            hits.append((path, "imports internal/models without MapPublic* projection"))
    return hits


def write_report(hits, exempt) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-public-dto-mapper"

    checks = []
    for p, reason in hits:
        rel = str(p.relative_to(ROOT))
        if rel in exempt:
            checks.append({"status": "warn", "label": rel, "detail": f"exempt — {reason}"})
        else:
            checks.append({"status": "fail", "label": rel, "detail": reason})

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:public-dto-mapper",
            "detail": "all public-transport handlers use MapPublic* projections",
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
        "scopeName": "public-dto-mapper",
        "flag": "lint:public-dto-mapper",
        "timestamp": now.replace(microsecond=0).isoformat(),
        "checks": checks,
        "summary": summary,
    }
    out = reports_dir / f"{ts_id}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")


def main() -> int:
    public_pkgs = load_json(PACKAGES_REGISTRY, "public_transport_packages")
    exempt      = load_json(EXEMPT_REGISTRY,   "exempt_paths")
    hits = scan(public_pkgs)

    if "--report" in sys.argv[1:]:
        write_report(hits, exempt)

    failing = [(p, r) for (p, r) in hits if str(p.relative_to(ROOT)) not in exempt]

    if not failing:
        print(
            f"[lint:public-dto-mapper] OK — {len(hits)} handler(s) flagged, "
            f"all on exempt ledger ({len(exempt)} ledger entries)."
        )
        return 0

    print(f"[lint:public-dto-mapper] FAIL — {len(failing)} handler(s) serialize internal models without MapPublic:")
    for path, reason in failing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}: {reason}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
