#!/usr/bin/env bash
# check_routes.sh — Layer 1: Go router ↔ OpenAPI spec drift
# Exit 0 = clean. Exit 1 = undocumented routes found.
#
# Reconstructs full paths through nested r.Route("/parent", func(r chi.Router) { ... })
# blocks by tracking brace depth in main.go. Strips the /samantha/v1 (or /v2) mount
# prefix before comparing against the spec path keys.
#
# Usage:
#   check_routes.sh                          # validate v1 routes against openapi.yaml
#   check_routes.sh --spec openapi-v2.yaml   # validate v2 routes against openapi-v2.yaml
#   check_routes.sh --all                    # validate both specs in sequence
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAIN_GO="$REPO_ROOT/backend/cmd/server/main.go"

# Default spec
SPEC="$REPO_ROOT/openapi.yaml"
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
  "$0" --spec openapi.yaml && "$0" --spec openapi-v2.yaml
  exit $?
fi

# Infra routes that live outside the versioned block — always skip
INFRA_ALLOW=(
  "/healthz"
  "/env"
  "/env/switch"
  "/status/pipeline"
  "/ws"
)

# Determine which version prefix to filter to based on the spec filename.
# openapi.yaml → v1, openapi-v2.yaml → v2.
VERSION_PREFIX="v1"
if [[ "$SPEC" == *"v2"* ]]; then
  VERSION_PREFIX="v2"
fi

# Reconstruct full chi route paths by walking main.go and tracking r.Route(...) nesting.
# Output: one path per line, deduped, prefix-stripped.
# Only emits paths from the /samantha/vN block that matches VERSION_PREFIX.
go_paths() {
  python3 - "$MAIN_GO" "$VERSION_PREFIX" <<'PY'
import re
import sys

src = open(sys.argv[1], encoding="utf-8").read()
version_filter = sys.argv[2]  # "v1" or "v2"
target_prefix = f"/samantha/{version_filter}"

route_re = re.compile(r'r\.Route\(\s*"([^"]+)"\s*,\s*func\s*\(\s*r\s+chi\.Router\s*\)\s*\{')
verb_re  = re.compile(r'r\.(?:Get|Post|Put|Patch|Delete|Head)\(\s*"([^"]+)"')

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
    # Rune literal
    if src[i] == "'":
        j = i + 1
        if j < n and src[j] == "\\" and j+1 < n:
            j += 2
        else:
            j += 1
        if j < n and src[j] == "'":
            i = j + 1
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

    sub = src[i:i+300]
    m = route_re.match(sub)
    if m:
        prefix = m.group(1)
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
    # Only emit paths that belong to the target version block.
    if not p.startswith(target_prefix):
        continue
    # Strip the /samantha/vN prefix.
    p2 = re.sub(r"^/samantha/v[0-9]+", "", p)
    if not p2:
        p2 = "/"
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

echo "=== check_routes: Go router [${VERSION_PREFIX}] ↔ $(basename "$SPEC") ==="

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
