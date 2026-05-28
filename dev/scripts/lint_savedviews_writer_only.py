#!/usr/bin/env python3
"""Lint savedviews-writer-only.

Rule: writes to `saved_views` MUST go through the sole-writer service
at `backend/internal/savedviews/`. The detector scans every Go file
under `backend/` for INSERT / UPDATE / DELETE statements naming
saved_views, and flags hits that do NOT live inside the allowed
package directory.

Migration SQL (`db/vector_artefacts/schema/*.sql`) is exempt.
Test files (`*_test.go`) are exempt.

Exit 0 = clean. Exit 1 = one or more rogue writes detected.
"""
from __future__ import annotations
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
ALLOWED_DIR = "backend/internal/savedviews/"

WRITE_RE = re.compile(
    r"(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+saved_views\b",
    re.IGNORECASE,
)

violations: list[tuple[pathlib.Path, int, str]] = []

for path in (ROOT / "backend").rglob("*.go"):
    rel = path.relative_to(ROOT).as_posix()
    if rel.startswith(ALLOWED_DIR):
        continue
    if path.name.endswith("_test.go"):
        continue
    try:
        text = path.read_text(errors="ignore")
    except Exception:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        if WRITE_RE.search(line):
            violations.append((path, i, line.strip()))

if not violations:
    print("lint:savedviews-writer-only OK — 0 rogue writes")
    sys.exit(0)

print(f"lint:savedviews-writer-only FAIL — {len(violations)} rogue writes:")
for p, i, line in violations:
    print(f"  {p.relative_to(ROOT)}:{i}  {line}")
sys.exit(1)
