#!/usr/bin/env bash
# PostToolUse hook — fires after mcp__planka__move_card_to_list
# Posts a pick-up or completion comment based on which list the card landed in.

set -euo pipefail

DOING_LIST="1760700299682513946"
COMPLETED_LIST="1760700351842878491"
PLANKA="http://localhost:3333"
PLANKA_USER="admin@mmffdev.com"
PLANKA_PASS="changeme123!"

INPUT=$(cat)

CARD_ID=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('cardId', ''))
" 2>/dev/null)

LIST_ID=$(echo "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('tool_input', {}).get('newListId', ''))
" 2>/dev/null)

[[ -z "$CARD_ID" || -z "$LIST_ID" ]] && exit 0
[[ "$LIST_ID" != "$DOING_LIST" && "$LIST_ID" != "$COMPLETED_LIST" ]] && exit 0

# Skip silently if tunnel is down
nc -z localhost 3333 2>/dev/null || exit 0

TOKEN=$(curl -sf -X POST "$PLANKA/api/access-tokens" \
  -H "Content-Type: application/json" \
  -d "{\"emailOrUsername\":\"$PLANKA_USER\",\"password\":\"$PLANKA_PASS\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['item'])" 2>/dev/null) || exit 0

[[ -z "$TOKEN" ]] && exit 0

BRANCH=$(git -C "${CLAUDE_PROJECT_DIR:-$PWD}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
DATE=$(date +%Y-%m-%d)

if [[ "$LIST_ID" == "$DOING_LIST" ]]; then
  TEXT="**In flight** — $DATE | branch \`$BRANCH\`"
else
  TEXT="**Code complete** — $DATE | branch \`$BRANCH\` — moved to Completed, awaiting review/test"
fi

curl -sf -X POST "$PLANKA/api/cards/$CARD_ID/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"$TEXT\"}" > /dev/null 2>&1 || true

exit 0
