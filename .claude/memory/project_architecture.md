---
name: Project Architecture & Tech Stack
description: Full-stack SaaS E2E, backend-driven, frontend display layer only
type: project
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
**Full-stack SaaS E2E architecture.** Backend handles all business logic, persistence, permissions enforcement. Frontend is a display layer — no data processing, no auth enforcement, no role logic.

**Why:** Separation of concerns. Backend is source of truth for all security, permissions, and data validation. Frontend is stateless presentation only.

**How to apply:**
- All API calls go through a backend service (not direct DB, not direct third-party APIs)
- Frontend fetches data, renders it, sends user actions back to backend
- Role-based access control enforced on backend; frontend just hides/shows UI based on role prop received from backend
- No business logic in React — calculations, validations, permission checks all happen server-side
- Environment: IONOS Linux + Plesk + Ubuntu, Node.js + Docker available

**Tech Stack:**
- Frontend: Next.js 15 App Router (SPA-like experience with SSR capability)
- Backend: Building from scratch (language/framework TBD)
- Hosting: IONOS Plesk with Docker, can deploy both frontend and backend containers
- Real-time: Scalable via WebSockets if needed; backend handles subscriptions
- Database: TBD

**Build Order:** Frontend shell → API contract definition → Backend services → Integration
