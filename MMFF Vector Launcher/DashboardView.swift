// DashboardView.swift — SwiftUI dashboard.
// Layout (top→bottom): Prod / Staging / Dev sections, each marked by a 10px
// diagonally-striped left border (env colour ↔ black) instead of a fill tint.
// Each section row contains Tunnel / Backend / Frontend / DB cards plus a
// SectionActionsCard down the right side. Locks per service persist via
// LockRegistry.
import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var state: AppState
    @State private var didAutoAdopt = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderBar()
            Divider().background(Theme.border)
            ScrollView {
                VStack(spacing: 12) {
                    EnvSection(env: .production)
                    EnvSection(env: .staging)
                    EnvSection(env: .dev)
                }
                .padding(12)
            }
            Divider().background(Theme.border)
            LogTailView()
        }
        .background(Theme.bg)
        .foregroundStyle(Theme.fg)
        .task {
            if !didAutoAdopt {
                didAutoAdopt = true
                state.startAll()
            }
        }
    }
}

struct HeaderBar: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        HStack(spacing: 12) {
            Button {
                state.portCheckPassed = false
            } label: {
                Label("Port check", systemImage: "chevron.left")
            }
            .buttonStyle(.bordered)
            .help("Return to port check")

            Text("MMFF Vector Launcher")
                .font(.headline)
                .foregroundStyle(Theme.fg)
            Spacer()
            Text("Active: \(state.currentEnv.displayName)")
                .font(.caption.monospaced())
                .foregroundStyle(Theme.fgMuted)
            BridgeToggle()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.bgPanel)
    }
}

struct BridgeToggle: View {
    @EnvironmentObject var state: AppState
    var body: some View {
        Button(state.bridgeRunning ? "Bridge: ON" : "Bridge: off") {
            state.toggleBridge()
        }
        .buttonStyle(.bordered)
        .tint(state.bridgeRunning ? Theme.success : Theme.fgMuted)
    }
}

// MARK: - env tint (border-only; user-specified hex)

private enum EnvTint {
    /// User-specified hex values for the section accent.
    static func color(_ env: BackendEnv) -> Color {
        switch env {
        case .production: return Color(hex: 0xFF0000)
        case .staging:    return Color(hex: 0xFF6600)
        case .dev:        return Color(hex: 0x00CC00)
        }
    }
}

private extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >>  8) & 0xFF) / 255.0
        let b = Double( hex        & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}

// MARK: - diagonal stripe accent

/// A 10pt-wide vertical strip drawn down the left edge of each env section,
/// filled with diagonal stripes that alternate between the env colour and
/// black. Each stripe is 10pt wide.
private struct DiagonalStripeAccent: View {
    let color: Color
    let stripeWidth: CGFloat = 10

    var body: some View {
        Canvas { ctx, size in
            // Solid base in the env colour, then black stripes drawn on top.
            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(color))

            // Diagonal stripes at 45°. Each band period = 2 × stripeWidth (one
            // colour stripe + one black stripe). We draw black quadrilaterals
            // and let the base colour show through between them.
            let period = stripeWidth * 2
            // Diagonal length so we cover all corners regardless of aspect
            let diagonal = (size.width + size.height) * 1.5
            var offset: CGFloat = -diagonal
            while offset < diagonal {
                var path = Path()
                // Build a parallelogram aligned to the +45° axis.
                let p1 = CGPoint(x: offset,                y: 0)
                let p2 = CGPoint(x: offset + stripeWidth,  y: 0)
                let p3 = CGPoint(x: offset + stripeWidth + size.height, y: size.height)
                let p4 = CGPoint(x: offset + size.height,                y: size.height)
                path.move(to: p1)
                path.addLine(to: p2)
                path.addLine(to: p3)
                path.addLine(to: p4)
                path.closeSubpath()
                ctx.fill(path, with: .color(.black))
                offset += period
            }
        }
        .frame(width: 10)
        .clipped()
    }
}

// MARK: - env section

struct EnvSection: View {
    let env: BackendEnv
    @EnvironmentObject var state: AppState

    /// Fixed height for every inner card so all four service cards and the
    /// SectionActionsCard line up evenly.
    private let cardHeight: CGFloat = 170

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            DiagonalStripeAccent(color: EnvTint.color(env))
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Text(env.displayName.uppercased())
                        .font(.title3.bold())
                        .foregroundStyle(Theme.fg)
                    if env == state.currentEnv {
                        Text("ACTIVE")
                            .font(.caption2.monospaced())
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(EnvTint.color(env).opacity(0.25))
                            .foregroundStyle(EnvTint.color(env))
                            .clipShape(Capsule())
                    }
                    Spacer()
                }

                HStack(alignment: .top, spacing: 10) {
                    ServiceCard(env: env, kind: .tunnel)
                        .frame(height: cardHeight)
                    ServiceCard(env: env, kind: .backend)
                        .frame(height: cardHeight)
                    ServiceCard(env: env, kind: .frontend)
                        .frame(height: cardHeight)
                    DBConnectionCard(env: env)
                        .frame(height: cardHeight)
                    SectionActionsCard(env: env)
                        .frame(height: cardHeight)
                }
            }
            .padding(14)
        }
        .background(Theme.bgPanel)
        .overlay(
            RoundedRectangle(cornerRadius: 8).stroke(Theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - card chrome + lock

private struct CardChrome<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Theme.bgRaised)
        .overlay(
            RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

private struct LockRow: View {
    @Binding var locked: Bool
    var body: some View {
        HStack(spacing: 6) {
            Spacer()
            Toggle("", isOn: $locked)
                .toggleStyle(.checkbox)
                .labelsHidden()
                .help(locked ? "Locked — actions disabled" : "Lock to prevent changes")
            Text("Lock")
                .font(.caption2)
                .foregroundStyle(Theme.fgMuted)
        }
    }
}

private struct VerticalActionButtons: View {
    let onStart: () -> Void
    let onStop: () -> Void
    let onRestart: () -> Void
    let disabled: Bool

    var body: some View {
        VStack(spacing: 4) {
            Button(action: onStart)   { Text("Start").frame(maxWidth: .infinity) }
            Button(action: onStop)    { Text("Stop").frame(maxWidth: .infinity) }
            Button(action: onRestart) { Text("Restart").frame(maxWidth: .infinity) }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .disabled(disabled)
        .opacity(disabled ? 0.45 : 1.0)
    }
}

// MARK: - service / DB cards

struct ServiceCard: View {
    let env: BackendEnv
    let kind: ServiceKind
    @EnvironmentObject var state: AppState

    private var label: String {
        switch kind {
        case .tunnel: return "Tunnel"
        case .backend: return "Backend"
        case .frontend: return "Frontend"
        }
    }
    private var port: UInt16 {
        switch kind {
        case .tunnel: return env.tunnelPort
        case .backend: return state.backendPort
        case .frontend: return state.frontendPort
        }
    }
    private var isActiveEnv: Bool { env == state.currentEnv }
    private var pid: Int32? {
        guard isActiveEnv else { return nil }
        switch kind {
        case .tunnel: return state.tunnelPid
        case .backend: return state.backendPid
        case .frontend: return state.frontendPid
        }
    }
    private var value: String {
        if !isActiveEnv && (kind == .backend || kind == .frontend) { return "not active" }
        if !isActiveEnv && kind == .tunnel {
            switch env {
            case .dev:        return state.dbStateDev ? "up" : "down"
            case .staging:    return state.dbStateStaging ? "up" : "down"
            case .production: return state.dbStateProduction ? "up" : "down"
            }
        }
        switch kind {
        case .tunnel: return state.tunnelLabel
        case .backend: return state.backendLabel
        case .frontend: return state.frontendLabel
        }
    }
    private var titleSuffix: String {
        let pidPart = pid.map { "PID \($0)" } ?? "PID —"
        return "(\(pidPart) :\(port))"
    }
    private var locked: Bool { state.isLocked(env, kind) }

    var body: some View {
        CardChrome {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(.subheadline.bold())
                Text(titleSuffix)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.fgMuted)
                Spacer()
                StatePill(value: value)
            }
            VerticalActionButtons(
                onStart:   { state.startService(env, kind) },
                onStop:    { state.stopService(env, kind) },
                onRestart: { state.restartService(env, kind) },
                disabled: locked
            )
            Spacer(minLength: 0)
            LockRow(locked: Binding(
                get: { state.isLocked(env, kind) },
                set: { state.setLock(env, kind, $0) }
            ))
        }
    }
}

struct DBConnectionCard: View {
    let env: BackendEnv
    @EnvironmentObject var state: AppState

    private var connected: Bool {
        switch env {
        case .dev: return state.dbStateDev
        case .staging: return state.dbStateStaging
        case .production: return state.dbStateProduction
        }
    }
    private var pid: Int32? {
        switch env {
        case .dev: return state.dbPidDev
        case .staging: return state.dbPidStaging
        case .production: return state.dbPidProduction
        }
    }
    private var titleSuffix: String {
        let pidPart = pid.map { "PID \($0)" } ?? "PID —"
        return "(\(pidPart) :\(env.tunnelPort))"
    }
    private var locked: Bool { state.isDBLocked(env) }

    var body: some View {
        CardChrome {
            HStack(alignment: .firstTextBaseline) {
                Text("DB").font(.subheadline.bold())
                Text(titleSuffix)
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.fgMuted)
                Spacer()
                StatePill(value: connected ? "connected" : "not connected")
            }
            VerticalActionButtons(
                onStart:   { state.startDB(env) },
                onStop:    { state.stopDB(env) },
                onRestart: { state.restartDB(env) },
                disabled: locked
            )
            Spacer(minLength: 0)
            LockRow(locked: Binding(
                get: { state.isDBLocked(env) },
                set: { state.setDBLock(env, $0) }
            ))
        }
    }
}

struct SectionActionsCard: View {
    let env: BackendEnv
    @EnvironmentObject var state: AppState

    var body: some View {
        CardChrome {
            HStack(alignment: .firstTextBaseline) {
                Text("All for \(env.displayName)")
                    .font(.subheadline.bold())
                Spacer()
            }
            VStack(spacing: 4) {
                Button(action: { state.startAllForEnv(env) }) {
                    Text("Start all").frame(maxWidth: .infinity)
                }
                Button(action: { state.stopAllForEnv(env) }) {
                    Text("Stop all").frame(maxWidth: .infinity)
                }
                Button(action: { state.restartAllForEnv(env) }) {
                    Text("Restart all").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            Spacer(minLength: 0)
        }
    }
}

struct StatePill: View {
    let value: String
    var body: some View {
        Text(value)
            .font(.caption.monospaced())
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(colorFor(value).opacity(0.18))
            .foregroundStyle(colorFor(value))
            .clipShape(Capsule())
    }
    private func colorFor(_ s: String) -> Color {
        if s.hasPrefix("up") || s == "connected" { return Theme.success }
        if s == "down" || s == "not connected" || s == "not active" { return Theme.fgMuted }
        if s.hasPrefix("starting") || s.hasPrefix("restarting") { return Theme.info }
        if s.hasPrefix("dropped") { return Theme.warning }
        return Theme.danger
    }
}

// LogTailView is defined in LogViewerView.swift
