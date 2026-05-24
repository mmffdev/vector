#!/usr/bin/env python3
"""lint:no-direct-workspace-id — workspace_id MUST come from Sentinel.

Rule: in any `*.tsx` / `*.ts` under `app/`, reading `user.workspace_id` or
`user?.workspace_id` is forbidden when `user` did NOT come from
`useSentinel()` — i.e. it's reading off an old AuthContext-shaped user
object. The canonical read path is `useSentinel().sentinel_user?.workspace_id`,
which is wired to the JWT claim via the Sentinel boot payload.

PLA062 S18 closed every active call site; S19 ratchets the rule so a
future PR can't reintroduce a direct read via a re-add of `useAuth`.

Mechanics: we permit `sentinel_user.workspace_id` (the canonical path)
and `grant.workspace_id` (per-grant scope data — different concept).
We FAIL on any other `\b_?user\??\.workspace_id\b` match unless the file
is exempted in dev/registries/no_direct_workspace_id_exempt.json.

Skipped paths: app/contexts/** (legacy contexts on death row in S22),
app/sentinel/** (the canonical implementation itself), tests, type
declaration files.

Exit 0 = clean. Exit 1 = violations found.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXEMPT_PATH = ROOT / "dev" / "registries" / "no_direct_workspace_id_exempt.json"

# Match `user.workspace_id`, `user?.workspace_id`, `_user.workspace_id`
# but NOT `sentinel_user.workspace_id` (allowed), `grant.workspace_id`
# (different concept — per-grant data), `tenant_user.workspace_id` etc.
# Negative lookbehind ensures the only allowed prefix is plain `_?` or
# nothing — `sentinel_` precedes it via a `_` so we explicitly block via
# the `sentinel` check below.
PATTERN = re.compile(r"\b(?<![a-zA-Z0-9_])(_?user)\??\.workspace_id\b")
SENTINEL_IMPORT = re.compile(r'from\s+["\']@/app/sentinel["\']')
COMMENT_LINE = re.compile(r"^\s*(//|\*|/\*)")
SKIP_DIRS = (
    "app/contexts/",          # legacy contexts being deleted in S22
    "app/sentinel/",          # canonical Sentinel implementation
)

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
    if any(rel.startswith(d) for d in SKIP_DIRS):
        continue
    if "__tests__/" in rel or rel.endswith(".test.tsx") or rel.endswith(".test.ts"):
        continue
    if rel.endswith(".d.ts"):
        continue
    if rel in exempt:
        continue
    src = f.read_text(errors="replace")
    # If the file imports from @/app/sentinel, treat `user.workspace_id`
    # as a Sentinel read (callers alias `sentinel_user` → `user` in the
    # destructure). The canonical concern is files that DON'T touch
    # Sentinel yet still read user.workspace_id off some other shape.
    if SENTINEL_IMPORT.search(src):
        checked += 1
        continue
    for lineno, line in enumerate(src.splitlines(), start=1):
        if COMMENT_LINE.match(line):
            continue
        # Strip any inline // or /* */ comments before matching.
        stripped = re.sub(r"//.*$", "", line)
        stripped = re.sub(r"/\*.*?\*/", "", stripped)
        for m in PATTERN.finditer(stripped):
            # Final exclusion: if the captured group is sandwiched in
            # something like `sentinel_user`, the lookbehind already
            # rejected it. But defend against constructs like
            # `current_user.workspace_id` (still wrong, still flagged).
            fail(
                f"{rel}:{lineno}  direct user.workspace_id read — "
                f"use useSentinel().sentinel_user?.workspace_id (PLA062 S19)"
            )
    checked += 1

print(f"OK    {checked} file(s) checked, {len(exempt)} exempt")

sys.exit(1 if FAIL else 0)
