---
name: GitHub identity for Vector PM project
description: Active gh CLI account is mmffdev; cookra is inactive fallback
type: reference
originSessionId: d0e7ded6-0ff4-4c9e-af9b-853c9c13dea8
---
The active `gh` CLI account for this project is **`mmffdev`** (stored in macOS keyring).

- Token scopes: `admin:public_key`, `gist`, `read:org`, `repo`, `workflow`
- Git protocol: ssh
- `cookra` account is also in the keyring but inactive — all `gh` API calls, PRs, and repo operations go out as `mmffdev`
- Repo namespace: `mmffdev/*` (e.g. `mmffdev/vector`, `mmffdev/mmff-ops`, `mmffdev/MMFFDev-WPPC`)

To switch active account later: `gh auth switch --user cookra`
