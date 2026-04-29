---
name: App is stateless and DB-driven — server irrelevant to data consistency
description: mmff-Ops frontend is a dead app with no caching or reactive state. All data reads fresh from the DB on each view. Server being up/down is orthogonal to data integrity.
type: project
originSessionId: 086ca3bd-6197-49d0-9c29-1d3bc8ea7ae9
---
The app is **stateless** and **DB-driven**:
- No caching; each view reads fresh from the DB
- No session state beyond auth tokens
- No admin-bus events or reactive updates needed
- Server availability does not affect data consistency

**Why:** The frontend is a "dead app" that renders whatever the DB contains at render time. There is no in-memory cache to invalidate, no client subscriptions to notify, no state divergence risk between server and app.

**How to apply:**
- When mutating the DB for sprint transitions, features, or state changes, skip the server-based API flow
- Mutate the DB directly via psql (port 5434, SSH tunnel) — the app will read the new state on next page load
- No need to start the server unless humans need to actively use the UI while work happens
- Protocol requirements for "atomic API transactions" and "post-condition verification" are unnecessary — the DB is the single source of truth, and reads are always fresh
- Do not emit admin-bus events or fire reactive updates

