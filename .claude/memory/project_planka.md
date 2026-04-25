---
name: Planka kanban board
description: Self-hosted Planka board on mmffdev.com used as team backlog, accessible via SSH tunnel on port 3333
type: project
originSessionId: b094b773-ebff-4f71-a435-1eb6d427b442
---
Planka is running on mmffdev.com in Docker at /opt/planka/, accessible via SSH tunnel on localhost:3333.

**Why:** Team backlog tool, tunnel-only access for security (no public subdomain).

**How to apply:** Use the `planka` MCP server (registered at user scope) to read/write the board. Tunnel must be up (`ssh -N -f mmffdev-pg`). Board UI at http://localhost:3333.

**Setup details:**
- Docker compose: /opt/planka/docker-compose.yml (Planka + its own Postgres)
- Named volumes: planka_db, planka_user_avatars, planka_project_bg, planka_attachments
- Admin login: admin@mmffdev.com (password set by user — update MCP after any password change)
- SMTP: routes through host Postfix (172.23.0.1:25, Docker subnet trusted via mynetworks), FROM noreply@mmffdev.com
- MCP binary: /opt/homebrew/bin/planka-mcp (npm package: planka-mcp)
- Port 3333 added to mmffdev-pg SSH tunnel alias
