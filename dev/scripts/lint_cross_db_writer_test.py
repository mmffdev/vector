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

# Match `<name> *pgxpool.Pool` field lines inside struct declarations.
POOL_FIELD_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s+\*pgxpool\.Pool\b", re.MULTILINE)

# Match the opening of a Go struct type block: `type Foo struct {`.
STRUCT_OPEN_RE = re.compile(r"\btype\s+[A-Za-z_][A-Za-z0-9_]*\s+struct\s*\{")

# Cross-DB test file globs.
CROSSDB_TEST_GLOBS = ["*crossdb*_test.go", "*cross_db*_test.go"]

# A package only has a cross-DB *write* hazard if it actually writes.
# `.Exec(` is the pgx write verb (QueryRow/Query are reads). A package
# that holds two pool fields but never calls .Exec is a cross-DB READER
# (e.g. erd's ERD-introspection joins, workspaceresolver's lookups) — it
# has no partial-failure-on-write boundary to document, so it must not be
# flagged. This is the "look for write methods rather than pool count"
# tightening the ledger note has been asking for (false-positive cull,
# 2026-06-05).
WRITE_CALL_RE = re.compile(r"\.Exec\(")


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {p.rstrip("/") for p in data.get("exempt_paths", [])}


def package_dirs() -> list[pathlib.Path]:
    return sorted([p for p in SCAN_DIR.iterdir() if p.is_dir()])


def _pool_fields_in_struct_blocks(src: str) -> int:
    """Max number of *pgxpool.Pool fields held by any SINGLE struct in
    src. We scan brace-balanced struct bodies rather than the whole file
    so two separate single-pool structs (e.g. auth's Service.Pool +
    JTICache.pool) are NOT conflated into a phantom two-pool writer — a
    genuine cross-DB writer is one STRUCT holding two pools to two DBs,
    not a package that happens to contain two unrelated one-pool types."""
    best = 0
    for open_m in STRUCT_OPEN_RE.finditer(src):
        # Walk from the opening brace, tracking depth, to find the
        # matching close brace for this struct body.
        i = open_m.end() - 1  # position of '{'
        depth = 0
        end = len(src)
        for j in range(i, len(src)):
            c = src[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    end = j
                    break
        body = src[i + 1 : end]
        n = len(POOL_FIELD_RE.findall(body))
        best = max(best, n)
    return best


def max_pool_fields_in_any_struct(pkg_dir: pathlib.Path) -> int:
    """Across all non-test .go files in the package, the largest number
    of *pgxpool.Pool fields declared in a single struct. >1 means a
    struct holds multiple pools — the cross-DB-writer shape."""
    best = 0
    for go_file in pkg_dir.glob("*.go"):
        if go_file.name.endswith("_test.go"):
            continue
        best = max(best, _pool_fields_in_struct_blocks(go_file.read_text()))
    return best


def has_crossdb_test(pkg_dir: pathlib.Path) -> bool:
    for glob in CROSSDB_TEST_GLOBS:
        if any(pkg_dir.glob(glob)):
            return True
    return False


def package_has_write(pkg_dir: pathlib.Path) -> bool:
    """True if any non-test .go file in the package issues a pgx write
    (`.Exec(`). A package with no writes cannot have a cross-DB write
    partial-failure boundary, so it is not a cross-DB *writer* even with
    multiple pool fields."""
    for go_file in pkg_dir.glob("*.go"):
        if go_file.name.endswith("_test.go"):
            continue
        if WRITE_CALL_RE.search(go_file.read_text()):
            return True
    return False


def main() -> int:
    exempt = load_exemptions()
    violations: list[str] = []

    for pkg_dir in package_dirs():
        rel = str(pkg_dir.relative_to(ROOT))
        n_pools = max_pool_fields_in_any_struct(pkg_dir)
        if n_pools < 2:
            continue
        if not package_has_write(pkg_dir):
            # Cross-DB reader, not writer — no write partial-failure
            # boundary to document. Not a violation.
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
