// DashboardView.swift — SwiftUI dashboard.
// Layout: header row (env + start/stop/restart all + bridge), three service
// cards (tunnel/backend/frontend), live log tail.
import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderBar()
            Divider().background(Theme.border)
            HStack(alignment: .top, spacing: 12) {
                ServiceCard(kind: .tunnel, label: "Tunnel", value: state.tunnelLabel)
                ServiceCard(kind: .backend, label: "Backend", value: state.backendLabel)
                ServiceCard(kind: .frontend, label: "Frontend", value: state.frontendLabel)
            }
            .padding(12)
            Divider().background(Theme.border)
            LogTailView()
        }
        .background(Theme.bg)
        .foregroundStyle(Theme.fg)
    }
}

struct HeaderBar: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        HStack(spacing: 12) {
            Text("MMFF Vector Launcher")
                .font(.headline)
                .foregroundStyle(Theme.fg)
            Spacer()
            EnvPicker()
            Group {
                Button("Start all")  { state.startAll() }
                Button("Stop all")   { state.stopAll() }
                Button("Restart all"){ state.restartAll() }
            }
            .buttonStyle(.bordered)
            BridgeToggle()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Theme.bgPanel)
    }
}

struct EnvPicker: View {
    @EnvironmentObject var state: AppState
    var body: some View {
        Picker("Env", selection: Binding(
            get: { state.currentEnv },
            set: { state.switchEnv($0) }
        )) {
            ForEach(BackendEnv.allCases, id: \.rawValue) { e in
                Text(e.displayName).tag(e)
            }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .frame(width: 130)
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

struct ServiceCard: View {
    let kind: ServiceKind
    let label: String
    let value: String
    @EnvironmentObject var state: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label).font(.subheadline.bold())
                Spacer()
                StatePill(value: value)
            }
            HStack(spacing: 6) {
                Button("Start")   { state.startService(kind) }
                Button("Stop")    { state.stopService(kind) }
                Button("Restart") { state.restartService(kind) }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.bgPanel)
        .overlay(
            RoundedRectangle(cornerRadius: 6).stroke(Theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 6))
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
        if s.hasPrefix("up") { return Theme.success }
        if s == "down" { return Theme.fgMuted }
        if s.hasPrefix("starting") || s.hasPrefix("restarting") { return Theme.info }
        if s.hasPrefix("dropped") { return Theme.warning }
        return Theme.danger
    }
}

struct LogTailView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(state.logTail.enumerated()), id: \.offset) { (i, e) in
                        Text(formatLine(e))
                            .font(Theme.mono)
                            .foregroundStyle(colorFor(e.level))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 1)
                            .id(i)
                    }
                }
            }
            .onChange(of: state.logTail.count) { _, _ in
                if let last = state.logTail.indices.last {
                    proxy.scrollTo(last, anchor: .bottom)
                }
            }
            .frame(minHeight: 200)
            .background(Theme.bg)
        }
    }

    private func formatLine(_ e: LogEntry) -> String {
        // Strip ms-precision portion from ISO ts for compact rendering.
        let ts = String(e.ts.split(separator: "T").last ?? Substring(e.ts))
            .replacingOccurrences(of: "Z", with: "")
        let extras = (e.extra ?? [:]).map { "\($0.key)=\($0.value)" }.sorted().joined(separator: " ")
        return "\(ts.prefix(12))  \(e.level.rawValue.uppercased().padding(toLength: 5, withPad: " ", startingAt: 0))  \(e.tag.rawValue.padding(toLength: 8, withPad: " ", startingAt: 0))  \(e.action.padding(toLength: 8, withPad: " ", startingAt: 0))  \(e.result.padding(toLength: 6, withPad: " ", startingAt: 0))  \(extras)"
    }

    private func colorFor(_ l: LogLevel) -> Color {
        switch l {
        case .debug: return Theme.fgMuted
        case .info: return Theme.fg
        case .warn: return Theme.warning
        case .error: return Theme.danger
        }
    }
}
