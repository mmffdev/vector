// DashboardView.swift — SwiftUI dashboard.
//
// Layout (top→bottom):
//   1. HeaderBar — title + bridge toggle.
//   2. AlwaysOnRow — four cards: Tunnel (dev), Backend, Frontend, Docs.
//      These come up at app launch and stay up. Each card has Restart only;
//      there is no Stop, because stopping an always-on service is a category
//      error in this launcher's design.
//   3. OptionalTunnelsRow — two toggle cards: Tunnel (staging), Tunnel (prod).
//      Off by default; user toggles via the switch. The HARD RULE that
//      "the only thing live on prod is the tunnel" is encoded in the spec
//      catalogue (no backend.prod, no frontend.prod, no docs.prod) — there
//      is literally nothing else that could come up against prod.
//   4. LogTailView — Wireshark-style log inline at the bottom.
//
// No env switching. No locks. No diagonal-stripe sections. The user said
// "stabilize the launcher or bin it" — this is the stabilized version: one
// row of always-on, one row of opt-in tunnels, done.
import SwiftUI

struct DashboardView: View {
    @EnvironmentObject var state: AppState

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderBar()
            Divider().background(Theme.border)
            ScrollView {
                VStack(spacing: 12) {
                    AlwaysOnRow()
                    OptionalTunnelsRow()
                }
                .padding(12)
            }
            Divider().background(Theme.border)
            LogTailView()
        }
        .background(Theme.bg)
        .foregroundStyle(Theme.fg)
    }
}

// MARK: - header

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
            Text("backend pinned to dev")
                .font(.caption.monospaced())
                .foregroundStyle(Theme.fgMuted)
            Spacer()
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

// MARK: - rows

struct AlwaysOnRow: View {
    private let cardHeight: CGFloat = 150
    private let alwaysOn: [ServiceID] = ServiceID.allCases.filter { $0.isAlwaysOnService }

    var body: some View {
        SectionShell(title: "Always on", accent: Theme.success) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(alwaysOn, id: \.rawValue) { id in
                    AlwaysOnCard(id: id)
                        .frame(height: cardHeight)
                }
            }
        }
    }
}

struct OptionalTunnelsRow: View {
    private let cardHeight: CGFloat = 150
    private let optional: [ServiceID] = ServiceID.allCases.filter { !$0.isAlwaysOnService }

    var body: some View {
        SectionShell(title: "Optional tunnels (off by default)", accent: Theme.warning) {
            HStack(alignment: .top, spacing: 10) {
                ForEach(optional, id: \.rawValue) { id in
                    OptionalTunnelCard(id: id)
                        .frame(height: cardHeight)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - section shell

struct SectionShell<Content: View>: View {
    let title: String
    let accent: Color
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Rectangle()
                    .fill(accent)
                    .frame(width: 4, height: 16)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                Text(title.uppercased())
                    .font(.caption.bold())
                    .foregroundStyle(Theme.fg)
                Spacer()
            }
            content()
        }
        .padding(14)
        .background(Theme.bgPanel)
        .overlay(
            RoundedRectangle(cornerRadius: 8).stroke(Theme.border, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - card chrome

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

// MARK: - cards

struct AlwaysOnCard: View {
    let id: ServiceID
    @EnvironmentObject var state: AppState

    private var snap: ServiceSnapshot? { state.snapshot(id) }
    private var pidLabel: String {
        snap?.pid.map { "PID \($0)" } ?? "PID —"
    }
    private var portLabel: String {
        snap.map { ":\($0.port)" } ?? ":?"
    }
    private var stateLabel: String { snap?.state ?? "—" }

    var body: some View {
        CardChrome {
            HStack(alignment: .firstTextBaseline) {
                Text(id.displayName).font(.subheadline.bold())
                Text("(\(pidLabel) \(portLabel))")
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.fgMuted)
                Spacer()
                StatePill(value: stateLabel)
            }
            Spacer(minLength: 0)
            Button {
                state.restart(id)
            } label: {
                Text("Restart").frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }
}

struct OptionalTunnelCard: View {
    let id: ServiceID
    @EnvironmentObject var state: AppState

    private var snap: ServiceSnapshot? { state.snapshot(id) }
    private var enabled: Bool { state.isEnabled(id) }
    private var stateLabel: String { snap?.state ?? "off" }
    private var pidLabel: String { snap?.pid.map { "PID \($0)" } ?? "PID —" }
    private var portLabel: String { snap.map { ":\($0.port)" } ?? ":?" }

    var body: some View {
        CardChrome {
            HStack(alignment: .firstTextBaseline) {
                Text(id.displayName).font(.subheadline.bold())
                Text("(\(pidLabel) \(portLabel))")
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.fgMuted)
                Spacer()
                StatePill(value: stateLabel)
            }
            Spacer(minLength: 0)
            HStack(spacing: 8) {
                Toggle("", isOn: Binding(
                    get: { enabled },
                    set: { _ in state.toggle(id) }
                ))
                .toggleStyle(.switch)
                .labelsHidden()
                .controlSize(.small)
                Text(enabled ? "On" : "Off")
                    .font(.caption.monospaced())
                    .foregroundStyle(Theme.fgMuted)
                Spacer()
                Button {
                    state.restart(id)
                } label: {
                    Text("Restart")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(!enabled)
            }
        }
        .frame(width: 280)
    }
}

// MARK: - state pill

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
        if s == "down" || s == "off" { return Theme.fgMuted }
        if s.hasPrefix("starting") { return Theme.info }
        if s.hasPrefix("failed") { return Theme.danger }
        return Theme.fgMuted
    }
}

// LogTailView is defined in LogViewerView.swift
