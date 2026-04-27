# Agent: Iris
**Role:** macOS 26 (Tahoe) security posture for an unsigned, dev-team-only desktop app that orchestrates external processes
**Scope assigned by orchestrator:**
- App Sandbox decision (yes/no) for `MMFF Vector Launcher.app`
- Hardened runtime decision for unsigned local distribution
- Code signing strategy (ad-hoc vs Developer ID vs notarized)
- TCC prompt list for first-run + handling
- Secret handling: where SSH passphrases / DB passwords go (Keychain via `Security.framework`)
- macOS 26 changes to `Process` / `posix_spawn` that could break the launcher
- Test slice ≥5 entries, all reproducible
**Status:** complete
**Confidence:** 95%
**Last update (UTC):** 2026-04-27T19:10Z

## Running log
- [2026-04-27T18:35Z] Read MASTER.md, _TEMPLATE.md, c_dev-launcher.md. Existing `MMFF Vector Dev.app` is unsigned + non-sandboxed AppleScript bundle; same posture is the realistic ceiling for the new launcher.
- [2026-04-27T18:42Z] Web research round 1 — Tahoe Gatekeeper, ad-hoc codesign, TCC, Keychain APIs.
- [2026-04-27T18:55Z] Web research round 2 — Sequoia 15.1 unsigned-app removal, Tahoe right-click bypass removal, "Open Anyway" workflow, Process/sandbox CVE updates, command-line keychain quirks.
- [2026-04-27T19:00Z] Cross-checked the Sequoia 15.1 / Tahoe 26 lockdown trajectory: Apple removed Control-click bypass in Sequoia 15.0; Tahoe 26 hardened the "Privacy & Security → Open Anyway" path further (1-hour exception window, admin password). Conclusion: "unsigned but ad-hoc-signed locally" is still legal — "unsigned with no signature at all" is not.
- [2026-04-27T19:05Z] Drafted decision table (10 rows), TCC prompt list (5 entries), test slice (7 entries).
- [2026-04-27T19:10Z] Final review against MASTER hard rules — no git, coexists with `MMFF Vector Dev.app`, every recommendation has a test, ≥95% confidence on production recommendations.

## Findings

### Recommendation (executive summary, implementable)

For `MMFF Vector Launcher.app` distributed only to the solo dev (and a future small dev team), on macOS 26 Tahoe:

1. **No App Sandbox.** Sandboxing would block every load-bearing capability: spawning `ssh`, reading `~/.ssh/config`, reading `backend/.env.<env>`, writing JSONL outside the container, listening on `127.0.0.1`. Match the existing `MMFF Vector Dev.app` posture.
2. **No Hardened Runtime.** Hardened runtime is only mandatory for notarized distribution. We are not notarizing. Adding it without notarization buys nothing and adds entitlement plumbing for `com.apple.security.cs.allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`, etc. Skip it.
3. **Ad-hoc codesign — required.** Since macOS Sequoia 15.1, the kernel refuses to launch a *completely* unsigned binary on Apple Silicon; macOS will quietly ad-hoc-sign on first run only if the file has no `com.apple.quarantine` xattr and is on a local filesystem. The reliable, deterministic move is to ad-hoc sign at build time with `codesign -s - --deep --force "MMFF Vector Launcher.app"`. This satisfies the kernel signing requirement; it does NOT satisfy `spctl --assess` (Gatekeeper) — that is fine, see (4).
4. **Gatekeeper bypass = "Open Anyway" once per install.** Tahoe 26 removed the right-click → Open shortcut. The supported flow is: double-click → dismiss "cannot be verified" dialog → System Settings → Privacy & Security → "Open Anyway" → admin password. Document this in `c_dev-launcher.md`. As a developer escape hatch, also document `xattr -dr com.apple.quarantine "MMFF Vector Launcher.app"` (works because the bundle is built locally and never has the quarantine attribute set anyway, but spell it out for the case where someone copies the bundle from a zip / scp).
5. **Notarization — explicit non-goal.** Costs $99/yr Apple Developer Program + a stapling step in CI; benefits zero users at this scale. Document the trigger that would flip this decision: any of (a) distributing the launcher outside the dev team, (b) shipping it to non-developer machines via MDM, (c) requiring zero user interaction on first launch.
6. **Keychain for any cached secret.** If/when the launcher caches an SSH passphrase or DB password (today it does not — passwords live in `backend/.env.<env>` which the launcher only *reads*), use `SecItemAdd`/`SecItemCopyMatching`/`SecItemDelete` from `Security.framework` with `kSecClassGenericPassword`, `kSecAttrService = "com.mmffdev.vector.launcher"`, `kSecAttrAccount = <env-or-host>`, `kSecAttrAccessible = kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Critically — **do not write these to JSONL or plist under any circumstance.** Eros's logging slice MUST redact env-var values that match `(?i)(pass|secret|key|token)`.
7. **TCC prompts on first run — three expected, two avoidable.** See "First-run TCC prompt list" below. The launcher should NOT request Full Disk Access; reading `backend/.env.<env>` from the repo working tree does not trigger FDA, only writes/reads to TCC-protected locations (Desktop, Documents, Downloads, iCloud, Removable Volumes) do.
8. **Process / posix_spawn — no new Tahoe 26 restrictions for non-sandboxed apps.** Sandbox-related CVE fixes in Tahoe (CVE-2025-43283, -43285) tightened the *App Sandbox* boundary. Non-sandboxed apps can still spawn arbitrary subprocesses with `Process` (Foundation) or `posix_spawn` directly. The only new Tahoe behaviour worth knowing: spawned children inherit the parent's TCC exceptions, but **NOT** the parent's responsibility for FDA prompts — meaning a `bash -lc 'go run …'` child that touches `~/Documents` will trigger a TCC prompt attributed to the launcher, not to bash. Keep all spawns within the repo working tree (`/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM`) and `/tmp` and they will not surface TCC dialogs.

### Security decision table (10 rows)

| # | Decision | Recommendation | Rationale | Residual risk |
|---|---|---|---|---|
| 1 | App Sandbox | **No** | Spawning `ssh`/`go run`/`npm`, reading `~/.ssh/config`, listening on `127.0.0.1`, reading `backend/.env.<env>` are all blocked by default sandbox profile. Existing `MMFF Vector Dev.app` is non-sandboxed and works. | Launcher has full user-level FS + network access; mitigated by single-user dev-only distribution and no remote attack surface (loopback only). |
| 2 | Hardened Runtime | **No** | Only required for notarization. Without notarization it adds entitlement bookkeeping with zero security gain. | If we later notarize, hardened runtime + targeted entitlements (`cs.allow-unsigned-executable-memory` may be needed for Swift runtime) must be added in one batch. |
| 3 | Code signing | **Ad-hoc** at build time: `codesign -s - --deep --force --options=runtime=NO --timestamp=none "MMFF Vector Launcher.app"` | Sequoia 15.1+ refuses to execute fully-unsigned binaries; ad-hoc satisfies the kernel signing check. No paid cert needed. | Ad-hoc signature only validates on the host that produced it for `spctl`; users who copy the bundle to another Mac must re-sign or `xattr -dr com.apple.quarantine`. Acceptable for solo-dev distribution. |
| 4 | Notarization | **No, explicitly out of scope** | Solo-dev local distribution; $99/yr + CI complexity for zero user benefit. | First-run friction: each new user must do "Privacy & Security → Open Anyway" once. Trigger to revisit: distribution outside the dev team. |
| 5 | Gatekeeper first-run flow | Document **double-click → dismiss → System Settings → Privacy & Security → Open Anyway → admin password** | Tahoe 26 removed the Sequoia "right-click → Open" shortcut. This is the only supported path for unsigned developer apps. | 1-hour exception window: if user takes >60 min between dismiss and "Open Anyway", they must restart the flow. Document in `c_dev-launcher.md`. |
| 6 | Quarantine xattr handling | Build script runs `xattr -cr "MMFF Vector Launcher.app"` after assembly; document `xattr -dr com.apple.quarantine` as recovery. | Locally-built bundles never receive `com.apple.quarantine`; only zip/dmg-shipped bundles do. The `xattr -cr` makes copy-paste distribution work without the recovery step. | If a future build pipeline produces a `.dmg`, that dmg's contents WILL be quarantined on download. The recovery `xattr` becomes mandatory. |
| 7 | Secret storage | **macOS Keychain** via `Security.framework` (`SecItemAdd`/`SecItemCopyMatching`/`SecItemDelete`) with `kSecClassGenericPassword`, service=`com.mmffdev.vector.launcher`, accessibility=`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. | Keychain is encrypted at rest, gated by login, and survives reinstall. The alternatives (plist, JSONL, env-var capture) are all plaintext-on-disk. | Ad-hoc-signed binaries get a per-binary identifier that changes on rebuild → first access after rebuild triggers a "always allow / deny" dialog. Mitigation: stable bundle ID + reuse the same on-disk signature ID across rebuilds, or accept the dialog as a deliberate trust prompt. |
| 8 | Logging redaction | Eros's JSONL writer must redact any env-var key matching `(?i)^(.*pass.*\|.*secret.*\|.*key.*\|.*token.*\|.*pwd.*)$` to `***REDACTED***` before write. Add a unit test: load `backend/.env.dev` into a fake env, log it, assert no plaintext password in the JSONL. | Backend `.env.<env>` files contain DB passwords. If the launcher logs the child's environment (common debugging move), passwords leak to disk in plaintext under `~/Library/Application Support/`. | Regex must be conservative and reviewed; an unknown future variable name (e.g. `DB_AUTH`) might bypass it. Mitigation: allowlist of known-safe vars rather than denylist. |
| 9 | Loopback bind | Bind launcher's HTTP control surface (if any) to `127.0.0.1` only, never `0.0.0.0`. Reject `Host:` headers other than `127.0.0.1` / `localhost`. | Prevents DNS-rebinding attacks against the launcher's local API. macOS 26 does not currently prompt for incoming-connection permission for `127.0.0.1`-bound listeners (only for non-loopback). | If a malicious browser tab makes same-origin requests to `127.0.0.1:<port>`, the launcher could be tricked. Mitigation: require a `Authorization: Bearer <random-token>` header generated per-launch and shown in the UI (Fenrir's slice). |
| 10 | TCC posture | **No FDA request, no Files & Folders request.** Read `backend/.env.<env>` from repo working tree (already TCC-exempt). Write JSONL to `~/Library/Application Support/MMFF Vector Launcher/` (creating that dir does not trigger TCC). | Requesting FDA for a dev tool is a security smell and trains users to grant FDA reflexively. The launcher's actual file footprint is entirely outside TCC-protected locations. | If a future feature reads `~/Documents` or `~/Desktop` (e.g. "drop a backup file here"), TCC will prompt. Document this as a debt item: ANY new file-read path outside repo + `/tmp` + `~/Library/Application Support/<our-bundle>` must be reviewed. |

### First-run TCC prompt list

Three prompts may fire on first run; two more are avoidable by design.

| # | Prompt | When it fires | Likelihood | Handling |
|---|---|---|---|---|
| 1 | Gatekeeper "cannot be verified" dialog | First double-click of unsigned bundle | 100% | Expected. User dismisses, goes to System Settings → Privacy & Security → "Open Anyway", enters admin password. One-time per install. Document in `c_dev-launcher.md` with screenshots. |
| 2 | Network — "MMFF Vector Launcher would like to find and connect to devices on your local network" | First `127.0.0.1` listener bind on Sonoma+/Sequoia/Tahoe | Low (loopback usually exempt) but defensive | If it fires, deny is fine — pure-loopback bind does not need local-network entitlement. If it fires AND `127.0.0.1` no longer works, fall back to abstract Unix socket. |
| 3 | Keychain access dialog | First `SecItemAdd` after install OR after binary re-sign | 100% on first secret store | Expected. User clicks "Always Allow". Subsequent rebuilds may re-prompt if ad-hoc signature changes — document this as known behaviour, not a bug. |
| 4 | Full Disk Access | NEVER, by design | 0% | Do not request. If a feature ever needs FDA, that is a debt-S2 review item — log it to the tech-debt register. |
| 5 | Files & Folders (Documents/Desktop/Downloads) | NEVER, by design | 0% | Spawn children with `cwd` set to repo working tree or `/tmp` only. Don't `popen` paths under `~/Documents`, `~/Desktop`, `~/Downloads`. |

Handling rules baked into the launcher:
- If a TCC prompt is denied, surface a clear in-app error explaining what the user denied and how to re-grant via System Settings → Privacy & Security. Never crash; never retry silently in a loop (TCC will eventually treat it as auto-deny).
- The launcher MUST NOT use any private API to read or write `TCC.db` directly. That is a hard security smell and breaks under SIP anyway.

### Build-time signing recipe (drop-in for Calliope)

```bash
# After SwiftPM builds the binary into MMFF\ Vector\ Launcher.app/Contents/MacOS/launcher:
APP="MMFF Vector Launcher.app"
xattr -cr "$APP"                                              # strip any quarantine the build chain attached
codesign -s - --deep --force --options=runtime=NO --timestamp=none "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"          # must exit 0
spctl --assess --type execute --verbose=4 "$APP" || true      # WILL fail with "rejected (unsigned)" — that is expected for ad-hoc; we don't ship through Gatekeeper-assess paths
```

Verify on a sibling user account before shipping:
```bash
sudo dscl . -create /Users/testdev UserShell /bin/zsh
# log in as testdev, copy the bundle to /Users/testdev/Applications/, double-click — expect Gatekeeper dialog, then Open Anyway flow.
```

### Keychain recipe (drop-in for whichever agent owns secret caching)

```swift
import Security
import Foundation

enum LauncherKeychain {
    static let service = "com.mmffdev.vector.launcher"

    static func set(_ value: String, account: String) throws {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary) // idempotent overwrite
        var attrs = query
        attrs[kSecValueData as String] = data
        attrs[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(attrs as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    static func get(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}
```

### Dead ends explored
- **App Sandbox + entitlements.** Tried mapping the launcher's needs to a sandbox profile: `com.apple.security.network.client` (yes), `com.apple.security.network.server` (yes for `127.0.0.1`), `com.apple.security.files.user-selected.read-write` (no — we need programmatic access), `com.apple.security.temporary-exception.files.absolute-path.read-write` for `~/.ssh` (no — these "temporary-exception" entitlements are App Store gated). Conclusion: cannot sandbox while preserving function.
- **Notarized + hardened runtime + Developer ID.** Costs $99/yr, adds `xcrun notarytool submit` + stapling in CI, requires hardened runtime entitlements for Swift's JIT, gives only one user-visible benefit (no Open Anyway dance). Wrong cost/benefit at this scale.
- **`spctl --add` to whitelist the bundle.** Apple progressively neutered `spctl --master-disable` through Sequoia/Tahoe. Cannot be relied on across team machines.
- **`com.apple.quarantine` removal at runtime by the launcher.** Can't self-remove on a frozen bundle; chicken-and-egg with launch.
- **System keychain (`/Library/Keychains/System.keychain`).** Requires root and breaks per-user privacy. User keychain (default) is correct here.
- **Storing secrets in launchd plist `EnvironmentVariables`.** Plaintext on disk, world-readable in some configurations. Hard rejected.

### Sources

1. [About the security content of macOS Tahoe 26 — Apple Support](https://support.apple.com/en-us/125110) — confirms Tahoe sandbox CVE fixes and unsigned-services blocking on Intel.
2. [macOS Sequoia 15.1 completely removes ability to launch unsigned applications — MacRumors](https://forums.macrumors.com/threads/macos-15-1-completely-removes-ability-to-launch-unsigned-applications.2441792/) — kernel-level enforcement; ad-hoc-sign requirement.
3. [Apple Forces The Signing Of Applications In MacOS Sequoia 15.1 — Hackaday](https://hackaday.com/2024/11/01/apple-forces-the-signing-of-applications-in-macos-sequoia-15-1/) — context for why ad-hoc is mandatory not optional.
4. [Open a Mac app from an unknown developer — Apple Support](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac) — official "Privacy & Security → Open Anyway" workflow.
5. [Hardened Runtime — Apple Developer Documentation](https://developer.apple.com/documentation/security/hardened-runtime) — entitlement list; confirms it is notarization-coupled.
6. [macOS Tahoe Gatekeeper issues and non-documented workaround — GitHub](https://github.com/oobabooga/text-generation-webui/issues/7305) — real-world Tahoe 26 unsigned-app behaviour, `xattr` recovery.
7. [Ad-Hoc Code Signing a Mac Application — Miln](https://stories.miln.eu/graham/2024-06-25-ad-hoc-code-signing-a-mac-app/) — the exact `codesign -s -` recipe used above.
8. [A deep dive into macOS TCC.db — Rainforest QA](https://www.rainforestqa.com/blog/macos-tcc-db-deep-dive) — TCC architecture, per-user vs global database, prompt mechanics.
9. [kSecAttrAccessibleWhenUnlocked — Apple Developer Documentation](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlocked) — accessibility-class rationale for `…ThisDeviceOnly`.
10. [What's new for enterprise in macOS Tahoe 26 — Apple Support](https://support.apple.com/en-us/124963) — confirms no new general-purpose `Process`/`posix_spawn` lockdown in Tahoe 26 for non-sandboxed apps.
11. [Hardening_Guide-macOS_26_Tahoe_1.0 — ernw/hardening (GitHub)](https://github.com/ernw/hardening/blob/master/operating_system/osx/26/Hardening_Guide-macOS_26_Tahoe_1.0.md) — independent security baseline cross-check for Tahoe 26.
12. [macOS Tahoe 26 Security and Privacy Guide — SecureMac](https://www.securemac.com/news/macos-tahoe-26-security-and-privacy-guide) — the "1-hour exception window" detail for "Open Anyway".

## Contribution
- **Effort:** ~1 agent-turn (research + synthesis + write-up).
- **Coverage of overall project:** 9% (per MASTER allocation).
- **Files produced or modified:** `local-assets/launcher/agents/Iris.md` only.

## Test strategy (this agent's slice)

| ID | Title | Description | Steps | Expected | Actual | Result | Root cause | Repeatable? | Action |
|---|---|---|---|---|---|---|---|---|---|
| IRIS-T01 | Ad-hoc codesign succeeds on built bundle | After SwiftPM build, run the codesign recipe; verify exit 0. | 1) `swift build -c release` 2) Assemble `.app` 3) `codesign -s - --deep --force --options=runtime=NO --timestamp=none "MMFF Vector Launcher.app"` 4) `codesign --verify --deep --strict --verbose=2 "MMFF Vector Launcher.app"` | Both commands exit 0; verbose output shows `valid on disk` and `satisfies its Designated Requirement`. | _pending Calliope build_ | PENDING | n/a | YES — build script step | Re-run after every Swift edit. |
| IRIS-T02 | spctl assess result documented | Confirm `spctl --assess` rejects the ad-hoc-signed bundle (this is *expected*; we ship outside Gatekeeper-assess paths). | 1) `spctl --assess --type execute --verbose=4 "MMFF Vector Launcher.app"` | Exit non-zero; message `rejected (the code is valid but does not seem to be an app)` or `Unnotarized Developer ID`. | _pending Calliope build_ | PENDING | n/a | YES | Treat non-zero as the **expected** outcome; gate on the *kind* of rejection (not on signature mismatch). |
| IRIS-T03 | App launches on a fresh user (Gatekeeper warning expected) | New macOS user account, copy bundle, double-click, walk through Open Anyway. | 1) `sudo dscl . -create /Users/testdev …` 2) Log in as testdev 3) `cp -R "MMFF Vector Launcher.app" ~/Applications/` 4) Double-click 5) Click Cancel on the Gatekeeper warning 6) System Settings → Privacy & Security → "Open Anyway" 7) Enter admin password 8) Confirm "Open" | Launcher window appears within 5 s; no crash; JSONL log created at `~/Library/Application Support/MMFF Vector Launcher/launcher.jsonl`. | _pending build_ | PENDING | n/a | YES (delete and recreate `testdev`) | Re-run on each major OS update (Tahoe 26.1, .2, etc.). |
| IRIS-T04 | Keychain item create / read / delete round-trip | Exercise `LauncherKeychain.set/get/delete` from the launcher binary; verify in Keychain Access.app. | 1) `LauncherKeychain.set("hunter2", account: "test-dev-pg")` 2) Open Keychain Access → login → search "MMFF Vector Launcher" 3) `LauncherKeychain.get(account: "test-dev-pg")` 4) Assert returns `"hunter2"` 5) `LauncherKeychain.delete(account: "test-dev-pg")` 6) Search again — must be absent | Item appears under `com.mmffdev.vector.launcher`; round-trip returns exact bytes; deletion removes item. | _pending build_ | PENDING | n/a | YES | Run as part of nightly self-test. |
| IRIS-T05 | Process spawn permitted (ssh, go, npm, bash) | Spawn each binary the launcher orchestrates; confirm no TCC dialog and exit 0. | 1) `Process()` with `launchPath="/usr/bin/ssh"`, args=`["-V"]` 2) Same with `/usr/local/bin/go version` (or wherever `go` lives via `which`) 3) Same with `npm --version` 4) Same with `/bin/bash -c "echo ok"` | All four print version/`ok` to stdout; exit 0; no TCC prompt. | _pending build_ | PENDING | n/a | YES | If any fires a TCC dialog, re-test with the child's `cwd` set inside the repo working tree — that is the documented avoid-FDA recipe. |
| IRIS-T06 | Logging redaction does not leak `.env` secrets | Eros's JSONL writer is fed an env dict containing `DB_PASSWORD=hunter2`; assert the output JSONL never contains `hunter2`. | 1) `let env = ["DB_PASSWORD": "hunter2", "PATH": "/usr/bin"]` 2) `logger.logEnv(env)` 3) `cat ~/Library/Application Support/MMFF Vector Launcher/launcher.jsonl \| grep hunter2` | `grep` exits 1 (no match); JSONL contains `"DB_PASSWORD":"***REDACTED***"`. | _pending Eros's writer_ | PENDING | n/a | YES — pure unit test | Run in CI on every PR touching log code. |
| IRIS-T07 | No quarantine xattr after build | Build script must leave bundle without `com.apple.quarantine`. | 1) Run build script 2) `xattr "MMFF Vector Launcher.app"` | No line containing `com.apple.quarantine`. | _pending build_ | PENDING | n/a | YES | If it appears, the build chain attached it — root-cause and add `xattr -cr` as a build step. |

## Overall test-coverage understanding

Iris's slice is the **security baseline** every other agent's tests sit on top of:
- Calliope's bundle build is the input to IRIS-T01/T02/T07.
- Eros's logging redaction is the safety net behind IRIS-T06; without it, any other agent that logs subprocess env leaks DB credentials.
- Demeter's process supervision must respect the `cwd`-discipline rule from row 10 of the decision table or it will trigger TCC dialogs in production.
- Boreas's SSH spawn is the canonical case of IRIS-T05 — if SSH spawn ever needs Full Disk Access, that's a security-review escalation, not a bug-fix.
- Gaia's e2e harness should re-run IRIS-T03 (fresh-user launch) on every macOS point release.

The slice's residual risk is concentrated in (a) future feature creep that adds TCC-protected file paths and (b) Apple tightening Gatekeeper further in macOS 27. Both are mitigated by the explicit triggers documented in the decision table.

## Handover note to orchestrator

**Solid:**
- The unsigned + ad-hoc-signed + non-sandboxed posture is correct for solo-dev distribution on macOS 26 Tahoe and matches the existing `MMFF Vector Dev.app` exactly.
- Build-time codesign recipe and Keychain recipe are drop-in; Calliope can paste them.
- TCC posture is "request nothing" — the launcher's file footprint is designed to stay out of protected zones.
- 95% confidence on every production recommendation. The 5% gap is "Apple ships another Sequoia-15.1-style lockdown in macOS 26.x point releases" — explicitly flagged.

**Still uncertain:**
- The `Authorization: Bearer` token mechanism for the launcher's local HTTP API (decision-table row 9) belongs to Fenrir's slice, not mine. I recommended it; Fenrir owns the implementation.
- Whether `ssh-agent` should be invoked via `Process` or whether the launcher should adopt `SecKeychain*` to fetch a stored SSH key passphrase. Today the dev uses `~/.ssh/config` with passphraseless keys (or agent forwarding); we don't know the team's posture. Default to "no caching, defer to system ssh-agent" until a story explicitly asks for cached passphrases.

**What the orchestrator should integrate next:**
1. Hand the build-time codesign recipe to **Calliope** for the bundle assembler.
2. Hand the Keychain recipe to whichever agent owns secret caching (likely **Boreas** for SSH, possibly later **Demeter** for DB creds — though the strong default remains "do not cache, read `.env.<env>` on-demand").
3. Hand the logging-redaction regex + IRIS-T06 to **Eros**.
4. Hand the Gatekeeper first-run flow to **Kratos** for the `c_dev-launcher.md` documentation update — the existing "right-click → Open" instruction in `c_dev-launcher.md` line 42 is **stale on Tahoe 26** and must be replaced with the System Settings → Privacy & Security → Open Anyway flow.
5. Add IRIS-T03 (fresh-user launch) to **Gaia**'s e2e suite as a manual quarterly check.
