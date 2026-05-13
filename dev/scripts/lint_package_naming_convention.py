#!/usr/bin/env python3
"""Lint package-naming-convention: Go package directories follow §1.1.

PLA-0048 / RF1.1.5. Backs the §1.1 rules in c_c_naming_conventions.md:
- All lowercase, single concept token.
- No underscores, no hyphens (Go-language constraint).
- Version suffixes (*vN) allowed ONLY when the version carries real
  meaning AND the package's doc.go documents what the predecessor was.

This lint walks every directory under backend/internal/ and checks:
  1. The directory name itself: lowercase only? underscore-free? hyphen-free?
  2. If the directory matches `*v\\d+`, does doc.go in that directory mention
     either "v1" or "predecessor" or "supersedes" or a previous package name?
     A bare `*v\\d+` directory without an explanation is a fail.

Exit 0 = clean. Exit 1 = at least one violation.
"""
from __future__ import annotations
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCAN_DIR = ROOT / "backend" / "internal"

LOWERCASE_RE = re.compile(r"^[a-z][a-z0-9]*$")
VERSION_SUFFIX_RE = re.compile(r"v\d+$")

DOC_EXPLAINS_VERSION_RE = re.compile(
    r"\b(v1|predecessor|supersedes|formerly|previously|renamed from|"
    r"replaces?|legacy.*pipeline|legacy.*package|originally named)\b",
    re.IGNORECASE,
)


def is_lowercase_token(name: str) -> bool:
    return bool(LOWERCASE_RE.match(name))


def has_version_suffix(name: str) -> bool:
    return bool(VERSION_SUFFIX_RE.search(name))


def doc_explains_version(pkg_dir: pathlib.Path) -> bool:
    """Look for a doc.go (or service.go fallback) that explains the version."""
    candidates = [pkg_dir / "doc.go", pkg_dir / "service.go"]
    for path in candidates:
        if path.exists():
            try:
                text = path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            if DOC_EXPLAINS_VERSION_RE.search(text):
                return True
    return False


def main() -> int:
    if not SCAN_DIR.exists():
        print(f"lint:package-naming-convention: {SCAN_DIR} not found; skipping.")
        return 0

    violations: list[tuple[pathlib.Path, str]] = []

    for entry in sorted(SCAN_DIR.iterdir()):
        if not entry.is_dir():
            continue
        # Skip directories that don't contain any .go files (might be subdirs
        # used as namespaces rather than packages).
        if not any(entry.glob("*.go")):
            continue
        name = entry.name
        rel = entry.relative_to(ROOT).as_posix()

        # Rule 1: lowercase token, no underscores, no hyphens
        if not is_lowercase_token(name):
            violations.append((entry, f"name '{name}' is not lowercase alphanumeric (§1.1.1)"))
            continue

        # Rule 2: version suffix needs doc.go justification
        if has_version_suffix(name):
            if not doc_explains_version(entry):
                violations.append((
                    entry,
                    f"name '{name}' carries version suffix but doc.go/service.go does not "
                    f"explain what predecessor/v1 was (§1.1.2)"
                ))

    if not violations:
        # Count packages scanned for the OK message
        pkg_count = sum(
            1 for d in SCAN_DIR.iterdir()
            if d.is_dir() and any(d.glob("*.go"))
        )
        print(f"lint:package-naming-convention OK — {pkg_count} package(s) conform.")
        return 0

    print("lint:package-naming-convention FAIL\n", file=sys.stderr)
    print(
        "These Go packages don't conform to §1.1 of c_c_naming_conventions.md.\n"
        "Either rename the directory, or (for version-suffixed packages) add a\n"
        "doc.go that explains what v1/predecessor was.\n",
        file=sys.stderr,
    )
    for path, reason in violations:
        rel = path.relative_to(ROOT).as_posix()
        print(f"  - {rel}: {reason}", file=sys.stderr)
    print(f"\n{len(violations)} package(s) in violation.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
