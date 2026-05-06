#!/usr/bin/env python3
"""lint:tab-deep-link — verify tab deep-linking uses path-segment routing.

Rules checked:
1. No file passes `urlKey` to <SecondaryNavigation> (nuqs approach was rejected;
   tabs use Next.js nested routes instead).
2. No file uses both `useTabState` and a layout.tsx sibling in the same
   workspace-settings route group (double-management guard).

The canonical pattern is: layout.tsx reads usePathname() and calls router.push()
on tab change; each tab is a real Next.js page route.

Exit 0 = clean. Exit 1 = violations found.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FAIL = False


def fail(msg: str) -> None:
    global FAIL
    FAIL = True
    print(f"FAIL  {msg}")


tsx_files = list(ROOT.glob("app/**/*.tsx")) + list(ROOT.glob("app/**/*.ts"))

# ── Rule 1: urlKey must not appear (nuqs approach retired) ──
url_key_files = [
    f for f in tsx_files
    if re.search(r'urlKey\s*=', f.read_text(errors="replace"))
]
if url_key_files:
    for f in url_key_files:
        fail(f"{f.relative_to(ROOT)}  uses urlKey — tab deep-linking uses path-segment routing, not urlKey/nuqs")
else:
    print("OK    no urlKey usage found (path-segment routing in use)")

# ── Rule 2: route groups that have a layout.tsx must not also use useTabState ──
# A layout.tsx that reads usePathname() owns the tab state; siblings that also
# call useTabState() create double-management.
route_dirs = set()
for f in ROOT.glob("app/**/layout.tsx"):
    src = f.read_text(errors="replace")
    # Only flag layouts that are doing tab routing (contain usePathname + SecondaryNavigation)
    if "usePathname" in src and "SecondaryNavigation" in src:
        route_dirs.add(f.parent)

for route_dir in route_dirs:
    for page in route_dir.rglob("page.tsx"):
        src = page.read_text(errors="replace")
        if re.search(r'useTabState\s*\(', src):
            fail(f"{page.relative_to(ROOT)}  uses useTabState inside a path-segment-routed layout — remove useTabState")

print(f"OK    {len(route_dirs)} path-segment layout(s) checked for double-management")

sys.exit(1 if FAIL else 0)
