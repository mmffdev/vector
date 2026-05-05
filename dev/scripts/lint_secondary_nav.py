#!/usr/bin/env python3
"""Lint SecondaryNavigation reorderable usage: PLA-0014 / Story 00420.

Rule: any `<SecondaryNavigation>` JSX element that uses the `reorderable`
prop MUST also pass a `pageId="..."` prop. The per-user tab order is
keyed by (user, subscription, page_id); without a stable pageId, the
backend cannot persist the ordering and the toggle has no effect.

The detector walks every `<SecondaryNavigation` opening tag (allowing
multi-line JSX) and verifies that, in the same element block (up to the
matching `>` or `/>`), both `reorderable` and `pageId` appear when
either is present.

Conservative pattern-match — works without an AST parser, mirrors
`lint_role_literals.py` style. False positives can be parked in
`dev/registries/secondary_nav_exempt.json` (`exempt_paths` list).

Exit 0 = clean. Exit 1 = one or more reorderable-without-pageId usages.
Output is line-oriented for the Reports panel (renders as
"secondary-nav" row).
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "secondary_nav_exempt.json"
SCAN_DIRS = ["app", "dev/store", "dev/pages", "dev/components"]

OPEN_RE = re.compile(r"<SecondaryNavigation\b")
REORDERABLE_RE = re.compile(r"\breorderable\b")
PAGEID_RE = re.compile(r"\bpageId\s*=")


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(p) for p in data.get("exempt_paths", [])}


def find_element_end(text: str, start: int) -> int:
    """Return index just after the `>` that closes the JSX opening tag.

    Tracks brace depth so that `>` chars inside `{...}` expression
    children of attribute values don't terminate the search. Returns
    len(text) if no terminator is found (defensive).
    """
    depth = 0
    in_str: str | None = None
    i = start
    n = len(text)
    while i < n:
        ch = text[i]
        if in_str:
            if ch == in_str and text[i - 1] != "\\":
                in_str = None
        elif ch in ("'", '"', "`"):
            in_str = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
        elif ch == ">" and depth == 0:
            return i + 1
        i += 1
    return n


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
                if path.name.endswith(".d.ts"):
                    continue
                # Skip the component implementation itself.
                if path.name == "SecondaryNavigation.tsx":
                    continue
                try:
                    text = path.read_text(errors="ignore")
                except OSError:
                    continue
                for m in OPEN_RE.finditer(text):
                    start = m.end()
                    end = find_element_end(text, start)
                    block = text[m.start():end]
                    if REORDERABLE_RE.search(block) and not PAGEID_RE.search(block):
                        line_no = text.count("\n", 0, m.start()) + 1
                        snippet = " ".join(block.split())
                        if len(snippet) > 120:
                            snippet = snippet[:117] + "..."
                        hits.append((path, line_no, snippet))
    return hits


def write_report(hits, exempt) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-secondary-nav"

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
                "detail": f"reorderable without pageId — add pageId=\"...\" — {sig}",
            })

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:secondary-nav",
            "detail": f"no reorderable-without-pageId usages found across {len(SCAN_DIRS)} scan dirs",
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
        "scopeName": "secondary-nav",
        "flag": "lint:secondary-nav",
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
        print(f"[lint:secondary-nav] OK — {len(hits)} match(es), all exempt ({len(exempt)} exempt path(s)).")
        return 0

    print(f"[lint:secondary-nav] FAIL — {len(failing)} reorderable-without-pageId usage(s) found:")
    for path, lineno, sig in failing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}:{lineno}: add pageId=\"...\" — {sig}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
