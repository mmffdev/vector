#!/usr/bin/env python3
"""extract_routes.py — Parse backend/cmd/server/main.go and emit the
live route catalogue as JSON for the BFF (/_site) and v2 (/samantha/v2)
transport tiers.

Outputs:
  /tmp/site_routes.json   { "/path": ["GET", "POST"], ... }
  /tmp/v2_routes.json     { "/path": ["GET", "POST"], ... }

Used by sync_specs.py to merge live Go truth into siteAPI.yaml +
samanthaAPI.yaml. The same closure-aware parser is also embedded in
check_routes.sh — kept in sync by hand because Bash can't share Python
across files easily. Any change here MUST be mirrored to check_routes.sh
or the gate and the sync command will disagree (lint trio TODO).

Closure handling:
  - NAME := func(r chi.Router) { ... }              — single-arg
  - NAME := func(r chi.Router, h *X) { ... }        — multi-arg
  - Nested closures (NAME declared inside another closure body)
  - Invocations NAME(r) or NAME(r, X) spliced under the current
    r.Route prefix stack.
  - Middleware chains: r.With(auth.Required).Get("/path") parses
    the path via verb_call_re regardless of intermediate .With() calls.

Run from repo root.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[2]
MAIN_GO = ROOT / "backend" / "cmd" / "server" / "main.go"


# ── Regexes ────────────────────────────────────────────────────────────────────

ROUTE_RE = re.compile(r'r\.Route\(\s*"([^"]+)"\s*,\s*func\s*\(\s*r\s+chi\.Router\s*\)\s*\{')
# Verb call: matches any `.Get("/path")`, `.Post("/path")` etc. tail.
# Anchors on the dot so middleware chains like
#   r.With(auth.RequirePermission(X, Y)).With(rateLimit).Get("/p")
# all resolve to the .Get part. Tolerates whitespace/newlines between
# the dot and the verb so multi-line chains like
#   r.With(authSvc.X).
#       Get("/users", h.List)
# parse correctly. The verb call itself uses a single string literal
# as the first arg.
VERB_CALL_RE = re.compile(r'\.\s*(Get|Post|Put|Patch|Delete|Head)\(\s*"([^"]+)"')
# Closure declaration: NAME := func(r chi.Router[, more args]) {
# The [^)]* allows trailing args (e.g. mountArtefactSite takes a handler).
CLOSURE_DECL_RE = re.compile(r'(\w+)\s*:=\s*func\s*\(\s*r\s+chi\.Router\b[^)]*\)\s*\{')
# Closure invocation: NAME(r) or NAME(r, X[, Y, ...])
# The optional trailing args are consumed up to the closing ).
CLOSURE_CALL_RE = re.compile(r'(\w+)\s*\(\s*r\s*(?:,\s*[^)]*)?\)')

# Mount-pattern call: someH.Mount(r) — the handler package defines a
# Mount(r chi.Router) method that registers all its routes. Without
# this, every route mounted via the Mount pattern (8 sites today) is
# invisible to the parser.
MOUNT_CALL_RE = re.compile(r'(\w+)\.Mount\(\s*r\s*\)')

# Handler-var declaration in main.go that we use to resolve the
# package for a mount call: usersH := users.NewHandler(...)
HANDLER_VAR_DECL_RE = re.compile(
    r'(?:^|\s)(\w+H[a-zA-Z]*?)\s*:?=\s*(\w+)\.NewHandler\(',
    re.MULTILINE,
)

# Go method definition for the Mount method on a Handler:
#   func (h *Handler) Mount(r chi.Router) {
MOUNT_METHOD_RE = re.compile(
    r'func\s*\(\s*\w+\s*\*?\s*\w+\s*\)\s*Mount\s*\(\s*r\s+chi\.Router\s*\)\s*\{'
)


# ── Go-aware skip helpers ──────────────────────────────────────────────────────

def skip_token(src: str, i: int, n: int) -> int | None:
    """Skip past one Go syntactic token at i (comment, string, rune).
    Returns the new index past the token, or None if i isn't the start
    of one."""
    if src[i:i + 2] == "//":
        nl = src.find("\n", i)
        return nl + 1 if nl != -1 else n
    if src[i:i + 2] == "/*":
        end = src.find("*/", i + 2)
        return end + 2 if end != -1 else n
    if src[i] == '"':
        j = i + 1
        while j < n and src[j] != '"':
            if src[j] == "\\" and j + 1 < n:
                j += 2
                continue
            if src[j] == "\n":
                break
            j += 1
        return j + 1
    if src[i] == "`":
        end = src.find("`", i + 1)
        return end + 1 if end != -1 else n
    if src[i] == "'":
        j = i + 1
        if j < n and src[j] == "\\" and j + 1 < n:
            j += 2
        else:
            j += 1
        if j < n and src[j] == "'":
            return j + 1
    return None


# ── Mount-method resolution ───────────────────────────────────────────────────


def build_handler_var_to_pkg(src: str) -> dict[str, str]:
    """Parse main.go to learn which package each handler var was
    constructed from. Used to resolve `usersH.Mount(r)` →
    backend/internal/users/."""
    out: dict[str, str] = {}
    for m in HANDLER_VAR_DECL_RE.finditer(src):
        var, pkg = m.group(1), m.group(2)
        if var not in out:
            out[var] = pkg
    return out


def find_mount_method(handler_var: str, var_to_pkg: dict[str, str]) -> tuple[str, int, int] | None:
    """Resolve `<handler_var>.Mount(r)` to the body text + (start, end)
    of the Mount method. Returns (file_src, body_start, body_end) or
    None. The body_start/end are positions inside the returned src
    suitable for parse_block."""
    pkg = var_to_pkg.get(handler_var)
    if not pkg:
        return None
    pkg_dir = ROOT / "backend" / "internal" / pkg
    if not pkg_dir.exists():
        return None
    for p in pkg_dir.glob("*.go"):
        if p.name.endswith("_test.go"):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        m = MOUNT_METHOD_RE.search(text)
        if not m:
            continue
        body_start = m.end()
        depth = 1
        j = body_start
        n = len(text)
        while j < n and depth > 0:
            nxt = skip_token(text, j, n)
            if nxt is not None:
                j = nxt
                continue
            if text[j] == "{":
                depth += 1
            elif text[j] == "}":
                depth -= 1
            j += 1
        return text, body_start, j - 1
    return None


# ── Closure body detection (pass 1) ───────────────────────────────────────────

def find_closure_bodies(src: str) -> dict[str, tuple[int, int]]:
    """Return {name: (body_start, body_end)} for every router closure
    declared in src. Scans nested closures too (continues inside each
    discovered body so declarations inside other closures are found)."""
    bodies: dict[str, tuple[int, int]] = {}
    n = len(src)
    i = 0
    while i < n:
        nxt = skip_token(src, i, n)
        if nxt is not None:
            i = nxt
            continue
        m = CLOSURE_DECL_RE.match(src[i:i + 300])
        if m:
            body_start = i + m.end()
            j = body_start
            bdepth = 1
            while j < n and bdepth > 0:
                nxt2 = skip_token(src, j, n)
                if nxt2 is not None:
                    j = nxt2
                    continue
                if src[j] == "{":
                    bdepth += 1
                elif src[j] == "}":
                    bdepth -= 1
                j += 1
            bodies[m.group(1)] = (body_start, j - 1)
            # Advance into body so nested closures are also found.
            i = body_start
            continue
        i += 1
    return bodies


# ── Route walking ─────────────────────────────────────────────────────────────

def parse_block(
    src: str,
    start: int,
    end: int,
    prefix_stack: list[tuple[str, int]],
    closure_bodies: dict[str, tuple[int, int]],
    var_to_pkg: dict[str, str] | None = None,
) -> set[tuple[str, str]]:
    """Walk src[start:end] tracking r.Route prefix stack and emit
    (METHOD, full_path) for every verb call. Parent stack entries are
    pinned with depth=-1 so the local brace-pop logic never removes
    them. `var_to_pkg` is the handler-var → package map used to
    resolve `someH.Mount(r)` calls."""
    routes: set[tuple[str, str]] = set()
    stack: list[tuple[str, int]] = [(p, -1) for p, _ in prefix_stack]
    depth = 0
    i = start
    while i < end:
        nxt = skip_token(src, i, end)
        if nxt is not None:
            i = nxt
            continue
        sub = src[i:i + 300]
        # Skip past nested closure declarations in this block.
        m = CLOSURE_DECL_RE.match(sub)
        if m and m.group(1) in closure_bodies:
            _, be = closure_bodies[m.group(1)]
            if be + 1 <= end:
                i = be + 1
                continue
        ch = src[i]
        if ch == "{":
            depth += 1
            i += 1
            continue
        if ch == "}":
            depth -= 1
            while stack and stack[-1][1] > depth:
                stack.pop()
            i += 1
            continue
        m = ROUTE_RE.match(sub)
        if m:
            depth += 1
            stack.append((m.group(1), depth))
            i += m.end()
            continue
        m = VERB_CALL_RE.match(sub)
        if m:
            full = "".join(s[0] for s in stack) + m.group(2)
            full = re.sub(r"//+", "/", full)
            if len(full) > 1 and full.endswith("/"):
                full = full[:-1]
            routes.add((m.group(1).upper(), full))
            i += m.end()
            continue
        # Mount-pattern call: `someH.Mount(r)` — resolve to the Mount
        # method body in the handler's package and parse it under the
        # current prefix stack. Without this, every route registered
        # via .Mount(r) is invisible (e.g. /workspaces children,
        # /artefact-types children).
        if var_to_pkg is not None:
            mm = MOUNT_CALL_RE.match(sub)
            if mm:
                resolved = find_mount_method(mm.group(1), var_to_pkg)
                if resolved is not None:
                    foreign_src, fs, fe = resolved
                    routes.update(
                        parse_block(foreign_src, fs, fe, stack, {}, var_to_pkg)
                    )
                    i += mm.end()
                    continue
        m = CLOSURE_CALL_RE.match(sub)
        if m and m.group(1) in closure_bodies:
            cs, ce = closure_bodies[m.group(1)]
            routes.update(parse_block(src, cs, ce, stack, closure_bodies, var_to_pkg))
            i += m.end()
            continue
        i += 1
    return routes


def parse_top(
    src: str,
    closure_bodies: dict[str, tuple[int, int]],
    var_to_pkg: dict[str, str] | None = None,
) -> set[tuple[str, str]]:
    """Walk the whole file, skipping over closure declaration bodies
    (so their routes don't emit at the wrong prefix). Closure call
    sites splice the closure body in at the current prefix.
    Mount calls (`someH.Mount(r)`) splice in the foreign Mount-method
    body when `var_to_pkg` resolution succeeds."""
    routes: set[tuple[str, str]] = set()
    stack: list[tuple[str, int]] = []
    depth = 0
    n = len(src)
    i = 0
    while i < n:
        nxt = skip_token(src, i, n)
        if nxt is not None:
            i = nxt
            continue
        sub = src[i:i + 300]
        m = CLOSURE_DECL_RE.match(sub)
        if m and m.group(1) in closure_bodies:
            _, be = closure_bodies[m.group(1)]
            i = be + 1
            continue
        ch = src[i]
        if ch == "{":
            depth += 1
            i += 1
            continue
        if ch == "}":
            depth -= 1
            while stack and stack[-1][1] > depth:
                stack.pop()
            i += 1
            continue
        m = ROUTE_RE.match(sub)
        if m:
            stack.append((m.group(1), depth + 1))
            depth += 1
            i += m.end()
            continue
        m = VERB_CALL_RE.match(sub)
        if m:
            full = "".join(s[0] for s in stack) + m.group(2)
            full = re.sub(r"//+", "/", full)
            if len(full) > 1 and full.endswith("/"):
                full = full[:-1]
            routes.add((m.group(1).upper(), full))
            i += m.end()
            continue
        # Mount-pattern call: see parse_block for the same logic.
        if var_to_pkg is not None:
            mm = MOUNT_CALL_RE.match(sub)
            if mm:
                resolved = find_mount_method(mm.group(1), var_to_pkg)
                if resolved is not None:
                    foreign_src, fs, fe = resolved
                    routes.update(
                        parse_block(foreign_src, fs, fe, stack, {}, var_to_pkg)
                    )
                    i += mm.end()
                    continue
        m = CLOSURE_CALL_RE.match(sub)
        if m and m.group(1) in closure_bodies:
            cs, ce = closure_bodies[m.group(1)]
            routes.update(parse_block(src, cs, ce, stack, closure_bodies, var_to_pkg))
            i += m.end()
            continue
        i += 1
    return routes


# ── Public API ────────────────────────────────────────────────────────────────

def extract_all_routes(main_go: pathlib.Path = MAIN_GO) -> set[tuple[str, str]]:
    """Parse the given main.go and return the full route set as a
    set of (METHOD, full_path) pairs. Public entry point for callers
    that want all routes regardless of mount prefix."""
    src = main_go.read_text(encoding="utf-8")
    closure_bodies = find_closure_bodies(src)
    var_to_pkg = build_handler_var_to_pkg(src)
    return parse_top(src, closure_bodies, var_to_pkg)


def by_mount_prefix(routes: set[tuple[str, str]], prefix: str) -> dict[str, list[str]]:
    """Slice the route set to those starting with `prefix/...` (or
    equal to `prefix`), strip the prefix, and return {path: [methods]}."""
    sliced = [
        (m, p[len(prefix):] or "/")
        for m, p in routes
        if p.startswith(prefix + "/") or p == prefix
    ]
    bp: dict[str, set[str]] = defaultdict(set)
    for m, p in sliced:
        bp[p].add(m)
    return {p: sorted(ms) for p, ms in bp.items()}


def main() -> int:
    all_routes = extract_all_routes()
    site = by_mount_prefix(all_routes, "/_site")
    v2 = by_mount_prefix(all_routes, "/samantha/v2")
    pathlib.Path("/tmp/site_routes.json").write_text(json.dumps(site, indent=2, sort_keys=True))
    pathlib.Path("/tmp/v2_routes.json").write_text(json.dumps(v2, indent=2, sort_keys=True))
    print(f"site: {len(site)} paths, v2: {len(v2)} paths")
    print("  → /tmp/site_routes.json")
    print("  → /tmp/v2_routes.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
