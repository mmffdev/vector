#!/usr/bin/env bash
# check_routes.sh — Layer 1: Go router ↔ openapi.yaml drift
# Exit 0 = clean. Exit 1 = undocumented routes found.
#
# Reconstructs full paths through nested r.Route("/parent", func(r chi.Router) { ... })
# blocks by tracking brace depth in main.go. Strips the /samantha/v1 (or /v2) mount
# prefix before comparing against openapi.yaml path keys.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAIN_GO="$REPO_ROOT/backend/cmd/server/main.go"
SPEC="$REPO_ROOT/openapi.yaml"

# Infra routes that live outside the versioned block — always skip
INFRA_ALLOW=(
  "/healthz"
  "/env"
  "/env/switch"
  "/status/pipeline"
  "/ws"
)

# Reconstruct full chi route paths by walking main.go and tracking r.Route(...) nesting.
# Output: one path per line, deduped, prefix-stripped.
go_paths() {
  python3 - "$MAIN_GO" <<'PY'
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()

route_re = re.compile(r'r\.Route\(\s*"([^"]+)"\s*,\s*func\s*\(\s*r\s+chi\.Router\s*\)\s*\{')
verb_re  = re.compile(r'r\.(?:Get|Post|Put|Patch|Delete|Head)\(\s*"([^"]+)"')

# Stack of (prefix, recorded_depth). When brace depth drops back below recorded,
# pop the prefix.
stack = []
depth = 0
paths = set()

i = 0
n = len(src)
while i < n:
    # Line comment
    if src[i:i+2] == "//":
        nl = src.find("\n", i)
        i = nl + 1 if nl != -1 else n
        continue
    # Block comment
    if src[i:i+2] == "/*":
        end = src.find("*/", i+2)
        i = end + 2 if end != -1 else n
        continue
    # Double-quoted string (interpreted)
    if src[i] == '"':
        j = i + 1
        while j < n and src[j] != '"':
            if src[j] == "\\" and j+1 < n:
                j += 2
                continue
            if src[j] == "\n":
                break
            j += 1
        i = j + 1
        continue
    # Backtick raw string (multi-line, no escapes)
    if src[i] == "`":
        end = src.find("`", i+1)
        i = end + 1 if end != -1 else n
        continue
    # Rune literal '{' or '}' or '\''
    if src[i] == "'":
        j = i + 1
        if j < n and src[j] == "\\" and j+1 < n:
            j += 2
        else:
            j += 1
        # Expect closing '
        if j < n and src[j] == "'":
            i = j + 1
            continue
        # Not a rune literal — fall through
    ch = src[i]
    if ch == "{":
        depth += 1
        i += 1
        continue
    if ch == "}":
        depth -= 1
        # Pop frames whose recorded depth is greater than current depth.
        while stack and stack[-1][1] > depth:
            stack.pop()
        i += 1
        continue

    # Try to match a route construct starting at i.
    sub = src[i:i+300]
    m = route_re.match(sub)
    if m:
        prefix = m.group(1)
        # The match includes the opening "{". We must increment depth to reflect
        # that we're now inside the block, and record the frame at the inside depth.
        depth += 1
        stack.append((prefix, depth))
        i += m.end()
        continue
    m = verb_re.match(sub)
    if m:
        leaf = m.group(1)
        full = "".join(s[0] for s in stack) + leaf
        full = re.sub(r"//+", "/", full)
        paths.add(full)
        i += m.end()
        continue
    i += 1

for p in sorted(paths):
    # Strip /samantha/v1 or /samantha/v2 prefix
    p2 = re.sub(r"^/samantha/v[0-9]+", "", p)
    if not p2:
        p2 = "/"
    # Normalise trailing slash: chi treats r.Get("/", ...) inside r.Route("/x", ...)
    # as /x/, but openapi spec authors usually write /x. Strip the trailing / unless
    # the whole path is just "/".
    if len(p2) > 1 and p2.endswith("/"):
        p2 = p2[:-1]
    print(p2)
PY
}

# Extract all path keys from openapi.yaml (lines starting with "  /")
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

echo "=== check_routes: Go router ↔ openapi.yaml ==="

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
  echo "FAIL: $errors undocumented route(s) found. Add them to openapi.yaml before pushing." >&2
  exit 1
fi

echo "OK"
exit 0
