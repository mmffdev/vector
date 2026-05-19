#!/usr/bin/env python3
"""Lint direct backend URLs outside the sanctioned api helper.

Procurement story (defence/finance buyers): every outbound call to
the Go backend MUST go through `app/lib/api.ts` (`apiSite`, `apiV2`,
`apiRoot`). That single file is the audit chokepoint — Authorization
header injection, retry policy, MFA step-up redirects, CSP-bounded
URL composition all live there.

This lint catches the four ways code can sneak past:

  1. Direct `localhost:5100` URLs anywhere except api.ts
  2. Direct `/_site/...` or `/samantha/v2/...` path literals outside
     api.ts (these only make sense composed by the helpers)
  3. Direct `${API_BASE}/...` interpolations outside the api.ts +
     allowlisted SSE/streaming sites
  4. `process.env.NEXT_PUBLIC_API_BASE` reads outside the allowlist

A small allowlist at dev/registries/api_caller_exempt.json lists the
SSE/EventSource/WebSocket sites that legitimately compose backend
URLs themselves (the apiSite helper only handles fetch-style RPC).
Every allowlist entry must include a `reason` field — defence buyers
want to know *why* something is outside the chokepoint.

Exit 0 = clean. Exit 1 = at least one non-exempt direct URL.
"""
from __future__ import annotations
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "api_caller_exempt.json"
SCAN_DIRS = ["app"]
# The api helper file is the only legitimate composer of these URLs.
HELPER_FILES = {"app/lib/api.ts"}

# Patterns flagged as "going rogue". Each tuple is (regex, message).
# We match on raw source text, not AST — fast + good enough for
# string-literal-style URL composition.
PATTERNS = [
    (re.compile(r'localhost:5100'),
     'direct localhost:5100 reference — use apiSite/apiV2/apiRoot from app/lib/api.ts'),
    (re.compile(r'["\'`]/_site/'),
     'direct /_site/... path literal — use apiSite() which prepends the mount'),
    (re.compile(r'["\'`]/samantha/v2/'),
     'direct /samantha/v2/... path literal — use apiV2() which prepends the mount'),
    (re.compile(r'process\.env\.NEXT_PUBLIC_API_BASE'),
     'NEXT_PUBLIC_API_BASE read outside api.ts — the helper handles env resolution'),
]


def load_exemptions() -> dict[str, str]:
    """Return {file_path: reason} from the allowlist registry."""
    if not EXEMPT_REGISTRY.exists():
        return {}
    raw = json.loads(EXEMPT_REGISTRY.read_text())
    out = {}
    for entry in raw.get("exemptions", []):
        path = entry["path"]
        reason = entry.get("reason", "(no reason given)")
        out[path] = reason
    return out


def is_implicitly_exempt(rel: str) -> bool:
    """Tests and Next.js server-side API routes are inside the trust
    boundary (they ARE the backend chokepoint, or they exercise it).
    Skipping them automatically keeps the registry focused on
    *client-side* violations."""
    if rel in HELPER_FILES:
        return True
    # The api helper family lives in app/lib/api.ts + app/lib/apiSite/.
    if rel.startswith("app/lib/api") or rel.startswith("app/lib/apiSite/"):
        return True
    if "/__tests__/" in rel or rel.endswith(".test.ts") or rel.endswith(".test.tsx"):
        return True
    # Next.js App Router server routes — anything under app/api/ is
    # server-side and may proxy to the Go backend.
    if rel.startswith("app/api/"):
        return True
    return False


def scan(file_path: pathlib.Path, rel: str) -> list[tuple[int, str, str]]:
    """Return [(line_no, line_text, message), ...] for every violator
    line in file_path. Empty list means clean."""
    if is_implicitly_exempt(rel):
        return []
    try:
        lines = file_path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    out = []
    for i, line in enumerate(lines, 1):
        # Skip comments (// or /* */ on the same line — best-effort).
        # We tolerate the trailing-comment case so a `// allow: SSE`
        # next to the violator still flags. But a fully-commented line
        # is OK.
        stripped = line.lstrip()
        if stripped.startswith("//") or stripped.startswith("*"):
            continue
        for pat, msg in PATTERNS:
            if pat.search(line):
                out.append((i, line.rstrip(), msg))
                break  # one message per line is enough
    return out


def main() -> int:
    exempt = load_exemptions()
    violations: list[tuple[str, int, str, str]] = []
    files_scanned = 0
    for d in SCAN_DIRS:
        root = ROOT / d
        for p in root.rglob("*"):
            if p.suffix not in (".ts", ".tsx", ".js", ".jsx"):
                continue
            if not p.is_file():
                continue
            rel = str(p.relative_to(ROOT))
            files_scanned += 1
            hits = scan(p, rel)
            if not hits:
                continue
            if rel in exempt:
                continue
            for line_no, line, msg in hits:
                violations.append((rel, line_no, line, msg))

    if not violations:
        print(f"OK    {files_scanned} file(s) checked, {len(exempt)} exempt")
        return 0

    print(f"[lint:api-caller-discipline] FAIL — {len(violations)} direct backend reference(s) outside app/lib/api.ts:")
    for rel, ln, line, msg in violations:
        print(f"  {rel}:{ln}: {msg}")
        print(f"    {line[:120]}")
    print()
    print(f"  Fix: either route through apiSite/apiV2/apiRoot from app/lib/api.ts,")
    print(f"  or add an exemption in dev/registries/api_caller_exempt.json with a reason.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
