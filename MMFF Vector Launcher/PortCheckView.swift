// PortCheckView.swift — startup port-conflict screen.
//
// On launch, scans all five managed ports. If any is already in use by a
// foreign process, shows a table with PID + command so the user can kill and
// restart or leave running and proceed. Once all ports are clear (or the user
// accepts), transitions to DashboardView.
import SwiftUI

// MARK: - model

struct PortRow: Identifiable {
    let id = UUID()
    let label: String        // human name
    let port: UInt16
    let pid: Int32?          // nil = clear
    let command: String      // truncated ps output, "" if clear
    var checked: Bool = false

    var isClear: Bool { pid == nil }
}

// MARK: - view

struct PortCheckView: View {
    @EnvironmentObject var state: AppState
    @State private var rows: [PortRow] = []
    @State private var scanning = true
    @State private var killing = false

    var allClear: Bool { rows.allSatisfy(\.isClear) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().background(Theme.border)
            if scanning {
                scanningBody
            } else {
                tableBody
                Divider().background(Theme.border)
                footer
            }
        }
        .background(Theme.bg)
        .foregroundStyle(Theme.fg)
        .task { await scan() }
    }

    // MARK: sub-views

    private var header: some View {
        HStack(spacing: 10) {
            Image(nsImage: NSImage(named: "AppIcon") ?? NSImage())
                .resizable().frame(width: 28, height: 28)
            Text("MMFF Vector Launcher")
                .font(.headline)
            Spacer()
            Text("Port check")
                .font(.subheadline)
                .foregroundStyle(Theme.fgMuted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.bgPanel)
    }

    private var scanningBody: some View {
        VStack(spacing: 12) {
            ProgressView().controlSize(.large)
            Text("Scanning ports…").foregroundStyle(Theme.fgMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }

    private var tableBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Source-of-truth table header
            credentialsSection
            Divider().background(Theme.border).padding(.horizontal, 16)
            // Port status table
            portTableHeader
            ForEach(rows) { row in
                portTableRow(row)
                Divider().background(Theme.border).padding(.leading, 16)
            }
        }
    }

    private var credentialsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Services — source of truth")
                .font(.subheadline.bold())
                .foregroundStyle(Theme.fgMuted)
                .padding(.top, 14)

            Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 4) {
                GridRow {
                    credHeader("Service")
                    credHeader("Port")
                    credHeader("Protocol")
                    credHeader("Credential source")
                    credHeader("SSH alias / notes")
                }
                credDivider()
                // Production tunnel — mmffdev-pg forwards 5434+3333+others in one session
                credRow("DB tunnel (prod)",  "5434", "SSH→PG",    "~/.ssh/config: mmffdev-pg",         "mmffdev-pg (also fwds :3333 Planka, :8081 Adminer, :9000 Portainer, :15672 RabbitMQ)")
                credRow("Planka board",      "3333", "HTTP",       "via mmffdev-pg (same SSH session)", "mmffdev-pg — no separate tunnel needed")
                // Dev / staging tunnels — aliases not yet in ~/.ssh/config, must be added manually
                credRow("DB tunnel (dev)",   "5435", "SSH→PG",    "~/.ssh/config: vector-dev-pg",      "⚠ alias not in ~/.ssh/config yet — add before use")
                credRow("DB tunnel (stg)",   "5436", "SSH→PG",    "~/.ssh/config: vector-staging-pg",  "⚠ alias not in ~/.ssh/config yet — add before use")
                credRow("Go backend",        "5100", "HTTP",       "backend/.env.<env>",                "—")
                credRow("Next.js frontend",  "5101", "HTTP",       "none (public dev server)",          "—")
                credRow("Bridge (local)",    "7787", "HTTP/token", "App Support/MMFFVectorLauncher/bridge.token", "—")
            }
            .padding(.bottom, 10)
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 4)
    }

    private func credHeader(_ t: String) -> some View {
        Text(t).font(Theme.mono.bold()).foregroundStyle(Theme.fgMuted)
    }
    private func credDivider() -> some View {
        GridRow {
            ForEach(0..<5, id: \.self) { _ in
                Divider().background(Theme.border)
            }
        }
    }
    private func credRow(_ svc: String, _ port: String, _ proto: String, _ cred: String, _ alias: String) -> some View {
        GridRow {
            Text(svc)   .font(Theme.mono).foregroundStyle(Theme.fg)
            Text(port)  .font(Theme.mono).foregroundStyle(Theme.info)
            Text(proto) .font(Theme.mono).foregroundStyle(Theme.fgMuted)
            Text(cred)  .font(Theme.mono).foregroundStyle(Theme.fgMuted).lineLimit(1)
            Text(alias) .font(Theme.mono).foregroundStyle(Theme.fgMuted)
        }
    }

    private var portTableHeader: some View {
        HStack(spacing: 0) {
            Text("Port")    .frame(width: 60,  alignment: .leading)
            Text("Service") .frame(width: 150, alignment: .leading)
            Text("Status")  .frame(width: 90,  alignment: .leading)
            Text("PID")     .frame(width: 70,  alignment: .leading)
            Text("Process") .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
        }
        .font(.caption.bold())
        .foregroundStyle(Theme.fgMuted)
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(Theme.bgPanel)
    }

    private func portTableRow(_ row: PortRow) -> some View {
        HStack(spacing: 0) {
            Text("\(row.port)")
                .frame(width: 60, alignment: .leading)
                .font(Theme.mono)
                .foregroundStyle(Theme.info)
            Text(row.label)
                .frame(width: 150, alignment: .leading)
                .font(Theme.mono)
            statusBadge(row)
                .frame(width: 90, alignment: .leading)
            Text(row.pid.map { "\($0)" } ?? "—")
                .frame(width: 70, alignment: .leading)
                .font(Theme.mono)
                .foregroundStyle(row.isClear ? Theme.fgMuted : Theme.warning)
            Text(row.isClear ? "—" : row.command)
                .font(Theme.mono)
                .foregroundStyle(Theme.fgMuted)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 6)
        .background(row.isClear ? Color.clear : Theme.danger.opacity(0.06))
    }

    private func statusBadge(_ row: PortRow) -> some View {
        let (label, color): (String, Color) = row.isClear
            ? ("clear", Theme.success)
            : ("in use", Theme.danger)
        return Text(label)
            .font(.caption.monospaced())
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(color.opacity(0.18))
            .foregroundStyle(color)
            .clipShape(Capsule())
    }

    private var footer: some View {
        HStack(spacing: 10) {
            if allClear {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Theme.success)
                Text("All ports clear")
                    .foregroundStyle(Theme.success)
            } else {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Theme.warning)
                Text("\(rows.filter { !$0.isClear }.count) port(s) in use")
                    .foregroundStyle(Theme.warning)
            }
            Spacer()
            Button("Rescan") {
                scanning = true
                Task { await scan() }
            }
            .buttonStyle(.bordered)
            .disabled(killing)

            if !allClear {
                Button(killing ? "Killing…" : "Kill & Continue") {
                    Task { await killAndContinue() }
                }
                .buttonStyle(.borderedProminent)
                .tint(Theme.danger)
                .disabled(killing)
            }

            Button(allClear ? "Continue →" : "Proceed anyway") {
                state.portCheckPassed = true
            }
            .buttonStyle(.borderedProminent)
            .tint(allClear ? Theme.success : Theme.fgMuted)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Theme.bgPanel)
    }

    // MARK: logic

    private func scan() async {
        let ports: [(String, UInt16)] = [
            ("DB tunnel (prod)",  5434),
            ("DB tunnel (dev)",   5435),
            ("Go backend",        5100),
            ("Next.js frontend",  5101),
            ("Docs (Docusaurus)", 3000),
            ("Bridge (local)",    7787),
        ]
        var result: [PortRow] = []
        for (label, port) in ports {
            let pids = ProcessSupervisor.listeningPIDs(on: port)
            if let pid = pids.first {
                let cmd = ProcessSupervisor.describePID(pid)
                result.append(PortRow(label: label, port: port, pid: pid, command: cmd))
            } else {
                result.append(PortRow(label: label, port: port, pid: nil, command: ""))
            }
        }
        await MainActor.run {
            self.rows = result
            self.scanning = false
        }
    }

    private func killAndContinue() async {
        await MainActor.run { killing = true }
        for row in rows where !row.isClear {
            if let pid = row.pid {
                let pgid = getpgid(pid)
                if pgid > 1 {
                    await ProcessSupervisor.killGroup(pgid: pgid, logTag: .tunnel)
                } else {
                    kill(pid, SIGKILL)
                }
            }
            await ProcessSupervisor.sweepPort(row.port, logTag: .tunnel)
        }
        try? await Task.sleep(nanoseconds: 800_000_000)
        await MainActor.run { killing = false }
        await scan()
    }
}
