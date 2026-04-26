# Planka REST command templates

> **⚠️ REFERENCE ONLY** — Do not call these directly via curl. Use `.claude/bin/planka` helper instead (see [`.claude/bin/planka`](./.claude/bin/planka)). This document is kept for understanding the Planka REST API; all actual board operations must go through the helper.

Tunnel must be up on `:3333`.

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

## Auth

**Use `.claude/bin/planka` — never call this directly.** Credentials are stored in `backend/.env.local` (git-ignored) and read only by the helper script.

The agent account (`claude@mmffdev.com`) has already accepted terms; login returns a real access token (valid ~1 year).

---

## Create card

**Use `.claude/bin/planka create-card`:**
```bash
.claude/bin/planka create-card <listId> "<title>" "<description>"
# Prints card ID to stdout
```

Details:
- `type` must be `"story"` (not `"card"` — that errors). `"project"` is for epics.
- `position`: increment by 65536 per card to space them.
- Labels must be attached separately (see Attach label section below)

---

## Move card to list

**Use `.claude/bin/planka move-card`:**
```bash
.claude/bin/planka move-card <cardId> <listId> <position>
```

Details:
- **Both `listId` and `position` are required** — omitting either silently fails.
- Position conventions: first card = 65536, subsequent = 65536 × N. If inserting between cards, use midpoint.

---

## Post comment

**Use `.claude/bin/planka comment`:**
```bash
.claude/bin/planka comment <cardId> "<text>"
```

Example with branch/date:
```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)
DATE=$(date +%Y-%m-%d)
.claude/bin/planka comment <cardId> "**Code complete** — $DATE | branch \`$BRANCH\`"
```

---

## Fetch board state (cards + labels)

**Use `.claude/bin/planka board`:**
```bash
.claude/bin/planka board | python3 -c "
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
    print(f'{name:12s} {c['id']} {c['name']}')
"
```

Filter to a specific list: add `if c['listId'] == '<LIST_ID>'` before print.

---

## Scan for MULTI AGENT claimable cards

**Use `.claude/bin/planka board`:**
```bash
.claude/bin/planka board | python3 -c "
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

**Use `.claude/bin/planka delete-card`:**
```bash
.claude/bin/planka delete-card <cardId>
```

---

## Known gotchas

- **Label endpoint is `/card-labels` (kebab-case)** — not `/labels` (that returns 404).
- **Card move requires BOTH `listId` and `position`** — omitting either silently fails (returns 200 but card doesn't move).
- **Card create requires `type`** — valid values: `story`, `project`. Omitting it returns 422.
- **Label create requires `position`** parameter (e.g., 65536) — omitting it returns `E_MISSING_OR_INVALID_PARAMS`.
- **Label remove** — no working REST endpoint found. Remove labels in the Planka UI.
