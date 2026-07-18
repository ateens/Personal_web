import XCTest
@testable import SYGMA

private final class APIClientURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private actor StateEventRecorder {
    private var events: [StateRevisionEvent] = []

    func append(_ event: StateRevisionEvent) { events.append(event) }
    func recorded() -> [StateRevisionEvent] { events }
}

final class APIClientTests: XCTestCase {
    override func tearDown() {
        APIClientURLProtocol.handler = nil
        super.tearDown()
    }

    func testFetchBypassesCachesAndOmitsBrowserMetadata() async throws {
        APIClientURLProtocol.handler = { request in
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Cache-Control"), "no-store")
            XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
            XCTAssertNil(request.httpBody)
            return try Self.successResponse(for: request, state: .object(["version": .number(4)]))
        }

        _ = try await makeClient().fetchState()
    }

    func testSaveUsesNativeRequestWithoutBrowserOrigin() async throws {
        let state: JSONValue = .object(["version": .number(4), "revision": .number(3)])
        APIClientURLProtocol.handler = { request in
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
            let body = try Self.requestBody(from: request)
            XCTAssertFalse(body.isEmpty)
            return try Self.successResponse(for: request, state: state, revision: 4)
        }

        _ = try await makeClient().saveState(state, baseRevision: 3)
    }

    func testStatusBypassesCachesAndReturnsRevision() async throws {
        APIClientURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/state/status")
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["X-State-Revision": "7"]
            ))
            let payload: JSONValue = .object([
                "revision": .number(7),
                "updatedAt": .string("2026-07-18T00:00:00Z"),
            ])
            return (response, try JSONEncoder().encode(payload))
        }

        let status = try await makeClient().fetchStateStatus()
        XCTAssertEqual(status, StateStatus(revision: 7, updatedAt: "2026-07-18T00:00:00Z"))
    }

    func testStateEventListenerUsesNoCacheStream() async throws {
        APIClientURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/state/events")
            XCTAssertEqual(URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "3")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "text/event-stream")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Last-Event-ID"), "3")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalAndRemoteCacheData)
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/event-stream; charset=utf-8"]
            ))
            return (response, Data())
        }

        let recorder = StateEventRecorder()
        try await makeClient().listenForStateEvents(after: 3) { event in
            await recorder.append(event)
        }
        let recorded = await recorder.recorded()
        XCTAssertTrue(recorded.isEmpty)
    }

    func testStateEventLineDecoderIgnoresHeartbeatsAndDuplicateRevisions() throws {
        let body = """
        : heartbeat

        event: state
        data: {"revision":3,"updatedAt":"old"}

        event: state
        data: {"revision":4,"updatedAt":"2026-07-18T00:00:01Z"}

        event: state
        data: {"revision":4,"updatedAt":"duplicate"}

        """
        var decoder = StateEventLineDecoder(after: 3)
        let events = try body.components(separatedBy: "\n").compactMap { try decoder.consume($0) }

        XCTAssertEqual(events, [StateRevisionEvent(revision: 4, updatedAt: "2026-07-18T00:00:01Z")])
    }

    func testAuthenticationRequiredResponsePreservesStatusAndCode() async throws {
        APIClientURLProtocol.handler = { request in
            let response = try XCTUnwrap(HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 401,
                httpVersion: "HTTP/1.1",
                headerFields: nil
            ))
            let payload: JSONValue = .object([
                "error": .string("Authentication is required."),
                "code": .string("AUTH_REQUIRED"),
            ])
            return (response, try JSONEncoder().encode(payload))
        }

        do {
            _ = try await makeClient().fetchState()
            XCTFail("401 response should throw")
        } catch let error as APIClientError {
            XCTAssertEqual(error.statusCode, 401)
            XCTAssertEqual(error.code, "AUTH_REQUIRED")
            XCTAssertEqual(error.errorDescription, "Authentication is required.")
        }
    }

    private func makeClient() -> APIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [APIClientURLProtocol.self]
        return APIClient(
            baseURL: URL(string: "https://sygma.test/")!,
            session: URLSession(configuration: configuration)
        )
    }

    private static func successResponse(
        for request: URLRequest,
        state: JSONValue,
        revision: Int = 0
    ) throws -> (HTTPURLResponse, Data) {
        let response = try XCTUnwrap(HTTPURLResponse(
            url: try XCTUnwrap(request.url),
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["X-State-Revision": String(revision)]
        ))
        let payload: JSONValue = .object([
            "state": state,
            "revision": .number(Double(revision)),
            "updatedAt": .string("2026-07-17T00:00:00Z"),
        ])
        return (response, try JSONEncoder().encode(payload))
    }

    private static func requestBody(from request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var body = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeRawData) }
            if count == 0 { return body }
            body.append(contentsOf: buffer.prefix(count))
        }
    }
}
