# `<backlog>` — Planka kanban board

> Lazy-loaded. Load only when the user invokes `<backlog>` or asks about open work.

Backlog lives in Planka at `http://localhost:3333` (SSH tunnel must be up — `ssh -N -f mmffdev-pg`).

- **REST templates + gotchas** → [`c_c_planka_rest.md`](c_c_planka_rest.md)
- **Agent contract, labels, parallel claim** → [`c_c_backlog_agent.md`](c_c_backlog_agent.md)
- **Dedup check script** → [`c_c_backlog_dedup.md`](c_c_backlog_dedup.md)

## Board

Project: **Vector Project** — Board: **Vector Main**

| List | Who moves it | Meaning |
|---|---|---|
| `Backlog` | `/storify` or `-a` flag | All ideas |
| `To Do` | Agent on pickup | Scoped, ready |
| `Doing` | Agent when active | In flight |
| `Completed` | Agent when code-done | Awaiting user test |
| `Accepted` | User only | Tested + terminal |

## Flags

| Flag | Action |
|---|---|
| `-n` (or no flag) | List **Backlog** + **To Do** + **Doing** cards |
| `-a "<text>" [-f]` | Create card in **Backlog** (dedup check; `-f` forces; adds footer + `backlog-cmd` label) |
| `-d` | List **Completed** cards awaiting test |
| `-accept <id>` | Move card to **Accepted** |
| `-h` | Print this flags table |

## Card format

Name: `<short title>` — description holds AC, context, ownership footer. Self-contained, readable cold.

## Notes

- Tunnel down → `ssh -N -f mmffdev-pg` first.
- MCP auth fail → re-register: `claude mcp remove planka -s user && claude mcp add planka -s user -e PLANKA_API_URL=http://localhost:3333 -e PLANKA_EMAIL_OR_USERNAME=admin@mmffdev.com -e PLANKA_PASSWORD=<new> -- /opt/homebrew/bin/planka-mcp`
- **Accepted cards are history** — never delete, never move back.
