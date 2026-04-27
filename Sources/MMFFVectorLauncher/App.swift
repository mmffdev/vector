// main.swift — MMFF Vector Launcher entrypoint
// Boots NSApplication, installs SwiftUI dashboard, kicks off orchestrator.
import AppKit
import SwiftUI

@main
struct MMFFVectorLauncherApp: App {
    @StateObject private var state = AppState.shared

    var body: some Scene {
        WindowGroup("MMFF Vector Launcher") {
            DashboardView()
                .environmentObject(state)
                .frame(minWidth: 760, minHeight: 520)
        }
        .windowResizability(.contentSize)
    }
}
