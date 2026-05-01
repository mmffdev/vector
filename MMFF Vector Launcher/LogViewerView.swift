// LogViewerView.swift — Wireshark-style log viewer.
//
// Embeds inline in DashboardView (compact) or opens in its own taller window
// via the "Expand" button. Features:
//   • Selectable text rows (copy/paste)
//   • Per-filter search bars with colour pickers (highlight stays live as new
//     entries arrive)
//   • Up to 4 simultaneous highlight rules, each with its own colour
//   • Level filter dropdown (ALL / DEBUG / INFO / WARN / ERROR)
//   • Tag filter dropdown (ALL / tunnel / backend / frontend / …)
//   • Download as TXT, CSV, JSON
//   • Expand → new window; close button dismisses window but log continues
import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - highlight rule

struct HighlightRule: Identifiable {
    let id = UUID()
    var text: String = ""
    var color: Color = .yellow
}

// MARK: - filter state (shared between inline + expanded window)

@MainActor
final class LogFilterState: ObservableObject {
    @Published var rules: [HighlightRule] = [HighlightRule()]
    @Published var levelFilter: LogLevel? = nil      // nil = ALL
    @Published var tagFilter: LogTag? = nil          // nil = ALL
    @Published var searchText: String = ""           // quick search (matches any field)

    func addRule() {
        guard rules.count < 4 else { return }
        let colors: [Color] = [.yellow, .cyan, .green, .orange]
        rules.append(HighlightRule(color: colors[rules.count % colors.count]))
    }
    func removeRule(_ id: UUID) {
        rules.removeAll { $0.id == id }
    }

    func matches(_ entry: LogEntry) -> Bool {
        if let lf = levelFilter, entry.level != lf { return false }
        if let tf = tagFilter,   entry.tag   != tf { return false }
        if !searchText.isEmpty {
            let hay = flatString(entry).lowercased()
            if !hay.contains(searchText.lowercased()) { return false }
        }
        return true
    }

    func highlightColor(for entry: LogEntry) -> Color? {
        let flat = flatString(entry).lowercased()
        for rule in rules where !rule.text.isEmpty {
            if flat.contains(rule.text.lowercased()) { return rule.color }
        }
        return nil
    }

    private func flatString(_ e: LogEntry) -> String {
        let extras = (e.extra ?? [:]).values.joined(separator: " ")
        return "\(e.level.rawValue) \(e.tag.rawValue) \(e.action) \(e.result) \(extras)"
    }
}

// MARK: - toolbar (shared between compact + expanded)

struct LogFilterBar: View {
    @ObservedObject var filter: LogFilterState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Row 1: level + tag + quick search
            HStack(spacing: 8) {
                levelPicker
                tagPicker
                quickSearch
                Spacer()
                Button("+ Rule") { filter.addRule() }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(filter.rules.count >= 4)
            }
            // Row 2: highlight rules
            if !filter.rules.isEmpty {
                HStack(spacing: 8) {
                    ForEach($filter.rules) { $rule in
                        HStack(spacing: 4) {
                            TextField("highlight…", text: $rule.text)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 130)
                                .font(Theme.mono)
                            ColorPicker("", selection: $rule.color)
                                .labelsHidden()
                                .frame(width: 28)
                            Button { filter.removeRule(rule.id) } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(Theme.fgMuted)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(rule.color.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: 5))
                    }
                    Spacer()
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.bgPanel)
    }

    private var levelPicker: some View {
        Picker("Level", selection: $filter.levelFilter) {
            Text("ALL levels").tag(LogLevel?.none)
            ForEach([LogLevel.debug, .info, .warn, .error], id: \.rawValue) { l in
                Text(l.rawValue.uppercased()).tag(LogLevel?.some(l))
            }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .frame(width: 110)
    }

    private var tagPicker: some View {
        Picker("Tag", selection: $filter.tagFilter) {
            Text("ALL tags").tag(LogTag?.none)
            ForEach(LogTag.allCases, id: \.rawValue) { t in
                Text(t.rawValue).tag(LogTag?.some(t))
            }
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .frame(width: 110)
    }

    private var quickSearch: some View {
        HStack(spacing: 4) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.fgMuted)
            TextField("Search all fields…", text: $filter.searchText)
                .textFieldStyle(.roundedBorder)
                .frame(width: 180)
                .font(Theme.mono)
            if !filter.searchText.isEmpty {
                Button { filter.searchText = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.fgMuted)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - single log row (selectable)

struct LogRowView: View {
    let entry: LogEntry
    let index: Int
    let highlight: Color?
    @State private var copied = false

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            // Line number
            Text("\(index + 1)")
                .font(Theme.mono)
                .foregroundStyle(Theme.fgMuted.opacity(0.5))
                .frame(width: 44, alignment: .trailing)
                .padding(.trailing, 8)

            // Selectable text block
            SelectableText(formatted(entry))
                .font(Theme.mono)
                .foregroundStyle(textColor)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 1)
        .background(rowBackground)
    }

    private var rowBackground: Color {
        if let h = highlight { return h.opacity(0.22) }
        return Color.clear
    }

    private var textColor: Color {
        if highlight != nil { return Theme.fg }
        switch entry.level {
        case .debug: return Theme.fgMuted
        case .info:  return Theme.fg
        case .warn:  return Theme.warning
        case .error: return Theme.danger
        }
    }

    private func formatted(_ e: LogEntry) -> String {
        let ts = String(e.ts.split(separator: "T").last ?? Substring(e.ts))
            .replacingOccurrences(of: "Z", with: "")
        let lv = e.level.rawValue.uppercased().padding(toLength: 5, withPad: " ", startingAt: 0)
        let tg = e.tag.rawValue.padding(toLength: 8, withPad: " ", startingAt: 0)
        let ac = e.action.padding(toLength: 10, withPad: " ", startingAt: 0)
        let rs = e.result.padding(toLength: 6, withPad: " ", startingAt: 0)
        let ex = (e.extra ?? [:]).map { "\($0.key)=\($0.value)" }.sorted().joined(separator: " ")
        return "\(String(ts.prefix(15)))  \(lv)  \(tg)  \(ac)  \(rs)  \(ex)"
    }
}

// MARK: - selectable text wrapper

struct SelectableText: NSViewRepresentable {
    let text: String
    var font: Font = Theme.mono
    var foregroundStyle: Color = Theme.fg

    init(_ text: String) { self.text = text }

    func makeNSView(context: Context) -> NSTextField {
        let f = NSTextField(labelWithString: text)
        f.isSelectable = true
        f.isEditable = false
        f.isBezeled = false
        f.drawsBackground = false
        f.lineBreakMode = .byClipping
        f.cell?.truncatesLastVisibleLine = true
        f.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        return f
    }
    func updateNSView(_ v: NSTextField, context: Context) {
        v.stringValue = text
        v.textColor = NSColor(foregroundStyle)
    }
}

extension SelectableText {
    func font(_ f: Font) -> SelectableText { self }
    func foregroundStyle(_ c: Color) -> SelectableText {
        var copy = self; copy.foregroundStyle = c; return copy
    }
}

// MARK: - log list body

struct LogListView: View {
    let entries: [LogEntry]
    @ObservedObject var filter: LogFilterState

    var filtered: [LogEntry] { entries.filter { filter.matches($0) } }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(filtered.enumerated()), id: \.offset) { (i, e) in
                        LogRowView(
                            entry: e,
                            index: i,
                            highlight: filter.highlightColor(for: e)
                        )
                        .id(i)
                    }
                }
            }
            .onChange(of: filtered.count) { _, _ in
                if let last = filtered.indices.last {
                    proxy.scrollTo(last, anchor: .bottom)
                }
            }
        }
        .background(Theme.bg)
    }
}

// MARK: - download helpers

enum LogExportFormat { case txt, csv, json }

func exportLogs(_ entries: [LogEntry], format: LogExportFormat) -> String {
    switch format {
    case .txt:
        return entries.map { e in
            let ex = (e.extra ?? [:]).map { "\($0.key)=\($0.value)" }.sorted().joined(separator: " ")
            return "\(e.ts)  \(e.level.rawValue.uppercased())  \(e.tag.rawValue)  \(e.action)  \(e.result)  \(ex)"
        }.joined(separator: "\n")
    case .csv:
        var lines = ["ts,level,tag,action,result,extra"]
        for e in entries {
            let ex = (e.extra ?? [:]).map { "\($0.key)=\($0.value)" }.sorted().joined(separator: "; ")
            lines.append("\"\(e.ts)\",\"\(e.level.rawValue)\",\"\(e.tag.rawValue)\",\"\(e.action)\",\"\(e.result)\",\"\(ex)\"")
        }
        return lines.joined(separator: "\n")
    case .json:
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = (try? encoder.encode(entries)) ?? Data()
        return String(data: data, encoding: .utf8) ?? "[]"
    }
}

@MainActor
func savePanel(content: String, name: String, ext: String) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = name
    panel.allowedContentTypes = [UTType(filenameExtension: ext) ?? .plainText]
    if panel.runModal() == .OK, let url = panel.url {
        try? content.write(to: url, atomically: true, encoding: .utf8)
    }
}

// MARK: - download toolbar

struct LogDownloadBar: View {
    let entries: [LogEntry]

    var body: some View {
        HStack(spacing: 8) {
            Text("\(entries.count) entries")
                .font(.caption)
                .foregroundStyle(Theme.fgMuted)
            Spacer()
            Button("TXT") { savePanel(content: exportLogs(entries, format: .txt),  name: "launcher.txt",  ext: "txt") }
            Button("CSV") { savePanel(content: exportLogs(entries, format: .csv),  name: "launcher.csv",  ext: "csv") }
            Button("JSON"){ savePanel(content: exportLogs(entries, format: .json), name: "launcher.json", ext: "json") }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Theme.bgPanel)
    }
}

// MARK: - expanded window controller

class LogWindowController: NSWindowController {
    static var shared: LogWindowController?

    convenience init(state: AppState, filter: LogFilterState) {
        let win = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        win.title = "MMFF Vector — Log Viewer"
        win.isReleasedWhenClosed = false
        win.center()
        self.init(window: win)
        let view = LogExpandedView(filter: filter, onClose: { [weak self] in
            self?.close()
            LogWindowController.shared = nil
        })
        .environmentObject(state)
        win.contentView = NSHostingView(rootView: view)
    }
}

// MARK: - expanded view (full window content)

struct LogExpandedView: View {
    @EnvironmentObject var state: AppState   // injected via .environmentObject at call site
    @ObservedObject var filter: LogFilterState
    let onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Log Viewer").font(.headline)
                Spacer()
                Button { onClose() } label: {
                    Label("Close", systemImage: "xmark.circle")
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.bgPanel)

            Divider().background(Theme.border)
            LogFilterBar(filter: filter)
            Divider().background(Theme.border)
            LogListView(entries: state.logTail, filter: filter)
            Divider().background(Theme.border)
            LogDownloadBar(entries: state.logTail)
        }
        .background(Theme.bg)
        .foregroundStyle(Theme.fg)
    }
}

// MARK: - inline compact viewer (used inside DashboardView)

struct LogTailView: View {
    @EnvironmentObject var state: AppState
    @StateObject private var filter = LogFilterState()

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar row: filter bar + expand button
            HStack(spacing: 0) {
                LogFilterBar(filter: filter)
                Divider().background(Theme.border).frame(maxHeight: .infinity)
                Button {
                    if LogWindowController.shared == nil {
                        let ctrl = LogWindowController(state: state, filter: filter)
                        LogWindowController.shared = ctrl
                        ctrl.showWindow(nil)
                    } else {
                        LogWindowController.shared?.window?.makeKeyAndOrderFront(nil)
                    }
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .help("Expand log viewer")
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                .foregroundStyle(Theme.fgMuted)
            }
            .fixedSize(horizontal: false, vertical: true)

            Divider().background(Theme.border)
            LogListView(entries: state.logTail, filter: filter)
                .frame(minHeight: 180, maxHeight: 280)
            Divider().background(Theme.border)
            LogDownloadBar(entries: state.logTail)
        }
    }
}
