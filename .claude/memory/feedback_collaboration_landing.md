---
name: User values end-to-end ownership on Vector PM features
description: User responds well when a feature is driven through every layer (DB → backend rebuild/restart → frontend → CSS → sidebar) without being asked to chase loose ends
type: feedback
originSessionId: bbf83995-114e-4228-9963-88c777ddc53b
---
When implementing a feature on Vector PM, do not stop at "code compiles". The user appreciates when the chain is taken all the way through:

- DB migration applied to live Postgres
- Go backend rebuilt AND the running `./server` process restarted (stale binary will silently drop new JSON fields)
- Frontend types + UI + save payload + hydration
- Read-side consumers (sidebar etc.) updated to honour the new field
- CSS for any new UI

**Why:** During the icon-override build the user said "honestly..... i am so impressed with your input here its truly 3026!" specifically after the assistant noticed the running backend binary was stale, rebuilt it, and restarted it without being asked — closing the persistence loop end-to-end.

**How to apply:** On any feature touching DB + backend + frontend, treat "did the change actually round-trip on the live stack?" as part of the definition of done. Check `ps` for stale `./server` / dev processes and restart when their on-disk binary predates the code change.
