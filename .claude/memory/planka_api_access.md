---
name: Planka API direct access
description: How to access the Planka board via REST API — use this because planka-mcp v1.0.7 is broken (returns HTML for every call)
type: reference
originSessionId: d252e265-892b-4087-8dbd-a50e6045c3e2
---
## Why not MCP

`planka-mcp` v1.0.7 makes preflight calls at startup that return `E_NOT_FOUND`. After that every MCP tool call returns the Planka HTML login page instead of JSON. Use direct REST calls instead.

## Auth

Use the `claude@mmffdev.com` account (created for the agent; admin's account is separate):

```bash
TOKEN=$(curl -s -X POST http://localhost:3333/api/access-tokens \
  -H "Content-Type: application/json" \
  -d '{"emailOrUsername":"claude@mmffdev.com","password":"myApples27@"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['item'])")
```

Re-run at the start of any session. Token is valid ~1 year. Terms of service have already been accepted on this account; login returns a real access token (not a `pendingToken`).

If a future Planka upgrade re-prompts terms, the response shape is `{"code":"E_FORBIDDEN","pendingToken":"...","step":"accept-terms"}`. Fetch the signature from `GET /api/terms`, then `POST /api/access-tokens/accept-terms` with `{pendingToken, signature}`.

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

## Attach a label to a card

```bash
curl -s -X POST "http://localhost:3333/api/cards/<CARD_ID>/card-labels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"labelId":"<LABEL_ID>"}'
```

**Important:** the path is **`/card-labels`** (kebab-case), not `/labels`. The `/labels` form returns `E_NOT_FOUND` and the storify skill's REST template (which uses `/labels`) silently fails. Same kebab-case convention applies to `/card-memberships` (assigning a user as card owner).

## Assign a user to a card (card ownership)

```bash
curl -s -X POST "http://localhost:3333/api/cards/<CARD_ID>/card-memberships" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId":"<USER_ID>"}'
```

My user ID (claude@mmffdev.com): `1761296226721990419`.

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

## Create a label

```bash
curl -s -X POST "http://localhost:3333/api/boards/<BOARD_ID>/labels" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"LABEL_NAME","color":"midnight-blue","position":65536}'
```

**Critical:** 
- Endpoint is `/api/boards/:id/labels` (not `/api/labels` — that returns 404)
- `position` parameter is required (omitting it returns `E_MISSING_OR_INVALID_PARAMS`)
- `position=65536` appends the label at the end of the list; use lower values for specific ordering
- `color` options: `midnight-blue`, `tank-green`, `berry-red`, etc.

## Prerequisite

Tunnel must be up on `localhost:3333` before any of this works.  
Check: `nc -z localhost 3333`  
Start: `ssh -N -f mmffdev-pg` (includes `LocalForward 3333 localhost:3333`)
