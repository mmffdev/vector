---
name: Project Infrastructure & Deployment
description: Platform stack, hosting, and deployment environment for MMFFDev-PM
type: project
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
**Project:** MMFFDev - PM (Enterprise Agile SaaS Platform)

**Stack:**
- Backend: Go (chi router, pgx/v5, JWT auth, httprate)
- Frontend: React (Next.js 15, App Router)
- Database: PostgreSQL inside Docker container
- UI Design Language: Vector (CSS-first, oklch colors, semantic tokens)

**Hosting & Infrastructure:**
- Server: Linux Ubuntu (Plesk control panel)
- Database: PostgreSQL running in Docker container on the same server
- Developers access staging/production databases **exclusively via encrypted SSH tunnels** (no direct port exposure)
- Docker for consistency across environments

**Architecture:**
- Three user personas with role-based access in single app (`<user>`)
- Global admin (`<gadmin`) — superuser, sets tenant scopes and delegates permissions
- Product admins (`<padmin`) — Product Leads with delegated scopes, manage assigned areas
- Ringfenced dev tooling (`<dev>`) — independent folder, plug-and-play, detachable without touching core code

**Why this matters:**
Security model requires zero-trust for auth/access. Multi-tenant isolation at database row level. All infrastructure decisions should account for these constraints.
