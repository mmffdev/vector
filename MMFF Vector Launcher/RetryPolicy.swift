// RetryPolicy.swift — full-jitter exponential backoff (Janus's canonical formula).
import Foundation

struct RetryPolicy: Sendable {
    let initialDelay: Double   // seconds
    let maxDelay: Double       // seconds
    let maxAttempts: Int

    static let tunnel   = RetryPolicy(initialDelay: 0.5, maxDelay: 4,  maxAttempts: 5)
    static let backend  = RetryPolicy(initialDelay: 1,   maxDelay: 8,  maxAttempts: 5)
    static let frontend = RetryPolicy(initialDelay: 2,   maxDelay: 15, maxAttempts: 5)

    /// AWS-canonical full-jitter: delay = random(0, min(max, initial * 2^attempt))
    func delay(forAttempt attempt: Int) -> Double {
        let cap = min(maxDelay, initialDelay * pow(2.0, Double(attempt)))
        return Double.random(in: 0...cap)
    }

    func nanoseconds(forAttempt attempt: Int) -> UInt64 {
        UInt64(delay(forAttempt: attempt) * 1_000_000_000)
    }
}
