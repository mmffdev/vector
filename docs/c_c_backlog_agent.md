# Planka — agent tracking contract & parallel claim

> Lazy-loaded. Load when an agent is picking up, completing, or scanning for work.

## Lifecycle moves

**Picking up a story:**
1. Move card **To Do** → **Doing** via `mcp__planka__move_card_to_list`
2. Hook auto-posts in-flight comment (`.claude/hooks/planka-card-moved.sh`)

**Code-complete:**
1. Move card **Doing** → **Completed** via `mcp__planka__move_card_to_list`
2. Hook auto-posts completion comment with branch

**User accepts (tested):**
1. User moves card to **Accepted** (board UI or `<backlog> -accept <id>`)
2. Remove from `boot2.md` active tracking — history lives on the board

## Card ownership footer (required on every agent-created card)

```
---
_Agent: <skill-name> | <YYYY-MM-DD> | <git-branch>_
```

Runtime values:
```bash
DATE=$(date +%Y-%m-%d)
BRANCH=$(git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
```

## Labels

| Label | Color | ID | Who applies |
|---|---|---|---|
| `storify` | lagoon-blue | `1760724305328473193` | `/storify` skill |
| `backlog-cmd` | egg-yellow | `1760724306184111210` | `<backlog> -a` |
| `manual` | fresh-salad | `1760724307056526443` | Human (UI only) |
| `MULTI AGENT` | berry-red | `1760728388919624826` | Planning agent — safe for parallel claim |

**Hard rule (every card-creating agent — storify, backlog-cmd, manual, ad-hoc):** every card MUST end creation carrying `PH-NNNN`, `FE-SECNNNN`, a creation-source label (`storify` / `backlog-cmd` / `manual`), and `MULTI AGENT` if it qualifies. Cards missing any of these are defects — fix on the spot, do not move on.

**Label-application transport — verified state of the world:**

| Path | Reality |
|---|---|
| `mcp__planka__create_card` with `labels[]` | **Silently broken** — schema accepts the field, server ignores it. Card is created with zero labels. Do NOT rely on this. |
| `mcp__planka__assign_label_to_card` (one call per label, after the card exists) | Works reliably. **Use this.** |
| `POST /api/cards/:id/labels` (REST) | Often returns `E_NOT_FOUND` even on success — the response body is untrustworthy. Verify after; if missing, retry via MCP. |

**Required protocol — no shortcuts:**
1. Create the card (REST `POST /api/lists/.../cards` OR `mcp__planka__create_card` — both fine for create-only).
2. For each required label, call `mcp__planka__assign_label_to_card`.
3. Fetch the board (`GET /api/boards/<BOARD_ID>`) and confirm `included.cardLabels` lists every required label for the new card. If any are missing, retry step 2 for that label and re-verify.
4. Only after the verify shows the full label set is the card considered created.

**`MULTI AGENT` qualifies when:** touches only its own files, no pending migrations, no schema changes, no shared service state. When in doubt, leave it unlabelled.

## Parallel agent work-claim

Scan for claimable cards (Backlog + To Do, `MULTI AGENT` labelled):

```bash
TOKEN=$(curl -s -X POST http://localhost:3333/api/access-tokens \
  -H "Content-Type: application/json" \
  -d '{"emailOrUsername":"admin@mmffdev.com","password":"changeme123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['item'])")

curl -s "http://localhost:3333/api/boards/1760699595475649556" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
claimable = {'1760700028730475544','1760700252018443289'}
labeled = {cl['cardId'] for cl in d['included'].get('cardLabels',[]) if cl['labelId'] == '1760728388919624826'}
for c in d['included']['cards']:
    if c['listId'] in claimable and c['id'] in labeled:
        print(c['id'], c['name'])
"
```

**Claim protocol:**
1. Pick a card from the output above
2. Move to **Doing** — hook posts in-flight comment automatically
3. Work to completion, move to **Completed**
4. Never claim a card already in Doing or Completed
