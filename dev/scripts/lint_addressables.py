#!/usr/bin/env python3
"""Lint addressables: structural rule for PLA-0005.

Rule: any container element whose first child is a heading element
AND that uses border + padding tokens (i.e. visually a panel) MUST be
<Panel name=…> from app/components/Panel.tsx, OR be one of the audited
exemption components: <InfoPanel>, <SectionHeading>, <PaneHeader>
(legacy — still exists in dev/registries; replaced page-by-page).

The lint is conservative — it flags the obvious offender pattern:
    <div ...border...padding...><h2>...</h2>...</div>
    <section ...border...padding...><h3>...</h3>...</section>

Per-page exemption list lives in dev/registries/addressables_exempt.json.
After the PLA-0005 sweep (stories 00255–00259), the list is EMPTY and
remains empty as a hard CI gate. Any new exemption must be discussed and
recorded with a justification.

Exit 0 = clean. Exit 1 = one or more raw panel-shaped elements remain.
Output is line-oriented so the Reports panel can render it as a row
labelled "addressables".
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "addressables_exempt.json"
SCAN_DIRS = ["app", "dev/store", "dev/pages", "dev/components"]

# Conservative panel-shape detector. Matches <div className="..."> or
# <section className="..."> whose className mentions BOTH a border token
# (border, --border, .panel) AND a padding token (padding, p-, --space),
# AND whose first JSX child is a heading h1..h6.
PANEL_SHAPE_RE = re.compile(
    r"""
    <(div|section)\b
    [^>]*?
    className\s*=\s*["'{]([^"'}]+)["'}]
    [^>]*>            # opening tag end
    \s*               # optional whitespace
    <h[1-6]\b         # first child must be heading
    """,
    re.VERBOSE | re.DOTALL,
)

PANEL_TAGS = {"Panel", "InfoPanel", "SectionHeading", "PaneHeader", "Header"}


def looks_like_panel(class_attr: str) -> bool:
    """Heuristic — true when the class string mentions a border AND padding token."""
    has_border = ("border" in class_attr) or ("--border" in class_attr)
    has_padding = ("padding" in class_attr) or ("p-" in class_attr) or ("--space" in class_attr)
    return has_border and has_padding


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
        for path in base.rglob("*.tsx"):
            if "node_modules" in path.parts or ".next" in path.parts:
                continue
            text = path.read_text(errors="ignore")
            for m in PANEL_SHAPE_RE.finditer(text):
                tag = m.group(1)
                cls = m.group(2)
                if not looks_like_panel(cls):
                    continue
                # If the matched element is itself nested inside a Panel /
                # InfoPanel / SectionHeading wrapper a few lines above, the
                # operator likely already wrapped it. We do a coarse check:
                # was a PANEL_TAGS open tag emitted in the preceding 6 lines?
                lineno = text.count("\n", 0, m.start()) + 1
                preceding = text[max(0, m.start() - 400):m.start()]
                if any(f"<{t}" in preceding for t in PANEL_TAGS):
                    continue
                hits.append((path, lineno, f"{tag} className=\"{cls[:60]}…\""))
    return hits


def write_report(hits, exempt) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-addressables"

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
                "detail": f"raw panel shape — wrap in <Panel name='…'> — {sig}",
            })

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:addressables",
            "detail": f"no raw panel shapes found across {len(SCAN_DIRS)} scan dirs",
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
        "scopeName": "addressables",
        "flag": "lint:addressables",
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
        print(f"[lint:addressables] OK — {len(hits)} panel-shaped element(s), all wrapped or exempt ({len(exempt)} exempt path(s)).")
        return 0

    print(f"[lint:addressables] FAIL — {len(failing)} raw panel shape(s) found:")
    for path, lineno, sig in failing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}:{lineno}: wrap in <Panel name='…'> — {sig}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
