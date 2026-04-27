// HTTPRequestTests.swift — FEN-T01/T02: minimal HTTP/1.1 parser correctness.
import XCTest
@testable import MMFFVectorLauncher

final class HTTPRequestTests: XCTestCase {

    func testParseGetWithHeaders() {
        let raw = "GET /v1/state HTTP/1.1\r\nHost: 127.0.0.1:7787\r\nAuthorization: Bearer abc123\r\n\r\n"
        guard let req = HTTPRequest.parse(Data(raw.utf8)) else {
            XCTFail("parser returned nil for well-formed GET")
            return
        }
        XCTAssertEqual(req.method, "GET")
        XCTAssertEqual(req.path, "/v1/state")
        XCTAssertEqual(req.headers["host"], "127.0.0.1:7787")
        XCTAssertEqual(req.headers["authorization"], "Bearer abc123")
        XCTAssertTrue(req.body.isEmpty)
    }

    func testParseHeaderNamesAreLowercased() {
        let raw = "GET / HTTP/1.1\r\nHOST: localhost\r\nIdempotency-Key: abc\r\n\r\n"
        let req = HTTPRequest.parse(Data(raw.utf8))!
        XCTAssertEqual(req.headers["host"], "localhost")
        XCTAssertEqual(req.headers["idempotency-key"], "abc")
    }

    func testParsePostWithBody() {
        let body = "{\"env\":\"staging\"}"
        let raw = "POST /v1/env/switch HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: \(body.count)\r\n\r\n\(body)"
        let req = HTTPRequest.parse(Data(raw.utf8))!
        XCTAssertEqual(req.method, "POST")
        XCTAssertEqual(req.path, "/v1/env/switch")
        XCTAssertEqual(String(data: req.body, encoding: .utf8), body)
    }

    func testParseReturnsNilOnIncompleteBody() {
        // Content-Length declared as 50 but body delivered is shorter.
        let raw = "POST /x HTTP/1.1\r\nHost: localhost\r\nContent-Length: 50\r\n\r\nshort"
        XCTAssertNil(HTTPRequest.parse(Data(raw.utf8)),
                     "parser must wait for full body, not return a partial request")
    }

    func testParseReturnsNilOnNoHeaderTerminator() {
        let raw = "GET / HTTP/1.1\r\nHost: localhost\r\n"
        XCTAssertNil(HTTPRequest.parse(Data(raw.utf8)))
    }
}
