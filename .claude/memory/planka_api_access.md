---
name: Planka API direct access
description: How to access the Planka board via REST API — use this because planka-mcp v1.0.7 is broken (returns HTML for every call)
type: reference
originSessionId: d252e265-892b-4087-8dbd-a50e6045c3e2
---
## Why not MCP

`planka-mcp` v1.0.7 makes preflight calls at startup that return `E_NOT_FOUND`. After that every MCP tool call returns the Planka HTML login page instead of JSON. Use direct REST calls instead.

## Auth

```bash
TOKEN=$(curl -s -X POST http://localhost:3333/api/access-tokens \
  -H "Content-Type: application/json" \
  -d '{"emailOrUsername":"admin@mmffdev.com","password":"changeme123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['item'])")
```

Re-run at the start of any session. Token is valid ~1 year.

## Key IDs (pre-resolved)

| Thing | ID |
|---|---|
| Project: Vector Project | `1760699494401311762` |
| Board: Vector Main | `1760699595475649556` |
| List: Backlog | `1760700028730475544` |
| List: To Do | `1760700252018443289` |
| List: Doing | `1760700299682513946` |
| List: Completed | `1760700351842878491` |
| List: Accepted | `1760700396512216092` |

## Create a card

```bash
curl -s -X POST "http://localhost:3333/api/lists/<LIST_ID>/cards" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Card title","description":"...","position":65536,"type":"story"}'
```

- `type` must be `"story"` (not `"card"` — that errors). `"project"` is for epics.
- `position`: increment by 65536 per card to space them.

## Move a card to a different list

```bash
curl -s -X PATCH "http://localhost:3333/api/cards/<CARD_ID>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listId":"<TARGET_LIST_ID>"}'
```

## Get all cards on the board

```bash
curl -s "http://localhost:3333/api/boards/1760699595475649556" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d['included']['cards']:
    print(c['id'], c['listId'], c['name'])
"
```

## Post a comment on a card

```bash
curl -s -X POST "http://localhost:3333/api/cards/<CARD_ID>/comments" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"comment text here"}'
```

## Delete a card

```bash
curl -s -X DELETE "http://localhost:3333/api/cards/<CARD_ID>" \
  -H "Authorization: Bearer $TOKEN"
```

## Prerequisite

Tunnel must be up on `localhost:3333` before any of this works.  
Check: `nc -z localhost 3333`  
Start: `ssh -N -f mmffdev-pg` (includes `LocalForward 3333 localhost:3333`)
