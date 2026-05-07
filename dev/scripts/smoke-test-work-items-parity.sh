#!/usr/bin/env bash
# =============================================================================
# smoke-test-work-items-parity.sh
#
# Purpose:  Structural parity smoke test — compares /v1/api/work-items (v1)
#           against /v1/api/v2/work-items (v2).  Asserts that both endpoints
#           return the same top-level shape { items: [...], total: N } and
#           that the first item (if any) carries the same set of JSON keys
#           in both responses.  Value parity is NOT checked — data sources
#           differ during the PLA-0023 backfill window.
#
# Usage:    ./dev/scripts/smoke-test-work-items-parity.sh [--limit N]
#
# What it tests:
#   1. Authentication via POST /v1/api/auth/login
#   2. GET /v1/api/work-items       → v1 response shape
#   3. GET /v1/api/v2/work-items    → v2 response shape (requires WORK_ITEMS_V2=true)
#   4. Top-level keys present:   "items" (array) and "total" (number)
#   5. Per-item keys present and matching between v1 and v2:
#        id, subscription_id, key_num, item_type, title, status,
#        flow_state_id, flow_state_name, flow_state_code,
#        priority, story_points, rollup_points, sprint_id, sprint,
#        parent_id, root_feature_id, owner_id, owner, due_date,
#        created_by, created_at, updated_at, archived_at, children_count
#
# Exit codes:
#   0 — all asserted checks passed (or v2 unavailable and noted)
#   1 — auth failure, unexpected response, or structural mismatch
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults / config
# ---------------------------------------------------------------------------
BASE_URL="http://localhost:5100"
# claude@mmffdev.com is currently inactive on dev DB; use claude_3_test (gadmin)
EMAIL="claude_3_test@mmffdev.com"
PASSWORD="password123!"
LIMIT=10

# Colours
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit)
      LIMIT="${2:?--limit requires a value}"
      shift 2
      ;;
    -h|--help)
      sed -n '3,/^# ====/p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "${RED}Unknown option: $1${RESET}" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
JQ=$(command -v jq 2>/dev/null || echo "")
if [[ -z "$JQ" ]]; then
  echo "${RED}✗ jq not found — install jq and retry${RESET}"
  exit 1
fi

pass() { echo "${GREEN}✓ $*${RESET}"; }
fail() { echo "${RED}✗ $*${RESET}"; FAILED=$((FAILED + 1)); }
note() { echo "${YELLOW}  NOTE: $*${RESET}"; }
header() { echo; echo "${BOLD}── $* ──${RESET}"; }

FAILED=0

# ---------------------------------------------------------------------------
# Step 1 — Authenticate
# ---------------------------------------------------------------------------
header "Step 1: Authenticate"

LOGIN_RESP=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  -X POST "${BASE_URL}/v1/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

HTTP_STATUS=$(echo "$LOGIN_RESP" | tail -n1 | sed 's/__HTTP_STATUS__//')
LOGIN_BODY=$(echo "$LOGIN_RESP" | sed '$d')

if [[ "$HTTP_STATUS" != "200" ]]; then
  fail "Login returned HTTP ${HTTP_STATUS} (expected 200)"
  echo "  Body: $LOGIN_BODY"
  exit 1
fi

ACCESS_TOKEN=$(echo "$LOGIN_BODY" | "$JQ" -r '.access_token // empty')
if [[ -z "$ACCESS_TOKEN" ]]; then
  fail "Login response missing access_token"
  echo "  Body: $LOGIN_BODY"
  exit 1
fi

pass "Login OK — token acquired"

AUTH_HEADER="Authorization: Bearer ${ACCESS_TOKEN}"

# ---------------------------------------------------------------------------
# Step 2 — Call v1 endpoint
# ---------------------------------------------------------------------------
header "Step 2: GET /api/work-items (v1)"

V1_RESP=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "${BASE_URL}/v1/api/work-items?limit=${LIMIT}" \
  -H "$AUTH_HEADER")

V1_STATUS=$(echo "$V1_RESP" | tail -n1 | sed 's/__HTTP_STATUS__//')
V1_BODY=$(echo "$V1_RESP" | sed '$d')

if [[ "$V1_STATUS" != "200" ]]; then
  fail "v1 returned HTTP ${V1_STATUS} (expected 200)"
  echo "  Body: $V1_BODY"
  exit 1
fi

# Validate top-level shape
V1_HAS_ITEMS=$(echo "$V1_BODY" | "$JQ" 'has("items")' 2>/dev/null || echo "false")
V1_HAS_TOTAL=$(echo "$V1_BODY" | "$JQ" 'has("total")' 2>/dev/null || echo "false")
V1_TOTAL=$(echo "$V1_BODY" | "$JQ" '.total // "missing"')
V1_COUNT=$(echo "$V1_BODY" | "$JQ" '.items | length')

[[ "$V1_HAS_ITEMS" == "true" ]] && pass "v1 has 'items' array" || fail "v1 missing 'items' key"
[[ "$V1_HAS_TOTAL" == "true" ]] && pass "v1 has 'total' field (value: ${V1_TOTAL})" || fail "v1 missing 'total' key"
echo "  v1 returned ${V1_COUNT} items (total in DB: ${V1_TOTAL})"

# Collect v1 item keys (from first item, if present)
V1_ITEM_KEYS=""
if [[ "$V1_COUNT" -gt 0 ]]; then
  V1_ITEM_KEYS=$(echo "$V1_BODY" | "$JQ" -r '.items[0] | keys | sort | .[]' 2>/dev/null)
  pass "v1 first item keys: $(echo "$V1_ITEM_KEYS" | tr '\n' ' ')"
else
  note "v1 returned 0 items — per-item key checks skipped"
fi

# ---------------------------------------------------------------------------
# Step 3 — Call v2 endpoint
# ---------------------------------------------------------------------------
header "Step 3: GET /api/v2/work-items (v2)"

V2_RESP=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "${BASE_URL}/v1/api/v2/work-items?limit=${LIMIT}" \
  -H "$AUTH_HEADER")

V2_STATUS=$(echo "$V2_RESP" | tail -n1 | sed 's/__HTTP_STATUS__//')
V2_BODY=$(echo "$V2_RESP" | sed '$d')

V2_AVAILABLE=true
if [[ "$V2_STATUS" == "503" ]]; then
  V2_AVAILABLE=false
  note "WORK_ITEMS_V2 is not set — v2 endpoint returns 503 (expected)."
  note "Set WORK_ITEMS_V2=true in backend/.env.dev and restart backend to enable."
  echo
elif [[ "$V2_STATUS" != "200" ]]; then
  fail "v2 returned HTTP ${V2_STATUS} (expected 200 or 503)"
  echo "  Body: $V2_BODY"
  FAILED=$((FAILED + 1))
  V2_AVAILABLE=false
fi

if [[ "$V2_AVAILABLE" == "true" ]]; then
  V2_HAS_ITEMS=$(echo "$V2_BODY" | "$JQ" 'has("items")' 2>/dev/null || echo "false")
  V2_HAS_TOTAL=$(echo "$V2_BODY" | "$JQ" 'has("total")' 2>/dev/null || echo "false")
  V2_TOTAL=$(echo "$V2_BODY" | "$JQ" '.total // "missing"')
  V2_COUNT=$(echo "$V2_BODY" | "$JQ" '.items | length')

  [[ "$V2_HAS_ITEMS" == "true" ]] && pass "v2 has 'items' array" || fail "v2 missing 'items' key"
  [[ "$V2_HAS_TOTAL" == "true" ]] && pass "v2 has 'total' field (value: ${V2_TOTAL})" || fail "v2 missing 'total' key"
  echo "  v2 returned ${V2_COUNT} items (total in DB: ${V2_TOTAL})"

  V2_ITEM_KEYS=""
  if [[ "$V2_COUNT" -gt 0 ]]; then
    V2_ITEM_KEYS=$(echo "$V2_BODY" | "$JQ" -r '.items[0] | keys | sort | .[]' 2>/dev/null)
    pass "v2 first item keys: $(echo "$V2_ITEM_KEYS" | tr '\n' ' ')"
  else
    note "v2 returned 0 items — per-item key checks skipped"
  fi
fi

# ---------------------------------------------------------------------------
# Step 4 — Structural parity comparison
# ---------------------------------------------------------------------------
header "Step 4: Structural parity"

# Required top-level keys (always checked against v1)
REQUIRED_KEYS=("id" "subscription_id" "key_num" "item_type" "title" "status"
               "flow_state_id" "flow_state_name" "flow_state_code"
               "priority" "story_points" "rollup_points"
               "sprint_id" "sprint" "parent_id" "root_feature_id"
               "owner_id" "owner" "due_date"
               "created_by" "created_at" "updated_at" "archived_at"
               "children_count")

if [[ -n "$V1_ITEM_KEYS" ]]; then
  echo "  Checking v1 item keys against expected schema..."
  for KEY in "${REQUIRED_KEYS[@]}"; do
    if echo "$V1_ITEM_KEYS" | grep -qx "$KEY"; then
      pass "  v1 item has key: ${KEY}"
    else
      fail "  v1 item MISSING key: ${KEY}"
    fi
  done
fi

if [[ "$V2_AVAILABLE" == "true" && -n "$V1_ITEM_KEYS" && -n "$V2_ITEM_KEYS" ]]; then
  echo
  echo "  Comparing v1 vs v2 item keys..."

  # Keys in v1 but not v2
  while IFS= read -r KEY; do
    [[ -z "$KEY" ]] && continue
    if ! echo "$V2_ITEM_KEYS" | grep -qx "$KEY"; then
      fail "  Key '${KEY}' present in v1 but MISSING from v2"
    fi
  done <<< "$V1_ITEM_KEYS"

  # Keys in v2 but not v1
  while IFS= read -r KEY; do
    [[ -z "$KEY" ]] && continue
    if ! echo "$V1_ITEM_KEYS" | grep -qx "$KEY"; then
      fail "  Key '${KEY}' present in v2 but MISSING from v1"
    fi
  done <<< "$V2_ITEM_KEYS"

  if [[ "$FAILED" -eq 0 ]]; then
    pass "v1 and v2 item key sets are identical"
  fi
elif [[ "$V2_AVAILABLE" == "true" && "$V2_COUNT" -eq 0 ]]; then
  note "v2 returned 0 items — key-set diff skipped (no items to compare)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
header "Summary"

if [[ "$FAILED" -eq 0 ]]; then
  if [[ "$V2_AVAILABLE" == "true" ]]; then
    pass "PASS — v1 and v2 are structurally identical"
  else
    pass "PASS — v1 shape valid; v2 skipped (WORK_ITEMS_V2 not enabled)"
  fi
  exit 0
else
  fail "FAIL — ${FAILED} check(s) failed (see above)"
  exit 1
fi
