#!/usr/bin/env python3
"""Lint cross-db-writer-test: PLA-0048 / RF1.5.6.

Rule: any Go package under `backend/internal/<pkg>/` whose
`service.go` (or any non-test file) declares more than one
`*pgxpool.Pool` struct field MUST have a sibling `*crossdb_test.go`
or `cross_db_*_test.go` file. The cross-DB test documents the
partial-failure boundary (Tx A commits, Tx B rolls back, or vice
versa) that the writer cannot atomically prevent.

Detection:
  • Scan every `backend/internal/<pkg>/*.go` (excluding tests).
  • Count fields whose type is `*pgxpool.Pool`. >1 means cross-DB.
  • If cross-DB, require at least one of:
      - <pkg>/*crossdb*_test.go
      - <pkg>/*cross_db*_test.go

Files currently in violation are listed in
`dev/registries/cross_db_writer_test_exempt.json` and warn rather
than fail. Each RF1.5.x story removes its package from the ledger
as the test is written. End state is an empty `exempt_paths`
array → invariant.

Exit 0 = clean. Exit 1 = a cross-DB package outside the ledger
has no crossdb test file.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "cross_db_writer_test_exempt.json"
SCAN_DIR = ROOT / "backend" / "internal"

# Match `<name> *pgxpool.Pool` lines inside struct declarations. Cheap
# heuristic — we don't parse Go; we just count distinct field-name
# lines per package directory.
POOL_FIELD_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s+\*pgxpool\.Pool\b", re.MULTILINE)

# Cross-DB test file globs.
CROSSDB_TEST_GLOBS = ["*crossdb*_test.go", "*cross_db*_test.go"]


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {p.rstrip("/") for p in data.get("exempt_paths", [])}


def package_dirs() -> list[pathlib.Path]:
    return sorted([p for p in SCAN_DIR.iterdir() if p.is_dir()])


def count_distinct_pool_fields(pkg_dir: pathlib.Path) -> int:
    """Sum of distinct *pgxpool.Pool field names in all non-test .go
    files in the package. We count distinct names rather than raw
    matches so a struct re-declared across files doesn't double-count."""
    seen: set[str] = set()
    for go_file in pkg_dir.glob("*.go"):
        if go_file.name.endswith("_test.go"):
            continue
        for m in POOL_FIELD_RE.finditer(go_file.read_text()):
            seen.add(m.group(1))
    return len(seen)


def has_crossdb_test(pkg_dir: pathlib.Path) -> bool:
    for glob in CROSSDB_TEST_GLOBS:
        if any(pkg_dir.glob(glob)):
            return True
    return False


def main() -> int:
    exempt = load_exemptions()
    violations: list[str] = []

    for pkg_dir in package_dirs():
        rel = str(pkg_dir.relative_to(ROOT))
        n_pools = count_distinct_pool_fields(pkg_dir)
        if n_pools < 2:
            continue
        if has_crossdb_test(pkg_dir):
            continue
        if rel in exempt:
            print(f"[warn] {rel}: {n_pools} pool fields, no crossdb test (on ledger)")
            continue
        violations.append(f"{rel}: {n_pools} pool fields, no crossdb test")

    if violations:
        print("lint:cross-db-writer-test FAIL")
        for v in violations:
            print(f"  • {v}")
        print(f"\nExpected: each cross-DB writer package has a *crossdb*_test.go")
        print(f"sibling that documents the partial-failure boundary.")
        print(f"Exempt-list: dev/registries/cross_db_writer_test_exempt.json")
        return 1

    print(f"lint:cross-db-writer-test OK — {len(exempt)} package(s) on shrinking ledger.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
