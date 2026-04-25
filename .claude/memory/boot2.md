---
name: Session bootup — Planka + tooling context
description: Read at session start to restore context for the Planka/MCP/backlog tooling work. Update when this area evolves.
type: project
originSessionId: b094b773-ebff-4f71-a435-1eb6d427b442
---
## Planka board — LIVE and ready (2026-04-25)

### Access
- URL: `http://localhost:3333` (SSH tunnel — `ssh -N -f mmffdev-pg`)
- Admin: `admin@mmffdev.com` / `changeme123!`
- **MCP fixed (2026-04-25)** — two bugs patched: `PLANKA_API_URL` corrected to `http://localhost:3333/api` in `~/.claude.json`; hardcoded `createTaskList` test call removed from `/opt/homebrew/bin/planka-mcp` (line 52). MCP tools (`mcp__planka__*`) work after Claude Code restart. REST API docs below kept as fallback.

### Planka REST API (use this instead of MCP)

```bash
TOKEN=$(curl -s -X POST http://localhost:3333/api/access-tokens \
  -H "Content-Type: application/json" \
  -d '{"emailOrUsername":"admin@mmffdev.com","password":"changeme123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['item'])")
```

**Key IDs (resolved — don't re-fetch):**
| Thing | ID |
|---|---|
| Project: Vector Project | `1760699494401311762` |
| Board: Vector Main | `1760699595475649556` |
| List: Backlog | `1760700028730475544` |
| List: To Do | `1760700252018443289` |
| List: Doing | `1760700299682513946` |
| List: Completed | `1760700351842878491` |
| List: Accepted | `1760700396512216092` |

**Create card:** `POST /api/lists/<LIST_ID>/cards` — body: `{"name":"...","description":"...","position":65536,"type":"story"}`  
**Move card:** `PATCH /api/cards/<CARD_ID>` — body: `{"listId":"<TARGET_LIST_ID>"}`  
**Delete card:** `DELETE /api/cards/<CARD_ID>`  
**List cards:** `GET /api/boards/1760699595475649556` → `included.cards[]`

### Board structure
- Project: **Vector Project** — Board: **Vector Main**
- Lists (in order): **Backlog → To Do → Doing → Completed → Accepted**
- Board was created manually by user — structure is live and ready

### Infrastructure
- Docker Compose: `/opt/planka/` on `mmffdev.com`
- Volumes: `planka_db`, `planka_user_avatars`, `planka_project_bg`, `planka_attachments`
- SMTP: host Postfix via `172.23.0.1:25`, FROM `noreply@mmffdev.com`
- Port `3333` in `mmffdev-pg` SSH tunnel alias

---

## Ownership labels (created 2026-04-25 — do not re-create)

| Label | Color | ID |
|---|---|---|
| `storify` | lagoon-blue | `1760724305328473193` |
| `backlog-cmd` | egg-yellow | `1760724306184111210` |
| `manual` | fresh-salad | `1760724307056526443` |

Applied via: `POST /api/cards/<id>/labels` — body: `{"labelId":"<id>"}`

---

## Dedup + ownership system (shipped 2026-04-25)

- `/storify` skill: `~/.claude/skills/storify/SKILL.md` — parses plan → approval list → creates cards with footer + `storify` label
- `<backlog> -a` flag: must add ownership footer + `backlog-cmd` label + run dedup check before creating
- Dedup contract documented in `docs/c_backlog.md` → "Dedup check" section
- Ownership footer format: `---\n_Agent: <skill> | <date> | <branch>_`

---

## Agent tracking contract (for reference)

- `boot2.md` tracks only **To Do / Doing / Completed** items
- **Accepted** = terminal, lives on board as history, removed from boot memory
- Never delete Accepted cards — they are the shipped changelog

---

## MCP re-registration (after password change)

```
claude mcp remove planka -s user
claude mcp add planka -s user \
  -e PLANKA_API_URL=http://localhost:3333 \
  -e PLANKA_EMAIL_OR_USERNAME=admin@mmffdev.com \
  -e PLANKA_PASSWORD=<new-password> \
  -- /opt/homebrew/bin/planka-mcp
```
