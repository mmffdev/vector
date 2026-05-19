#!/usr/bin/env bash
# check_routes.sh — Layer 1: Go router ↔ OpenAPI spec drift
# Exit 0 = clean. Exit 1 = undocumented routes found.
#
# Reconstructs full paths through nested r.Route("/parent", func(r chi.Router) { ... })
# blocks by tracking brace depth in main.go. Strips the mount prefix
# (/_site or /samantha/v2) before comparing against spec path keys.
#
# Closure handling (B20.5.x): the PLA-0039 backend defines a closure
#   mountSiteRoutes := func(r chi.Router) { ... }
# and invokes it inside r.Route("/_site", func(r) { mountSiteRoutes(r) }).
# Routes inside the closure are flagged with a sentinel prefix during
# pass 1; pass 2 splices the closure body wherever the invocation
# appears under a parent r.Route prefix.
#
# Usage:
#   check_routes.sh                          # validate site routes against siteAPI.yaml
#   check_routes.sh --spec samanthaAPI.yaml  # validate v2 routes against samanthaAPI.yaml
#   check_routes.sh --all                    # validate both specs in sequence
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAIN_GO="$REPO_ROOT/backend/cmd/server/main.go"

# Default spec
SPEC="$REPO_ROOT/siteAPI.yaml"
RUN_ALL=false

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec)
      SPEC="$REPO_ROOT/$2"
      shift 2
      ;;
    --all)
      RUN_ALL=true
      shift
      ;;
    *)
      echo "Unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

if $RUN_ALL; then
  "$0" --spec siteAPI.yaml && "$0" --spec samanthaAPI.yaml
  exit $?
fi

# Infra routes that live outside the mounted block — always skip
INFRA_ALLOW=(
  "/healthz"
  "/env"
  "/env/switch"
  "/status/pipeline"
  "/ws"
)

# Determine the mount prefix for the spec.
#   siteAPI.yaml      → /_site
#   samanthaAPI.yaml  → /samantha/v2
SPEC_BASENAME="$(basename "$SPEC")"
case "$SPEC_BASENAME" in
  siteAPI.yaml)
    MOUNT_PREFIX="/_site"
    ;;
  samanthaAPI.yaml)
    MOUNT_PREFIX="/samantha/v2"
    ;;
  *)
    # Fallback to legacy v1/v2 mapping for ad-hoc invocations.
    if [[ "$SPEC_BASENAME" == *"v2"* ]]; then
      MOUNT_PREFIX="/samantha/v2"
    else
      MOUNT_PREFIX="/_site"
    fi
    ;;
esac

# Reconstruct full chi route paths by walking main.go and tracking
# r.Route(...) nesting plus the special mountSiteRoutes closure.
# Output: one path per line, deduped, with the chosen MOUNT_PREFIX
# stripped. Only emits paths that live under MOUNT_PREFIX after
# closure-body splicing.
go_paths() {
  python3 - "$MAIN_GO" "$MOUNT_PREFIX" <<'PY'
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()
mount_prefix = sys.argv[2]  # "/_site" or "/samantha/v2"

route_re   = re.compile(r'r\.Route\(\s*"([^"]+)"\s*,\s*func\s*\(\s*r\s+chi\.Router\s*\)\s*\{')
# Verb registration: matched in two steps because middleware chains
# like r.With(auth.RequirePermission(permResolver, X)).Get("/path")
# contain nested parens that no simple regex handles. We:
#   1. Anchor on the verb call: \.(Get|Post|...) followed by `(`.
#   2. Walk forward into the string literal to extract the path.
#   3. (For attribution, we don't care about what middleware was
#      applied — just the path.)
# verb_call_re finds the verb token + opening "(" of the call.
# Tolerates whitespace/newlines between the dot and the verb so
# multi-line middleware chains like
#   r.With(authSvc.X).
#       Get("/users", h.List)
# parse correctly. Mirrored in dev/scripts/extract_routes.py — change
# both together.
verb_call_re = re.compile(r'\.\s*(Get|Post|Put|Patch|Delete|Head)\(\s*"([^"]+)"')
# Closure declaration: NAME := func(r chi.Router) {        — single-arg
#                  or: NAME := func(r chi.Router, ...) {  — multi-arg
# The body always opens a brace right after the closing ).
closure_decl_re = re.compile(r'(\w+)\s*:=\s*func\s*\(\s*r\s+chi\.Router\b[^)]*\)\s*\{')
# Closure invocation: NAME(r)         — single-arg call
#                 or: NAME(r, X[, Y]) — multi-arg call (e.g. mountArtefactSite(r, workItemsV2H))
# In both cases we splice the closure body under the current r.Route prefix.
# The non-greedy [^)]* consumes any remaining args up to the closing ).
closure_call_re = re.compile(r'(\w+)\s*\(\s*r\s*(?:,\s*[^)]*)?\)')

# Pass 1: walk source. For r.Route blocks track prefix on a stack.
# For closure declarations, isolate their body and parse the closure
# in isolation to get the closure's relative routes. For closure
# invocations inside an r.Route, splice the closure's relative paths
# under the current prefix.

# Common Go-aware token skip (comments, strings, runes).
def skip_token(src, i, n):
    """Return the new index after skipping a Go syntactic token starting
    at i, or None if i is not the start of such a token. Handles line
    comment, block comment, double-quoted string, raw string, rune."""
    if src[i:i+2] == "//":
        nl = src.find("\n", i)
        return nl + 1 if nl != -1 else n
    if src[i:i+2] == "/*":
        end = src.find("*/", i+2)
        return end + 2 if end != -1 else n
    if src[i] == '"':
        j = i + 1
        while j < n and src[j] != '"':
            if src[j] == "\\" and j+1 < n:
                j += 2
                continue
            if src[j] == "\n":
                break
            j += 1
        return j + 1
    if src[i] == "`":
        end = src.find("`", i+1)
        return end + 1 if end != -1 else n
    if src[i] == "'":
        j = i + 1
        if j < n and src[j] == "\\" and j+1 < n:
            j += 2
        else:
            j += 1
        if j < n and src[j] == "'":
            return j + 1
    return None

# First, locate every chi.Router closure body. Walk the entire file
# byte-by-byte (respecting strings + comments) and record every
# closure_decl_re match — including ones nested inside other closures
# (e.g. mountArtefactSite lives inside mountSiteRoutes' body, and
# mountArtefactRoutes lives inside r.Route("/samantha/v2", ...) which
# is at top level). The previous implementation skipped past matched
# closure bodies, which hid nested declarations.
closure_bodies = {}
i = 0
n = len(src)
while i < n:
    nxt = skip_token(src, i, n)
    if nxt is not None:
        i = nxt
        continue
    sub = src[i:i+300]
    m = closure_decl_re.match(sub)
    if m:
        name = m.group(1)
        # Position right after the matched "{".
        body_start = i + m.end()
        # Walk forward tracking brace depth (respecting comments/strings)
        # until the matching close.
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
        # j now points one past the closing "}" — body_end is j-1.
        closure_bodies[name] = (body_start, j - 1)
        # Advance just past the matched "{" so we continue scanning
        # the body for nested closures. Don't jump to j (that would
        # hide nested declarations like mountArtefactSite inside
        # mountSiteRoutes).
        i = body_start
        continue
    i += 1

# Helper: parse a slice of source into the set of routes it declares,
# starting under an initial prefix stack. Returns the set of full paths
# emitted within that slice. Walks the same way the main pass would,
# but recurses on closure invocations.
#
# Parent stack entries are pinned with depth=-1 so the local brace-pop
# logic never removes them — only the new entries this block pushes
# (which use the local depth counter starting at 0) can be popped.
# Without this pinning the first inner "}" closes the parent's
# r.Route prefix and every subsequent route in the closure body
# would emit with the parent prefix dropped.
def parse_block(src, start, end, prefix_stack):
    paths = set()
    stack = [(p, -1) for p, _ in prefix_stack]
    depth = 0
    i = start
    while i < end:
        nxt = skip_token(src, i, end)
        if nxt is not None:
            i = nxt
            continue
        sub = src[i:i+300]
        # Skip past nested closure declarations inside this block — we
        # don't want to emit their routes at the wrong prefix. They'll
        # be spliced in at their call site (which may be in a different
        # block entirely, e.g. mountArtefactSite is declared inside
        # mountSiteRoutes' body but called twice from r.Route blocks
        # right after).
        m = closure_decl_re.match(sub)
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

        m = route_re.match(sub)
        if m:
            inner_prefix = m.group(1)
            depth += 1
            stack.append((inner_prefix, depth))
            i += m.end()
            continue
        # Verb call: .Get("/path") etc. May be preceded by an arbitrary
        # middleware chain like r.With(auth.RequirePermission(X, Y)).Get(...).
        # The verb_call_re matches the suffix; we don't validate the
        # chain because there's no false-positive verb-call shape that's
        # interesting to a routes audit.
        m = verb_call_re.match(sub)
        if m:
            leaf = m.group(2)
            full = "".join(s[0] for s in stack) + leaf
            full = re.sub(r"//+", "/", full)
            paths.add(full)
            i += m.end()
            continue
        # Closure invocation NAME(r) [, args] — splice the closure body
        # here under the current prefix stack.
        m = closure_call_re.match(sub)
        if m and m.group(1) in closure_bodies:
            name = m.group(1)
            cb_start, cb_end = closure_bodies[name]
            paths.update(parse_block(src, cb_start, cb_end, stack))
            i += m.end()
            continue
        i += 1
    return paths

# Main pass: walk the whole file, but skip over closure declaration
# bodies (so we don't emit those routes at the wrong prefix). The
# closure invocations inside r.Route blocks splice the routes in
# at the right prefix.
def parse_top():
    paths = set()
    stack = []
    depth = 0
    i = 0
    n = len(src)
    # Build a sorted list of closure body ranges to skip.
    closure_ranges = sorted(closure_bodies.values())
    skip_to = -1
    while i < n:
        # If we're inside a closure body, jump past it.
        for s, e in closure_ranges:
            # Find the closure header start by looking backward — but we
            # detected closures by their { offset, so the body starts at
            # s. We want to skip from the closure declaration begin to
            # past the close. Use a small lookback: the declaration line
            # starts up to 80 chars before s.
            if i >= s - 80 and i < e + 1:
                # Check whether the declaration actually starts before i.
                # If a declaration regex matches at i, mark the skip range.
                pass
        nxt = skip_token(src, i, n)
        if nxt is not None:
            i = nxt
            continue
        sub = src[i:i+300]
        # If this is the start of a closure declaration, skip its body.
        m = closure_decl_re.match(sub)
        if m and m.group(1) in closure_bodies:
            _, body_end = closure_bodies[m.group(1)]
            # Advance past the "}" (body_end is the position OF "}").
            i = body_end + 1
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
        m = route_re.match(sub)
        if m:
            prefix = m.group(1)
            depth += 1
            stack.append((prefix, depth))
            i += m.end()
            continue
        m = verb_call_re.match(sub)
        if m:
            leaf = m.group(2)
            full = "".join(s[0] for s in stack) + leaf
            full = re.sub(r"//+", "/", full)
            paths.add(full)
            i += m.end()
            continue
        # Closure invocation NAME(r) — splice the closure body under the
        # current prefix.
        m = closure_call_re.match(sub)
        if m and m.group(1) in closure_bodies:
            name = m.group(1)
            cb_start, cb_end = closure_bodies[name]
            paths.update(parse_block(src, cb_start, cb_end, stack))
            i += m.end()
            continue
        i += 1
    return paths

all_paths = parse_top()

for p in sorted(all_paths):
    # Only emit paths that belong to the target mount prefix.
    if not p.startswith(mount_prefix):
        continue
    # Strip the mount prefix.
    p2 = p[len(mount_prefix):]
    if not p2:
        p2 = "/"
    if len(p2) > 1 and p2.endswith("/"):
        p2 = p2[:-1]
    print(p2)
PY
}

# Extract all path keys from siteAPI.yaml (lines starting with "  /")
spec_paths() {
  grep -E '^  /' "$SPEC" | sed 's/://; s/^  //' | sort -u
}

is_infra() {
  local p="$1"
  for infra in "${INFRA_ALLOW[@]}"; do
    [[ "$p" == "$infra" ]] && return 0
  done
  return 1
}

errors=0
warnings=0

echo "=== check_routes: Go router under ${MOUNT_PREFIX} ↔ $(basename "$SPEC") ==="

# Hard fail: Go route not in spec
while IFS= read -r path; do
  is_infra "$path" && continue
  if ! spec_paths | grep -qx "$path"; then
    echo "ERROR: Go route '$path' has no spec entry (undocumented route)" >&2
    errors=$((errors + 1))
  fi
done < <(go_paths)

# Warn only: spec path not in Go routes
while IFS= read -r path; do
  if ! go_paths | grep -qx "$path"; then
    echo "WARN:  Spec path '$path' has no Go route (spec-first OK, or dead spec entry)"
    warnings=$((warnings + 1))
  fi
done < <(spec_paths)

echo "--- Result: $errors error(s), $warnings warning(s)"

if [[ $errors -gt 0 ]]; then
  echo "FAIL: $errors undocumented route(s) found. Add them to siteAPI.yaml before pushing." >&2
  exit 1
fi

echo "OK"
exit 0
