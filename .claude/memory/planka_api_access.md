---
name: Planka API direct access
description: How to connect to Planka REST API using Python urllib — agent credentials, auth pattern, board IDs, and endpoint shapes that actually work.
type: reference
originSessionId: a5f9602b-0644-4cea-999f-b70468753594
---
## How to connect (this is the working pattern)

Credentials live in `backend/.env.local` (git-ignored). Read them at runtime — never hardcode.

```python
import urllib.request, json, urllib.error

# 1. Read credentials
env_file = "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/backend/.env.local"
creds = {}
with open(env_file) as f:
    for line in f:
        if line.startswith("PLANKA_AGENT_USER=") or line.startswith("PLANKA_AGENT_PASS="):
            k, v = line.strip().split("=", 1)
            creds[k] = v

# 2. Authenticate — returns a bearer token
auth_req = urllib.request.Request(
    'http://localhost:3333/api/access-tokens',
    data=json.dumps({'emailOrUsername': creds['PLANKA_AGENT_USER'], 'password': creds['PLANKA_AGENT_PASS']}).encode(),
    headers={'Content-Type': 'application/json'},
    method='POST'
)
token = json.loads(urllib.request.urlopen(auth_req).read())['item']

# 3. All subsequent requests use: headers={'Authorization': f'Bearer {token}'}
```

**Never use curl. Always use Python urllib. Always read creds from `.env.local` at runtime.**

**For card creation and label attachment: use `.claude/bin/planka` helper directly** (`create-card`, `label-card`, `move-card`). It has all quirks (`type: story`, correct URL, `card-labels` path) baked in. Only drop to raw urllib for batch operations or endpoints the helper doesn't cover (board fetch, label creation, verify-labels). Writing descriptions inline in shell (backticks, special chars) causes interpolation explosions — write to a `.sh` file first.

## Tunnel prerequisite

Planka is at `http://localhost:3333` via SSH tunnel. Check first:

```bash
nc -z localhost 3333 && echo "up" || echo "DOWN"
```

Start if down: `nohup /usr/bin/ssh -N mmffdev-pg &`

## Key IDs

| Thing | ID |
|---|---|
| Board: Vector Main | `1760699595475649556` |
| List: Ideas | `1763533821526935509` |
| List: Backlog | `1760700028730475544` |
| List: To Do | `1760700252018443289` |
| List: Doing | `1760700299682513946` |
| List: Completed | `1760700351842878491` |
| List: Accepted | `1760700396512216092` |

## Endpoint shapes (verified working)

### GET board (cards, lists, labels, cardLabels)
```python
req = urllib.request.Request(
    'http://localhost:3333/api/boards/1760699595475649556',
    headers={'Authorization': f'Bearer {token}'},
    method='GET'
)
board = json.loads(urllib.request.urlopen(req).read())
# board['included']['lists'], board['included']['cards'], board['included']['labels'], board['included']['cardLabels']
```

### POST create a list
```python
req = urllib.request.Request(
    'http://localhost:3333/api/boards/1760699595475649556/lists',
    data=json.dumps({'name': 'Ideas', 'position': 32768, 'type': 'active'}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
    method='POST'
)
result = json.loads(urllib.request.urlopen(req).read())
# result['item']['id'], result['item']['position']
# REQUIRED: type must be 'active'. Omitting it returns 400 E_MISSING_OR_INVALID_PARAMS.
# Endpoint is /api/boards/:boardId/lists — NOT /api/lists (returns 404).
```

### POST create a card
```python
req = urllib.request.Request(
    f'http://localhost:3333/api/lists/{list_id}/cards',
    data=json.dumps({'name': title, 'description': desc, 'position': 65536, 'type': 'story'}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
    method='POST'
)
result = json.loads(urllib.request.urlopen(req).read())
card_id = result['item']['id']
# type must be 'story' (not 'card'). 'project' is for epics.
```

### PATCH move a card
```python
req = urllib.request.Request(
    f'http://localhost:3333/api/cards/{card_id}',
    data=json.dumps({'listId': target_list_id, 'position': position}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
    method='PATCH'
)
json.loads(urllib.request.urlopen(req).read())
# Both listId AND position are required. Omitting position silently ignores the listId change.
```

### POST attach a label to a card
```python
req = urllib.request.Request(
    f'http://localhost:3333/api/cards/{card_id}/card-labels',
    data=json.dumps({'labelId': label_id}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
    method='POST'
)
json.loads(urllib.request.urlopen(req).read())
# Path is /card-labels (kebab-case). /labels returns 404.
```

### POST create a label on the board
```python
req = urllib.request.Request(
    'http://localhost:3333/api/boards/1760699595475649556/labels',
    data=json.dumps({'name': 'MY-LABEL', 'color': 'midnight-blue', 'position': 65536}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
    method='POST'
)
result = json.loads(urllib.request.urlopen(req).read())
label_id = result['item']['id']
# Endpoint is /api/boards/:id/labels — NOT /api/labels (returns 404).
# position is required.
```

### POST comment on a card
```python
req = urllib.request.Request(
    f'http://localhost:3333/api/cards/{card_id}/comments',
    data=json.dumps({'text': 'comment text'}).encode(),
    headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'},
    method='POST'
)
json.loads(urllib.request.urlopen(req).read())
```

### DELETE a card
```python
req = urllib.request.Request(
    f'http://localhost:3333/api/cards/{card_id}',
    headers={'Authorization': f'Bearer {token}'},
    method='DELETE'
)
urllib.request.urlopen(req)
```

## Error handling pattern

```python
try:
    resp = urllib.request.urlopen(req)
    result = json.loads(resp.read())
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"Error {e.code}: {body[:300]}")
```

## List positions (current board)

Positions are integers; Planka uses 65536-step increments by default.
- Ideas: 32768 (before Backlog)
- Backlog: 65536
- To Do: 131072
- Doing: 196608
- Completed: 262144
- Accepted: 327680
- archive / trash: position=None (system lists, ignore in sorts — use `l.get('position') or 0`)
