// HealthProbeTests.swift — JAN-T01..T05: failure classification + git HEAD read.
import XCTest
@testable import MMFFVectorLauncher

final class HealthProbeTests: XCTestCase {

    func testTerminalFailureClassification() {
        XCTAssertTrue(ProbeFailure.badShape.isTerminal,  "BAD_SHAPE must be terminal — re-trying a malformed body is wasted budget")
        XCTAssertTrue(ProbeFailure.stale.isTerminal,     "STALE must be terminal — running binary is older than HEAD; only a restart can fix")
        XCTAssertFalse(ProbeFailure.timeout.isTerminal,  "TIMEOUT is transient")
        XCTAssertFalse(ProbeFailure.refused.isTerminal,  "REFUSED is transient (process not yet bound)")
        XCTAssertFalse(ProbeFailure.networkDown.isTerminal, "NETWORK_DOWN is transient")
    }

    func testProbeFailureRawValuesStable() {
        XCTAssertEqual(ProbeFailure.timeout.rawValue, "TIMEOUT")
        XCTAssertEqual(ProbeFailure.refused.rawValue, "REFUSED")
        XCTAssertEqual(ProbeFailure.badShape.rawValue, "BAD_SHAPE")
        XCTAssertEqual(ProbeFailure.stale.rawValue, "STALE")
        XCTAssertEqual(ProbeFailure.networkDown.rawValue, "NETWORK_DOWN")
    }

    func testReadGitHeadReturnsNonEmptyShaOrRef() {
        // The launcher walks .git/HEAD itself (no `git` command). For this repo
        // the function should resolve a SHA either directly (detached) or via a
        // single ref: redirect.
        guard let head = HealthProbe.readGitHead() else {
            XCTFail("readGitHead returned nil — expected to read .git/HEAD from this repo")
            return
        }
        XCTAssertFalse(head.isEmpty, "HEAD must not be empty")
        // Either a 40-char hex SHA or — if the ref redirect target doesn't
        // exist on disk yet — at minimum a non-empty trimmed string. We don't
        // demand exactly 40 chars because some packed-ref repos store HEAD
        // pointing at a ref whose tip lives in packed-refs (not handled by the
        // direct file read). In that case readGitHead returns nil, so reaching
        // here means we got a SHA back.
        let hexCount = head.unicodeScalars.filter { ("0"..."9").contains($0) || ("a"..."f").contains($0) || ("A"..."F").contains($0) }.count
        XCTAssertEqual(hexCount, head.count, "HEAD content should be all-hex when resolved")
    }

    func testProbeResultSuccessShape() {
        XCTAssertTrue(ProbeResult.success.ok)
        XCTAssertNil(ProbeResult.success.failure)
        XCTAssertNil(ProbeResult.success.detail)
    }
}
