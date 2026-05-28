#!/usr/bin/env python3
"""Lint savedviews-context-free.

Rule: the `<SavedViewsControl>` component family (anything under
`app/components/SavedViews/`) MUST read no globals related to identity.
This protects the future-proofing contract: identity arrives as props
only, so future consumers (custom pages, dashboards) plug in without
refactoring the component.

Forbidden tokens (any of):
  - `useRouter`
  - `useSearchParams`
  - `usePathname`
  - `window.location`
  - any import from `next/router` or `next/navigation`

Exit 0 = clean. Exit 1 = one or more violations.
"""
from __future__ import annotations
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
TARGET = ROOT / "app" / "components" / "SavedViews"

FORBIDDEN_RE = re.compile(
    r"\b(useRouter|useSearchParams|usePathname|window\.location)\b"
    r"|from\s+['\"]next/(router|navigation)['\"]"
)

violations: list[tuple[pathlib.Path, int, str]] = []

if not TARGET.exists():
    print(f"lint:savedviews-context-free OK — target dir {TARGET.relative_to(ROOT)} does not exist yet")
    sys.exit(0)

for path in TARGET.rglob("*.ts*"):
    try:
        text = path.read_text(errors="ignore")
    except Exception:
        continue
    for i, line in enumerate(text.splitlines(), 1):
        if FORBIDDEN_RE.search(line):
            violations.append((path, i, line.strip()))

if not violations:
    print("lint:savedviews-context-free OK — 0 identity globals")
    sys.exit(0)

print(f"lint:savedviews-context-free FAIL — {len(violations)} identity-global reads:")
for p, i, line in violations:
    print(f"  {p.relative_to(ROOT)}:{i}  {line}")
sys.exit(1)
