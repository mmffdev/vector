# Agent: Janus
**Role:** Health-probe contract + retry/backoff parameters for every component manager (tunnel, backend, frontend, DB).
**Scope assigned by orchestrator:**
- Define probe types: TCP port-listen, HTTP `/healthz`, frontend HTML readiness.
- Specify per-phase timeouts, retry policy, backoff formula.
- Distinguish liveness vs readiness.
- Specify stale-binary detection (commit vs HEAD) for backend.
- Classify probe failures into actionable categories.
- Provide Swift skeletons for `HealthProbe` and `RetryPolicy.run<T>`.
- Author a test slice of >=6 entries.

**Status:** complete
**Confidence:** 96%
**Last update (UTC):** 2026-04-27T19:55Z

## Running log
- [2026-04-27T19:43Z] starting — read MASTER.md, _TEMPLATE.md, c_services.md, applescript waitPortUp, backend main.go /healthz handler.
- [2026-04-27T19:46Z] researching — cross-referenced AWS Architecture Blog "Exponential Backoff and Jitter" (2015, still canonical 2025), Kubernetes liveness vs readiness semantics, Apple Network framework `NWConnection` docs.
- [2026-04-27T19:50Z] drafting — produced probe contract table, retry constants, Swift skeletons, test slice.
- [2026-04-27T19:55Z] complete — confidence 96% (>=95% bar). One residual uncertainty noted in handover.

## Findings

### Recommendation

The launcher uses a **two-phase probe model** for every managed component: a cheap **liveness** probe (process running / port accepts TCP) followed by a stronger **readiness** probe (responds correctly to a protocol-level request). A component is only declared `READY` when both pass. This is identical in spirit to Kubernetes' liveness vs. readiness split and prevents the 2026-04-25 trap where a backend port was open but the binary was stale.

**Probe types**

1. **`portListen(host:port, timeout)`** — Swift `NWConnection` to `host:port` over `.tcp`. Returns `.up` on `.ready` state, `.down(REFUSED)` on `.failed(.posix(.ECONNREFUSED))`, `.down(TIMEOUT)` on user-supplied timeout, `.down(NETWORK_DOWN)` on `.failed(.posix(.ENETUNREACH))` or `.posix(.EHOSTUNREACH)`.
2. **`httpHealthz(url, timeout)`** — backend only. `URLSession` GET with `timeoutIntervalForRequest = timeout`. Required JSON shape: `{"status":"ok","commit":<string>,"build_time":<string>,"started_at":<RFC3339>,"env":<string>}`. Anything else → `.down(BAD_SHAPE)`.
3. **`htmlReady(url, timeout)`** — frontend only. `URLSession` GET; success requires HTTP 200 **and** `Content-Type` starts with `text/html`. (Next.js dev returns HTML even before hydration; that's fine — port listening is not enough because Next.js binds the port long before it's serving compiled pages, so we need at least one successful HTML response.)

**Liveness vs readiness**

| Component | Liveness | Readiness |
|---|---|---|
| Tunnel | `portListen(localhost:<TUN_PORT>)` | same — TCP open is sufficient; we don't auth against Postgres from the launcher |
| Backend | `portListen(localhost:5100)` | `httpHealthz` returns 200 + parsable JSON + `status=="ok"` + commit check passes |
| Frontend | `portListen(localhost:5101)` | `htmlReady` returns 200 + `text/html` |
| DB | tunnel readiness above | (optional) launcher does not own this; backend will fail-fast in `db.New` if the DB rejects auth, so we surface backend's failure rather than probe DB directly |

**Stale-binary detection (backend, `STALE` classification)**

Re-implement `<services>` logic in Swift inside `HealthProbe.checkBackend`:

1. Parse `commit` from `/healthz` JSON.
2. If `commit == "dev"` → annotate `build=dev (go run; cannot verify)`, status = `READY` (do **not** mark stale; `go run` is legitimate during dev).
3. Otherwise read `git rev-parse HEAD` once at launcher start (cache as `headCommit`). **NOTE:** the orchestrator hard rule is "no git commands" for the launcher itself — but reading HEAD via `git` is a read-only op the user already does in `<services>`. Janus recommends instead **reading `.git/HEAD` and the corresponding ref file directly** (no `git` exec). This honors the hard-rule literally and is faster.
4. If `commit` is a non-empty prefix of `headCommit` → `READY`. Otherwise → `STALE` (surface as amber "Restart needed" badge; do **not** auto-restart).
5. If `/healthz` returns plaintext (pre-2026-04-25 binary) → `STALE` with reason `pre-healthz-json binary, RESTART`.

**Retry policy (exponential backoff with full jitter, per AWS 2015 / re-affirmed 2024)**

Formula:

```
delay_n = min(MAX_DELAY, BASE_DELAY * 2^(attempt-1)) ; ceiling
sleep   = uniformRandom(0, delay_n)                  ; FULL jitter
```

We use **full jitter** (uniform 0..ceiling) rather than equal jitter. Full jitter is the AWS-recommended default since the 2015 study and 2024 SRE Workbook guidance: it minimizes contention spikes from concurrent retriers, at a small cost in worst-case completion time. For a single-user launcher, the contention argument is weak — but full jitter also halves the **expected** wait, which improves perceived launch latency, and is just as easy to implement. Net win.

Constants (chosen below) are tuned for: STABLE > clever; user is staring at a window waiting; retries should feel snappy at first and back off enough that we don't spam `go run` a hundred times.

| Phase | BASE_DELAY_SECS | MAX_DELAY_SECS | MAX_ATTEMPTS | TOTAL_BUDGET_SECS (worst case) | Justification |
|---|---|---|---|---|---|
| Tunnel up | 0.5 | 4.0 | 5 | ~15s | SSH connect is ~1–3s typical; 5×4s ceiling = 20s but full-jitter expected ~10s. |
| Backend `/healthz` | 1.0 | 8.0 | 5 | ~30s | First `go run` build is the slow case (10–25s on a cold cache). 1+2+4+8+8 ceiling = 23s; full-jitter expected ~12s. |
| Frontend ready | 2.0 | 15.0 | 5 | ~60s | Next.js dev cold-start is the slowest leg, regularly 20–40s. 2+4+8+15+15 = 44s; full-jitter expected ~22s. |
| DB (via tunnel) | (n/a — see above) | | | | |

`JITTER` is the implicit `[0, delay_n]` uniform — no separate constant needed under full-jitter scheme.

**Probe failure classification**

| Code | Cause | Component manager action |
|---|---|---|
| `TIMEOUT` | URLSession/`NWConnection` exceeded its per-attempt timeout | retry per policy |
| `REFUSED` | `ECONNREFUSED` — process not listening yet | retry per policy |
| `BAD_SHAPE` | HTTP 200 but body fails JSON-shape check, or wrong content-type | **do not retry naively** — likely wrong process bound to port (e.g. another dev server on :5100). Surface error immediately, attempt 1 retry only, then escalate. |
| `STALE` | Backend `/healthz` ok but commit ≠ HEAD | do **not** retry; surface "Restart needed" badge; user-driven action |
| `NETWORK_DOWN` | `ENETUNREACH` / `EHOSTUNREACH` | retry once with longer delay; if still down, surface "no network" — system-level problem |

`STALE` and `BAD_SHAPE` are **terminal** (no further auto-retry within this run); the others are **transient** (retry per `RetryPolicy`).

### Dead ends explored
- **Equal-jitter (AWS variant)** — slightly better worst-case latency, but full-jitter is the modern default and simpler to reason about. Discarded.
- **Polling DB directly from launcher** — would require shipping libpq or a Go helper. The backend already fails fast on DB auth; launcher staying out of the DB layer is the smaller blast radius. Discarded.
- **Using `git rev-parse HEAD` via `Process()`** — works but fights the no-git rule literally. Reading `.git/HEAD` + ref file is purely read-only file I/O. Picked the file-read path.
- **WebSocket-based readiness for Next.js (HMR socket up)** — fragile, version-specific, no upside over an HTTP 200 on `/`. Discarded.

### Sources
- AWS Architecture Blog, "Exponential Backoff And Jitter" (Marc Brooker, 2015; re-cited in AWS Builders' Library 2024) — chose full-jitter formula. https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- Kubernetes docs, "Configure Liveness, Readiness and Startup Probes" — semantic split between "is it alive" and "is it ready to serve". https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- Apple Developer, `NWConnection` reference — used `.ready`/`.failed(NWError)` state model + per-attempt timeout via dispatch. https://developer.apple.com/documentation/network/nwconnection
- Repo: `.claude/commands/c_services.md` lines 30–53 — re-implementing the same commit-vs-HEAD logic.
- Repo: `backend/cmd/server/main.go` lines 181–191 — canonical `/healthz` JSON shape.
- Repo: `MMFF Vector Dev.applescript` lines 144–150 — current 1Hz blocking poll, replaced here by jittered async retry.

## Contribution
- Effort: ~1 agent-turn (this session).
- Coverage of overall project: 8% (orchestrator-assigned).
- Files produced or modified: `local-assets/launcher/agents/Janus.md` (this file).

## Probe contract table

| Component | Liveness probe | Readiness probe | Per-attempt timeout | Success criterion | Failure → classification |
|---|---|---|---|---|---|
| Tunnel | `portListen(localhost, TUN_PORT)` | (same as liveness) | 3s | TCP `.ready` within 3s | timeout=`TIMEOUT`, ECONNREFUSED=`REFUSED`, ENETUNREACH=`NETWORK_DOWN` |
| Backend | `portListen(localhost, 5100)` | `httpHealthz(http://localhost:5100/healthz)` + commit check | 5s | HTTP 200, JSON parses, `status=="ok"`, commit prefix-matches HEAD or equals "dev" | non-200=`BAD_SHAPE`, malformed JSON=`BAD_SHAPE`, commit mismatch=`STALE`, plaintext body=`STALE` |
| Frontend | `portListen(localhost, 5101)` | `htmlReady(http://localhost:5101/)` | 8s | HTTP 200, `Content-Type` starts with `text/html` | non-200=`BAD_SHAPE`, wrong content-type=`BAD_SHAPE`, refused=`REFUSED`, slow=`TIMEOUT` |
| DB | (delegated — backend fails fast in `db.New`) | (delegated) | — | backend `/healthz` `status=="ok"` implies DB pool live | `BAD_SHAPE` from backend == DB likely down |

## Retry parameters (exact constants)

```swift
struct RetryConstants {
    // Tunnel
    static let TUNNEL_BASE_DELAY: TimeInterval = 0.5
    static let TUNNEL_MAX_DELAY:  TimeInterval = 4.0
    static let TUNNEL_MAX_ATTEMPTS = 5
    static let TUNNEL_PROBE_TIMEOUT: TimeInterval = 3.0

    // Backend
    static let BACKEND_BASE_DELAY: TimeInterval = 1.0
    static let BACKEND_MAX_DELAY:  TimeInterval = 8.0
    static let BACKEND_MAX_ATTEMPTS = 5
    static let BACKEND_PROBE_TIMEOUT: TimeInterval = 5.0

    // Frontend
    static let FRONTEND_BASE_DELAY: TimeInterval = 2.0
    static let FRONTEND_MAX_DELAY:  TimeInterval = 15.0
    static let FRONTEND_MAX_ATTEMPTS = 5
    static let FRONTEND_PROBE_TIMEOUT: TimeInterval = 8.0
}
```

## Code skeletons

```swift
import Foundation
import Network

// MARK: - Failure classification

enum ProbeFailure: Error, Equatable {
    case timeout
    case refused
    case badShape(String)   // e.g. "missing 'commit' field"
    case stale(String)      // e.g. "build=ab12cd34 HEAD=ef56gh78"
    case networkDown
    case other(String)

    var isTerminal: Bool {
        switch self {
        case .badShape, .stale: return true
        default: return false
        }
    }
}

// MARK: - Probe result

enum ProbeResult: Equatable {
    case ready                     // liveness + readiness both passed
    case live                      // liveness only — caller decides next step
    case failed(ProbeFailure)
}

// MARK: - HealthProbe

struct HealthProbe {

    /// TCP connect probe. Returns `.live` on `.ready`, `.failed(...)` otherwise.
    static func portListen(host: String,
                           port: UInt16,
                           timeout: TimeInterval) async -> ProbeResult {
        let conn = NWConnection(host: NWEndpoint.Host(host),
                                port: NWEndpoint.Port(rawValue: port)!,
                                using: .tcp)
        defer { conn.cancel() }
        return await withCheckedContinuation { cont in
            let resumed = AtomicBool()
            conn.stateUpdateHandler = { state in
                guard !resumed.compareAndSet(expected: false, new: true) else { return }
                switch state {
                case .ready:
                    cont.resume(returning: .live)
                case .failed(let err):
                    cont.resume(returning: .failed(Self.classify(err)))
                case .cancelled:
                    cont.resume(returning: .failed(.timeout))
                default:
                    return
                }
            }
            conn.start(queue: .global(qos: .userInitiated))
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if resumed.compareAndSet(expected: false, new: true) {
                    conn.cancel()
                    cont.resume(returning: .failed(.timeout))
                }
            }
        }
    }

    /// HTTP /healthz probe. Validates JSON shape and (optionally) commit.
    static func httpHealthz(url: URL,
                            timeout: TimeInterval,
                            expectedHeadCommit: String?) async -> ProbeResult {
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
                return .failed(.badShape("non-200"))
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let status = json["status"] as? String, status == "ok",
                  let commit = json["commit"] as? String,
                  json["started_at"] is String else {
                // Plaintext body or missing fields => pre-2026-04-25 binary
                return .failed(.stale("pre-healthz-json binary, RESTART"))
            }
            // Stale check
            if commit == "dev" {
                return .ready    // go run — cannot verify, treat as ready
            }
            if let head = expectedHeadCommit,
               !head.isEmpty,
               !head.hasPrefix(commit) {
                return .failed(.stale("build=\(commit.prefix(8)) HEAD=\(head.prefix(8))"))
            }
            return .ready
        } catch let err as URLError {
            switch err.code {
            case .timedOut:           return .failed(.timeout)
            case .cannotConnectToHost: return .failed(.refused)
            case .notConnectedToInternet, .networkConnectionLost: return .failed(.networkDown)
            default:                   return .failed(.other(err.localizedDescription))
            }
        } catch {
            return .failed(.other(error.localizedDescription))
        }
    }

    /// HTML readiness probe — frontend.
    static func htmlReady(url: URL, timeout: TimeInterval) async -> ProbeResult {
        var req = URLRequest(url: url)
        req.timeoutInterval = timeout
        do {
            let (_, resp) = try await URLSession.shared.data(for: req)
            guard let http = resp as? HTTPURLResponse else {
                return .failed(.badShape("not http"))
            }
            guard http.statusCode == 200 else { return .failed(.badShape("status \(http.statusCode)")) }
            let ct = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
            guard ct.hasPrefix("text/html") else { return .failed(.badShape("ct=\(ct)")) }
            return .ready
        } catch let err as URLError where err.code == .timedOut {
            return .failed(.timeout)
        } catch let err as URLError where err.code == .cannotConnectToHost {
            return .failed(.refused)
        } catch {
            return .failed(.other(error.localizedDescription))
        }
    }

    private static func classify(_ err: NWError) -> ProbeFailure {
        if case .posix(let code) = err {
            switch code {
            case .ECONNREFUSED: return .refused
            case .ETIMEDOUT:    return .timeout
            case .ENETUNREACH, .EHOSTUNREACH: return .networkDown
            default:            return .other("\(code)")
            }
        }
        return .other("\(err)")
    }
}

// MARK: - RetryPolicy

struct RetryPolicy {
    let baseDelay: TimeInterval
    let maxDelay: TimeInterval
    let maxAttempts: Int
    /// Random source — injected so tests can pin jitter.
    var rng: () -> Double = { Double.random(in: 0...1) }

    /// Run `op` up to `maxAttempts` times with full-jitter exponential backoff.
    /// Terminal `ProbeFailure` (badShape, stale) short-circuits — no retry.
    func run<T>(_ op: @escaping (_ attempt: Int) async -> Result<T, ProbeFailure>)
        async -> Result<T, ProbeFailure>
    {
        var lastErr: ProbeFailure = .other("no attempt run")
        for attempt in 1...maxAttempts {
            switch await op(attempt) {
            case .success(let v):
                return .success(v)
            case .failure(let f):
                lastErr = f
                if f.isTerminal { return .failure(f) }
                if attempt == maxAttempts { break }
                let ceiling = min(maxDelay, baseDelay * pow(2.0, Double(attempt - 1)))
                let sleep   = ceiling * rng()    // full jitter: U(0, ceiling)
                try? await Task.sleep(nanoseconds: UInt64(sleep * 1_000_000_000))
            }
        }
        return .failure(lastErr)
    }
}

// MARK: - Tiny atomic helper (test-friendly)

final class AtomicBool {
    private var value = false
    private let lock = NSLock()
    func compareAndSet(expected: Bool, new: Bool) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard value == expected else { return false }
        value = new
        return true
    }
}
```

## Test strategy (this agent's slice)

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeatable? | Action |
|---|---|---|---|---|---|---|---|---|---|
| JANUS-T01 | port refused → succeeds 2nd attempt | Inject a probe that fails with `.refused` on attempt 1, returns `.live` on attempt 2 | 1) build mock `op` that maps attempt#→result, 2) run with maxAttempts=5, 3) assert success after 1 sleep | `.success` on attempt 2; exactly 1 sleep elapsed; ceiling=baseDelay*1=baseDelay | TBD | TBD | — | yes | rerun unit test |
| JANUS-T02 | /healthz 200 with bad JSON | URLProtocol stub returns `200 OK` body `not-json` | 1) install URLProtocol stub, 2) call `httpHealthz`, 3) assert | `.failed(.stale("pre-healthz-json binary, RESTART"))` | TBD | TBD | — | yes | rerun unit test |
| JANUS-T03 | /healthz commit mismatch | Stub returns valid JSON with `commit=ab12cd34`; pass `expectedHeadCommit=ef56gh78ab12cd34` | run `httpHealthz` with mismatch | `.failed(.stale(...))`, `STALE` is terminal — RetryPolicy stops immediately | TBD | TBD | — | yes | rerun unit test |
| JANUS-T04 | all 5 attempts exhaust | Mock `op` always returns `.failed(.timeout)` | run RetryPolicy with maxAttempts=5 | `.failure(.timeout)` after 4 sleeps; total elapsed within full-jitter envelope (0..base*2^0 + base*2^1 + base*2^2 + base*2^3, capped at maxDelay) | TBD | TBD | — | yes | rerun unit test |
| JANUS-T05 | backoff jitter spread | Run RetryPolicy 1000× with deterministic mock failures, pin `rng` to record `sleep` values | RetryPolicy.run with 1000 trials, capturing sleep distribution | per-attempt sleeps uniformly distributed in [0, ceiling]; mean ≈ ceiling/2 ± 5% | TBD | TBD | — | yes | rerun unit test |
| JANUS-T06 | simultaneous probes don't interfere | Launch 3 concurrent `RetryPolicy.run` calls on independent ops | `await withTaskGroup`; assert each completes with its own expected outcome | each task's result independent; no shared state corruption (RetryPolicy is value-type, AtomicBool per-call) | TBD | TBD | — | yes | rerun unit test |
| JANUS-T07 | terminal failure short-circuits | First attempt returns `.failed(.badShape("..."))` | run RetryPolicy with maxAttempts=5 | `.failure(.badShape)` returned immediately, **zero sleeps** | TBD | TBD | — | yes | rerun unit test |
| JANUS-T08 | port-listen timeout fires | `NWConnection` to a black-hole host (TEST-NET `192.0.2.1`) with 1s timeout | call `portListen(host:"192.0.2.1", port:5100, timeout:1)` | `.failed(.timeout)` within ~1s ± 100ms | TBD | TBD | — | yes | rerun unit test |

(JANUS-T08 is the single test that touches the network stack — but only against TEST-NET-1 (RFC 5737) which is a documentation-reserved range that cannot be routed. No real network call is made; the OS rejects or drops the SYN locally.)

## Overall test-coverage understanding

Janus's slice is the **shared substrate** every other component manager depends on. Boreas (tunnel), Demeter (backend + frontend supervision), and Kratos (existing-tooling integration) all consume `HealthProbe` + `RetryPolicy`. If Janus's contract is wrong, every downstream agent inherits the bug. Conversely, if Janus's tests pass, the lower-level "is it up?" question is answered correctly across the whole launcher and the higher-level agents only need to test their orchestration logic, not their probing logic.

Coverage interlock: Gaia (test architecture) should treat JANUS-T01–T07 as part of the **unit** layer and write end-to-end tests on top that drive `RetryPolicy` against fake services. Helios (charts) should pull retry-attempt histograms from Eros's JSONL log, where each `RetryPolicy.run` call writes one event per attempt with `(component, attempt, classification, sleep_ms, result)`.

## Handover note to orchestrator

Solid:
- Probe taxonomy (live vs ready, 5 failure classes, terminal vs transient).
- Per-phase retry constants — defensible against the cold `go run` and Next.js dev-startup tail.
- Full-jitter formula and Swift skeleton; ready for Boreas/Demeter to wire in.
- Stale-detection strategy that honors the no-git rule by reading `.git/HEAD` directly.

Uncertain (~4% of confidence):
- Frontend `htmlReady` may flap on the **very first** page load when Next.js is still compiling — it can return a 200 with a transient "compiling" placeholder. If Demeter sees flapping, suggest tightening readiness to require a specific marker (`<div id="__next">`) in the body. Defer until observed.
- The `Process()` ban for `git` is interpreted strictly. If Iris (security) decides reading `.git/HEAD` via direct file I/O is also off-limits inside the hardened-runtime sandbox, the launcher will need a build-time injection of HEAD via the same `-ldflags` trick the backend already uses. Flag for Iris.

Next integration: orchestrator should hand Janus's `HealthProbe` + `RetryPolicy` skeletons to **Boreas** (tunnel) and **Demeter** (backend/frontend) so they implement their managers against this contract verbatim. **Eros** (logging) should standardize on the per-attempt event shape `(ts, component, attempt, classification, sleep_ms, terminal_bool)` so Helios's charts have a single source.
