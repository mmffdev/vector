// main.swift — MMFF Vector Launcher entrypoint
// Boots NSApplication, installs SwiftUI dashboard, kicks off orchestrator.
import AppKit
import SwiftUI

@main
struct MMFFVectorLauncherApp: App {
    @StateObject private var state = AppState.shared

    var body: some Scene {
        WindowGroup("MMFF Vector Launcher") {
            Group {
                if state.portCheckPassed {
                    DashboardView()
                } else {
                    PortCheckView()
                }
            }
            .environmentObject(state)
            .frame(minWidth: 1280, idealWidth: 1400, minHeight: 920, idealHeight: 980)
        }
        .windowResizability(.contentSize)
    }
}
