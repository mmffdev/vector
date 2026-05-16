#!/usr/bin/env python3
"""Lint exemption-ratchet: *_exempt.json files cannot grow commit-to-commit.

PLA-0048 / RF1.1.3. Two existing exemption ledgers
(page_description_exempt.json, role_literals_exempt.json) demonstrated
the failure mode this lint blocks: an exemption file was being used as a
parking lot — every page that should have <PageDescription> was instead
added to the exempt list rather than fixed. The lint stayed green; the
debt grew.

This lint enforces a one-way ratchet on every `dev/registries/*_exempt.json`
and `dev/registries/*_allowlist.json` file: the number of exempt entries
may shrink (good) or stay the same (acceptable). It may NEVER grow
between HEAD and HEAD~1 (the comparison point).

How it works:
  1. List every *_exempt.json and *_allowlist.json under dev/registries/.
  2. For each, count entries today vs the same file at HEAD~1.
  3. Fail if today's count exceeds HEAD~1's count.

Entry counts:
  - For lists (top-level array): len(json.load(...)).
  - For dicts: len(data.get("exempt_paths", [])) || len(data.get("entries",
    [])) || len(data.get("paths", [])) — first non-empty wins. If none
    found, fall back to summing all list-valued top-level fields.

A one-line note field is ignored.

Exit 0 = clean. Exit 1 = at least one ledger grew.
"""
from __future__ import annotations
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCAN_DIR = ROOT / "dev" / "registries"
LEDGER_GLOBS = ["*_exempt.json", "*_allowlist.json", "*-exemptions.txt"]


def count_entries(data: object) -> int:
    """Count exemption-style entries inside a parsed ledger."""
    if isinstance(data, list):
        return len(data)
    if isinstance(data, dict):
        # Try known keys first
        for key in ("exempt_paths", "entries", "paths", "allowed", "exemptions"):
            v = data.get(key)
            if isinstance(v, list):
                return len(v)
        # Fallback: sum all list-valued fields
        total = 0
        for v in data.values():
            if isinstance(v, list):
                total += len(v)
        return total
    return 0


def load_count_from_path(path: pathlib.Path) -> int:
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return 0
    if path.suffix == ".txt":
        return sum(1 for line in text.splitlines() if line.strip() and not line.startswith("#"))
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return 0
    return count_entries(data)


def load_count_from_git(rel: str, ref: str) -> int | None:
    """Return entry count for the ledger at `ref:rel`, or None if not present."""
    try:
        result = subprocess.run(
            ["git", "show", f"{ref}:{rel}"],
            capture_output=True, text=True, cwd=ROOT, check=False,
        )
    except (FileNotFoundError, OSError):
        return None
    if result.returncode != 0:
        # File didn't exist at that ref → no baseline; treat as 0 so any
        # current entries are acceptable (a new ledger is allowed to start
        # at any size — it's growth between commits that's blocked).
        return None
    text = result.stdout
    if rel.endswith(".txt"):
        return sum(1 for line in text.splitlines() if line.strip() and not line.startswith("#"))
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return 0
    return count_entries(data)


def discover_ledgers() -> list[pathlib.Path]:
    if not SCAN_DIR.exists():
        return []
    out: list[pathlib.Path] = []
    for pattern in LEDGER_GLOBS:
        out.extend(SCAN_DIR.glob(pattern))
    return sorted(set(out))


def main() -> int:
    ledgers = discover_ledgers()
    if not ledgers:
        print("lint:exemption-ratchet: no ledgers found; skipping.")
        return 0

    # Compare against HEAD~1 if available; otherwise compare against HEAD
    # (which means: a fresh ledger that doesn't yet exist in git is ignored
    # — the lint only blocks growth in tracked ledgers).
    base_ref = "HEAD~1"
    # Verify HEAD~1 resolves
    probe = subprocess.run(
        ["git", "rev-parse", "--verify", base_ref],
        capture_output=True, text=True, cwd=ROOT, check=False,
    )
    if probe.returncode != 0:
        base_ref = "HEAD"  # initial-commit edge case

    violations: list[tuple[pathlib.Path, int, int]] = []
    summaries: list[str] = []

    for path in ledgers:
        rel = path.relative_to(ROOT).as_posix()
        current = load_count_from_path(path)
        baseline = load_count_from_git(rel, base_ref)
        if baseline is None:
            summaries.append(f"  {rel}: new ledger ({current} entries, no baseline)")
            continue
        delta = current - baseline
        sign = "+" if delta > 0 else ""
        summaries.append(f"  {rel}: {baseline} → {current} ({sign}{delta})")
        if current > baseline:
            violations.append((path, baseline, current))

    if not violations:
        print(f"lint:exemption-ratchet OK — no ledger grew vs {base_ref}.")
        for line in summaries:
            print(line)
        return 0

    print(f"lint:exemption-ratchet FAIL — ledger(s) grew vs {base_ref}.\n", file=sys.stderr)
    print(
        "Exemption ledgers are a one-way ratchet: they may shrink or stay the same,\n"
        "but never grow. If you have a real exception, file a TD entry first\n"
        "and link the ledger expansion to it.\n",
        file=sys.stderr,
    )
    for path, baseline, current in violations:
        rel = path.relative_to(ROOT).as_posix()
        print(f"  - {rel}: {baseline} → {current} (+{current - baseline})", file=sys.stderr)
    print(f"\n{len(violations)} ledger(s) grew.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
