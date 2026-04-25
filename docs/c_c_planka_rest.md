# Planka REST command templates

> Lazy-loaded. Load when writing curl/Python Planka calls or debugging MCP failures.

Tunnel must be up on `:3333`. All commands use `$TOKEN` — get it once per session (see Auth below).

## Key IDs (hard-coded — do not re-fetch)

| Thing | ID |
|---|---|
| Board | `1760699595475649556` |
| Backlog list | `1760700028730475544` |
| To Do list | `1760700252018443289` |
| Doing list | `1760700299682513946` |
| Completed list | `1760700351842878491` |
| Accepted list | `1760700396512216092` |
| Label: storify | `1760724305328473193` |
| Label: backlog-cmd | `1760724306184111210` |
| Label: manual | `1760724307056526443` |
| Label: MULTI AGENT (berry-red) | `1760728388919624826` |

---

## Auth — get token

```bash
TOKEN=$(curl -s -X POST http://localhost:3333/api/access-tokens \
  -H "Content-Type: application/json" \
  -d '{"emailOrUsername":"admin@mmffdev.com","password":"changeme123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['item'])")
```

---

## Create card

**Use MCP `mcp__planka__create_card`** — curl always requires `type` and the REST label endpoint is unreliable.

MCP call (labels array works on create):
```
mcp__planka__create_card
  listId:      <LIST_ID>
  name:        "<TITLE>"
  description: "<AC>\n\n---\n_Agent: backlog-cmd | <DATE> | <BRANCH>_"
  position:    <65536 * N>
  type:        story
  labels:      ["<LABEL_ID>", ...]
```

Get date/branch at runtime:
```bash
DATE=$(date +%Y-%m-%d)
BRANCH=$(git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
```

---

## Move card to list

```bash
curl -s -X PATCH "http://localhost:3333/api/cards/<CARD_ID>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listId":"<LIST_ID>","position":<POSITION>}'
```

**Both `listId` and `position` are required together** — omitting either returns 422.

Position conventions: first card = 65536, subsequent = 65536 × N. If inserting between cards, use midpoint.

---

## Post comment

```bash
curl -s -X POST "http://localhost:3333/api/cards/<CARD_ID>/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"<COMMENT_TEXT>"}'
```

For dynamic text with branch/hash:
```bash
BRANCH=$(git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
curl -s -X POST "http://localhost:3333/api/cards/<CARD_ID>/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"**Code complete** — <SUMMARY>. Branch: ${BRANCH}\"}"
```

---

## Fetch board state (cards + labels)

```bash
curl -s "http://localhost:3333/api/boards/1760699595475649556" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)
list_names = {
  '1760700028730475544':'Backlog',
  '1760700252018443289':'To Do',
  '1760700299682513946':'Doing',
  '1760700351842878491':'Completed',
  '1760700396512216092':'Accepted',
}
for c in d['included']['cards']:
    name = list_names.get(c['listId'],'?')
    print(f\"{name:12s} {c['id']} {c['name']}\")
"
```

Filter to a specific list: add `if c['listId'] == '<LIST_ID>'` before print.

---

## Scan for MULTI AGENT claimable cards

```bash
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

---

## Delete card

```bash
curl -s -X DELETE "http://localhost:3333/api/cards/<CARD_ID>" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Known gotchas

- **Label assign via curl** (`POST /api/cards/:id/labels`) returns 404 in this Planka version. Use MCP `create_card labels[]` instead — apply labels at creation time.
- **Card create requires `type`** — valid values: `story`, `project`. Omitting it returns 422 `E_MISSING_OR_INVALID_PARAMS`.
- **Move requires `position`** — `PATCH /api/cards/:id` with only `listId` returns 422. Always pass both.
- **Label remove** — no working REST endpoint found. Remove labels in the Planka UI.
