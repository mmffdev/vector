// BackendEnvTests.swift — DEM-T01..T03: env constants must match docs/c_server.md.
import XCTest
@testable import MMFFVectorLauncher

final class BackendEnvTests: XCTestCase {

    func testTunnelPortsCanonical() {
        XCTAssertEqual(BackendEnv.dev.tunnelPort, 5435)
        XCTAssertEqual(BackendEnv.staging.tunnelPort, 5436)
        XCTAssertEqual(BackendEnv.production.tunnelPort, 5434)
    }

    func testEnvFilePaths() {
        XCTAssertEqual(BackendEnv.dev.envFile, "backend/.env.dev")
        XCTAssertEqual(BackendEnv.staging.envFile, "backend/.env.staging")
        XCTAssertEqual(BackendEnv.production.envFile, "backend/.env.production")
    }

    func testSshAliasesNonEmpty() {
        for env in BackendEnv.allCases {
            XCTAssertFalse(env.sshAlias.isEmpty, "ssh alias missing for \(env)")
        }
        // dev/staging follow vector-* convention; production currently uses
        // the legacy mmffdev-pg alias (Kratos finding — flagged not fixed).
        XCTAssertEqual(BackendEnv.dev.sshAlias, "vector-dev-pg")
        XCTAssertEqual(BackendEnv.staging.sshAlias, "vector-staging-pg")
    }

    func testServiceStateLabels() {
        XCTAssertEqual(ServiceState.down.label, "down")
        XCTAssertEqual(ServiceState.starting.label, "starting")
        XCTAssertEqual(ServiceState.up(pid: 42, owned: true).label, "up")
        XCTAssertEqual(ServiceState.up(pid: 42, owned: false).label, "up (adopted)")
        XCTAssertEqual(ServiceState.dropped.label, "dropped")
        XCTAssertEqual(ServiceState.failed(reason: "oops").label, "failed: oops")
    }

    func testServiceStateIsUp() {
        XCTAssertTrue(ServiceState.up(pid: 1, owned: true).isUp)
        XCTAssertTrue(ServiceState.up(pid: 1, owned: false).isUp)
        XCTAssertFalse(ServiceState.down.isUp)
        XCTAssertFalse(ServiceState.dropped.isUp)
        XCTAssertFalse(ServiceState.failed(reason: "x").isUp)
    }
}
