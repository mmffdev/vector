#!/usr/bin/env python3
"""Lint sql-in-sqlfile-only: every raw SQL literal must live in sql.go.

PLA-0048 / RF1.1.1. Backs the §1.3 rule in c_c_naming_conventions.md:
every package under `backend/internal/` keeps its SQL strings in a
single `sql.go` file as named constants (sqlVerbResource form), referenced
by service.go / handler.go / etc. The runtime calls (pool.QueryRow,
pool.Exec) stay where they are; only the SQL strings move.

Why: SQL scattered across 56 of 137 backend files means moving a table
requires grepping across all of them. With sql.go consolidation, a table
move is one find-and-replace per package.

How the lint works:
  1. Walk every non-test .go file under backend/internal/.
  2. Skip the file if its basename is exactly `sql.go`.
  3. Skip the file if its path is on dev/registries/sql_in_sqlfile_exempt.json.
  4. Search file contents for raw SQL markers (SELECT, INSERT INTO, UPDATE,
     DELETE FROM, WITH ... AS).
  5. Any hit on a non-allow-listed non-sql.go file → fail.

The allow-list shrinks one package per RF1.2 commit. End state: empty
exempt_paths array → invariant.

Exit 0 = clean. Exit 1 = at least one non-exempt file has raw SQL.
"""
from __future__ import annotations
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "sql_in_sqlfile_exempt.json"
SCAN_DIR = ROOT / "backend" / "internal"

# SQL markers — case-insensitive match inside string literals.
# Anchored to require the keyword be followed by whitespace so we don't
# false-positive on identifiers like `SelectedItem` or `INSERTED_VAL`.
SQL_MARKERS = [
    re.compile(r"\bSELECT\s", re.IGNORECASE),
    re.compile(r"\bINSERT\s+INTO\s", re.IGNORECASE),
    re.compile(r"\bUPDATE\s+[a-z_][a-z0-9_]*\s+SET\s", re.IGNORECASE),
    re.compile(r"\bDELETE\s+FROM\s", re.IGNORECASE),
    re.compile(r"\bWITH\s+[a-z_][a-z0-9_]*\s+AS\s*\(", re.IGNORECASE),
    re.compile(r"\bCREATE\s+(TABLE|INDEX|VIEW)\s", re.IGNORECASE),
    re.compile(r"\bALTER\s+TABLE\s", re.IGNORECASE),
]

# We only consider matches that appear INSIDE a Go string literal (either
# double-quoted "..." or backtick `...`). Comments and identifier names
# don't count. We scan the file once, strip comments, then check only
# the string-literal substrings.
GO_LINE_COMMENT = re.compile(r"//[^\n]*")
GO_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
GO_STRING_LITERAL = re.compile(
    r'`[^`]*`'           # raw string (multi-line, no escapes)
    r'|"(?:[^"\\]|\\.)*"',  # interpreted string (single line, escapes)
    re.DOTALL,
)


def strip_comments(src: str) -> str:
    src = GO_BLOCK_COMMENT.sub("", src)
    src = GO_LINE_COMMENT.sub("", src)
    return src


def extract_strings(src: str) -> list[str]:
    return GO_STRING_LITERAL.findall(strip_comments(src))


def file_has_sql(path: pathlib.Path) -> bool:
    try:
        src = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return False
    for literal in extract_strings(src):
        for rx in SQL_MARKERS:
            if rx.search(literal):
                return True
    return False


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(p) for p in data.get("exempt_paths", [])}


def main() -> int:
    if not SCAN_DIR.exists():
        print(f"lint:sql-in-sqlfile-only: scan dir not found ({SCAN_DIR}); skipping.")
        return 0

    exemptions = load_exemptions()
    violations: list[pathlib.Path] = []

    for path in sorted(SCAN_DIR.rglob("*.go")):
        if path.name == "sql.go":
            continue
        if path.name.endswith("_test.go"):
            continue
        rel = path.relative_to(ROOT).as_posix()
        if rel in exemptions:
            continue
        if file_has_sql(path):
            violations.append(path)

    if not violations:
        print(
            f"lint:sql-in-sqlfile-only OK — 0 violations; "
            f"{len(exemptions)} file(s) on the shrinking allow-list."
        )
        return 0

    print("lint:sql-in-sqlfile-only FAIL\n", file=sys.stderr)
    print(
        "These files contain raw SQL outside sql.go and are not on the allow-list.\n"
        "Move the SQL strings into <package>/sql.go (see docs/c_c_naming_conventions.md §1.3),\n"
        "OR add the file path to dev/registries/sql_in_sqlfile_exempt.json's exempt_paths.\n",
        file=sys.stderr,
    )
    for path in violations:
        print(f"  - {path.relative_to(ROOT).as_posix()}", file=sys.stderr)
    print(f"\n{len(violations)} file(s) in violation.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
