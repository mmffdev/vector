// RetryPolicyTests.swift — JAN-T07: full-jitter math is uniform in [0, cap].
import XCTest
@testable import MMFFVectorLauncher

final class RetryPolicyTests: XCTestCase {

    func testFullJitterWithinCap() {
        let p = RetryPolicy.backend
        for attempt in 0..<8 {
            let cap = min(p.maxDelay, p.initialDelay * pow(2.0, Double(attempt)))
            for _ in 0..<200 {
                let d = p.delay(forAttempt: attempt)
                XCTAssertGreaterThanOrEqual(d, 0.0)
                XCTAssertLessThanOrEqual(d, cap + 0.0001)
            }
        }
    }

    func testPerPhaseBudgets() {
        XCTAssertEqual(RetryPolicy.tunnel.maxAttempts, 5)
        XCTAssertEqual(RetryPolicy.backend.maxAttempts, 5)
        XCTAssertEqual(RetryPolicy.frontend.maxAttempts, 5)
        XCTAssertEqual(RetryPolicy.tunnel.maxDelay, 4)
        XCTAssertEqual(RetryPolicy.backend.maxDelay, 8)
        XCTAssertEqual(RetryPolicy.frontend.maxDelay, 15)
    }

    func testNanosecondConversion() {
        let p = RetryPolicy.tunnel
        let n = p.nanoseconds(forAttempt: 0)
        XCTAssertGreaterThanOrEqual(n, 0)
        XCTAssertLessThanOrEqual(n, UInt64(p.maxDelay * 1_000_000_000))
    }
}
