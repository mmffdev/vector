---
name: Vector PM repo is private
description: Remote repo is private, so committing env files and secrets is acceptable
type: project
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
The Vector PM (MMFFDev - PM) git remote is a **private** repository. Committing `.env.local`, tracked secrets, dev credentials, and internal config files is acceptable — they're not exposed publicly.

**Why:** User confirmed explicitly on 2026-04-22 when asked whether to stage `backend/.env.local` in a broad commit.

**How to apply:** Don't scope commits to exclude `.env*`, secret files, or internal config on this project. Still flag *new* secret values being introduced (in case of accidental paste), but no need to split commits to avoid including tracked-env changes.
