#!/usr/bin/env python3
"""Lint deferral-needs-td-id: deferral language in a commit message must
reference a TD-* register id.

PLA-0048 / RF1.1.4. Backs feedback_deferrals_register.md memory rule.
The standing rule says every deferral lands in docs/c_tech_debt.md as a
TD-* row BEFORE the commit that creates the deferral. Memory entries
self-policed (i.e. enforced by Claude reading the rule before acting)
were not sufficient — four deferrals slipped past on 2026-05-13 before
the rule was even written.

This lint reads a commit message (from a file path arg, or HEAD by
default) and fails if it contains deferral phrases without a TD-* id
in the same message.

Deferral phrases (case-insensitive):
  - "hold until"
  - "out of scope for this commit" / "out of scope for now"
  - "needs its own plan" / "needs its own session" / "needs its own commit"
  - "deferred" / "deferring"
  - "follow-up" / "followup"
  - "leave for next time" / "leave for later"
  - "not blocking" / "nonblocking"
  - "tech debt, not addressing now" / "tech debt for later"

TD-* id pattern: TD-[A-Z]+-\\d+ (e.g. TD-AUTH-001, TD-API-002).

Usage:
  lint_deferral_needs_td_id.py                  # check HEAD's commit message
  lint_deferral_needs_td_id.py <msgfile>        # check a specific file
  lint_deferral_needs_td_id.py --commit-msg <f> # commit-msg hook mode

Exit 0 = clean. Exit 1 = deferral phrase present without TD-* id.
"""
from __future__ import annotations
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

DEFERRAL_PHRASES = [
    r"\bhold\s+until\b",
    r"\bout\s+of\s+scope\b",
    r"\bneeds?\s+its\s+own\s+(plan|session|commit|pla|story|card)\b",
    r"\bdefer(?:red|ring|ral)\b",
    r"\bfollow[\s\-]?up\b",
    r"\bleave\s+for\s+(?:next\s+time|later)\b",
    r"\bnot\s+blocking\b",
    r"\bnon[\s\-]?blocking\b",
    r"\btech\s+debt\b.*\b(?:not\s+addressing\s+now|for\s+later|for\s+now)\b",
    r"\bwill\s+(?:address|fix|do)\s+later\b",
    r"\bpunt(?:ed|ing)?\b",
]
DEFERRAL_RE = re.compile("|".join(DEFERRAL_PHRASES), re.IGNORECASE)

TD_ID_RE = re.compile(r"\bTD-[A-Z]+-\d+\b")


def get_message_from_head() -> str:
    """Read HEAD's commit message."""
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--pretty=%B", "HEAD"],
            capture_output=True, text=True, cwd=ROOT, check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return ""
    return result.stdout


def get_message_from_file(path: pathlib.Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def strip_comments(msg: str) -> str:
    """Strip git-style comment lines (# at start of line) so phrases in
    commented-out help text don't count."""
    return "\n".join(
        line for line in msg.splitlines() if not line.lstrip().startswith("#")
    )


def main() -> int:
    # Parse args
    msg_path: pathlib.Path | None = None
    args = sys.argv[1:]
    if args:
        if args[0] in ("--commit-msg", "-m"):
            if len(args) < 2:
                print("usage: lint_deferral_needs_td_id.py [--commit-msg <file>] [file]", file=sys.stderr)
                return 2
            msg_path = pathlib.Path(args[1])
        elif args[0] in ("--help", "-h"):
            print(__doc__)
            return 0
        else:
            msg_path = pathlib.Path(args[0])

    if msg_path is not None:
        msg = get_message_from_file(msg_path)
    else:
        msg = get_message_from_head()

    if not msg.strip():
        print("lint:deferral-needs-td-id: empty message; skipping.")
        return 0

    msg = strip_comments(msg)

    deferral_matches = DEFERRAL_RE.findall(msg)
    if not deferral_matches:
        print("lint:deferral-needs-td-id OK — no deferral phrases.")
        return 0

    td_matches = TD_ID_RE.findall(msg)
    if td_matches:
        print(
            f"lint:deferral-needs-td-id OK — deferral phrase(s) present, "
            f"linked to {', '.join(sorted(set(td_matches)))}."
        )
        return 0

    print("lint:deferral-needs-td-id FAIL\n", file=sys.stderr)
    print(
        "Commit message contains deferral phrasing but no TD-* register id.\n"
        "Per feedback_deferrals_register.md: every deferral MUST be filed in\n"
        "docs/c_tech_debt.md with a TD-* id BEFORE the commit that creates it.\n",
        file=sys.stderr,
    )
    print("Deferral phrases detected:", file=sys.stderr)
    for phrase in sorted(set(deferral_matches)):
        print(f"  - {phrase!r}", file=sys.stderr)
    print(
        "\nTo fix:\n"
        "  1. Open docs/c_tech_debt.md and add a row (see existing rows for shape).\n"
        "  2. Pick a TD-* id (TD-AREA-NNN, area matches the affected domain).\n"
        "  3. Reference the id in this commit message (anywhere in the body).\n",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
