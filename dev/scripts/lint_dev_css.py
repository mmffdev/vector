#!/usr/bin/env python3
"""Lint dev-css: structural rule for PLA-0013.

Rule: Dev Setup pages (under /dev) MUST use the .dui-* primitives in
dev/styles/dev-ui.css. Two checks enforce this:

  1. app/globals.css MUST NOT contain any `dev-*` or `dui-*` selectors.
     (Per-page bespoke classes leaked into globals.css over five
     generations of dev panels — globals.css is for user-facing pages.)

  2. Files under dev/ MUST NOT import app/globals.css.
     (Next.js loads globals.css automatically; dev panels only need
     dev/styles/dev.css + dev/styles/dev-ui.css.)

Exit 0 = clean. Exit 1 = one or more violations found.
Output is line-oriented so the Reports panel can render it as a row
labelled "dev-css".
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
GLOBALS_CSS = ROOT / "app" / "globals.css"
DEV_DIR = ROOT / "dev"

# Match `.dev-<word>` or `.dui-<word>` selectors at column-1 or after
# whitespace/comma/combinator. The trailing char-class stops at the
# first non-identifier char so we don't trip on `--dev-foo` token names
# (those start with `--`, not `.`).
SELECTOR_RE = re.compile(r"(?:^|[\s,>+~{])\.((?:dev|dui)-[A-Za-z0-9_-]+)")

# Match `import "...globals.css"`, `import '...globals.css'`,
# `@import "...globals.css"`, or relative paths ending in `app/globals.css`.
IMPORT_RE = re.compile(
    r"""
    (?:^|\s)
    (?:import|@import)
    \s+
    ["']
    ([^"']*?app/globals\.css|@/app/globals\.css)
    ["']
    """,
    re.VERBOSE | re.MULTILINE,
)


def scan_globals_css() -> list[tuple[int, str]]:
    """Return list of (lineno, selector) hits in app/globals.css."""
    hits: list[tuple[int, str]] = []
    if not GLOBALS_CSS.exists():
        return hits
    text = GLOBALS_CSS.read_text(errors="ignore")
    for lineno, line in enumerate(text.splitlines(), start=1):
        # Strip comments to avoid false hits in `/* .dev-foo */`.
        stripped = re.sub(r"/\*.*?\*/", "", line)
        for m in SELECTOR_RE.finditer(stripped):
            hits.append((lineno, m.group(1)))
    return hits


def scan_dev_imports() -> list[tuple[pathlib.Path, int, str]]:
    """Return list of (path, lineno, import_target) for dev/ files importing globals.css."""
    hits: list[tuple[pathlib.Path, int, str]] = []
    if not DEV_DIR.exists():
        return hits
    for ext in ("*.tsx", "*.ts", "*.css", "*.jsx", "*.js"):
        for path in DEV_DIR.rglob(ext):
            if "node_modules" in path.parts or ".next" in path.parts:
                continue
            text = path.read_text(errors="ignore")
            for m in IMPORT_RE.finditer(text):
                lineno = text.count("\n", 0, m.start()) + 1
                hits.append((path, lineno, m.group(1)))
    return hits


def write_report(globals_hits, import_hits) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-dev-css"

    checks = []

    for ln, sel in globals_hits:
        checks.append({
            "status": "fail",
            "label": f"app/globals.css:{ln}",
            "detail": f"`.{sel}` selector — move to dev/styles/dev-ui.css under .dui-* namespace",
        })

    for path, ln, target in import_hits:
        rel = str(path.relative_to(ROOT))
        checks.append({
            "status": "fail",
            "label": f"{rel}:{ln}",
            "detail": f"imports {target} — dev panels load dev/styles/dev.css + dev-ui.css only",
        })

    if not globals_hits and not import_hits:
        checks.append({
            "status": "pass",
            "label": "lint:dev-css",
            "detail": "no dev-* / dui-* selectors in app/globals.css and no dev/ imports of app/globals.css",
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
        "scopeName": "dev-css",
        "flag": "lint:dev-css",
        "timestamp": now.replace(microsecond=0).isoformat(),
        "checks": checks,
        "summary": summary,
    }

    out = reports_dir / f"{ts_id}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")


def main() -> int:
    globals_hits = scan_globals_css()
    import_hits = scan_dev_imports()

    if "--report" in sys.argv[1:]:
        write_report(globals_hits, import_hits)

    total = len(globals_hits) + len(import_hits)

    if total == 0:
        print("[lint:dev-css] OK — app/globals.css clean of dev-*/dui-* selectors; no dev/ files import app/globals.css.")
        return 0

    print(f"[lint:dev-css] FAIL — {total} violation(s):")
    if globals_hits:
        print(f"  {len(globals_hits)} dev-*/dui-* selector(s) in app/globals.css:")
        for ln, sel in globals_hits[:50]:
            print(f"    app/globals.css:{ln}: .{sel} — move to dev/styles/dev-ui.css")
        if len(globals_hits) > 50:
            print(f"    … and {len(globals_hits) - 50} more")
    if import_hits:
        print(f"  {len(import_hits)} dev/ file(s) importing app/globals.css:")
        for path, ln, target in import_hits:
            rel = path.relative_to(ROOT)
            print(f"    {rel}:{ln}: imports {target}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
