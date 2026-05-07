#!/usr/bin/env python3
"""Lint portfolio-library-read: PLA-0026 / Story 00512.

Rule: after the per-workspace portfolio adoption cutover, tenant runtime
code MUST NOT read directly from the library. The post-cutover invariant
is:

    Tenant pages / handlers read tenant data from `vector_artefacts`.
    The library (mmff_library) is consulted at adoption time inside the
    saga and never again.

This lint locks that invariant. It scans the codebase for the live
library-read patterns and fails if a tenant-side file consumes them
outside the small set of allowed packages (the saga itself, the library
admin pages, the library-releases announcement channel, and the
librarydb infrastructure layer).

Forbidden patterns:

    Frontend (app/**/*.{ts,tsx}):
        '/api/library/'            — any live-library REST read
        '/api/portfolio-templates/'— legacy portfolio-template read

    Backend (backend/internal/**/*.go):
        'mmff_library'             — connection-string reference,
                                     except inside `internal/librarydb/`

Default-exempt directories (the saga + the library admin surface):

    app/(library-admin)/**                        (forward-compatible)
    app/(user)/admin/**                           (gadmin admin surface)
    app/(user)/library-releases/**                (release-notification UI)
    app/contexts/LibraryReleasesContext.tsx       (release-notification poll)
    app/components/LibraryReleaseBadge.tsx        (release-notification badge)
    backend/internal/librarydb/**                 (the connection pool itself)
    backend/internal/portfoliomodels/**           (the adoption saga)
    backend/internal/libraryreleases/**           (release-notification handler)
    backend/internal/errorsreport/**              (error_codes lookup — adoption-adjacent)

Per-file exemption ledger lives at
`dev/registries/lint_portfolio_library_read_exemptions.json`. The ledger
is a one-way ratchet that only ever shrinks — once a file leaves the
ledger no one can silently reintroduce a library read.

Exit 0 = clean. Exit 1 = one or more rogue library reads detected.
Output is line-oriented for the Reports panel (renders as
"portfolio-library-read" row).
"""
from __future__ import annotations
import argparse
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = (
    ROOT / "dev" / "registries" / "lint_portfolio_library_read_exemptions.json"
)

# Frontend scan roots — every tenant-facing TypeScript / TSX file.
FRONTEND_SCAN_DIRS = ["app"]

# Backend scan roots — every Go file under backend/internal/.
BACKEND_SCAN_DIRS = ["backend/internal"]

# Default-exempt directories. Any file under these paths is allowed to
# reference a forbidden pattern. The saga and the library admin surface
# legitimately read the library; tenant runtime does not.
DEFAULT_EXEMPT_DIRS: tuple[str, ...] = (
    "app/(library-admin)",
    "app/(user)/admin",
    "app/(user)/library-releases",
    "backend/internal/librarydb",
    "backend/internal/portfoliomodels",
    "backend/internal/libraryreleases",
    "backend/internal/errorsreport",
)

# Default-exempt individual files. Library-releases poll loop and badge
# render the announcement channel — they sit at the tenant layer but are
# part of the release-notification feature, not artefact reads.
DEFAULT_EXEMPT_FILES: tuple[str, ...] = (
    "app/contexts/LibraryReleasesContext.tsx",
    "app/components/LibraryReleaseBadge.tsx",
)

# Frontend forbidden URL prefixes. Match as quoted string literals so we
# don't trip on comments. The detector handles single quote, double
# quote, and backtick (template-literal) delimiters.
FRONTEND_PATTERNS: dict[str, re.Pattern[str]] = {
    "/api/library/": re.compile(r"""['"`](/api/library/[^'"`]*)['"`]"""),
    "/api/portfolio-templates/": re.compile(
        r"""['"`](/api/portfolio-templates/[^'"`]*)['"`]"""
    ),
}

# Backend forbidden token. `mmff_library` appears in connection strings,
# log messages, comments, etc. We flag every occurrence and let the
# default-exempt directories filter the legitimate ones.
BACKEND_PATTERN: re.Pattern[str] = re.compile(r"\bmmff_library\b")


def _norm(rel: str) -> str:
    return rel.replace("\\", "/")


def is_default_exempt(rel_path: str) -> bool:
    """True if rel_path lives under any default-exempt dir or is a
    default-exempt file."""
    norm = _norm(rel_path)
    for d in DEFAULT_EXEMPT_DIRS:
        prefix = d.rstrip("/") + "/"
        if norm == d or norm.startswith(prefix):
            return True
    return norm in DEFAULT_EXEMPT_FILES


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(p) for p in data.get("exempt_paths", [])}


def _strip_line_comment(line: str) -> str:
    """Remove `// …` line-comment tail (best-effort, ignores // inside
    strings — good enough for lint-string detection)."""
    in_str: str | None = None
    i = 0
    while i < len(line):
        ch = line[i]
        if in_str is None:
            if ch in ("'", '"', "`"):
                in_str = ch
            elif ch == "/" and i + 1 < len(line) and line[i + 1] == "/":
                return line[:i]
        else:
            if ch == "\\" and i + 1 < len(line):
                i += 2
                continue
            if ch == in_str:
                in_str = None
        i += 1
    return line


def scan_frontend() -> list[tuple[pathlib.Path, int, str, str]]:
    """Return list of (path, line, pattern, snippet) for frontend hits."""
    hits: list[tuple[pathlib.Path, int, str, str]] = []
    for sub in FRONTEND_SCAN_DIRS:
        base = ROOT / sub
        if not base.exists():
            continue
        for ext in ("*.ts", "*.tsx"):
            for path in base.rglob(ext):
                if "node_modules" in path.parts or ".next" in path.parts:
                    continue
                if path.name.endswith(".d.ts"):
                    continue
                try:
                    text = path.read_text(errors="ignore")
                except OSError:
                    continue
                for line_no, line in enumerate(text.splitlines(), start=1):
                    body = _strip_line_comment(line)
                    stripped = body.lstrip()
                    if stripped.startswith("*") or stripped.startswith("/*"):
                        continue
                    for label, pat in FRONTEND_PATTERNS.items():
                        m = pat.search(body)
                        if not m:
                            continue
                        snippet = line.strip()[:80]
                        hits.append((path, line_no, label, snippet))
    return hits


def scan_backend() -> list[tuple[pathlib.Path, int, str, str]]:
    """Return list of (path, line, pattern, snippet) for backend hits."""
    hits: list[tuple[pathlib.Path, int, str, str]] = []
    for sub in BACKEND_SCAN_DIRS:
        base = ROOT / sub
        if not base.exists():
            continue
        for path in base.rglob("*.go"):
            if "vendor" in path.parts or "node_modules" in path.parts:
                continue
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
                if BACKEND_PATTERN.search(line):
                    snippet = line.strip()[:80]
                    hits.append((path, line_no, "mmff_library", snippet))
    return hits


def write_report(failing, warned, hits) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-portfolio-library-read"

    checks: list[dict] = []

    for p, ln, pattern, snippet in warned:
        rel = str(p.relative_to(ROOT))
        checks.append({
            "status": "warn",
            "label": f"{rel}:{ln}",
            "detail": f"exempt — {pattern} — {snippet}",
        })

    for p, ln, pattern, snippet in failing:
        rel = str(p.relative_to(ROOT))
        checks.append({
            "status": "fail",
            "label": f"{rel}:{ln}",
            "detail": (
                f"tenant-side library read — {pattern} — "
                f"read tenant artefacts via vector_artefacts only — {snippet}"
            ),
        })

    if not failing and not warned:
        checks.append({
            "status": "pass",
            "label": "lint:portfolio-library-read",
            "detail": "no tenant-side library reads found across app/ + backend/internal/",
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
        "scopeName": "portfolio-library-read",
        "flag": "lint:portfolio-library-read",
        "timestamp": now.replace(microsecond=0).isoformat(),
        "checks": checks,
        "summary": summary,
    }

    out = reports_dir / f"{ts_id}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Fail when tenant-side code reads from the live library. "
            "Tenant runtime reads vector_artefacts only; the library is "
            "consulted at adoption time inside the saga and never again."
        )
    )
    parser.add_argument(
        "--report",
        action="store_true",
        help="write a structured JSON report to dev/reports/",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="emit JSON envelope on stdout for CI integration",
    )
    args = parser.parse_args()

    exempt_files = load_exemptions()

    raw_hits = scan_frontend() + scan_backend()

    failing: list[tuple[pathlib.Path, int, str, str]] = []
    warned: list[tuple[pathlib.Path, int, str, str]] = []
    for path, lineno, pattern, snippet in raw_hits:
        rel = _norm(str(path.relative_to(ROOT)))
        if is_default_exempt(rel):
            continue  # default-exempt is silent — not a violation, not a warning
        if rel in exempt_files:
            warned.append((path, lineno, pattern, snippet))
            continue
        failing.append((path, lineno, pattern, snippet))

    if args.report:
        write_report(failing, warned, raw_hits)

    if args.json:
        envelope = {
            "flag": "lint:portfolio-library-read",
            "exit": 1 if failing else 0,
            "summary": {
                "fail": len(failing),
                "warn": len(warned),
                "scanned_dirs_frontend": FRONTEND_SCAN_DIRS,
                "scanned_dirs_backend": BACKEND_SCAN_DIRS,
                "default_exempt_dirs": list(DEFAULT_EXEMPT_DIRS),
                "default_exempt_files": list(DEFAULT_EXEMPT_FILES),
                "ledger_exempt_count": len(exempt_files),
            },
            "violations": [
                {
                    "file": _norm(str(p.relative_to(ROOT))),
                    "line": ln,
                    "pattern": pat,
                    "snippet": snip,
                }
                for (p, ln, pat, snip) in failing
            ],
            "warnings": [
                {
                    "file": _norm(str(p.relative_to(ROOT))),
                    "line": ln,
                    "pattern": pat,
                    "snippet": snip,
                }
                for (p, ln, pat, snip) in warned
            ],
        }
        print(json.dumps(envelope, indent=2))
        return 1 if failing else 0

    if not failing:
        print(
            f"[lint:portfolio-library-read] OK — {len(raw_hits)} match(es) total; "
            f"{len(warned)} ledger-exempt, {len(exempt_files)} ledger entries; "
            f"{len(DEFAULT_EXEMPT_DIRS)} default-exempt dir(s)."
        )
        return 0

    print(
        f"[lint:portfolio-library-read] FAIL — {len(failing)} tenant-side library read(s) found:"
    )
    for path, lineno, pattern, snippet in failing:
        rel = path.relative_to(ROOT)
        print(
            f"  {rel}:{lineno}: {pattern} — read tenant artefacts via "
            f"vector_artefacts only — {snippet}"
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
