---
name: Planka API direct access
description: How to access the Planka board via REST API — use this because planka-mcp v1.0.7 is broken (returns HTML for every call)
type: reference
originSessionId: d252e265-892b-4087-8dbd-a50e6045c3e2
---
## ⚠️ HARD RULE: DO NOT CALL CURL DIRECTLY

**All Planka board operations must go through `.claude/bin/planka`** — the single authoritative entry point. This ensures:
- Credentials are never printed to stdout
- Passwords are never visible in process lists
- There is one source of truth for all API calls

If you find yourself writing curl to call Planka, STOP and use the helper instead. See `.claude/bin/planka help` for all available sub-commands.

## Why not MCP

`planka-mcp` v1.0.7 makes preflight calls at startup that return `E_NOT_FOUND`. After that every MCP tool call returns the Planka HTML login page instead of JSON.

## Auth (Reference Only)

The `claude@mmffdev.com` account (created for the agent; admin's account is separate) credentials are stored in `backend/.env.local` (git-ignored) and are read only by `.claude/bin/planka`. Token is valid ~1 year; terms of service already accepted on this account.

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

## REST API Endpoints (Reference Only)

**Use `.claude/bin/planka <sub-command>` instead of calling these directly.**

### Create a card
- **Endpoint:** `POST /api/lists/<LIST_ID>/cards`
- **Body:** `{"name":"...","description":"...","position":65536,"type":"story"}`
- **Note:** `type` must be `"story"` (not `"card"`). `"project"` is for epics. Position increments by 65536 per card.
- **Helper:** `planka create-card <listId> "<title>" "<desc>"` → prints card ID

### Move a card
- **Endpoint:** `PATCH /api/cards/<CARD_ID>`
- **Body:** `{"listId":"<TARGET_LIST_ID>","position":<POS>}`
- **Note:** Both `listId` and `position` are required. Omitting either silently fails.
- **Helper:** `planka move-card <cardId> <listId> <position>`

### Get all cards
- **Endpoint:** `GET /api/boards/1760699595475649556`
- **Response:** JSON with `included.cards[]`, `included.lists[]`, `included.labels[]`, `included.cardLabels[]`
- **Helper:** `planka board` → prints full JSON

### Attach a label
- **Endpoint:** `POST /api/cards/<CARD_ID>/card-labels`
- **Body:** `{"labelId":"<LABEL_ID>"}`
- **Note:** Path is **`/card-labels`** (kebab-case), NOT `/labels` (that returns 404). Same applies to `/card-memberships`.
- **Helper:** `planka label-card <cardId> <labelId>`

### Post a comment
- **Endpoint:** `POST /api/cards/<CARD_ID>/comments`
- **Body:** `{"text":"..."}`
- **Helper:** `planka comment <cardId> "<text>"`

### Delete a card
- **Endpoint:** `DELETE /api/cards/<CARD_ID>`
- **Helper:** `planka delete-card <cardId>`

### Create a label
- **Endpoint:** `POST /api/boards/<BOARD_ID>/labels`
- **Body:** `{"name":"...","color":"midnight-blue","position":65536}`
- **Note:** Endpoint is `/api/boards/:id/labels` (not `/api/labels` — that returns 404). `position` is required. Colors: `midnight-blue`, `tank-green`, `berry-red`, etc.
- **Helper:** `planka create-label <boardId> "<name>" <color> <position>` → prints label ID

### Verify labels on cards
- **Helper:** `planka verify-labels "id1,id2,id3" "label1,label2"` → exits 1 on any defect

## Prerequisite

Tunnel must be up on `localhost:3333` before any of this works.  
Check: `nc -z localhost 3333`  
Start: `ssh -N -f mmffdev-pg` (includes `LocalForward 3333 localhost:3333`)
