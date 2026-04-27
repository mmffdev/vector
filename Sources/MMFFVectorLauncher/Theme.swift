// Theme.swift — Vector design tokens mirrored into SwiftUI Color values.
// Mirrors variables in app/globals.css. Severity-only colour use.
import SwiftUI

enum Theme {
    // Background / foreground
    static let bg       = Color(red: 0.07, green: 0.07, blue: 0.08)
    static let bgPanel  = Color(red: 0.10, green: 0.10, blue: 0.12)
    static let bgRaised = Color(red: 0.13, green: 0.13, blue: 0.16)
    static let fg       = Color(red: 0.93, green: 0.93, blue: 0.95)
    static let fgMuted  = Color(red: 0.62, green: 0.62, blue: 0.66)
    static let border   = Color(red: 0.22, green: 0.22, blue: 0.25)

    // Severity (only colour permitted on charts/states)
    static let success  = Color(red: 0.36, green: 0.78, blue: 0.45)
    static let warning  = Color(red: 0.96, green: 0.72, blue: 0.30)
    static let danger   = Color(red: 0.93, green: 0.36, blue: 0.36)
    static let info     = Color(red: 0.46, green: 0.66, blue: 0.96)

    static let accent   = Color(red: 0.62, green: 0.50, blue: 0.95)

    // Monospace stack matches the in-app log viewer
    static let mono = Font.system(.body, design: .monospaced)
}
