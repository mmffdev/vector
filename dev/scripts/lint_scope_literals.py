#!/usr/bin/env python3
"""Lint hard-coded artefact scope literals in artefactitems (PLA-0037 / B21).

Rule: inside `backend/internal/artefactitems/`, the strings `'work'` and
`'strategy'` MUST NOT appear as SQL literals. The Service struct carries a
`scope` field that is bound through query parameters — handlers that bake
the literal into SQL silently leak scope across endpoints.

    DEPRECATED  →  WHERE at.scope = 'work'
    REPLACEMENT →  WHERE at.scope = $N   (with s.scope as the bound arg)

The detector scans every .go file under backend/internal/artefactitems
and flags lines that contain `'work'` or `'strategy'` (or `"work"` /
`"strategy"`) outside an explicitly-allowed context:

  - The Service struct definition (`scope string`)
  - The package's tests (file ends with `_test.go`) — tests legitimately
    seed both scopes for assertions
  - Lines beginning with `//` (comments)
  - The validItemTypesByScope map keys in types.go (the canonical scope
    registry — exactly the place where these literals are allowed)

False positives can be parked in `dev/registries/scope_literals_exempt.json`
(`exempt_paths` list — relative to repo root).

Exit 0 = clean. Exit 1 = one or more raw scope-literal SQL fragments remain.
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "scope_literals_exempt.json"
SCAN_DIR = ROOT / "backend" / "internal" / "artefactitems"

# Match the literal strings 'work' or 'strategy' (single or double quoted) as
# whole words. Trailing comma/paren/space allowed.
SCOPE_LITERAL_RE = re.compile(r"""['"](work|strategy)['"]""")

# Allow-list filenames: types.go owns the canonical registry; the Service
# struct definition / scope field also legitimately mention these strings.
ALLOWED_TYPES_GO_LINES = re.compile(
    r"""validItemTypesByScope|"work":\s*\{|"strategy":\s*nil|//"""
)


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(p) for p in data.get("exempt_paths", [])}


def scan() -> list[tuple[pathlib.Path, int, str]]:
    hits: list[tuple[pathlib.Path, int, str]] = []
    if not SCAN_DIR.exists():
        return hits
    for path in SCAN_DIR.rglob("*.go"):
        # Tests legitimately seed both scopes for assertions.
        if path.name.endswith("_test.go"):
            continue
        try:
            text = path.read_text(errors="ignore")
        except OSError:
            continue
        for line_no, line in enumerate(text.splitlines(), start=1):
            stripped = line.lstrip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            # types.go: the scope-keyed validator map is the canonical place
            # for these literals. Anything else in types.go still trips.
            if path.name == "types.go" and ALLOWED_TYPES_GO_LINES.search(line):
                continue
            for m in SCOPE_LITERAL_RE.finditer(line):
                lit = m.group(1)
                hits.append((path, line_no, f"'{lit}' literal in {path.name}"))
    return hits


def write_report(hits, exempt) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-scope-literals"

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
                "detail": f"hardcoded scope literal — bind via $N + s.scope — {sig}",
            })

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:scope-literals",
            "detail": f"no scope literals in {SCAN_DIR.relative_to(ROOT)}",
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
        "scopeName": "scope-literals",
        "flag": "lint:scope-literals",
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
        print(f"[lint:scope-literals] OK — {len(hits)} match(es), all exempt or in registry ({len(exempt)} exempt path(s)).")
        return 0

    print(f"[lint:scope-literals] FAIL — {len(failing)} hardcoded scope literal(s):")
    for path, lineno, sig in failing:
        rel = path.relative_to(ROOT)
        print(f"  {rel}:{lineno}: bind via $N + s.scope — {sig}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
