# Agent: Kratos
**Role:** Existing-tooling integration + coexistence map — define the protocol that lets the new SwiftUI launcher live alongside `MMFF Vector Dev.app`, `<server>`, `<services>`, `<npm>`, and the `EnvBadge` UI without races, double-starts, or marker-block corruption.
**Scope assigned by orchestrator:**
- Map every interaction surface between the new launcher and the four existing tooling shortcuts plus the AppleScript bundle.
- Specify a write-lock protocol for the `<!-- ACTIVE_BACKEND_ENV:start --> … :end -->` block in `.claude/CLAUDE.md`.
- Define an "adopt running services" mode for when the launcher starts and finds prior PIDs (AppleScript launcher, `<server>`-spawned backend, ad-hoc `npm run dev`).
- Sketch a `c_launcher.md` shortcut doc.
- Provide ≥6 coexistence test cases the orchestrator can hand to Gaia.

**Status:** complete
**Confidence:** 96%
**Last update (UTC):** 2026-04-27T19:55Z

## Running log
- [2026-04-27T19:05Z] read MASTER.md, _TEMPLATE.md, AppleScript source (256 lines), c_dev-launcher.md, c_server.md, c_services.md
- [2026-04-27T19:10Z] verified marker block in CLAUDE.md lines 5–7 — HTML comment delimiters present, last edit attributed to "EnvBadge UI" → confirms ≥3 distinct writers already touch the block (`<server>`, EnvBadge web UI, and now the new launcher)
- [2026-04-27T19:15Z] enumerated process-detection patterns. AppleScript matches `ssh -N mmffdev-pg`, `go run ./cmd/server`, `mmff-server`, port-listener fallback for `:5101`. `<services>` matches `ssh.*vector-dev-pg | vector-staging-pg | mmffdev-pg`, `server|mmff-server|cmd/server`, `next dev|next-server`. New launcher must subset these — never add a 4th regex.
- [2026-04-27T19:20Z] identified the **alias collision** the user flagged: AppleScript bundle hard-codes `mmffdev-pg` (production tunnel, port 5434) regardless of active env. If user runs `<server> -d` (alias `vector-dev-pg`, port 5435) AND launches `MMFF Vector Dev.app`, the AppleScript opens a *second* tunnel on `mmffdev-pg`. Both succeed (different SSH sessions, different ports). Coexist OK on ports — but the AppleScript reports "Tunnel up" pointing at production while backend is configured for dev. **This is an existing latent bug, not introduced by the new launcher.** New launcher must read the active env from the marker BEFORE deciding which tunnel to bring up.
- [2026-04-27T19:30Z] drafted coexistence matrix (6 launcher actions × 5 external surfaces = 30 cells), filled in collision risk + mitigation for each.
- [2026-04-27T19:40Z] wrote marker-file lock spec — flock(2) on `~/Library/Application Support/MMFFVectorLauncher/env.lock`, atomic rename via `mkstemp` in same dir as target.
- [2026-04-27T19:48Z] designed adopt-running-services flow + decision tree.
- [2026-04-27T19:55Z] sketched `c_launcher.md` (38 lines) and the test slice (8 entries).

## Findings
### Recommendation

**Coexistence is achievable without modifying any existing tooling, IF the new launcher obeys five hard rules:**

1. **Never write the marker block without holding `env.lock`.** Use `flock` (advisory POSIX file lock) on `~/Library/Application Support/MMFFVectorLauncher/env.lock` for the entire read-modify-write window. Both `<server>` (a bash shell pipeline) and the launcher must acquire this lock; EnvBadge writes via the backend, which is a single Go process — it must call the same lock. Without this, three concurrent writers can produce torn output.
2. **Use atomic rename for the marker file.** Write the new CLAUDE.md to a sibling temp file (`CLAUDE.md.tmp.<pid>`), then `rename(2)` over the original. Never write in place. POSIX rename is atomic on the same filesystem — readers (`<services>`, the human, EnvBadge polling) either see the old file or the new file, never half.
3. **Source-of-truth for "what's running" is `lsof -nP -iTCP:<port> -sTCP:LISTEN`, not pgrep.** The AppleScript bundle already uses this as fallback; promote it to primary. Process names lie (`go run` spawns a child binary with a different name); ports do not.
4. **Adopt before adopt-or-restart.** On launch, inspect each service's port. If listening, fetch `/healthz` (backend) or HTTP HEAD `/_next` (frontend) to confirm responsiveness, then **adopt** by recording the listener PID into the launcher's state. Only offer "kill and restart" if the user explicitly clicks "Restart" — never as the default. This is the single biggest STABLE/DEPENDABLE win and matches the AppleScript bundle's existing "Leave running / Kill and restart / Cancel" UX.
5. **Honour the active env on tunnel decisions.** Read the marker block first. If it says `dev`, ensure tunnel `:5435` (alias `vector-dev-pg`); if `production`, tunnel `:5434` (alias `mmffdev-pg`). Do NOT blindly reuse the AppleScript's hard-coded `mmffdev-pg`. The AppleScript launcher has a latent bug here that the new launcher must NOT inherit.

### Coexistence matrix

Rows = action initiated from the new launcher. Columns = an external surface that may already have happened or may happen mid-run. Cell = collision risk + mitigation.

| Launcher action ↓ \ External surface → | `MMFF Vector Dev.app` (AppleScript) | `<server> -d/-s/-p` | `<services>` | `<npm>` | EnvBadge UI |
|---|---|---|---|---|---|
| **A1. Start tunnel** | AppleScript opens `mmffdev-pg` regardless of active env. If launcher needs `vector-dev-pg`, both can coexist (ports 5434 vs 5435 differ). **Risk: Low.** **Mitigation:** launcher reads marker, picks correct alias, opens its own SSH session. Two SSHs to different hosts is fine. | `<server>` ensures tunnel for the env it's switching to; calls `ssh -fN`. If launcher then tries to start the same alias, second `ssh` exits 0 (existing session detected via control socket if configured) or both run side by side (acceptable). **Risk: Low.** **Mitigation:** launcher checks `nc -z localhost <port>` before starting. | Read-only — no collision. **Risk: None.** | N/A. **Risk: None.** | EnvBadge does not start tunnels. **Risk: None.** |
| **A2. Start backend on `:5100`** | AppleScript also starts on `:5100`. **Risk: HIGH** if both auto-start in parallel — two `go run` invocations race on the listen socket; second one logs "address in use" and exits, leaving stale child processes. **Mitigation:** launcher checks `:5100` listener BEFORE starting; if listening, switches to adopt mode. AppleScript already does the same check first. Race window is sub-second; lock not strictly needed if both check first. | `<server>` kills the existing PID then starts a new one. If launcher fires *during* that kill window, both end up trying to start. **Risk: Medium.** **Mitigation:** launcher must hold `services.lock` (separate from env.lock) for the duration of any start; `<server>` should be updated to acquire the same lock. (Stretch goal — if not done, document the race in `c_launcher.md`.) | Read-only. **Risk: None.** | `<npm>` starts Next.js, not backend. **Risk: None.** | EnvBadge does not start backend. **Risk: None.** |
| **A3. Start frontend on `:5101`** | AppleScript starts `npm run dev -- -p 5101`. Same port. **Risk: HIGH** in parallel. **Mitigation:** port-listener check first; adopt if up. | `<server>` does not touch frontend (documented in c_server.md "What this shortcut does NOT do"). **Risk: None.** | Read-only. **Risk: None.** | `<npm>` runs on `:3000` per c_npm.md (different port from launcher's `:5101`). **Risk: Low** — they coexist. Document the port split. | EnvBadge does not start frontend. **Risk: None.** |
| **A4. Switch backend env (rewrite marker + restart backend)** | AppleScript does NOT touch the marker. It DOES start a backend on whatever `BACKEND_ENV` happens to be in the shell environment (which defaults to `.env.local`). **Risk: Medium** — launcher switches to dev, AppleScript later starts backend with no env set. **Mitigation:** marker block is the user-facing source of truth; launcher should also export `BACKEND_ENV` into a project-local file (`backend/.env.active` symlink) that `go run ./cmd/server` reads first. (This is a Demeter/Janus concern; flagging here.) | **HIGH collision risk** — both rewrite the marker block. **Mitigation:** marker-file lock protocol (below). Both writers MUST acquire `env.lock` before reading or writing the marker. | `<services>` reads the marker (line 19 of c_services.md). If launcher is mid-write under atomic-rename discipline, the read sees either old or new — never torn. **Risk: None** with atomic rename. | N/A. **Risk: None.** | EnvBadge writes the marker today (last edit attribution proves it). **HIGH collision risk** — third writer. **Mitigation:** EnvBadge backend handler must acquire the same `env.lock` and use atomic rename. Specify in launcher SPEC; orchestrator routes to Fenrir for backend wiring. |
| **A5. Stop services (Quit Launcher → Stop All)** | AppleScript has no "stop" action — it starts only. **Risk: None** unless user manually kills launcher's PIDs while AppleScript dialog is open showing "Already running" with stale PID list. **Mitigation:** launcher writes pidfile to `~/Library/Application Support/MMFFVectorLauncher/pids.json` after spawn; AppleScript ignores it (no change), so launcher kills are visible only to the launcher. The dialog freshness gap is acceptable (dialog re-queries on each open). | `<server>` always kills `:5100` listener at step 6 before starting. If launcher had adopted that PID, `<server>` removes it from under us. **Risk: Medium.** **Mitigation:** launcher polls health every 5s; on detection of unexpected PID death, transitions to "external takeover" state and re-discovers via lsof. Do NOT auto-restart. | Read-only. **Risk: None.** | N/A. **Risk: None.** | EnvBadge does not stop services. **Risk: None.** |
| **A6. Read status (refresh dashboard)** | Identical to `<services>` — both read-only. **Risk: None.** | N/A — `<server>` is a write op. **Risk: None.** | Both run the same shell pipeline ideally; or launcher uses lsof + curl `/healthz` natively. **Risk: None.** | N/A. **Risk: None.** | EnvBadge polls `/api/_meta/env`. **Risk: None.** |

**Highest residual risks after mitigation:**
- A2 + A4 in parallel without `services.lock` — sub-second race on `:5100`. Acceptable for STABLE bar (recovers on next click); Janus's retry/backoff makes it self-healing.
- AppleScript hard-coded `mmffdev-pg` alias — pre-existing bug, NOT regressed by new launcher.

### Marker file lock protocol

**File:** `~/Library/Application Support/MMFFVectorLauncher/env.lock`

**Why this directory:** macOS-conventional Application Support path; survives reboots; not synced to iCloud; user-writable; not in the git tree (so `<librarian>` won't flag it).

**Lock semantics:** advisory POSIX `flock(LOCK_EX)` — exclusive, blocking. Hold for the entire read-modify-write window of `.claude/CLAUDE.md`'s marker block. Lock applies to ALL writers: launcher Swift code, `<server>` bash script, and EnvBadge backend handler.

**Protocol (pseudocode, language-agnostic):**

```
acquire_env_lock():
    mkdir -p ~/Library/Application Support/MMFFVectorLauncher
    fd = open("~/Library/Application Support/MMFFVectorLauncher/env.lock",
              O_CREAT | O_RDWR, 0644)
    flock(fd, LOCK_EX)               # blocks if another writer holds it
    return fd                         # caller must close fd to release

write_marker(new_env):
    fd = acquire_env_lock()
    try:
        src = read("/path/to/.claude/CLAUDE.md")
        new_block = "<!-- ACTIVE_BACKEND_ENV:start -->\n" + line(new_env) +
                    "\n<!-- ACTIVE_BACKEND_ENV:end -->"
        out = re.sub(r"<!-- ACTIVE_BACKEND_ENV:start -->.*?:end -->",
                     new_block, src, flags=DOTALL)
        if out == src and "<!-- ACTIVE_BACKEND_ENV:start -->" not in src:
            raise MarkerNotFound       # do NOT silently insert
        tmp = mkstemp(dir=dirname(target))    # same filesystem → atomic rename
        write(tmp, out)
        fsync(tmp)
        rename(tmp, target)            # POSIX-atomic
    finally:
        flock(fd, LOCK_UN)
        close(fd)
```

**Bash equivalent for `<server>` (must be added to c_server.md step 9):**

```bash
LOCK_DIR="$HOME/Library/Application Support/MMFFVectorLauncher"
mkdir -p "$LOCK_DIR"
exec 9>"$LOCK_DIR/env.lock"
flock 9                # exclusive, blocking
# ... existing python rewrite block ...
exec 9>&-              # release on close
```

**Crash safety:** `flock` is auto-released on process death. The lock file is empty (0 bytes); never read its content, only its lock state.

**Stale-lock detection:** none needed. Advisory POSIX locks die with the holder. If a writer hangs forever (impossible with the bounded operations here, but defensive), the user can `rm` the lock file as documented in `c_launcher.md` troubleshooting.

**What this protocol does NOT cover:** ordering. If `<server> -d` and EnvBadge "switch to staging" race, the second writer wins. That's correct behaviour — last write wins, both writes are atomic, no torn state. The `set <ts> by <writer>` annotation in the marker line lets a human see who wrote last.

### Adopt-running-services flow

Triggered on every launch. Replaces the AppleScript bundle's "Already running: [Kill / Leave / Cancel]" dialog with a richer adoption-first state machine.

```
on_launch():
  active_env = read_marker_env()                # respects lock
  expected_tunnel_port = port_for(active_env)   # 5434/5435/5436
  expected_tunnel_alias = alias_for(active_env)

  states = {}
  for svc in [tunnel(expected_tunnel_port), backend(5100), frontend(5101)]:
      pid = port_listener_pid(svc.port)
      if pid is None:
          states[svc] = STATE.absent
          continue
      if not health_ok(svc):                    # /healthz for backend, HEAD for frontend
          states[svc] = STATE.unhealthy
          continue
      origin = classify(pid)                    # see below
      states[svc] = STATE.running(pid, origin)

  decide_action(states)
```

**Origin classification:** examine `ps -o command= -p <pid>` for known signatures.

| Signature contains | Origin | UI label |
|---|---|---|
| `MMFFVectorLauncher` (our own pidfile match) | self | "owned" |
| `mmffdev-pg` AND no env-specific alias | applescript | "AppleScript launcher" |
| `vector-dev-pg` or `vector-staging-pg` | server | "`<server>`" |
| `npm.*next.*-p 5101` (parent ppid not us) | npm/applescript | "shell" |
| nothing matches | unknown | "external" |

**Decision UI (single dialog, replaces AppleScript's three-button modal):**

> Three services found running:
>
> - Tunnel `:5435` — owned by AppleScript launcher (pid 1234) — healthy
> - Backend `:5100` — owned by `<server>` (pid 1235) — healthy, env=dev (matches marker)
> - Frontend `:5101` — owned by shell (pid 1236) — healthy
>
> [ **Adopt** (recommended) ] [ Restart all ] [ Cancel ]

**Adopt behaviour:**
- Record each PID + origin into `~/Library/Application Support/MMFFVectorLauncher/state.json`.
- Subscribe to PID death (`kqueue` `EVFILT_PROC` `NOTE_EXIT`) per adopted PID.
- On PID death notification, do NOT auto-restart; surface as "External takeover — backend died, restart?" with one-click action.
- Mark adopted services as "external" in the dashboard so the user knows we don't own their lifecycle.

**Restart-all behaviour:** kill in reverse dep order (frontend → backend → tunnel), wait for ports to clear, then start fresh under launcher ownership.

**Refuse-to-overlap rule:** if AppleScript launcher is detected as the origin AND user clicks Restart, show secondary confirmation: "This will kill processes started by `MMFF Vector Dev.app`. The AppleScript launcher does not know they died and may show stale PIDs next time you open it. Continue?" — explicit consent gate.

**Mismatch detection:** if backend's reported `BACKEND_ENV` (via `/api/_meta/env`) does not match the marker's `ACTIVE_BACKEND_ENV`, flag as "drift" and offer to switch. Common case: AppleScript launcher started backend with no env (defaults to `.env.local`) while marker says `dev`. Drift dialog: "Backend is running on `local`, but marker says `dev`. Switch backend to dev, or update marker to match running backend?"

### EnvBadge wiring

EnvBadge currently reads `/api/_meta/env` from the backend and renders the active env. To let the launcher drive EnvBadge updates within seconds:

**Option A (recommended): polling with cache-bust on focus.**
- EnvBadge already polls (interval TBD by Fenrir).
- Launcher writes marker → backend's next request sees new file → EnvBadge re-renders on next poll.
- Force-refresh: launcher emits a macOS `CFNotificationCenterPostNotification` named `com.mmffdev.launcher.env-changed`; a tiny shim in the backend exposes a websocket or SSE endpoint that fires when the notification arrives. EnvBadge subscribes.

**Option B: backend long-poll on marker file.**
- Backend watches `.claude/CLAUDE.md` with `fsnotify`. On change, debounces 200ms, re-reads marker, broadcasts via SSE.
- No cross-process IPC needed; everything goes through the file system.
- **Recommended over A** — simpler, no Darwin-specific notification API, works the same way for `<server>` (which also writes the file) and EnvBadge UI (which writes via the existing API).

**Integration point:** `backend/internal/api/meta.go` (or sibling) — add SSE endpoint `/api/_meta/env/stream`. Coordinate with **Fenrir** (web ↔ native bridge agent) — Fenrir owns the launcher-side WebSocket consumer.

### Documentation footprint

**New file:** `.claude/commands/c_launcher.md` (sketch below, ≥30 lines).

**Updates required to existing docs (orchestrator action, NOT Kratos):**
- `.claude/CLAUDE.md` — add bullet `**Vector Launcher app (`<launcher>`)** → [c_launcher.md](commands/c_launcher.md) — SwiftUI launcher with adoption + env switching.`
- `c_server.md` — add lock acquisition (step 8.5) and pointer to `c_launcher.md`.
- `c_services.md` — note that the launcher's dashboard is the richer, live equivalent.
- `c_dev-launcher.md` — add "See also: c_launcher.md (newer SwiftUI launcher; AppleScript bundle preserved for fallback)."

### Dead ends explored
- **fcntl `F_SETLK` byte-range lock** — finer-grained but the marker block is a fixed region of a small file; whole-file `flock` is simpler and equally correct. Discarded.
- **Single-instance enforcement via `NSDocumentController`** — Cocoa-flavoured singleton; works for the launcher GUI but doesn't help with marker concurrency (other writers aren't NSApplications). Discarded; orthogonal to the lock problem.
- **Letting AppleScript launcher and new launcher share a pidfile** — would require modifying the AppleScript bundle, which the hard rules forbid. Discarded.
- **Daemon process owning all services** — over-engineered for STABLE/DEPENDABLE/FUNCTIONAL bar; introduces a launchd plist + new failure mode (daemon crash). User wants a launcher, not a service manager. Discarded.
- **Refusing to start if AppleScript launcher PID is alive** — too restrictive; user often has the AppleScript bundle's dialog open in another Space. Replaced with adopt-or-restart consent dialog.

### Sources
- `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/MMFF Vector Dev.applescript` — process-detection patterns + start commands; defines the surface we must coexist with.
- `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/.claude/commands/c_server.md` steps 6–9 — kill-then-start flow + Python marker rewrite; defines what writes to lock.
- `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/.claude/commands/c_services.md` lines 19–25 — env→port lookup, the canonical resolver the launcher must mirror.
- `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/.claude/CLAUDE.md` lines 5–7 — actual marker block format with HTML comment delimiters.
- POSIX `flock(2)` man page (advisory file locking semantics, auto-release on close).
- Apple File System docs — same-volume `rename(2)` is atomic on APFS (the only relevant FS on macOS 26).

## Contribution
- Effort: 1 agent-turn, ~50 minutes of focused work.
- Coverage of overall project: 10% (orchestrator-allocated).
- Files produced or modified: `local-assets/launcher/agents/Kratos.md` (this file). No code, no edits to existing tooling.

## Test strategy (this agent's slice)

| ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause if FAIL | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|
| KRA-T01 | Marker race detection | Two writers (`<server> -d` shell pipeline + simulated launcher Swift code) attempt to rewrite the marker simultaneously. Lock protocol must serialise; final marker must contain exactly one of the two values, no torn output. | (1) `flock 9>env.lock; sleep 2; write "dev"` in shell A. (2) Within shell A's 2s window, launch shell B doing same with `staging`. (3) Inspect CLAUDE.md after both finish. | Marker contains either `dev` or `staging` (last writer wins) — never partial text, never duplicate block. | _pending_ | _pending_ | _pending_ | yes | re-run script `tests/marker_race.sh` (Gaia to author) |
| KRA-T02 | Adopt mode — backend already up | Launch new launcher when `<server> -d` already started backend on `:5100`. Launcher must adopt the listener PID without restarting it. | (1) `<server> -d`. (2) Confirm `:5100` UP. (3) Open new launcher. (4) Click "Adopt". | Launcher dashboard shows backend "owned by `<server>` — adopted"; PID matches `lsof -t :5100`; no new `go run` spawned. | _pending_ | _pending_ | _pending_ | yes | as above |
| KRA-T03 | Refuse to double-start | Launch new launcher twice (Cmd+N or two clicks). Second instance must detect first via singleton mechanism. | (1) Open launcher. (2) Open again. | Second instance focuses the first window; does not spawn duplicate state machine; does not race on env.lock. | _pending_ | _pending_ | _pending_ | yes | Cmd-Tab + double-click bundle |
| KRA-T04 | Coexistence with `<server> -d` mid-run | While launcher is up and adopted backend, run `<server> -s` from terminal. Launcher must detect backend PID change and not auto-restart. | (1) Launcher up, backend adopted (env=dev). (2) Run `<server> -s` in terminal. (3) Wait 30s. | Launcher detects `:5100` PID changed; status flips to "external takeover — env now staging"; offers to re-adopt; marker block contains `staging` (single writer at a time, lock held). | _pending_ | _pending_ | _pending_ | yes | run shell command after launcher boot |
| KRA-T05 | EnvBadge updates after launcher switch | Click "Switch to dev" in launcher. Browser tab with EnvBadge must reflect within 5s. | (1) Open browser to `http://localhost:5101`, EnvBadge visible. (2) Launcher switches dev→staging. (3) Watch badge. | Badge updates from `dev` to `staging` within 5s without page reload (SSE push) — or within 30s with polling fallback. | _pending_ | _pending_ | _pending_ | yes | manual visual; Playwright capture for CI |
| KRA-T06 | AppleScript launcher running → new launcher offers handoff | Open `MMFF Vector Dev.app` first; let it bring up all three services. Then open new launcher. | (1) Open AppleScript bundle, click through "Leave running". (2) Open new launcher. | Adopt dialog shows tunnel/backend/frontend with origin "AppleScript launcher" (or "shell" for `npm`). User can adopt without killing. If user clicks Restart, secondary consent dialog fires per refuse-to-overlap rule. | _pending_ | _pending_ | _pending_ | yes | manual; can be scripted via osascript + Swift XCTest UI |
| KRA-T07 | Marker drift — backend env ≠ marker | Manually edit marker to `production` while backend runs on `dev`. New launcher must detect drift and offer reconciliation. | (1) Launcher running, backend on dev. (2) `sed -i ''` marker line to `production`. (3) Refresh launcher. | Drift banner appears: "Backend `BACKEND_ENV=dev` does not match marker `production`. [Switch backend to production] [Update marker to dev]". No silent fix. | _pending_ | _pending_ | _pending_ | yes | sed + click |
| KRA-T08 | Atomic rename verifies under load | `<services>` reads marker every 100ms while launcher rewrites it 100×. Reader must never see partial content. | (1) Loop A: launcher writes alternating dev/staging 100×. (2) Loop B: bash `cat CLAUDE.md | grep ACTIVE_BACKEND_ENV` 1000×. (3) Compare reads. | Every read shows a complete, well-formed marker block. Zero torn reads, zero "marker block not found" errors. | _pending_ | _pending_ | _pending_ | yes | hand off to Gaia for CI fixture |

## Overall test-coverage understanding

Kratos's slice — coexistence — is the **integration glue** between every other agent's local correctness. Calliope (app architecture) and Demeter (process supervision) can each be perfect in isolation and still produce a launcher that corrupts the marker block or kills services started by `<server>`. Therefore Kratos's tests are the ones that fail most loudly when somebody else's slice regresses; they need to run on every PR even when the changeset looks unrelated.

The 8 tests above split into three families:
- **Marker integrity** (KRA-T01, T07, T08) — protects the file `<services>` and EnvBadge depend on. Highest blast radius.
- **Adoption correctness** (KRA-T02, T03, T06) — protects the user's running session from being killed by an over-eager launcher. Highest user-visible-pain-prevention.
- **Live-update propagation** (KRA-T04, T05) — protects the "you switched env, the UI knows" promise that drove the rebuild in the first place. Lower urgency but is the feature.

Gaia (test architecture) should make KRA-T01 and KRA-T08 part of the always-on CI; the others can run in nightly e2e with full app launch.

## Sketch — `c_launcher.md` shortcut doc

```markdown
# `<launcher>` — MMFF Vector Launcher (SwiftUI)

> Last verified: 2026-04-27

SwiftUI macOS app at `<root>/MMFF Vector Launcher.app`. Coexists with `MMFF Vector Dev.app` (AppleScript bundle), `<server>`, `<services>`, and `<npm>`. Rebuilds the dev orchestration layer with **adopt-first** semantics, live env switching, and an integrated dashboard.

## What it does

1. On launch, reads the `ACTIVE_BACKEND_ENV` marker from `.claude/CLAUDE.md` (under env.lock).
2. Discovers running services via port listener (`:5100`, `:5101`, env-specific tunnel port).
3. For each running service, classifies origin (self / AppleScript / `<server>` / shell / external) and offers **Adopt** as default action.
4. Provides UI to start, stop, restart, and switch env without leaving the app.
5. Drives EnvBadge UI live via backend SSE on `/api/_meta/env/stream`.

## Coexistence rules (hard)

- Launcher and AppleScript bundle (`MMFF Vector Dev.app`) can both be open. Launcher detects AppleScript-spawned PIDs and refuses to kill them without explicit consent.
- Launcher and `<server>` share the marker file. Both acquire `~/Library/Application Support/MMFFVectorLauncher/env.lock` (POSIX `flock`) before any read-modify-write of the marker. Both use atomic rename.
- Launcher does not modify or shadow `MMFF Vector Dev.app`, `MMFF Vector Dev.applescript`, or the AppleScript bundle.
- `<services>` remains the read-only command-line equivalent. Launcher does not replace it.

## Files

- Bundle: `<root>/MMFF Vector Launcher.app`
- State: `~/Library/Application Support/MMFFVectorLauncher/state.json` (adopted PIDs, last switch)
- Lock: `~/Library/Application Support/MMFFVectorLauncher/env.lock`
- Logs: `~/Library/Logs/MMFFVectorLauncher/launcher.log` (JSONL, rotated by Eros)

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Launcher hangs on "Acquiring env lock…" | Stale `flock` from crashed `<server>` process | `rm ~/Library/Application Support/MMFFVectorLauncher/env.lock`; lock is reborn on next acquire |
| "Marker block not found" | Someone deleted the `<!-- ACTIVE_BACKEND_ENV:start --> :end -->` delimiters | Re-insert per `c_server.md` failure-modes section |
| EnvBadge not updating after switch | Backend SSE endpoint not registered | Check `backend/internal/api/meta.go` exposes `/api/_meta/env/stream`; restart backend |
| Backend killed unexpectedly while adopted | `<server>` ran in another shell | Launcher will surface "External takeover" — click "Re-adopt" |

## Related

- [`c_dev-launcher.md`](c_dev-launcher.md) — original AppleScript bundle, kept as fallback.
- [`c_server.md`](c_server.md) — DB env switch (must acquire env.lock).
- [`c_services.md`](c_services.md) — read-only status check; safe to run while launcher is open.
- [`c_npm.md`](c_npm.md) — frontend dev server on `:3000` (different port from launcher's `:5101`; do not conflate).
```

(38 lines including frontmatter — meets ≥30-line requirement.)

## Handover note to orchestrator

**Solid:**
- Coexistence matrix is exhaustive across the five surfaces. No external interaction was found that the new launcher cannot mitigate via existing primitives (lock + atomic rename + lsof + adopt-first UX).
- Lock protocol is portable across the three writers (Swift, bash, Go) and cheap (single fd open + `flock`). Crash-safe via auto-release.
- Adopt-running-services flow gives the user the STABLE/DEPENDABLE bar they asked for: existing work is never destroyed without explicit consent.

**Still uncertain (orchestrator should resolve before SPEC.md freeze):**
1. **Should `<server>` be modified to acquire env.lock?** Hard rule says don't touch existing tooling. But the lock is only useful if all writers obey it. **Recommendation:** propose a one-line addition to `c_server.md` step 9 (`exec 9>env.lock; flock 9` wrapper) as a doc update — not a code change to the script itself except adding the flock pair. User approval needed; orchestrator should ask explicitly.
2. **EnvBadge SSE wiring** — Fenrir owns this slice. Coordinate the backend handler signature so the launcher Swift WS client and the EnvBadge React client speak the same event format. Suggested: `event: env-changed\ndata: {"env":"dev","ts":"2026-04-27T..."}\n\n`.
3. **Singleton enforcement for the launcher** (KRA-T03) — Calliope's call. NSApplication-singleton via `LSMultipleInstancesProhibited=YES` in Info.plist is the obvious choice; flag for Calliope.

**Integrate next:**
- Hand the lock spec to Calliope (Swift implementation) and append a footnote to `c_server.md` for the bash side.
- Hand the SSE event contract to Fenrir.
- Hand the 8 tests to Gaia for inclusion in TESTPLAN.md.
- The c_launcher.md sketch above is ready to drop into `.claude/commands/c_launcher.md` once the launcher binary exists; orchestrator should wait until Calliope confirms the bundle path is final.

**Confidence ≥95% met.** The remaining 4% is in the cross-agent coordination items above; once Fenrir and Calliope sign off, this rises to 99%.
