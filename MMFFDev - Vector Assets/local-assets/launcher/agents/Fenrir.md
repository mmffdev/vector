# Agent: Fenrir
**Role:** Web ↔ native bridge — secure default for the Next.js app (and future web surfaces) to read launcher state and request privileged actions (env switch, restart backend, tail logs).
**Scope assigned by orchestrator:**
- Compare 4 candidate transports: localhost HTTP, file-watch, URL scheme, WebSocket-via-backend
- Pick the secure default and justify
- Define the wire contract (endpoints, shapes, status codes)
- Specify auth (shared-secret token), CSRF posture, loopback binding, replay protection
- Specify ≥6 tests, including LAN-refusal and pagination
- Coexist with the existing `/api/_meta/env` (now `/api/env`) endpoint
**Status:** complete
**Confidence:** 96%
**Last update (UTC):** 2026-04-27T19:55Z

## Running log
- [2026-04-27T19:43Z] starting — read MASTER, _TEMPLATE, EnvBadge, main.go 180–230
- [2026-04-27T19:45Z] mapped existing surface: backend already exposes `GET /api/env` and `POST /api/env/switch`; the latter relies on the backend itself shelling out to a switch script. That couples env-switch to backend liveness — the very thing we want to be able to recover *from*. This is the architectural gap the launcher bridge fills.
- [2026-04-27T19:48Z] reviewed Apple Network framework semantics for `NWListener` + `NWParameters.tcp` with `requiredLocalEndpoint = 127.0.0.1` and `IPv4-only` to refuse `0.0.0.0` and `::` bindings.
- [2026-04-27T19:51Z] reviewed prior art: Tailscale `tailscaled` LocalAPI on `127.0.0.1`/unix socket with peer-cred auth; 1Password CLI's per-process token; Docker Desktop's `/var/run/docker.sock` on macOS; VS Code's `vscode-server` random-port + token query. Common shape: 127.0.0.1 + bearer secret in a 0600 file.
- [2026-04-27T19:53Z] decision: **localhost HTTP server inside the launcher with shared-secret bearer auth, fetched server-to-server via the Go backend (token never reaches the browser)**. Detail in Findings.
- [2026-04-27T19:55Z] wrote endpoint contract, security analysis, and test slice. Confidence 96%.

## Findings

### Recommendation — Localhost HTTP server in the launcher (option 1) with proxy-via-backend

**Topology**

```
  Browser (Next.js, :5101)
      │  same-origin fetch → /api/launcher/*
      ▼
  Next.js API route / Go backend (:5100)            ← reads token from disk
      │  loopback fetch → http://127.0.0.1:48219    ← random port, ephemeral
      ▼  Authorization: Bearer <token-from-bridge.token>
  Launcher HTTP server (Swift NWListener, 127.0.0.1 only)
```

The browser **never sees the token** and **never talks to the launcher directly**. The Go backend is the only client of the launcher's loopback listener. This means:

1. The browser is a normal same-origin client of the Next.js / Go backend (existing CSRF cookie protection still applies — no new attack surface in the browser).
2. The launcher does not need to handle browser-origin CORS, cookies, or CSRF — its only client is a trusted local process that authenticates with a 256-bit secret it can read from a `0600` file the launcher itself writes.
3. The launcher remains usable when the backend is down, because the Go backend is a *client* of the launcher, not the other way around. When the user wants to "restart the backend", the Next.js app calls the Go backend, the Go backend calls the launcher, but if the Go backend is dead the user can also call the launcher via a small CLI shim (`.claude/bin/launcher`) that reads the same token file. We retain a recovery path.

**Why this beats the other three options:** see Decision matrix below.

### Decision matrix

| Option | Pros | Cons | Security posture | Effort |
|---|---|---|---|---|
| **1. Localhost HTTP (NWListener, 127.0.0.1, bearer) — RECOMMENDED** | Standard REST; debuggable with curl; works while backend is dead; structured request/response; pagination natural; survives browser refresh | Adds one listening port (random, loopback-only); requires token plumbing | **Strong**: bind-to-loopback enforced by `NWParameters.requiredLocalEndpoint`; 256-bit token in `~/Library/Application Support/MMFF Vector Launcher/bridge.token` mode 0600; constant-time compare; no CORS exposure (no browser client); replay-safe via `Idempotency-Key` on POSTs | Medium (~1 day) — Apple's Network framework gives us a working HTTP listener in <100 lines; auth + idempotency middleware ~50 lines |
| 2. File-watched JSON state file | No listener at all; trivially debuggable (`cat state.json`); zero auth surface | One-way (read-only); no command channel — we still need a second mechanism for "restart backend"; race conditions on concurrent writers; 100–500ms of `fseventsd` jitter; backend doing tight polling burns CPU | Strongest read-side (no listener); weakest command-side (no command channel exists, so we'd add option 1 anyway → double surface) | Medium for half the problem |
| 3. macOS URL scheme `mmff-launcher://` | Native; no port; macOS does the auth (the URL handler is registered) | Browser shows a "Open MMFF Vector Launcher?" dialog every time → terrible UX for "switch env" which fires often; one-way (browser → launcher, no response body); cannot return state, only fire intents; user can register a malicious app to hijack the scheme | Weak: scheme hijacking is a real issue (no code signing requirement on registration in macOS 26); no response channel means we can't even confirm success | Low |
| 4. WebSocket via backend (backend brokers) | Bidirectional push; live log tail is natural | Couples bridge availability to backend availability — exactly the failure mode the launcher exists to recover from; backend has to act as a proxy/broker which is added complexity; doesn't help when backend is being restarted | Inherits backend's auth (good) but useless for the "backend is dead" recovery path (bad) | High — needs WS handler in Go, reconnect logic in browser, broker state |

### Why proxy-via-backend (rather than browser-direct) for option 1

Browser-direct to a localhost listener is what tools like Jupyter and VS Code do. It works, but the cost is:
- The browser must obtain the token somehow — usually via a query string in the URL the launcher opens. That puts the token in browser history, server logs, and `Referer` headers.
- CORS becomes a first-class concern; misconfiguration (e.g. `Access-Control-Allow-Origin: *`) instantly turns this into a remote-attack vector via DNS-rebinding (which can defeat 127.0.0.1 binding by binding the *attacker's domain* to 127.0.0.1 and tricking the browser into sending requests).
- Any browser extension running in the user's browser can read the token from `localStorage` / page DOM.

Proxy-via-backend eliminates DNS-rebinding (the launcher requires a `Host: 127.0.0.1` check + a constant-time bearer; only the Go backend on the same machine has both), eliminates CORS (no browser origin), and keeps the token off the browser entirely.

### Security analysis (full)

1. **Loopback binding (no LAN exposure).** `NWListener` is created with `NWParameters.tcp` and the parameters' `requiredLocalEndpoint` set to `NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)`. Additionally `parameters.acceptLocalOnly = true` and `parameters.requiredInterfaceType = .loopback`. We **also** set a `newConnectionHandler` that rejects any connection whose `endpoint` resolves to a non-loopback address as a defence-in-depth check. Test FNR-T01 verifies refusal on `192.168.x.x` and the machine's primary LAN IP.

2. **Token at rest.** On first launch the launcher generates a 32-byte random token via `SecRandomCopyBytes`, base64url-encodes it, and writes it to `~/Library/Application Support/MMFF Vector Launcher/bridge.token` with `chmod 0600` and `chflags hidden`. Directory is created with `0700`. The token **never** appears in argv, env, logs, or stdout. The launcher logs only the token's first 8 chars + length, never the body.

3. **Token at use.** Every request must carry `Authorization: Bearer <token>`. The check is constant-time (`timingsafe_bcmp` via Swift's `ContiguousBytes` comparison wrapper). Missing or wrong token → 401 with no body. No retry counter is needed — the file is `0600` and only the user (and root) can read it; if root is compromised we have bigger problems.

4. **CSRF.** No browser CSRF surface exists because there is no browser origin. The launcher rejects requests whose `Host:` header is anything other than `127.0.0.1:<port>` (defence against DNS rebinding even though the listener is loopback-only — the browser's `Host` is set by URL, not by socket). The Go backend, when proxying, sets `Host: 127.0.0.1:<port>` explicitly.

5. **Replay safety on POSTs.** Every state-changing POST requires an `Idempotency-Key: <uuid>` header. The launcher keeps a 256-entry LRU of recently seen keys (60-second TTL). A repeat key returns the cached response and does not re-run the action. This protects against double-clicks and against the Go backend retrying after a transient timeout.

6. **Method allow-list.** Only `GET` and `POST` are accepted. `OPTIONS` returns 405 (we don't need preflight because there's no browser origin). `PUT`/`DELETE`/etc → 405.

7. **Body size cap.** 64 KiB max request body; over → 413. Logs endpoint capped at 1 MiB response.

8. **Audit log.** Every POST writes a JSONL line to the launcher's log stream (handled by Eros) with `{ts, method, path, idempotency_key_hash, result}`. The token is never logged.

9. **Token rotation.** Launcher exposes `POST /v1/auth/rotate` (also bearer-authenticated with current token). Writes new token, atomically renames over `bridge.token`, returns the new token in the response body once. The Go backend re-reads the file on 401.

10. **Process identity (deferred / future).** SO_PEERCRED is not directly available on macOS for AF_INET, but `NWConnection` exposes the peer's PID via `metadata(definition: NWProtocolTCP.definition)` on macOS 14+. We log the peer PID per request; we do not yet *enforce* `pid == backendPID`, but that hook is in place for a future tightening.

### Endpoint contract (v1)

Base URL (loopback only): `http://127.0.0.1:<port>` where `<port>` is written to `~/Library/Application Support/MMFF Vector Launcher/bridge.port` on startup (also `0600`).

All requests: `Authorization: Bearer <token>`. All POSTs: `Idempotency-Key: <uuid-v4>`.
Content-Type for POST: `application/json`. Responses always JSON.

| Method | Path | Purpose | Body / Query | 200 shape | Error codes |
|---|---|---|---|---|---|
| GET | `/v1/state` | Snapshot of launcher and managed services | — | `{ launcher: {version, started_at, pid}, services: { tunnel: {state, port, env}, backend: {state, pid, port, commit}, frontend: {state, pid, port} }, env: {active: "dev"\|"staging"\|"production"} }` | 401, 503 |
| GET | `/v1/health` | Liveness ping for the launcher itself | — | `{ ok: true, uptime_s: 1234 }` | 401 |
| POST | `/v1/services/{tunnel\|backend\|frontend}/{start\|stop\|restart}` | Service action | `{}` (reserved for future flags) | `{ accepted: true, action_id: "<uuid>", state_after: "starting"\|"stopping" }` returned 202 | 400 (bad service/action), 401, 409 (already in target state), 423 (locked — another action in flight), 503 |
| POST | `/v1/env/switch` | Switch active DB env. Internally: stops backend → updates marker → ensures correct tunnel → starts backend with new BACKEND_ENV. | `{ "target": "dev"\|"staging"\|"production" }` | `{ accepted: true, action_id: "<uuid>", from: "dev", to: "staging" }` — 202 | 400, 401, 409 (already on target), 423, 503 |
| GET | `/v1/logs` | Tail of the unified JSONL stream (Eros writes this) | `?since=<rfc3339-or-cursor>&limit=<1..500>&service=<tunnel\|backend\|frontend\|launcher>` | `{ entries: [{ts, service, level, msg, kv}], next_cursor: "<opaque>", has_more: bool }` | 400, 401, 416 (since beyond retention) |
| GET | `/v1/actions/{action_id}` | Status of an async action returned 202 from POST endpoints | — | `{ action_id, state: "queued"\|"running"\|"done"\|"failed", started_at, finished_at?, error? }` | 401, 404 |
| POST | `/v1/auth/rotate` | Rotate the bearer token | `{}` | `{ token: "<new-token>", rotated_at }` (returned once) | 401 |

**Coexistence with `/api/env`:** the existing backend route is unchanged. The frontend's `EnvBadge` continues calling `/api/env` for *reads* (the Go backend is the truth source for "what DB am I actually connected to"). The new `POST /api/env/switch` in the backend is updated (one-line change, out of Fenrir's scope but flagged) to **delegate** to `POST /v1/env/switch` on the launcher when the launcher token file exists, falling back to today's `.claude/bin/switch-server` when it doesn't. This gives a clean migration path and zero EnvBadge changes.

### Implementation skeleton (Swift, ~120 lines, for Calliope to integrate)

```swift
import Foundation
import Network
import CryptoKit

final class BridgeServer {
    private let listener: NWListener
    private let token: Data            // raw bytes
    private let port: NWEndpoint.Port
    private let queue = DispatchQueue(label: "bridge.server")
    private var seenIdem = LRUCache<String, CachedResponse>(capacity: 256, ttl: 60)

    init() throws {
        self.token = Self.loadOrCreateToken()
        var params = NWParameters.tcp
        params.acceptLocalOnly = true
        params.requiredInterfaceType = .loopback
        params.allowLocalEndpointReuse = false
        self.listener = try NWListener(using: params, on: .any)
        self.port = listener.port ?? .any  // resolved after start
    }

    func start() throws {
        listener.newConnectionHandler = { [weak self] conn in self?.accept(conn) }
        listener.stateUpdateHandler = { state in
            if case .ready = state { /* write port file */ }
        }
        listener.start(queue: queue)
    }
    // accept + parse + auth + route omitted for brevity — see Calliope's bundle
}
```

### Dead ends explored
- **Browser-direct to loopback (no proxy).** Discarded due to DNS-rebinding risk and the need to ship a token to the browser. The cost of adding a second hop in the Go backend is one fetch call.
- **Unix domain socket instead of TCP loopback.** Cleaner (no port at all, file-permission auth), but `URLSession`/`fetch` in browsers can't speak it — and even from Go we'd need extra plumbing. The benefit (no port) is small because we already bind 127.0.0.1; the cost (incompatibility with curl-from-frontend devs) is real.
- **Mutual TLS on loopback.** Overkill — bearer token in 0600 file gives the same security guarantee against anyone who isn't already root, with 1/10th the moving parts.
- **gRPC / protobuf.** Overkill for 6 endpoints; harms debuggability (curl-friendly REST wins for a dev tool).
- **macOS URL scheme as primary.** Discarded — UX of the macOS "open in app?" dialog firing on every env-switch is unacceptable.

### Sources
- Apple Developer — `NWParameters` (`acceptLocalOnly`, `requiredInterfaceType`): https://developer.apple.com/documentation/network/nwparameters — authoritative for loopback-only binding semantics.
- Apple Developer — `NWListener`: https://developer.apple.com/documentation/network/nwlistener — confirms ephemeral-port allocation pattern.
- Tailscale `tailscaled` LocalAPI design notes: https://tailscale.com/kb/1080/cli — prior art for loopback bearer auth in a daemon talking to a UI.
- OWASP — DNS Rebinding cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/DNS_Rebinding_Cheat_Sheet.html — basis for the `Host:` header check.
- OWASP — CSRF cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html — basis for "no browser origin = no CSRF surface" reasoning.
- RFC 6750 — Bearer Token Usage: https://www.rfc-editor.org/rfc/rfc6750 — `Authorization: Bearer` shape and 401 semantics.
- RFC 9457 — Problem Details for HTTP APIs: https://www.rfc-editor.org/rfc/rfc9457 — error response shape (used for 4xx/5xx bodies).
- Repo: `app/components/EnvBadge.tsx` — confirms the polling cadence (10s idle, 1s during switch) the launcher must support without extra load.
- Repo: `backend/cmd/server/main.go` lines 197–250 — the existing `/api/env` and `/api/env/switch` we coexist with.

## Contribution
- Effort: ~2 agent-turns of design + research + drafting (~90 minutes equivalent).
- Coverage of overall project: 10% (assigned by orchestrator).
- Files produced or modified:
  - `local-assets/launcher/agents/Fenrir.md` (this file) — created.
  - Recommendations for Calliope (Swift bundle) and Kratos (backend coexistence) handed off via this doc; no code touched in those slices.

## Test strategy (this agent's slice)

| ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause if FAIL | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|
| FNR-T01 | LAN refusal | Listener binds 127.0.0.1 only; LAN clients are refused at the kernel level | 1) Start launcher. 2) From another machine on the LAN, `curl http://<mac-LAN-ip>:<port>/v1/health`. 3) Also `curl http://0.0.0.0:<port>/v1/health` from same machine | Connection refused / no route — both attempts fail without reaching the auth layer | _pending_ | _pending_ | — | Yes | Re-run from any LAN host; if connection succeeds, root cause is misconfigured `NWParameters` (verify `acceptLocalOnly = true` and `requiredInterfaceType = .loopback`) |
| FNR-T02 | Auth required | Missing/wrong bearer rejected without leaking timing | 1) `curl -i http://127.0.0.1:<port>/v1/state` (no header). 2) Same with `Authorization: Bearer wrong`. 3) Same with correct token. 4) Run 1000× under `time` for case 2 with token-length-matched wrong token vs random wrong token | (1)+(2) → 401 with empty body and no `WWW-Authenticate` hint that distinguishes "missing" from "wrong"; (3) → 200; (4) → mean delta < 50µs (constant-time check holds) | _pending_ | _pending_ | — | Yes | Re-run with statistical comparison; if delta > 200µs, replace `==` with constant-time compare |
| FNR-T03 | Replay safety | Same `Idempotency-Key` on a POST is served from cache, not re-executed | 1) `POST /v1/services/backend/restart` with `Idempotency-Key: K`. 2) Capture pid_after. 3) Repeat (1) immediately with same K. 4) Compare pid_after | Second call returns the cached 202 with the same `action_id`; backend pid unchanged (no second restart) | _pending_ | _pending_ | — | Yes | Re-run with fresh K to confirm a new K *does* trigger a new restart |
| FNR-T04 | Command response shape conforms to contract | `POST /v1/env/switch {target:"staging"}` returns the documented schema | 1) Issue request with valid token + Idempotency-Key. 2) Validate JSON against contract (accepted, action_id, from, to). 3) `GET /v1/actions/{action_id}` until `state:"done"` or `failed` | Initial response 202 with all 4 fields present and typed correctly; action eventually reaches `done` and `GET /v1/state` shows `env.active = "staging"` | _pending_ | _pending_ | — | Yes | Switch back to dev to leave system in known state |
| FNR-T05 | Graceful 503 when launcher busy | Service action returned with 423 when another action is in flight | 1) `POST /v1/services/backend/restart` (long action). 2) Within 100ms, `POST /v1/services/backend/stop`. 3) Inspect second response | Second call → 423 Locked with `{error:"action_in_flight", current_action_id:"<uuid>"}`; original action completes normally | _pending_ | _pending_ | — | Yes | Wait until first action completes, retry second action, expect 202 |
| FNR-T06 | Logs endpoint pagination | `GET /v1/logs` paginates correctly with `since` cursor | 1) Generate ≥50 log entries (start/stop services). 2) `GET /v1/logs?limit=20` → cursor C1, 20 entries. 3) `GET /v1/logs?since=C1&limit=20` → cursor C2, 20 different entries. 4) `GET /v1/logs?since=C2&limit=20` → final batch, `has_more:false` | No duplicate entries across pages; entries are monotonic by ts; final page has `has_more:false` and `next_cursor` is omitted or null | _pending_ | _pending_ | — | Yes | Re-run with `limit=500` to confirm cap; over-limit → 400 |
| FNR-T07 | DNS-rebinding defence | Request with `Host: attacker.example` is rejected even on the right port | 1) `curl -H 'Host: attacker.example' http://127.0.0.1:<port>/v1/state` with valid token | 421 Misdirected Request (or 400) — request refused before the handler runs | _pending_ | _pending_ | — | Yes | Re-run with `Host: 127.0.0.1:<port>` → 200 |
| FNR-T08 | Token rotation | After `POST /v1/auth/rotate`, old token is invalidated and new token is in the file | 1) Read current token T1. 2) `POST /v1/auth/rotate` with T1 → returns T2. 3) `GET /v1/state` with T1 → 401. 4) Read file → contains T2. 5) `GET /v1/state` with T2 → 200 | All assertions hold; file mode remains 0600 after rename | _pending_ | _pending_ | — | Yes | Re-rotate to leave system fresh |

## Overall test-coverage understanding
This slice owns the wire between the launcher and any web/automation client. Its tests certify: (a) the listener cannot be reached off-host (FNR-T01, FNR-T07), (b) auth holds (FNR-T02, FNR-T08), (c) the contract behaves as documented under normal and concurrent load (FNR-T03–T05), and (d) the read-side endpoint paginates safely under realistic log volume (FNR-T06). Together these are sufficient to let Gaia (test architecture) treat the bridge as a trusted boundary in higher-level e2e tests — i.e. she can call `POST /v1/env/switch` from a test harness and rely on it to be both authenticated and idempotent, without re-proving those properties at every call site.

What this slice does **not** cover: the Swift implementation correctness of `NWListener` parameters (Calliope owns), the macOS hardening of the .app bundle (Iris), the actual content of the JSONL log stream (Eros), or the orchestration of services behind the bridge (Demeter, Boreas). The bridge is the contract; those agents own the implementations on either side of it.

## Handover note to orchestrator
**Solid:**
- Decision is clear and defensible: localhost HTTP, NWListener, 127.0.0.1 only, bearer token in `~/Library/Application Support/MMFF Vector Launcher/bridge.token` (mode 0600), proxied via the Go backend so the browser never holds the token.
- 7 endpoints fully specified with shapes and status codes; 8 tests defined with explicit pass criteria.
- Coexistence story with existing `/api/env` is clean — backend keeps owning the *read*, launcher owns the *command*.

**Still uncertain (4% confidence gap):**
- Peer-PID enforcement is logged-only for v1; tightening to "only the running backend PID may call the bridge" requires Calliope and Demeter to agree on how the launcher learns the backend's current PID across restarts. Recommend deferring to v1.1.
- Token rotation UX when the backend is mid-restart: if rotation lands during a backend restart, the new backend instance must re-read `bridge.token` on startup. This is a 5-line change in backend bootstrap; flagged for Kratos.

**Recommended integration order:**
1. Calliope adds `BridgeServer` to the launcher .app skeleton (uses skeleton above).
2. Iris signs/notarises the .app so the token file's `Application Support` directory is per-app sandboxed.
3. Kratos updates the existing `/api/env/switch` Go handler to delegate to `POST /v1/env/switch` on the launcher when `bridge.token` exists, falling back to `.claude/bin/switch-server` otherwise. Zero EnvBadge changes.
4. Eros wires `/v1/logs` to the JSONL stream he produces.
5. Gaia uses FNR-T01 through FNR-T08 as the contract tests in her e2e harness.
