# MMFF Vector Launcher — Multi-agent Orchestration Master

**Orchestrator:** Claude Opus 4.7 (this session)
**Mission:** Design, build, test, and document a STABLE / DEPENDABLE / FUNCTIONAL macOS launcher that orchestrates SSH tunnels, Go backend, Next.js frontend, and DB env switching for the Vector dev environment, and publishes a professional research+test document to the Dev → Research panel.

## Hard rules (passed to every agent)
1. **NO GIT** — do not run any `git` command. Files in the working tree are fine; just do not commit, push, branch, reset, etc.
2. **Coexist** — do not modify or remove `MMFF Vector Dev.app`, `MMFF Vector Dev.applescript`, `<server>`, `<services>`, `<npm>`, or the `MMFF Vector Dev.app/Contents/Resources/Scripts/main.scpt` AppleScript bundle.
3. **Confidence threshold** — no production recommendation may go into the final report below 95% confidence.
4. **STABLE > clever** — the user's prime objective is "STABLE, DEPENDABLE, FUNCTIONAL". Surprise via UX polish, not via novel orchestration tricks.
5. **Testable** — every behavioural recommendation must come with a test (unit, integration, or e2e simulation) recorded in the agent's test table.
6. **Logged** — every agent maintains a running log at `local-assets/launcher/agents/<Name>.md`, updated as work progresses, not in one final dump.

## Repo facts (canonical — agents may rely on these)
- Repo root: `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM`
- Existing AppleScript launcher: `MMFF Vector Dev.app` + source `MMFF Vector Dev.applescript`
- Backend Go server: `backend/cmd/server`, runs on `:5100`, exposes `/healthz` and (newer builds) `/api/_meta/env` returning `{ env, db_host, backend_env, ... }`
- Next.js frontend: runs on `:5101`, started via `npm run dev -- -p 5101`
- DB envs and tunnels:
  - dev: `BACKEND_ENV=dev`, file `backend/.env.dev`, tunnel port `5435`, ssh alias `vector-dev-pg`
  - staging: `BACKEND_ENV=staging`, file `backend/.env.staging`, tunnel port `5436`, ssh alias `vector-staging-pg`
  - production: `BACKEND_ENV=production`, file `backend/.env.production`, tunnel port `5434`, ssh alias `mmffdev-pg`
- Marker block in `.claude/CLAUDE.md` between `<!-- ACTIVE_BACKEND_ENV:start -->` / `:end -->` is the canonical "which env is active right now" line. The `<services>` shortcut reads it.
- Frontend `EnvBadge` component (`app/components/EnvBadge.tsx`) reads backend `/api/_meta/env` (or sibling) and renders the active env. It exists and is in use today.
- Toolchain available locally:
  - `swift` 6.2 (Apple Swift, target `arm64-apple-macosx26.0`)
  - `osacompile` (for AppleScript compilation if any helper is needed)
  - `xcodebuild` is installed but only **CommandLineTools**, NOT full Xcode. So we cannot use Xcode `.xcodeproj` build flow — we use Swift Package Manager + a hand-crafted `.app` bundle (Contents/MacOS/<binary>, Contents/Info.plist, Contents/Resources/...).

## Deliverables
1. `MMFF Vector Launcher.app/` — runnable bundle in repo root, name distinct from existing `MMFF Vector Dev.app`.
2. `local-assets/launcher/spec/SPEC.md` — final synthesized spec (orchestrator writes from agent outputs).
3. `local-assets/launcher/spec/TESTPLAN.md` — full e2e plan with happy + sad paths, test table.
4. `local-assets/launcher/charts/*.svg` — uptime, retries, latency, env-switch frequency.
5. `dev/research/R003.json` — final professional report posted to Dev → Research panel.
6. `local-assets/launcher/agents/<Name>.md` × 10 — agent running logs.

## Agent roster (10)
| # | Name | Domain |
|---|---|---|
| 1 | Calliope | SwiftUI app architecture + no-Xcode .app bundling |
| 2 | Boreas | SSH tunnel orchestration in Swift |
| 3 | Demeter | Process supervision: backend + frontend lifecycles |
| 4 | Eros | JSONL structured logging + rotation + tail rendering |
| 5 | Fenrir | Web ↔ native bridge (launcher API vs file-watch vs URL scheme) |
| 6 | Gaia | Test architecture (unit + integration + agent-driven e2e) |
| 7 | Helios | Charts/graphs — metric set + SVG specs |
| 8 | Iris | macOS 26 security: keychain, hardened runtime, gatekeeper, sandbox |
| 9 | Janus | Health-probe contract + retry/backoff parameters |
| 10 | Kratos | Existing-tooling integration + coexistence map |

## Agent log template
Each agent writes to `local-assets/launcher/agents/<Name>.md` and updates as they go.

```
# Agent: <Name>
**Role:** <one line>
**Scope assigned by orchestrator:** <bullets>
**Status:** starting | researching | drafting | testing | complete
**Confidence:** <0–100%>
**Last update (UTC):** <timestamp>

## Running log
- [<UTC>] action — outcome
- ...

## Findings
### Recommendation
<paragraph or bullets — must be implementable>

### Dead ends explored
- <approach> — why discarded

### Sources
- <url or repo path> — why useful

## Contribution
- Effort: <agent-turns or rough hours>
- Coverage of overall project: <%> (orchestrator-assigned slice weight)
- Files produced or modified: <list>

## Test strategy (this agent's slice)
Anticipated tests for this domain. Use this table. Add rows as you run them.

| ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result (PASS/FAIL/SKIP) | Root cause if FAIL | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|
| <NAME>-T01 | ... | ... | ... | ... | ... | ... | ... | ... | ... |

## Overall test-coverage understanding
<paragraph — your slice's place in the whole>

## Handover note to orchestrator
<paragraph — what's solid, what's still uncertain, what the orchestrator should integrate next>
```

## Coverage allocation (sums to 100%)
| Agent | Allocated coverage |
|---|---|
| Calliope | 15% |
| Boreas | 10% |
| Demeter | 12% |
| Eros | 8% |
| Fenrir | 10% |
| Gaia | 12% |
| Helios | 6% |
| Iris | 9% |
| Janus | 8% |
| Kratos | 10% |
| **Total** | **100%** |

## Orchestrator running log
- [2026-04-27T18:30Z] Master file written. Toolchain probed: swift 6.2 ✓, full Xcode ✗ → SwiftPM + hand-crafted .app bundle.
- [2026-04-27T18:30Z] Confirmed EnvBadge wiring exists; backend exposes `backend_env` already.
- [2026-04-27T18:30Z] Spawning 10 named agents in parallel.
