---
name: Session bootup — Planka + tooling context
description: Read at session start to restore context for the Planka/MCP/backlog tooling work. Update when this area evolves.
type: project
originSessionId: b094b773-ebff-4f71-a435-1eb6d427b442
---
## Planka board — LIVE and ready (2026-04-25)

### Access
- URL: `http://localhost:3333` (SSH tunnel — `ssh -N -f mmffdev-pg`)
- **Use `.claude/bin/planka` helper** — single entry point for all board operations. Never call curl directly.
- Agent account: `claude@mmffdev.com` (credentials in `backend/.env.local`, git-ignored)
- Admin account: separate (see project-admins for access)

**Key IDs and REST API** → see `planka_api_access.md` (authoritative).

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

Applied via: `planka label-card <cardId> <labelId>` (endpoint is `/card-labels`, not `/labels`)

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

---

## Whisper MCP (2026-04-26 — READY)

- Model: `mlx-community/whisper-large-v3-turbo` cached at `~/.cache/huggingface/hub/models--mlx-community--whisper-large-v3-turbo/` (1.5GB)
- Also: `~/.cache/whisper/large-v3-turbo.pt` (openai-whisper format, 1.5GB)
- MLX Whisper CLI: `~/Library/Python/3.9/bin/mlx_whisper`
- MCP server: `~/.claude/bin/whisper-mcp.js` (Node.js raw JSON-RPC stdio, zero deps)
- Config: `.mcp.json` → `node /Users/rick/.claude/bin/whisper-mcp.js`
- Tool: `transcribe(file_path, model?)` — returns transcript text
- **Status:** ready

---

## Adminer (2026-04-26 — customised)

- URL: `http://localhost:8081` (SSH tunnel `mmffdev-pg`)
- Docker: `/opt/adminer/` on remote, `adminer:4` image
- **Default changed to SELECT DATA** — plugin at `/opt/adminer/plugins-enabled/select-default.php`
- Plugin injects JS that rewrites sidebar `table=` links → `select=` on page load
- Volume mount added to docker-compose for persistence

---

## Remote services port map (all via SSH tunnel `mmffdev-pg`)

| Local port | Service | Remote path |
|---|---|---|
| `3333` | Planka kanban | `/opt/planka/` |
| `5434` | Postgres (mmff_vector) | — |
| `8081` | Adminer | `/opt/adminer/` |
| `8083` | **API Reference docs** | `/opt/api-reference/` |
| `9000` | Portainer | — |
| `15672` | RabbitMQ management | — |

**Separate tunnel** `mmffdev-homepage`: `localhost:8082` → remote port 3000 (Homepage dashboard)

Restart tunnel: `pkill -f "ssh.*mmffdev-pg" && ssh -N -f mmffdev-pg`

---

## API Reference Docs Site (localhost:8083)

**Local scaffold:** `api-reference/` in repo root  
**Remote:** `/opt/api-reference/docker-compose.yml` — `mmffdev/api-reference:latest` on `127.0.0.1:8083:80`  
**Deploy:** `cd api-reference && ./deploy.sh` — builds `linux/amd64` image (buildx), pipes via SSH, restarts container  
**Current state:** Default Docusaurus scaffold live. Content not yet written.
