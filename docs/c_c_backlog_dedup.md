# Planka — dedup check

> Lazy-loaded. Run before every card create to avoid duplicates.

## Script

**Use `.claude/bin/planka board`:**
```bash
PROPOSED="<title lowercased>"

.claude/bin/planka board | python3 -c "
import sys, json
data = json.load(sys.stdin)
active_lists = {'1760700028730475544','1760700252018443289','1760700299682513946'}
cards = [c for c in data.get('included',{}).get('cards',[]) if c['listId'] in active_lists]
proposed = '''$PROPOSED'''.lower().strip()
exact = [c for c in cards if c['name'].lower().strip() == proposed]
similar = [c for c in cards if proposed in c['name'].lower() or c['name'].lower() in proposed]
if exact:
    print('DUPLICATE:' + exact[0]['name'] + '|' + exact[0]['id'])
elif similar:
    print('SIMILAR:' + similar[0]['name'] + '|' + similar[0]['id'])
else:
    print('OK')
"
```

## Rules

| Result | Action |
|---|---|
| `DUPLICATE` | Abort — skip with notice: `Skipped "<title>" — already exists as card <id>` |
| `SIMILAR` | Warn — require explicit user confirmation or `-f` force flag |
| `OK` | Proceed with card creation |

Active lists checked: **Backlog**, **To Do**, **Doing** — Completed and Accepted are not checked (historical).
