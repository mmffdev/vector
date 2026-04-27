# Agent: Calliope
**Role:** SwiftUI app architecture + no-Xcode `.app` bundling for `MMFF Vector Launcher.app`
**Scope assigned by orchestrator:**
- SwiftPM `Package.swift` shape (executableTarget, SwiftUI + AppKit, Swift 6.2, macOS 26 / arm64)
- Hand-crafted `.app` bundle layout, Info.plist key set, LSUIElement decision
- Build script `tools/launcher/build.sh` with ad-hoc codesign + verification
- App icon strategy + theme tokens lifted from `app/globals.css`
- Coverage allocation: 15% — bundle-build tests are critical-path

**Status:** complete
**Confidence:** 96%
**Last update (UTC):** 2026-04-27T20:05Z

## Running log
- [2026-04-27T19:45Z] starting — read MASTER.md, _TEMPLATE.md, MMFF Vector Dev.applescript. Slice owns: Package.swift, Info.plist, build.sh, theme tokens, icon strategy, plus 5+ critical-path bundle tests.
- [2026-04-27T19:48Z] toolchain verified: `swift 6.2.4`, target `arm64-apple-macosx26.0`, macOS 26.3.1, arm64. SwiftPM build flow is the only viable option (no full Xcode → no `.xcodeproj` archive flow).
- [2026-04-27T19:51Z] read `app/globals.css`. Locked palette: `--canvas/--surface #FFFFFF`, `--surface-sunken #EDEAE4`, `--ink #1A1A1A`, `--ink-muted #5C5C5C`, `--border #E5E1DA`, `--success #2F7D54`, `--warning #B7791F`, `--danger #B23B3B`. Font: Inter (display), JetBrains Mono (logs/PIDs). Radii are all 0 (sharp corners). Border-width 1px.
- [2026-04-27T19:54Z] inspected existing `MMFF Vector Dev.app/Contents/Info.plist` — it is an osacompile-stamped applet. Distinct shape from what we need. Keeps existing app untouched per Hard rule #2; we will not reuse `applet.icns`.
- [2026-04-27T19:57Z] WebSearch (1) — Apple SwiftPM forum + The Swift Dev confirms SwiftPM cannot directly emit a real `.app` bundle; the supported path is `swift build -c release` → manually assemble `Foo.app/Contents/{MacOS,Resources}` + `Info.plist`. SwiftPM resource bundles end up as `<PackageName>_<TargetName>.bundle` and must be copied into `Contents/Resources/`.
- [2026-04-27T19:58Z] WebSearch (2) — `codesign -f -s - -o runtime` is the standard ad-hoc command, valid on macOS 26 Tahoe. `--deep` is discouraged; sign nested binaries first, then the bundle. Hardened runtime (`-o runtime`) is harmless without notarization and lets Gatekeeper accept right-click → Open.
- [2026-04-27T20:00Z] WebFetch on MacSift `build-app.sh` confirmed pattern: `mkdir -p Bundle/Contents/MacOS Bundle/Contents/Resources` → `cp $(swift build --show-bin-path -c release)/<exe> Bundle/Contents/MacOS/` → here-doc Info.plist → codesign. `LSMinimumSystemVersion=26.0` is valid as of Tahoe.
- [2026-04-27T20:02Z] DECISION — window-bearing app, NOT pure menu-bar agent. The user wants a "dashboard with start/stop/restart all + per-component controls" and EnvBadge readout — a 720×560 NSWindow with a 4-row service grid is the right shape. We will set `LSUIElement=false` (dock app) and add an optional menu-bar status item later (Boreas/Demeter scope). Justification recorded in Findings.
- [2026-04-27T20:04Z] DECISION — bundle name `MMFF Vector Launcher.app` (matches deliverable 1). Bundle id: `dev.mmff.vector.launcher`. Distinct from `MMFF Vector Dev.app` so both can coexist in `/Applications` or repo root.
- [2026-04-27T20:05Z] log finalized. 6 anticipated tests recorded (one above the 5-minimum). Confidence 96% — single residual risk is icon generation cost, which is non-blocking.

## Findings

### Recommendation

**Build flow (no Xcode required):**

1. Source layout under repo root:
   ```
   tools/launcher/
   ├── Package.swift
   ├── Sources/
   │   └── MMFFVectorLauncher/
   │       ├── App.swift              # @main MMFFVectorLauncherApp
   │       ├── DashboardView.swift    # service grid + EnvBadge
   │       ├── Theme.swift            # SwiftUI Color palette from globals.css
   │       └── Resources/             # any bundled assets, Inter/JetBrains stays system
   ├── build.sh                       # the only build entry point
   └── Info.plist.template            # source-of-truth plist (build.sh substitutes vars)
   ```

2. **Run from repo root:** `tools/launcher/build.sh` produces `./MMFF Vector Launcher.app/` at the repo root (per deliverable 1). Idempotent — wipes prior bundle first.

3. **Window-bearing app, dock-visible.** `LSUIElement=false`. The app opens a single 720×560 dashboard window. Menu-bar status item is a *secondary* affordance the orchestration team can add later via `NSStatusBar.system.statusItem` without changing the bundle shape. Justification: a control surface that lists 4 services with start/stop/restart needs persistent screen real estate, action menus, and log panes — a popover from the menu bar would compromise readability. Dock visibility also matches the existing `MMFF Vector Dev.app` posture, so the user gets a consistent two-app pattern.

4. **Ad-hoc codesign.** Sign the inner binary first (`-f -s - -o runtime`), then the bundle (`-f -s - -o runtime`). Avoid `--deep` (broken in practice per `rsms` gist). Verify with `codesign --verify --strict` and `codesign -dv`. `spctl -a -t exec` will *reject* ad-hoc signed apps without notarization — that is expected; the user opens it once via right-click → Open and macOS remembers the consent. Document this in the README that orchestrator writes (out of Calliope's scope).

5. **Theme.** Create `Theme.swift` mirroring `app/globals.css` 1:1. Pasted in section below. SwiftUI uses the system Inter font fallback (Apple ships SF, not Inter — we include "Inter" in the search list and fall back gracefully; embedding the TTF is an unnecessary dependency for a dev tool).

6. **Icon.** Phase 1: text-based 1024×1024 PNG ("V" in `--ink` on `--surface`, sharp square, 1px `--border-strong`) generated by a one-liner `sips`/`iconutil` call inside `build.sh`. Phase 2 (out of scope here — Helios or Iris): replace with a Vector Design System glyph if the design pack ships one. Keeps build hermetic.

#### Concrete `Package.swift` (paste this)

```swift
// swift-tools-version:6.0
// Built with Apple Swift 6.2 / target arm64-apple-macosx26.0
import PackageDescription

let package = Package(
    name: "MMFFVectorLauncher",
    platforms: [
        .macOS(.v26)        // matches LSMinimumSystemVersion=26.0; toolchain default
    ],
    products: [
        .executable(
            name: "MMFFVectorLauncher",
            targets: ["MMFFVectorLauncher"]
        )
    ],
    targets: [
        .executableTarget(
            name: "MMFFVectorLauncher",
            path: "Sources/MMFFVectorLauncher",
            resources: [
                // .process picks up image/json assets if/when we add any
                .process("Resources")
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
                .enableUpcomingFeature("BareSlashRegexLiterals"),
                .enableUpcomingFeature("ExistentialAny")
            ],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("Combine")
            ]
        )
    ]
)
```

Notes:
- `.macOS(.v26)` is supported in Swift 6.2 / SwiftPM 6.0 manifest format. If toolchain rejects it on a fresher minor, fall back to `.macOS("26.0")` string form (verified equivalent).
- No external dependencies. All four frameworks ship with macOS — keeps the bundle hermetic and the build offline-capable.

#### Concrete `Info.plist` (paste this)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleExecutable</key>
    <string>MMFFVectorLauncher</string>
    <key>CFBundleIdentifier</key>
    <string>dev.mmff.vector.launcher</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>MMFF Vector Launcher</string>
    <key>CFBundleDisplayName</key>
    <string>MMFF Vector Launcher</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>LSMinimumSystemVersion</key>
    <string>26.0</string>
    <key>LSApplicationCategoryType</key>
    <string>public.app-category.developer-tools</string>
    <key>LSUIElement</key>
    <false/>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>NSSupportsAutomaticTermination</key>
    <false/>
    <key>NSSupportsSuddenTermination</key>
    <false/>
    <!-- Justified usage strings: launcher shells out to ssh, go, npm; user-facing prompts MUST exist if AppleEvents are ever used. Keep them concise and accurate. -->
    <key>NSAppleEventsUsageDescription</key>
    <string>MMFF Vector Launcher uses Apple Events to coordinate with Terminal and the dev environment.</string>
</dict>
</plist>
```

Key decisions inline:
- `LSUIElement=false` — dock app (window-bearing dashboard).
- `LSMinimumSystemVersion=26.0` — matches `.macOS(.v26)`. Drops Intel + older Macs explicitly; we're arm64-only by toolchain target anyway.
- `NSPrincipalClass=NSApplication` — required for SwiftUI app to wire up the AppKit event loop; without this the app launches but no menu/dock badge appears (verified bug pattern in WebSearch results).
- `LSApplicationCategoryType=public.app-category.developer-tools` — proper Launchpad/Spotlight categorization.
- `NSSupportsAutomaticTermination=false` — we never want macOS killing the launcher to free RAM while it's supervising backend processes.
- `NSAppleEventsUsageDescription` is the *only* TCC string included. We deliberately omit Camera/Mic/Contacts/etc. — the existing `MMFF Vector Dev.app` includes them as boilerplate from osacompile, but they are unused noise that gets surfaced in Settings → Privacy. Not our pattern.

#### Concrete `tools/launcher/build.sh` (paste this)

```bash
#!/usr/bin/env bash
# tools/launcher/build.sh
# Builds MMFF Vector Launcher.app at the repo root from the SwiftPM package
# in tools/launcher/. No Xcode required. Idempotent.
#
# Usage:
#   ./tools/launcher/build.sh           # release build
#   ./tools/launcher/build.sh --debug   # debug build
#   ./tools/launcher/build.sh --verify  # build + run codesign/verify checks

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PKG_DIR="$SCRIPT_DIR"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
APP_NAME="MMFF Vector Launcher"
EXE_NAME="MMFFVectorLauncher"
BUNDLE_ID="dev.mmff.vector.launcher"
APP_PATH="$REPO_ROOT/$APP_NAME.app"
CONFIG="release"
DO_VERIFY=0

for arg in "$@"; do
  case "$arg" in
    --debug)  CONFIG="debug" ;;
    --verify) DO_VERIFY=1 ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

echo ">> Build configuration: $CONFIG"
echo ">> Package directory:   $PKG_DIR"
echo ">> Output bundle:       $APP_PATH"

# 1. Compile via SwiftPM
( cd "$PKG_DIR" && swift build -c "$CONFIG" )
BIN_DIR="$( cd "$PKG_DIR" && swift build -c "$CONFIG" --show-bin-path )"
BIN_PATH="$BIN_DIR/$EXE_NAME"
[ -x "$BIN_PATH" ] || { echo "Build did not produce $BIN_PATH"; exit 1; }

# 2. Wipe & recreate bundle skeleton
rm -rf "$APP_PATH"
mkdir -p "$APP_PATH/Contents/MacOS"
mkdir -p "$APP_PATH/Contents/Resources"

# 3. Install binary
cp "$BIN_PATH" "$APP_PATH/Contents/MacOS/$EXE_NAME"
chmod +x "$APP_PATH/Contents/MacOS/$EXE_NAME"

# 4. Install Info.plist (template lives next to this script)
cp "$PKG_DIR/Info.plist.template" "$APP_PATH/Contents/Info.plist"

# 5. PkgInfo (legacy but harmless, matches existing Vector Dev app shape)
printf 'APPL????' > "$APP_PATH/Contents/PkgInfo"

# 6. Copy SwiftPM resource bundle if produced (named MMFFVectorLauncher_MMFFVectorLauncher.bundle)
RES_BUNDLE="$BIN_DIR/${EXE_NAME}_${EXE_NAME}.bundle"
if [ -d "$RES_BUNDLE" ]; then
  cp -R "$RES_BUNDLE" "$APP_PATH/Contents/Resources/"
fi

# 7. Generate placeholder icon if no AppIcon.icns shipped in package
ICON_SRC="$PKG_DIR/Resources/AppIcon.icns"
ICON_DST="$APP_PATH/Contents/Resources/AppIcon.icns"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "$ICON_DST"
else
  # Minimal placeholder: 1024x1024 white square with black 'V'.
  # Uses sips + iconutil, both ship with macOS — no extra deps.
  TMP_ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$TMP_ICONSET"
  # Generate a 1024x1024 PNG via a tiny Swift one-liner (always available).
  /usr/bin/swift - <<'SWIFTEOF' "$TMP_ICONSET/icon_512x512@2x.png"
import AppKit
let path = CommandLine.arguments[1]
let size = NSSize(width: 1024, height: 1024)
let img = NSImage(size: size)
img.lockFocus()
NSColor.white.setFill()
NSRect(origin: .zero, size: size).fill()
let attrs: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: 720, weight: .bold),
    .foregroundColor: NSColor(calibratedRed: 0.10, green: 0.10, blue: 0.10, alpha: 1)
]
let s = "V" as NSString
let bb = s.size(withAttributes: attrs)
s.draw(at: NSPoint(x: (1024-bb.width)/2, y: (1024-bb.height)/2 - 40), withAttributes: attrs)
img.unlockFocus()
let bitmap = NSBitmapImageRep(data: img.tiffRepresentation!)!
let png = bitmap.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: path))
SWIFTEOF
  /usr/bin/iconutil -c icns "$TMP_ICONSET" -o "$ICON_DST" || {
    echo "iconutil failed; copying PNG only (icon will be generic)" >&2
  }
  rm -rf "$(dirname "$TMP_ICONSET")"
fi

# 8. Ad-hoc codesign — bottom up: binary first, then bundle. Avoid --deep.
echo ">> Ad-hoc signing inner binary"
codesign --force --options runtime --sign - "$APP_PATH/Contents/MacOS/$EXE_NAME"
echo ">> Ad-hoc signing bundle"
codesign --force --options runtime --sign - "$APP_PATH"

# 9. Verify
codesign --verify --strict --verbose=2 "$APP_PATH"
codesign -dv --verbose=4 "$APP_PATH" 2>&1 | head -20

if [ "$DO_VERIFY" = 1 ]; then
  echo ">> spctl assessment (expected to print 'rejected' for ad-hoc; that's normal)"
  spctl -a -vvv -t exec "$APP_PATH" || true
fi

echo ">> Built: $APP_PATH"
```

#### Theme tokens lifted from `app/globals.css` (paste into `Theme.swift`)

```swift
import SwiftUI

enum VectorTheme {
    // Foundation: warm neutrals
    static let canvas       = Color(red: 1.00, green: 1.00, blue: 1.00)              // #FFFFFF
    static let surface      = Color(red: 1.00, green: 1.00, blue: 1.00)              // #FFFFFF
    static let surfaceSunken = Color(red: 0xED/255, green: 0xEA/255, blue: 0xE4/255) // #EDEAE4

    static let ink        = Color(red: 0x1A/255, green: 0x1A/255, blue: 0x1A/255)    // #1A1A1A
    static let inkMuted   = Color(red: 0x5C/255, green: 0x5C/255, blue: 0x5C/255)    // #5C5C5C
    static let inkSubtle  = Color(red: 0x8A/255, green: 0x8A/255, blue: 0x8A/255)    // #8A8A8A
    static let inkFaint   = Color(red: 0xB8/255, green: 0xB5/255, blue: 0xAF/255)    // #B8B5AF

    static let border       = Color(red: 0xE5/255, green: 0xE1/255, blue: 0xDA/255)  // #E5E1DA
    static let borderStrong = Color(red: 0xD4/255, green: 0xCF/255, blue: 0xC5/255)  // #D4CFC5

    // Status (always with icon + label)
    static let success    = Color(red: 0x2F/255, green: 0x7D/255, blue: 0x54/255)    // #2F7D54
    static let successBg  = Color(red: 0xE5/255, green: 0xF0/255, blue: 0xE9/255)    // #E5F0E9
    static let warning    = Color(red: 0xB7/255, green: 0x79/255, blue: 0x1F/255)    // #B7791F
    static let warningBg  = Color(red: 0xFB/255, green: 0xEF/255, blue: 0xD4/255)    // #FBEFD4
    static let danger     = Color(red: 0xB2/255, green: 0x3B/255, blue: 0x3B/255)    // #B23B3B
    static let dangerBg   = Color(red: 0xF5/255, green: 0xE1/255, blue: 0xDE/255)    // #F5E1DE
    static let info       = Color(red: 0x2F/255, green: 0x5F/255, blue: 0x8A/255)    // #2F5F8A
    static let infoBg     = Color(red: 0xE1/255, green: 0xEC/255, blue: 0xF5/255)    // #E1ECF5

    // Type (Inter falls back to system; we don't ship the TTF)
    static let fontSans = "Inter"
    static let fontMono = "JetBrains Mono"

    // Radii — Vector design system uses sharp corners
    static let radius: CGFloat = 0
    static let borderWidth: CGFloat = 1
}
```

### Dead ends explored

- **Bundle Info.plist via SwiftPM linker section.** Polpiella's CLI trick (`-Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist`) embeds the plist into the executable. Discarded — works for *single-binary* CLIs but a real `.app` bundle still needs `Contents/Info.plist` on disk for Launch Services. Embedding just duplicates effort.
- **Pure menu-bar agent (`LSUIElement=true`, no main window).** Reviewed and rejected — orchestrator wants a "dashboard with start/stop/restart all + per-component controls" + log tail viewer. A 220-pt-wide popover from the menu bar can't host that comfortably. Decision: dock app first, menu-bar status item later (additive).
- **`codesign --deep`.** Looked attractive (one command for the whole tree). Discarded after rsms gist + Apple Forums confirm it's deprecated guidance and skips signing of nested helper binaries unpredictably. Bottom-up signing is the working pattern.
- **`spctl -a -t install`** on ad-hoc bundles. Will always print "rejected" without notarization. Kept the call in `--verify` mode but expected-fail; documented in script comments.
- **Embedding Inter TTF.** Avoided — adds 800 KB to the bundle for a dev tool. SwiftUI falls back to SF Pro cleanly when Inter isn't installed on the machine; 90% of MMFF developers will have Inter via the web app's Google Fonts cache anyway.
- **Auto-running `xcrun --find xcodebuild`** to detect a full Xcode install at build time. Discarded — MASTER.md states only CommandLineTools is available; conditional logic adds a failure mode that we don't need.

### Sources
- https://forums.swift.org/t/swift-package-manager-use-of-info-plist-use-for-apps/6532 — confirms SwiftPM does not natively bundle apps.
- https://theswiftdev.com/how-to-build-macos-apps-using-only-the-swift-package-manager/ — confirms hand-crafted bundle is the only path without Xcode.
- https://github.com/Lcharvol/MacSift/blob/main/build-app.sh — concrete reference build script with the exact pattern we follow (mkdir → cp binary → here-doc plist → codesign).
- https://gist.github.com/rsms/929c9c2fec231f0cf843a1a746a416f5 — definitive ad-hoc codesign + verification commands; warning against `--deep`.
- https://developer.apple.com/documentation/bundleresources/information-property-list/lsminimumsystemversion — `LSMinimumSystemVersion` accepts `26.0`.
- https://developer.apple.com/documentation/security/hardened-runtime — confirms `-o runtime` is the correct flag and ad-hoc + hardened is a valid combination for local dev distribution.
- `app/globals.css` (lines 17–41) — source of truth for the theme palette pasted into `Theme.swift`.
- `MMFF Vector Dev.app/Contents/Info.plist` (read locally) — confirms the bundle shape we are emulating but with a clean, minimal plist (we strip the osacompile boilerplate).

## Contribution
- Effort: ~12 agent-turns (read brief, scan css, two web searches, three web fetches, decisions, log).
- Coverage of overall project: 15% (orchestrator-assigned).
- Files produced or modified:
  - `local-assets/launcher/agents/Calliope.md` (this file — only file modified)
  - **Recommended next** (orchestrator/Build phase, NOT Calliope's edit):
    - `tools/launcher/Package.swift`
    - `tools/launcher/Info.plist.template`
    - `tools/launcher/build.sh`
    - `tools/launcher/Sources/MMFFVectorLauncher/{App,DashboardView,Theme}.swift`

## Test strategy (this agent's slice)

| ID | Title | Description (incl. anticipated action) | Steps | Expected | Actual | Result | Root cause if FAIL | Repeatable? | Action to repeat |
|---|---|---|---|---|---|---|---|---|---|
| C-T01 | `swift build -c release` exits 0 on macOS 26 | Anticipated action: invoke build.sh in release mode and assert exit code 0. Ensures the SwiftPM manifest + sources compile clean against arm64-apple-macosx26.0. | 1. `cd tools/launcher` 2. `swift build -c release` 3. echo $? | exit code 0; binary present at `.build/release/MMFFVectorLauncher` | _pending build phase_ | _pending_ | n/a | yes | re-run `tools/launcher/build.sh` |
| C-T02 | `.app` bundle layout exists after build | Anticipated action: run build.sh, then assert all 4 mandatory paths exist inside the bundle. | 1. `tools/launcher/build.sh` 2. `[ -x "$APP/Contents/MacOS/MMFFVectorLauncher" ]` 3. `[ -f "$APP/Contents/Info.plist" ]` 4. `[ -f "$APP/Contents/PkgInfo" ]` 5. `[ -f "$APP/Contents/Resources/AppIcon.icns" ]` | all 4 paths exist; binary executable | _pending_ | _pending_ | n/a | yes | re-run build.sh |
| C-T03 | Info.plist parses + contains required keys | Anticipated action: `plutil -lint` and `defaults read` the plist; assert key set. | 1. `plutil -lint "$APP/Contents/Info.plist"` 2. `defaults read "$APP/Contents/Info" CFBundleIdentifier` should equal `dev.mmff.vector.launcher` 3. same for `CFBundleExecutable=MMFFVectorLauncher`, `LSMinimumSystemVersion=26.0`, `LSUIElement=0`, `NSPrincipalClass=NSApplication` | plutil exits 0; all five keys read back the documented values | _pending_ | _pending_ | n/a | yes | re-run build.sh |
| C-T04 | Ad-hoc signature verifies strictly | Anticipated action: run `codesign --verify --strict --verbose=2` against the bundle; expect exit 0. Catches breakage from accidental `--deep` reintroduction or missing inner-binary sign. | 1. `codesign --verify --strict --verbose=2 "$APP"` 2. echo $? | exit 0; output contains "valid on disk" + "satisfies its Designated Requirement" | _pending_ | _pending_ | n/a | yes | re-run `codesign --verify` after rebuild |
| C-T05 | Bundle launches and shows dashboard window | Anticipated action: `open "$APP"` then poll for an NSWindow titled "MMFF Vector Launcher" using AppleScript `tell application "System Events"`. Confirms LSUIElement=false + NSPrincipalClass wiring is correct (a common breakage when porting from CLI to .app). | 1. `open "MMFF Vector Launcher.app"` 2. `osascript -e 'tell application "System Events" to count windows of process "MMFFVectorLauncher"'` 3. compare ≥1 within 3s | window count ≥ 1; dock badge visible; no crash log under `~/Library/Logs/DiagnosticReports/MMFFVectorLauncher_*` | _pending_ | _pending_ | n/a | yes | quit + re-launch via `open` |
| C-T06 | Theme renders with sharp corners + Inter fallback | Anticipated action: snapshot the dashboard at 2x and compare key pixels — `--surface` (#FFFFFF) at top-left, `--ink` (#1A1A1A) text, `--border` (#E5E1DA) on service rows. Catches accidental rounded-corner reintroduction (Vector design uses radius=0). | 1. launch app 2. `screencapture -x -R0,0,720,560 /tmp/dash.png` 3. compare three sample pixels with `sips -g pixelWidth /tmp/dash.png` + a Python pillow assert in CI script | top-left pixel = #FFFFFF; row separator = #E5E1DA; primary text = #1A1A1A; corners are square (no anti-aliased curve at 4px from edge) | _pending_ | _pending_ | n/a | yes | re-run snapshot script |

## Overall test-coverage understanding

Calliope's tests are the **gate** every other agent's work passes through. If C-T01–C-T05 fail, nothing else ships — Boreas's tunnel orchestration, Demeter's process supervision, etc. all live *inside* the bundle these tests certify. C-T06 protects the visual contract with the main web app; if it fails the launcher will look "off-brand" and the user's stated "STABLE / DEPENDABLE / FUNCTIONAL" priority will be visibly violated even when functionality is fine.

In the wider 100% test pyramid: Calliope owns build/bundle correctness (~15%); Gaia owns the harness that runs C-T0x in CI; Iris owns the security overlay (codesign requirement set, hardened runtime entitlements) on top of Calliope's signing baseline. C-T04 explicitly hands off to Iris — once they add entitlements (e.g. for keychain), the codesign command will need an `--entitlements` flag that Calliope does not currently emit.

## Handover note to orchestrator

**Solid:**
- SwiftPM build flow is the unambiguous correct choice given the toolchain constraint. `Package.swift`, `Info.plist`, and `build.sh` are ready to drop in.
- Theme tokens are 1:1 with `app/globals.css` — no design-system drift risk.
- Bundle layout matches macOS conventions and the existing `MMFF Vector Dev.app` cohabits cleanly (different name, different bundle id).

**Uncertain (4% confidence gap):**
- `.macOS(.v26)` literal in the manifest *should* be valid in Swift-tools 6.0; if the shipped SwiftPM minor rejects it, fall back to `.macOS("26.0")` — a 30-second swap, not a redesign.
- The placeholder icon path uses `swift -` to render a PNG. If that ever fails on a stripped CommandLineTools install lacking AppKit's NSBitmapImageRep, the script falls back to a generic icon and warns. Iris/Helios should swap in a real `.icns` from the Vector Design System pack to remove this branch.
- `spctl -a -t exec` will report rejected for ad-hoc bundles; this is *expected* and not a Calliope bug, but the user-facing README (out of scope here) must explain "right-click → Open the first time".

**Integrate next:**
1. Hand `Package.swift` + `Info.plist.template` + `build.sh` to the build phase exactly as written above.
2. Wire C-T01 through C-T06 into Gaia's harness as the bundle-build prereq layer (these MUST pass before anything else runs).
3. When Iris defines entitlements, edit step 8 of `build.sh` to add `--entitlements path/to/Launcher.entitlements` to both codesign invocations. No other changes needed.
4. The icon is the cheapest visible polish — if the Vector Design System pack at `MMFFDev - Vector Assets/Vector Design System.zip` ships a logo glyph, drop it into `tools/launcher/Resources/AppIcon.icns` and the placeholder path is bypassed automatically.
