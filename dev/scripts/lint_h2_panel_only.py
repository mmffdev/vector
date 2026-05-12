#!/usr/bin/env python3
"""lint:h2-panel-only — every <h2> on a user-facing page MUST come from <Panel>.

Rule: in any `*.tsx` under `app/(user)/`, raw `<h2>` JSX is forbidden. Panel
titles render `<h2 class="panel__title">` internally, so section titles must
go through `<Panel title="…">`. This keeps the heading hierarchy consistent,
wires the helper-icon contract for every section, and registers the section
in the addressable substrate.

Exemptions live in `dev/registries/h2_panel_only_exempt.json` — used only
when a heading is genuinely not a section (e.g. a modal header inside a
shared component reused on these pages).

The Panel component itself (`app/components/Panel.tsx`) is the canonical
emitter and is hard-skipped — that's where the `<h2>` legitimately lives.

Exit 0 = clean. Exit 1 = violations found.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXEMPT_PATH = ROOT / "dev" / "registries" / "h2_panel_only_exempt.json"
PANEL_COMPONENT = "app/components/Panel.tsx"

H2_PATTERN = re.compile(r"<h2[\s>]")
COMMENT_LINE_PATTERN = re.compile(r"^\s*(//|\*|/\*)")

FAIL = False


def fail(msg: str) -> None:
    global FAIL
    FAIL = True
    print(f"FAIL  {msg}")


exempt = set()
if EXEMPT_PATH.exists():
    raw = json.loads(EXEMPT_PATH.read_text())
    exempt = {entry["path"] for entry in raw.get("exemptions", [])}

files = sorted(ROOT.glob("app/(user)/**/*.tsx"))
checked = 0
for f in files:
    rel = f.relative_to(ROOT).as_posix()
    if rel == PANEL_COMPONENT:
        continue
    if rel in exempt:
        continue
    src = f.read_text(errors="replace")
    for lineno, line in enumerate(src.splitlines(), start=1):
        if COMMENT_LINE_PATTERN.match(line):
            continue
        if H2_PATTERN.search(line):
            fail(f"{rel}:{lineno}  raw <h2> — section titles must go through <Panel title=\"…\">")
    checked += 1

print(f"OK    {checked} file(s) checked, {len(exempt)} exempt")

sys.exit(1 if FAIL else 0)
