import Foundation

enum DevelopmentConnectionSettingsError: Error {
    case invalidEndpoint
    case invalidCredential
}

/// Ephemeral first-phone-test configuration. Never written to defaults or bundled metadata.
struct DevelopmentConnectionSettings {
    let url: URL
    private let token: String

    init(endpoint: String, token: String) throws {
        guard let url = URL(string: endpoint), url.scheme?.lowercased() == "wss",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil else {
            throw DevelopmentConnectionSettingsError.invalidEndpoint
        }
        guard token.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil else {
            throw DevelopmentConnectionSettingsError.invalidCredential
        }
        self.url = url
        self.token = token
    }

    func request() -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return request
    }
}

enum DevelopmentConnectionDiagnostics {
    static func describe(_ error: Error) -> String {
        guard let failure = error as? URLError else { return "WSS transport failed" }
        switch failure.code {
        case .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot,
             .secureConnectionFailed:
            return "TLS certificate or hostname validation failed"
        case .badServerResponse:
            return "WSS handshake rejected; check development credential and proxy"
        case .cannotConnectToHost, .cannotFindHost, .notConnectedToInternet,
             .networkConnectionLost, .timedOut:
            return "Network connection failed; check WSS reachability"
        default:
            return "WSS transport failed"
        }
    }
}
