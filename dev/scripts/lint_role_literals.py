#!/usr/bin/env python3
"""Lint role-literal compares: PLA-0007 / Story 00305.

Rule: prevent regressions where a string-literal role code is compared
against a `.role` field on the frontend. After PLA-0007 lands the
data-driven RBAC, the contract is:

    DEPRECATED  →  user.role === 'gadmin'
    REPLACEMENT →  useHasPermission('menu.admin.view')
                   (or the matching permission for the gate)

The replacement-call migration is a later PLA-0007 story. This lint
locks the door behind that migration: once a file is converted, no one
can silently reintroduce a role-string compare.

The detector looks for binary equality / inequality whose left or right
operand is a string literal in {'gadmin', 'padmin', 'team_lead', 'user',
'external'} AND whose other operand textually references `.role` (e.g.
`user.role`, `currentUser.role`, `user?.role`, `u.role`).

Conservative pattern-match — works without an AST parser, suitable for
the project's existing python-lint convention (mirrors
`lint_addressables.py`). False positives can be parked in
`dev/registries/role_literals_exempt.json` (`exempt_paths` list).

Exit 0 = clean. Exit 1 = one or more raw role-literal compares remain.
Output is line-oriented for the Reports panel (renders as
"role-literals" row).
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "role_literals_exempt.json"
SCAN_DIRS = ["app", "dev/store", "dev/pages", "dev/components"]

ROLE_CODES = ("gadmin", "padmin", "team_lead", "user", "external")
ROLE_RE = "|".join(ROLE_CODES)

# .role references — handles `user.role`, `currentUser?.role`, `u.role`, etc.
# Matches an identifier (or `this`), an optional `?.`, then `.role` followed
# by a non-identifier char so we don't match `.roles` or `.role_id`.
DOTROLE_FRAG = r"[A-Za-z_$][\w$]*\??\.role(?![\w$])"

# Two patterns: literal on the right, literal on the left.
RIGHT_LITERAL_RE = re.compile(
    rf"""({DOTROLE_FRAG})\s*(===|!==|==|!=)\s*['"]({ROLE_RE})['"]""",
)
LEFT_LITERAL_RE = re.compile(
    rf"""['"]({ROLE_RE})['"]\s*(===|!==|==|!=)\s*({DOTROLE_FRAG})""",
)


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(p) for p in data.get("exempt_paths", [])}


def scan() -> list[tuple[pathlib.Path, int, str]]:
    hits: list[tuple[pathlib.Path, int, str]] = []
    for sub in SCAN_DIRS:
        base = ROOT / sub
        if not base.exists():
            continue
        for ext in ("*.tsx", "*.ts"):
            for path in base.rglob(ext):
                if "node_modules" in path.parts or ".next" in path.parts:
                    continue
                # skip type-declaration files — they describe types, not gates
                if path.name.endswith(".d.ts"):
                    continue
                try:
                    text = path.read_text(errors="ignore")
                except OSError:
                    continue
                for line_no, line in enumerate(text.splitlines(), start=1):
                    # Skip lines fully inside a // line comment of role
                    # discussion (rare false-positive pruning).
                    stripped = line.lstrip()
                    if stripped.startswith("//") or stripped.startswith("*"):
                        continue
                    for m in RIGHT_LITERAL_RE.finditer(line):
                        ref, op, lit = m.group(1), m.group(2), m.group(3)
                        sig = f"{ref} {op} '{lit}'"
                        hits.append((path, line_no, sig))
                    for m in LEFT_LITERAL_RE.finditer(line):
                        lit, op, ref = m.group(1), m.group(2), m.group(3)
                        sig = f"'{lit}' {op} {ref}"
                        hits.append((path, line_no, sig))
    return hits


def write_report(hits, exempt) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-role-literals"

    checks = []
    for p, ln, sig in hits:
        rel = str(p.relative_to(ROOT))
        if rel in exempt:
            checks.append({
                "status": "warn",
                "label": f"{rel}:{ln}",
                "detail": f"exempt — {sig}",
            })
        else:
            checks.append({
                "status": "fail",
                "label": f"{rel}:{ln}",
                "detail": f"role-string compare — replace with useHasPermission(...) — {sig}",
            })

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:role-literals",
            "detail": f"no role-string compares found across {len(SCAN_DIRS)} scan dirs",
        })

    summary = {
        "pass": sum(1 for c in checks if c["status"] == "pass"),
        "warn": sum(1 for c in checks if c["status"] == "warn"),
        "fail": sum(1 for c in checks if c["status"] == "fail"),
        "fixed": 0,
    }

    report = {
        "id": ts_id,
        "scope": "H",
        "scopeName": "role-literals",
        "flag": "lint:role-literals",
        "timestamp": now.replace(microsecond=0).isoformat(),
        "checks": checks,
        "summary": summary,
    }

    out = reports_dir / f"{ts_id}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")


def main() -> int:
    exempt = load_exemptions()
    hits = scan()

    if "--report" in sys.argv[1:]:
        write_report(hits, exempt)

    failing = [(p, ln, sig) for (p, ln, sig) in hits if str(p.relative_to(ROOT)) not in exempt]

    if not failing:
        print(f"[lint:role-literals] OK — {len(hits)} match(es), all exempt ({len(exempt)} exempt path(s)).")
        return 0

    print(f"[lint:role-literals] FAIL — {len(failing)} role-string compare(s) found:")
    for path, lineno, sig in failing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}:{lineno}: replace with useHasPermission(...) — {sig}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
