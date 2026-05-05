// App.swift — MMFF Vector Launcher entrypoint.
//
// Boots a SwiftUI window that shows the port-check screen first, then the
// dashboard once the user has cleared (or accepted) the port state. The
// service registry is bootstrapped only after the port check passes, so
// the launcher never fights a foreign listener while the user is still
// deciding what to kill.
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
                        .onAppear { state.bootstrapServices() }
                } else {
                    PortCheckView()
                }
            }
            .environmentObject(state)
            .frame(minWidth: 1280, idealWidth: 1400, minHeight: 720, idealHeight: 820)
        }
        .windowResizability(.contentSize)
    }
}
