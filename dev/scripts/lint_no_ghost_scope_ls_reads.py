#!/usr/bin/env python3
"""lint:no-ghost-scope-ls-reads — no reads from retired ScopeContext localStorage keys.

Rule: in any `*.tsx` / `*.ts` under `app/`, calling
`localStorage.{get,set,remove}Item("vector.scope.*")` is forbidden. These
keys were ScopeContext's persistence layer, deleted with ScopeContext
itself in PLA062 S22 (commit d14bcc70). No writer exists in current
code, so any value present in localStorage is stale residue from a
pre-S22 session.

Bug origin: 2026-05-24. `app/lib/api.ts::withForwardedMeg` fell back to
`localStorage.getItem("vector.scope.activeNodeId")` when the page URL
had no ?meg=. The stale UUID was injected into wire requests under
`(work-items|portfolio-items)/*`, backend's `topology.CanReadScope`
returned `ErrScopeForbidden` against a node the user no longer had a
grant on, → 403 `scope_read_denied` → ObjectTreeV2 rendered empty.
See TD-SCOPE-GHOST-LS-READS in docs/c_tech_debt.md.

Retired keys (from pre-S22 git history):
  - vector.scope.activeNodeId
  - vector.scope.direction
  - vector.scope.activeWorkspaceId
  - vector.scope.tenantId
  - any other vector.scope.* introduced before S22

Skipped paths: tests, type declaration files, the lint script itself,
docs/comment-only references. The exempt registry starts empty —
production code has no reason to read these keys.

Exit 0 = clean. Exit 1 = violations found.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXEMPT_PATH = ROOT / "dev" / "registries" / "no_ghost_scope_ls_reads_exempt.json"

# Pattern matches: localStorage.{get,set,remove}Item("vector.scope.…")
# Also catches the bracket form: localStorage["vector.scope.x"] / ["vector.scope.x" + …]
PATTERN = re.compile(
    r'localStorage\s*(?:'
    r'\.\s*(?:get|set|remove)Item\s*\(\s*["\']vector\.scope\.'
    r'|'
    r'\[\s*["\']vector\.scope\.'
    r')'
)
COMMENT_LINE = re.compile(r"^\s*(//|\*|/\*)")

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
        if PATTERN.search(line):
            fail(
                f"{rel}:{lineno}  localStorage read of retired ScopeContext key "
                f'("vector.scope.*") forbidden — ScopeContext was deleted in '
                f"PLA062 S22 (commit d14bcc70). Use useSentinel() from "
                f"@/app/sentinel for the canonical scope state. See "
                f"TD-SCOPE-GHOST-LS-READS in docs/c_tech_debt.md."
            )
    checked += 1

print(f"OK    {checked} file(s) checked, {len(exempt)} exempt")

sys.exit(1 if FAIL else 0)
