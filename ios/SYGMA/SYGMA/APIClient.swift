import Foundation

struct StateEnvelope: Sendable, Equatable {
    let state: JSONValue
    let revision: Int
    let updatedAt: String
}

struct StateStatus: Sendable, Equatable {
    let revision: Int
    let updatedAt: String
}

struct StateRevisionEvent: Codable, Sendable, Equatable {
    let revision: Int
    let updatedAt: String
}

struct StateEventLineDecoder: Sendable {
    private(set) var lastRevision: Int
    private var dataLines: [String] = []
    private var dataBytes = 0

    init(after revision: Int) {
        lastRevision = revision
    }

    mutating func consume(_ line: String) throws -> StateRevisionEvent? {
        if line.isEmpty {
            guard !dataLines.isEmpty else { return nil }
            let data = Data(dataLines.joined(separator: "\n").utf8)
            dataLines.removeAll(keepingCapacity: true)
            dataBytes = 0
            guard let event = try? JSONDecoder().decode(StateRevisionEvent.self, from: data),
                  event.revision > lastRevision else { return nil }
            lastRevision = event.revision
            return event
        }
        guard line.hasPrefix("data:") else { return nil }
        let value = line.dropFirst(5).drop(while: { $0 == " " })
        dataBytes += value.utf8.count
        guard dataBytes <= 16_384 else {
            throw APIClientError.invalidPayload("State event payload was too large.")
        }
        dataLines.append(String(value))
        return nil
    }
}

enum APIClientError: Error, Sendable, Equatable, LocalizedError {
    case invalidBaseURL
    case invalidResponse
    case invalidPayload(String)
    case server(
        statusCode: Int,
        code: String,
        message: String,
        details: JSONValue?,
        revision: Int?,
        retryAfter: String?
    )

    var statusCode: Int? {
        guard case let .server(statusCode, _, _, _, _, _) = self else { return nil }
        return statusCode
    }

    var code: String? {
        guard case let .server(_, code, _, _, _, _) = self else { return nil }
        return code
    }

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "The API base URL must have an HTTP or HTTPS origin."
        case .invalidResponse:
            return "The server returned an invalid response."
        case let .invalidPayload(message):
            return message
        case let .server(_, _, message, _, _, _):
            return message
        }
    }
}

struct APIClient: Sendable {
    static let productionURL = URL(string: "https://personalweb-production-81a6.up.railway.app/")!

    let baseURL: URL
    let session: URLSession

    init(
        baseURL: URL = productionURL,
        session: URLSession? = nil
    ) {
        self.baseURL = baseURL
        self.session = session ?? Self.noCacheSession()
    }

    func fetchState() async throws -> StateEnvelope {
        try await performStateRequest(request(path: "api/state", method: "GET"))
    }

    func fetchStateStatus() async throws -> StateStatus {
        let request = try request(path: "api/state/status", method: "GET")
        let (data, rawResponse) = try await session.data(for: request)
        guard let response = rawResponse as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        let payload = data.isEmpty ? nil : try? JSONDecoder().decode(JSONValue.self, from: data)
        guard (200..<300).contains(response.statusCode) else {
            throw serverError(response: response, payload: payload)
        }
        guard let revision = responseRevision(response: response, payload: payload) else {
            throw APIClientError.invalidPayload("The state status response did not include a valid revision.")
        }
        return StateStatus(revision: revision, updatedAt: payload?["updatedAt"]?.stringValue ?? "")
    }

    func listenForStateEvents(
        after revision: Int,
        onEvent: @escaping @Sendable (StateRevisionEvent) async -> Void
    ) async throws {
        guard revision >= 0 else {
            throw APIClientError.invalidPayload("State event revision must be non-negative.")
        }
        var request = try request(path: "api/state/events?after=\(revision)", method: "GET")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache, no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue(String(revision), forHTTPHeaderField: "Last-Event-ID")
        request.timeoutInterval = 60 * 60

        let (bytes, rawResponse) = try await session.bytes(for: request)
        defer { bytes.task.cancel() }
        guard let response = rawResponse as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(response.statusCode) else {
            throw serverError(response: response, payload: nil)
        }
        guard response.mimeType == "text/event-stream" else {
            throw APIClientError.invalidResponse
        }

        var decoder = StateEventLineDecoder(after: revision)
        for try await line in bytes.lines {
            try Task.checkCancellation()
            if let event = try decoder.consume(line) { await onEvent(event) }
        }
    }

    func saveState(_ state: JSONValue, baseRevision: Int) async throws -> StateEnvelope {
        guard case .object = state else {
            throw APIClientError.invalidPayload("State must be a JSON object.")
        }
        guard baseRevision >= 0 else {
            throw APIClientError.invalidPayload("Base revision must be non-negative.")
        }

        var request = try request(path: "api/state", method: "PUT")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("\"state-\(baseRevision)\"", forHTTPHeaderField: "If-Match")
        request.httpBody = try JSONEncoder().encode(StateWriteRequest(state: state, baseRevision: baseRevision))
        return try await performStateRequest(request)
    }

    private func request(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: normalizedBaseURL)?.absoluteURL else {
            throw APIClientError.invalidBaseURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        return request
    }

    private func performStateRequest(_ request: URLRequest) async throws -> StateEnvelope {
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }

        let payload = data.isEmpty ? nil : try? JSONDecoder().decode(JSONValue.self, from: data)
        guard (200..<300).contains(response.statusCode) else {
            throw serverError(response: response, payload: payload)
        }
        guard let payload, case let .object(object) = payload else {
            throw APIClientError.invalidResponse
        }

        guard let revision = responseRevision(response: response, payload: payload) else {
            throw APIClientError.invalidPayload("The state response did not include a valid revision.")
        }

        guard let state = object["state"] else {
            throw APIClientError.invalidPayload("The state response did not include a state value.")
        }

        return StateEnvelope(
            state: state,
            revision: revision,
            updatedAt: object["updatedAt"]?.stringValue ?? ""
        )
    }

    private func serverError(response: HTTPURLResponse, payload: JSONValue?) -> APIClientError {
        let object = payload?.objectValue
        let fallback = HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
        return .server(
            statusCode: response.statusCode,
            code: object?["code"]?.stringValue ?? "HTTP_\(response.statusCode)",
            message: object?["error"]?.stringValue ?? fallback,
            details: object?["details"],
            revision: responseRevision(response: response, payload: payload),
            retryAfter: response.value(forHTTPHeaderField: "Retry-After")
        )
    }

    private func responseRevision(response: HTTPURLResponse, payload: JSONValue?) -> Int? {
        if let header = response.value(forHTTPHeaderField: "X-State-Revision"),
           let revision = Int(header), revision >= 0 {
            return revision
        }
        if let revision = payload?["revision"]?.intValue, revision >= 0 {
            return revision
        }
        if let revision = payload?["details"]?["revision"]?.intValue, revision >= 0 {
            return revision
        }
        return nil
    }

    private var normalizedBaseURL: URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              components.host != nil else {
            return nil
        }
        components.query = nil
        components.fragment = nil
        if !components.path.hasSuffix("/") { components.path += "/" }
        return components.url
    }

    private static func noCacheSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        return URLSession(configuration: configuration)
    }
}

private struct StateWriteRequest: Encodable {
    let state: JSONValue
    let baseRevision: Int
}
