#!/usr/bin/env python3
"""check_callers.py — Layer 1: frontend api() callers vs openapi.yaml.

Rules:
  - api(...)      caller path not in spec  → exit 1 (hard fail)
  - apiInfra(...) paths                    → tracked, but skipped from hard-fail
  - apiV2(...)    paths                    → tracked, but skipped from hard-fail
                                             (the v1 spec does not cover v2)
  - Spec path has no api() caller          → warn + dead-apis.txt

Side effects (always written, even on failure):
  - api-snapshots/caller-map.json   — { "/path": ["file:line", ...] } (api() only)
  - api-snapshots/dead-apis.txt     — spec paths with zero api() callers and not exempted
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_DIR = ROOT / "app"
SPEC = ROOT / "openapi.yaml"
SNAPSHOTS_DIR = ROOT / "api-snapshots"
EXEMPTIONS_FILE = ROOT / "dev" / "registries" / "dead-api-exemptions.txt"
CALLER_MAP_FILE = SNAPSHOTS_DIR / "caller-map.json"
DEAD_APIS_FILE = SNAPSHOTS_DIR / "dead-apis.txt"

# Regex: api("/path") or api('/path') — captures literal path strings only.
# `(?:<[^>]*>)?` allows the optional TS generic, e.g. `api<Foo>("/x")`.
# Strips any query/fragment after the path.
API_RE = re.compile(r'\bapi(?:<[^>]*>)?\s*\(\s*["\']([^"\'?#`]+)')
INFRA_RE = re.compile(r'\bapiInfra(?:<[^>]*>)?\s*\(\s*["\']([^"\'?#`]+)')
V2_RE = re.compile(r'\bapiV2(?:<[^>]*>)?\s*\(\s*["\']([^"\'?#`]+)')

# Excluded directories under app/. "api" excludes app/api/{dev,v2}/ (Next.js
# route handlers, not backend callers).
EXCLUDE_DIRS = {"node_modules", ".next", "api"}


def load_spec_paths() -> set[str]:
    paths: set[str] = set()
    for line in SPEC.read_text(encoding="utf-8").splitlines():
        if re.match(r"^  /", line):
            paths.add(line.strip().rstrip(":"))
    return paths


def load_exemptions() -> set[str]:
    if not EXEMPTIONS_FILE.exists():
        return set()
    lines = EXEMPTIONS_FILE.read_text(encoding="utf-8").splitlines()
    return {l.strip() for l in lines if l.strip() and not l.startswith("#")}


def scan_callers() -> tuple[
    dict[str, list[str]],
    dict[str, list[str]],
    dict[str, list[str]],
]:
    """Returns (api_callers, infra_callers, v2_callers) — each maps path → [file:line, ...]."""
    api_callers: dict[str, list[str]] = {}
    infra_callers: dict[str, list[str]] = {}
    v2_callers: dict[str, list[str]] = {}

    for ext in ("*.ts", "*.tsx"):
        for f in APP_DIR.rglob(ext):
            if any(part in EXCLUDE_DIRS for part in f.parts):
                continue
            _scan_file(f, api_callers, infra_callers, v2_callers)

    return api_callers, infra_callers, v2_callers


def _normalise(p: str) -> str:
    """Strip trailing slash unless the path is just '/'. Mirrors check_routes.sh
    so callers and routes compare on the same canonical form."""
    if len(p) > 1 and p.endswith("/"):
        return p[:-1]
    return p


def _scan_file(
    path: pathlib.Path,
    api_callers: dict[str, list[str]],
    infra_callers: dict[str, list[str]],
    v2_callers: dict[str, list[str]],
) -> None:
    rel = str(path.relative_to(ROOT))
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    for i, line in enumerate(text.splitlines(), 1):
        for m in API_RE.finditer(line):
            api_callers.setdefault(_normalise(m.group(1)), []).append(f"{rel}:{i}")
        for m in INFRA_RE.finditer(line):
            infra_callers.setdefault(_normalise(m.group(1)), []).append(f"{rel}:{i}")
        for m in V2_RE.finditer(line):
            v2_callers.setdefault(_normalise(m.group(1)), []).append(f"{rel}:{i}")


def main() -> int:
    spec_paths = load_spec_paths()
    exemptions = load_exemptions()
    api_callers, infra_callers, v2_callers = scan_callers()

    errors: list[str] = []

    # Hard fail: api() caller path not in spec
    for path, refs in sorted(api_callers.items()):
        if path not in spec_paths:
            errors.append(f"  ERROR: '{path}' called at {refs[0]} has no spec entry")

    # Build caller map (api callers only — infra and v2 excluded from hard-fail map)
    caller_map: dict[str, list[str]] = {}
    for path in spec_paths:
        if path in api_callers:
            caller_map[path] = api_callers[path]

    # Dead APIs: spec paths with no api() caller and not exempted
    dead = [p for p in sorted(spec_paths) if p not in api_callers and p not in exemptions]

    SNAPSHOTS_DIR.mkdir(exist_ok=True)
    CALLER_MAP_FILE.write_text(json.dumps(caller_map, indent=2) + "\n", encoding="utf-8")
    DEAD_APIS_FILE.write_text("\n".join(dead) + ("\n" if dead else ""), encoding="utf-8")

    print("=== check_callers: frontend api() callers vs openapi.yaml ===")
    if errors:
        for e in errors:
            print(e, file=sys.stderr)
        print(f"FAIL: {len(errors)} caller(s) reference undocumented endpoints", file=sys.stderr)
    print(f"  caller-map.json: {len(caller_map)} mapped endpoints")
    print(f"  dead-apis.txt:   {len(dead)} uncalled spec path(s)")
    if infra_callers:
        print(f"  apiInfra paths:  {len(infra_callers)} (skipped from hard-fail)")
    if v2_callers:
        print(f"  apiV2 paths:     {len(v2_callers)} (skipped from hard-fail; v2 not in spec)")
    print(f"--- Result: {len(errors)} error(s)")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
