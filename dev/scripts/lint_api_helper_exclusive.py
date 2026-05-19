#!/usr/bin/env python3
"""Lint bare fetch()/XMLHttpRequest()/WebSocket()/EventSource()
outside the sanctioned api helper.

This is the AST-level companion to `lint_api_caller_discipline.py`.
Caller-discipline catches direct *URLs*; this catches direct
*network-call primitives*. Together they make sure every outbound
call to the backend is composed by `app/lib/api.ts` (or the
allowlisted SSE sites).

What's flagged:

  - `fetch(` outside the api helper family — even with relative URLs.
    Relative URLs hit the Next.js dev server, which is allowed when
    the destination is `/api/...` (Next.js route handlers under our
    control). To distinguish: relative URLs starting with `/api/`
    are OK; everything else needs to go through apiSite.
  - `new XMLHttpRequest(` — legacy, never used in this codebase;
    if it shows up, flag it.
  - `new WebSocket(` / `new EventSource(` outside the SSE/realtime
    exemption list.

What's NOT flagged:

  - `refetch(`, `fetcher(`, `prefetch(` — local React hooks/helpers.
  - `fetch(` inside test fixtures.
  - `fetch(` inside Next.js `app/api/` server routes (server-side
    fetch is fine — those ARE the proxy).

The allowlist lives at the same file as caller-discipline:
`dev/registries/api_caller_exempt.json`.

Exit 0 = clean. Exit 1 = at least one non-exempt call.
"""
from __future__ import annotations
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "api_caller_exempt.json"
SCAN_DIRS = ["app"]

# Catch a bare `fetch(` call (word boundary before `f` so we skip
# `refetch`, `prefetch`, `fetcher`). Anchored to capture the leading
# context so we can heuristically distinguish backend calls from
# Next.js-relative ones.
FETCH_RE = re.compile(r'(?<![A-Za-z_])fetch\(\s*([^)]*?)(?:\)|,)')
XHR_RE = re.compile(r'new\s+XMLHttpRequest\b')
WS_RE = re.compile(r'new\s+WebSocket\b')
SSE_RE = re.compile(r'new\s+EventSource\b')


def load_exemptions() -> set[str]:
    if not EXEMPT_REGISTRY.exists():
        return set()
    raw = json.loads(EXEMPT_REGISTRY.read_text())
    return {e["path"] for e in raw.get("exemptions", [])}


def is_implicitly_exempt(rel: str) -> bool:
    if rel.startswith("app/lib/api") or rel.startswith("app/lib/apiSite/"):
        return True
    if "/__tests__/" in rel or rel.endswith(".test.ts") or rel.endswith(".test.tsx"):
        return True
    if rel.startswith("app/api/"):
        return True
    return False


def first_arg_targets_backend(arg: str) -> bool:
    """Heuristically decide whether a fetch() first arg points at code
    that must go through apiSite, or at a sanctioned exception.

    Two classes of `/api/...` URL exist in this repo:

      - **Sanctioned shadow** (file-only Next.js handlers — research,
        retros, plans, scope, operations, etc.). These are gadmin-only
        dev-panel data sources that read repo files, not the DB. The
        full list lives in dev/scripts/audit_api_touchpoints.sh's
        SANCTIONED_SHADOW_PATHS array; the contract is documented in
        docs/c_c_shadow_backend_exceptions.md.

      - **DB-touching shadow** (`/api/dev/artefact-types/*`,
        `/api/v2/work-items/relations`, anything pg-direct). These ARE
        the bypass the rule was written to ban. They MUST migrate to
        a Go handler under `/_site/*` and call via apiSite.

    OK (returns False):
      - sanctioned-shadow `/api/dev/<area>` URLs (whitelist below)
      - data: / blob: URLs
      - file:// URLs

    NOT OK (returns True):
      - any explicit localhost:5100 / _site / samantha/v2 reference
      - any non-sanctioned `/api/dev/...` or `/api/v2/...` URL
      - URL constructed from API_BASE / NEXT_PUBLIC_API_BASE
      - absolute http URLs (likely external; could still be a bypass)
    """
    a = arg.strip()
    if not a:
        return False  # empty / variable — let caller-discipline handle string-literal checks
    # Strip surrounding quotes/backticks for static analysis.
    stripped = a.strip("'\"`")
    # data:/blob:/file: URLs — never a backend call.
    if stripped.startswith("data:") or stripped.startswith("blob:") or stripped.startswith("file:"):
        return False
    # Sanctioned shadow paths — file-only handlers, no DB touch. Mirrors
    # the SANCTIONED_SHADOW_PATHS array in audit_api_touchpoints.sh. Keep
    # the two lists in sync; any path in the audit's allowlist MUST also
    # be in this prefix tuple (and vice-versa).
    sanctioned_shadow_prefixes = (
        "/api/dev/api-changelog",
        "/api/dev/library",
        "/api/dev/memory-reports",
        "/api/dev/operations",
        "/api/dev/plans",
        "/api/dev/research",
        "/api/dev/retros",
        "/api/dev/scope",
        "/api/dev/security-audits",
        "/api/dev/services",
        "/api/dev/go-test",
    )
    if stripped.startswith(sanctioned_shadow_prefixes):
        return False
    # Non-sanctioned shadow routes are DB-touching bypasses — flag.
    if stripped.startswith("/api/dev/") or stripped.startswith("/api/v2/"):
        return True
    if stripped.startswith("/_site/") or stripped.startswith("/samantha/v2/"):
        return True
    if "localhost:5100" in a or "API_BASE" in a or "NEXT_PUBLIC_API_BASE" in a:
        return True
    # Template literals — check the literal prefix.
    if a.startswith("`/api/dev/") or a.startswith("`/api/v2/"):
        # Re-strip and re-check against sanctioned list.
        tl_stripped = a.strip("`")
        if tl_stripped.startswith(sanctioned_shadow_prefixes):
            return False
        return True
    if a.startswith("`/api/"):
        return False
    # External absolute URLs — flag (could be CSRF / SSRF surface).
    if stripped.startswith("http://") or stripped.startswith("https://"):
        return True
    # Bare relative URL or variable — assume OK; caller-discipline
    # catches the string-literal cases independently.
    return False


def scan(file_path: pathlib.Path, rel: str, exempt: set[str]) -> list[tuple[int, str, str]]:
    if is_implicitly_exempt(rel) or rel in exempt:
        return []
    try:
        lines = file_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    out = []
    for i, line in enumerate(lines, 1):
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        if XHR_RE.search(line):
            out.append((i, line.rstrip(), "XMLHttpRequest not allowed — use apiSite/apiV2/apiRoot"))
            continue
        if WS_RE.search(line):
            out.append((i, line.rstrip(), "new WebSocket() — add an exemption in api_caller_exempt.json with a reason"))
            continue
        if SSE_RE.search(line):
            out.append((i, line.rstrip(), "new EventSource() — add an exemption in api_caller_exempt.json with a reason"))
            continue
        m = FETCH_RE.search(line)
        if m:
            arg = m.group(1)
            if first_arg_targets_backend(arg):
                out.append((i, line.rstrip(),
                            f"fetch() with backend-targeted URL — use apiSite/apiV2/apiRoot. First arg: {arg.strip()[:60]}"))
    return out


def main() -> int:
    exempt = load_exemptions()
    violations: list[tuple[str, int, str, str]] = []
    files_scanned = 0
    files_exempt = 0
    for d in SCAN_DIRS:
        root = ROOT / d
        for p in root.rglob("*"):
            if p.suffix not in (".ts", ".tsx", ".js", ".jsx"):
                continue
            if not p.is_file():
                continue
            rel = str(p.relative_to(ROOT))
            files_scanned += 1
            if rel in exempt or is_implicitly_exempt(rel):
                files_exempt += 1
            hits = scan(p, rel, exempt)
            for line_no, line, msg in hits:
                violations.append((rel, line_no, line, msg))

    if not violations:
        print(f"OK    {files_scanned} file(s) checked, {files_exempt} exempt")
        return 0

    print(f"[lint:api-helper-exclusive] FAIL — {len(violations)} bare network call(s) outside app/lib/api.ts:")
    for rel, ln, line, msg in violations:
        print(f"  {rel}:{ln}: {msg}")
        print(f"    {line[:120]}")
    print()
    print(f"  Fix: route through apiSite/apiV2/apiRoot from app/lib/api.ts,")
    print(f"  or add an exemption in dev/registries/api_caller_exempt.json with a reason.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
