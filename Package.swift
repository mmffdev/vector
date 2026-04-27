// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "MMFFVectorLauncher",
    platforms: [.macOS(.v26)],
    products: [
        .executable(name: "MMFFVectorLauncher", targets: ["MMFFVectorLauncher"])
    ],
    targets: [
        .executableTarget(
            name: "MMFFVectorLauncher",
            path: "Sources/MMFFVectorLauncher",
            swiftSettings: [
                .enableExperimentalFeature("StrictConcurrency")
            ]
        ),
        .testTarget(
            name: "MMFFVectorLauncherTests",
            dependencies: ["MMFFVectorLauncher"],
            path: "Tests/MMFFVectorLauncherTests"
        )
    ]
)
