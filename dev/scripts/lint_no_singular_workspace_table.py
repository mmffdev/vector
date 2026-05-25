#!/usr/bin/env python3
"""lint:no-singular-workspace-table — no SQL keyword references to placeholder/dead mmff_vector tables.

Rule: the following 6 tables are placeholder or dead and are queued for DROP in PLA064 CUT1.1.1.
Any new Go or SQL code that references them in a SQL keyword context (FROM, JOIN, UPDATE,
INSERT INTO, DELETE FROM) is forbidden. This lint would have caught the 2026-05-25 sentinel
bug at PR time (sentinel/sql.go referenced 'FROM workspace' — 0-row placeholder — instead of
master_record_workspaces — the real registry).

Gated tables (case-insensitive, word-bounded):
  workspace, portfolio, product, company_roadmap,
  execution_item_types, subscriptions_item_type_icons

Word-boundary caveat: 'workspace' is a substring of 'master_record_workspaces', 'workspaces_*',
etc. The regex uses \\b to prevent false positives. Same for 'portfolio' (vs master_record_portfolios,
portfoliomodels), 'product' (vs production, product_*), etc.

Scans:
  backend/**/*.go  — Go string literals embedding SQL
  db/**/*.sql      — raw SQL files

Exemption registry: dev/registries/placeholder_table_lint_allowlist.json
  Permits legitimate references (e.g. CREATE TABLE definitions, DROP migrations, historical
  migration functions that define these tables). This registry SHOULD shrink to zero before
  CUT1.1.1 closes and is retired in CUT1.6.1.

Exit 0 = clean (or all violations exempt). Exit 1 = at least one new violation.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXEMPT_PATH = ROOT / "dev" / "registries" / "placeholder_table_lint_allowlist.json"

# The 6 dead/placeholder tables queued for drop in CUT1.1.1.
DEAD_TABLES = [
    "workspace",
    "portfolio",
    "product",
    "company_roadmap",
    "execution_item_types",
    "subscriptions_item_type_icons",
]

# SQL keyword contexts that indicate a live query reference (not a CREATE/DROP/ALTER).
# \\b word boundaries prevent matching 'workspaces', 'master_record_workspace', 'production', etc.
# The keyword group is matched case-insensitively. We build one pattern per table.
_KW = r"(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)"
PATTERNS = {
    name: re.compile(
        rf"\b{_KW}\s+\b{re.escape(name)}\b",
        re.IGNORECASE,
    )
    for name in DEAD_TABLES
}

# Combined OR-pattern for a fast pre-filter line scan (avoids per-table match on every line).
FAST_CHECK = re.compile(
    rf"\b{_KW}\s+\b(?:{'|'.join(re.escape(n) for n in DEAD_TABLES)})\b",
    re.IGNORECASE,
)

COMMENT_LINE = re.compile(r"^\s*(?://|/\*|\*|#|--)")

FAIL = False


def fail(msg: str) -> None:
    global FAIL
    FAIL = True
    print(f"FAIL  {msg}")


# Load exemption registry.
exempt = set()
if EXEMPT_PATH.exists():
    raw = json.loads(EXEMPT_PATH.read_text())
    for entry in raw.get("exemptions", []):
        exempt.add(entry["path"])

# Collect files to scan: backend/**/*.go + db/**/*.sql
files_go = sorted(ROOT.glob("backend/**/*.go"))
files_sql = sorted(ROOT.glob("db/**/*.sql"))
all_files = files_go + files_sql

checked = 0
for f in all_files:
    rel = f.relative_to(ROOT).as_posix()
    if rel in exempt:
        continue
    src = f.read_text(errors="replace")
    hit_in_file = False
    for lineno, line in enumerate(src.splitlines(), start=1):
        # Skip pure comment lines.
        if COMMENT_LINE.match(line):
            continue
        # Fast pre-filter: skip if no keyword+table combo on this line.
        if not FAST_CHECK.search(line):
            continue
        # Per-table check to produce a precise violation message.
        for name, pat in PATTERNS.items():
            if pat.search(line):
                fail(
                    f"{rel}:{lineno}: references dead table '{name}' in SQL keyword context"
                    f" — queued for DROP in CUT1.1.1 (PLA064)"
                )
                hit_in_file = True
    checked += 1

print(f"OK    {checked} file(s) scanned, {len(exempt)} path(s) exempt")
if FAIL:
    print(
        "      Resolve violations before CUT1.1.1 drops these tables, OR add to"
        " dev/registries/placeholder_table_lint_allowlist.json with a reason."
    )

sys.exit(1 if FAIL else 0)
