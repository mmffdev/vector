#!/usr/bin/env python3
"""Lint spec routes that have zero frontend callers (route orphans).

Drift detector. The contract gate (`check_routes.sh`) already proves
"every Go route is documented", and `check_callers.py` proves "every
frontend call hits a documented path". This lint closes the third
side of the triangle: **every documented route has at least one
frontend caller** (or is explicitly marked as backend-only).

The signal:
  - Route in spec + caller exists       → OK (caller-map.json)
  - Route in spec + zero callers        → orphan; flag below
  - Caller exists + no spec entry       → check_callers.py errors

By default this is a WARN-style lint (exit 0, prints the count) so
it doesn't block PRs — many legitimate routes have no frontend caller
(admin tools, dev resets, cron-only endpoints, server-to-server
infra). Add `--strict` to fail on any orphan that isn't in the
allowlist; useful as a periodic audit.

Allowlist: `dev/registries/route_orphan_exempt.json`. Each entry:
  { "path": "/admin/dev/master-reset", "reason": "dev-tool only, no UI" }

Usage:
  python3 dev/scripts/lint_route_orphans.py          # report only
  python3 dev/scripts/lint_route_orphans.py --strict # fail on non-exempt orphans
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
CHECK_CALLERS = ROOT / "dev" / "scripts" / "check_callers.py"
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "route_orphan_exempt.json"
DEAD_APIS = ROOT / "api-snapshots" / "dead-apis.txt"

SPECS = [
    ("siteAPI", "siteAPI.yaml", "/_site"),
    ("samanthaAPI", "samanthaAPI.yaml", "/samantha/v2"),
]


def load_exemptions() -> dict[str, str]:
    if not EXEMPT_REGISTRY.exists():
        return {}
    raw = json.loads(EXEMPT_REGISTRY.read_text())
    return {e["path"]: e.get("reason", "(no reason given)") for e in raw.get("exemptions", [])}


def collect_dead_for(spec_arg: str | None) -> list[str]:
    """Run check_callers.py for one spec; return the lines of the
    dead-apis.txt it wrote (clobbered each run)."""
    cmd = ["python3", str(CHECK_CALLERS)]
    if spec_arg is not None:
        cmd.extend(["--spec", spec_arg])
    try:
        subprocess.run(cmd, check=True, capture_output=True, cwd=ROOT, text=True)
    except subprocess.CalledProcessError as e:
        print(f"WARN: check_callers.py exited {e.returncode}:", file=sys.stderr)
        print(e.stderr, file=sys.stderr)
        return []
    if not DEAD_APIS.exists():
        return []
    return [l.strip() for l in DEAD_APIS.read_text().splitlines() if l.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true",
                        help="exit 1 on any non-exempt orphan")
    args = parser.parse_args()

    exempt = load_exemptions()

    per_spec: dict[str, list[str]] = {}
    per_spec["siteAPI"] = collect_dead_for(None)        # default = v1 / siteAPI
    per_spec["samanthaAPI"] = collect_dead_for("samanthaAPI.yaml")

    # Aggregate. Each path is reported under its source spec.
    total = 0
    total_unexplained = 0
    total_exempt = 0
    print("[lint:route-orphans] spec routes with no frontend caller")
    for label, orphans in per_spec.items():
        if not orphans:
            print(f"  {label}: 0")
            continue
        real = [p for p in orphans if p not in exempt]
        ex = [p for p in orphans if p in exempt]
        total += len(orphans)
        total_unexplained += len(real)
        total_exempt += len(ex)
        print(f"  {label}: {len(orphans)} orphan(s) — {len(ex)} exempt, {len(real)} unexplained")
        for p in real[:15]:
            print(f"      {p}")
        if len(real) > 15:
            print(f"      ... +{len(real) - 15} more")

    print()
    print(f"  total orphans:    {total}")
    print(f"  total exempt:     {total_exempt}")
    print(f"  total unexplained: {total_unexplained}")

    if args.strict and total_unexplained:
        print()
        print(f"FAIL: {total_unexplained} orphan(s) outside dev/registries/route_orphan_exempt.json")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
