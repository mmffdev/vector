#!/usr/bin/env python3
"""lint:no-old-context-imports — no imports from legacy auth/scope/tenant contexts.

Rule: in any `*.tsx` / `*.ts` under `app/`, importing from
`@/app/contexts/AuthContext`, `@/app/contexts/ScopeContext`, or
`@/app/contexts/TenantContext` is forbidden. These contexts are scheduled
for deletion in PLA062 S22; the canonical identity/scope source is
`@/app/sentinel`.

The contexts themselves are skipped (they're their own implementation).
The legacy `app/contexts/Sentinel.tsx` (the original SentinelBridge) is
ALSO skipped because it's an internal implementation that gets deleted
together with the others in S22.

PLA062 S19 ratchets so a future PR can't reintroduce these imports.

Skipped paths: app/contexts/AuthContext.tsx, app/contexts/ScopeContext.tsx,
app/contexts/TenantContext.tsx, app/contexts/Sentinel.tsx (the legacy
bridge itself), tests, type declaration files.

Exit 0 = clean. Exit 1 = violations found.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXEMPT_PATH = ROOT / "dev" / "registries" / "no_old_context_imports_exempt.json"

# Pattern matches: import { … } from "@/app/contexts/{Auth,Scope,Tenant}Context"
# Also matches dynamic imports if anyone tried that.
PATTERN = re.compile(
    r'(?:from\s+["\']|import\s*\(\s*["\'])'
    r'@/app/contexts/(AuthContext|ScopeContext|TenantContext)'
    r'["\']'
)
COMMENT_LINE = re.compile(r"^\s*(//|\*|/\*)")

# Files that ARE the legacy contexts themselves — skip.
SELF_FILES = {
    "app/contexts/AuthContext.tsx",
    "app/contexts/ScopeContext.tsx",
    "app/contexts/TenantContext.tsx",
    "app/contexts/Sentinel.tsx",  # the legacy SentinelBridge — deleted in S22
}

FAIL = False


def fail(msg: str) -> None:
    global FAIL
    FAIL = True
    print(f"FAIL  {msg}")


exempt = set()
if EXEMPT_PATH.exists():
    raw = json.loads(EXEMPT_PATH.read_text())
    exempt = {entry["path"] for entry in raw.get("exemptions", [])}

checked = 0
files = sorted(ROOT.glob("app/**/*.tsx")) + sorted(ROOT.glob("app/**/*.ts"))
for f in files:
    rel = f.relative_to(ROOT).as_posix()
    if rel in SELF_FILES:
        continue
    if "__tests__/" in rel or rel.endswith(".test.tsx") or rel.endswith(".test.ts"):
        continue
    if rel.endswith(".d.ts"):
        continue
    if rel in exempt:
        continue
    src = f.read_text(errors="replace")
    for lineno, line in enumerate(src.splitlines(), start=1):
        if COMMENT_LINE.match(line):
            continue
        m = PATTERN.search(line)
        if m:
            fail(
                f"{rel}:{lineno}  import from @/app/contexts/{m.group(1)} forbidden — "
                f"use useSentinel() from @/app/sentinel (PLA062 S19)"
            )
    checked += 1

print(f"OK    {checked} file(s) checked, {len(exempt)} exempt")

sys.exit(1 if FAIL else 0)
