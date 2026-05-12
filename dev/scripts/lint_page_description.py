#!/usr/bin/env python3
"""lint:page-description — every user-facing page must render <PageDescription>.

Rule: any `page.tsx` under `app/(user)/` must contain `<PageDescription>` so
the helper-icon Panel + standardised top spacing land consistently. New pages
inherit the convention without per-page wiring.

Exemptions live in `dev/registries/page_description_exempt.json` — used for
pages that are pure list/detail shells where a description panel adds no
value (e.g. dynamic `[id]` detail routes, harness/dev pages). Adding an
entry requires a paired tech-debt note.

Exit 0 = clean. Exit 1 = violations found.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXEMPT_PATH = ROOT / "dev" / "registries" / "page_description_exempt.json"

FAIL = False


def fail(msg: str) -> None:
    global FAIL
    FAIL = True
    print(f"FAIL  {msg}")


exempt = set()
if EXEMPT_PATH.exists():
    raw = json.loads(EXEMPT_PATH.read_text())
    exempt = {entry["path"] for entry in raw.get("exemptions", [])}

pages = sorted(ROOT.glob("app/(user)/**/page.tsx"))
checked = 0
for page in pages:
    rel = page.relative_to(ROOT).as_posix()
    if rel in exempt:
        continue
    src = page.read_text(errors="replace")
    if "<PageDescription" not in src:
        fail(f"{rel}  missing <PageDescription> — add one or exempt in {EXEMPT_PATH.relative_to(ROOT)}")
    checked += 1

print(f"OK    {checked} page(s) checked, {len(exempt)} exempt")

sys.exit(1 if FAIL else 0)
