#!/usr/bin/env python3
"""Lint no-empty-route-block: every r.Route(...) block must mount handlers.

PLA-0048 / RF1.1.2. On 2026-05-13 we discovered a `r.Route("/samantha/v1",
func(r chi.Router) { ... })` block in main.go that had survived for weeks
with ZERO verb registrations inside — only apikeys.Middleware and a
Deprecation/Sunset/Link header middleware running on 404 traffic. Existing
gates (check_routes.sh) didn't catch it because the script only walks
r.Get/Post/... verbs; an empty Route block emits zero paths.

This lint walks the Go source AST-lite (brace-tracking parser) and flags
any `r.Route("...", func(r chi.Router) { ... })` whose body contains
zero verb calls.

Scan scope: backend/cmd/server/main.go and any backend/**/routes*.go.

Exit 0 = clean. Exit 1 = at least one empty Route block.
"""
from __future__ import annotations
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCAN_PATHS = [
    ROOT / "backend" / "cmd" / "server" / "main.go",
]
# Also scan any *_routes.go files in backend/
SCAN_GLOBS = ["backend/**/routes*.go", "backend/**/*_routes.go"]

# Match r.Route("...", func(r chi.Router) {
ROUTE_OPEN = re.compile(
    r'\br\.Route\(\s*"([^"]+)"\s*,\s*func\s*\(\s*r\s+chi\.Router\s*\)\s*\{'
)
# Verb registrations that count as "real handlers"
VERB_RE = re.compile(
    r'\br\.(?:Get|Post|Put|Patch|Delete|Head|Options|Method|Handle|Mount)\s*\('
)
# Nested r.Route also counts as a real mount (it'll be checked recursively)
NESTED_ROUTE_RE = re.compile(r'\br\.Route\s*\(')
# Group is also a real container
GROUP_RE = re.compile(r'\br\.Group\s*\(')


def strip_comments_and_strings(src: str) -> str:
    """Strip Go comments and string-literal contents so brace counting and
    verb matching don't false-match on text inside comments/strings."""
    out = []
    i = 0
    n = len(src)
    while i < n:
        # Line comment
        if src[i:i+2] == "//":
            nl = src.find("\n", i)
            if nl == -1:
                break
            out.append("\n")
            i = nl + 1
            continue
        # Block comment
        if src[i:i+2] == "/*":
            end = src.find("*/", i + 2)
            if end == -1:
                break
            out.append(" ")
            i = end + 2
            continue
        # Raw string
        if src[i] == "`":
            end = src.find("`", i + 1)
            if end == -1:
                break
            out.append('""')  # placeholder so the surrounding code keeps its shape
            i = end + 1
            continue
        # Interpreted string
        if src[i] == '"':
            j = i + 1
            while j < n and src[j] != '"':
                if src[j] == "\\" and j + 1 < n:
                    j += 2
                    continue
                if src[j] == "\n":
                    break
                j += 1
            out.append('""')
            i = j + 1
            continue
        out.append(src[i])
        i += 1
    return "".join(out)


def find_route_blocks(src: str) -> list[tuple[str, int, str]]:
    """Return list of (path, line_no, body_text) for every r.Route(...) call.
    The body is the source between the matching '{' and '}'."""
    src = strip_comments_and_strings(src)
    blocks: list[tuple[str, int, str]] = []
    for m in ROUTE_OPEN.finditer(src):
        path = m.group(1)
        line_no = src.count("\n", 0, m.start()) + 1
        # Find the matching close brace starting at the '{' just matched.
        open_pos = src.find("{", m.end() - 1)
        if open_pos == -1:
            continue
        depth = 1
        i = open_pos + 1
        while i < len(src) and depth > 0:
            ch = src[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            i += 1
        close_pos = i - 1
        body = src[open_pos + 1:close_pos]
        blocks.append((path, line_no, body))
    return blocks


def block_has_real_handler(body: str) -> bool:
    return bool(
        VERB_RE.search(body)
        or NESTED_ROUTE_RE.search(body)
        or GROUP_RE.search(body)
    )


def scan_file(path: pathlib.Path) -> list[tuple[str, int]]:
    """Return list of (route_path, line_no) for empty Route blocks."""
    try:
        src = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return []
    empty: list[tuple[str, int]] = []
    for route_path, line_no, body in find_route_blocks(src):
        if not block_has_real_handler(body):
            empty.append((route_path, line_no))
    return empty


def discover_files() -> list[pathlib.Path]:
    files: list[pathlib.Path] = []
    for p in SCAN_PATHS:
        if p.exists():
            files.append(p)
    for pattern in SCAN_GLOBS:
        for p in ROOT.glob(pattern):
            if p.is_file() and not p.name.endswith("_test.go"):
                files.append(p)
    return list(dict.fromkeys(files))  # dedupe, preserve order


def main() -> int:
    violations: list[tuple[pathlib.Path, str, int]] = []
    files = discover_files()
    if not files:
        print("lint:no-empty-route-block: no scan targets found; skipping.")
        return 0
    for path in files:
        for route_path, line_no in scan_file(path):
            violations.append((path, route_path, line_no))

    if not violations:
        print(f"lint:no-empty-route-block OK — 0 empty Route blocks across {len(files)} file(s).")
        return 0

    print("lint:no-empty-route-block FAIL\n", file=sys.stderr)
    print(
        "These r.Route(...) blocks have zero handler registrations inside.\n"
        "Either mount handlers in the block, or delete the block (and its middleware).\n",
        file=sys.stderr,
    )
    for path, route_path, line_no in violations:
        rel = path.relative_to(ROOT).as_posix()
        print(f"  - {rel}:{line_no} — empty block at r.Route(\"{route_path}\", ...)", file=sys.stderr)
    print(f"\n{len(violations)} empty Route block(s) in violation.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
