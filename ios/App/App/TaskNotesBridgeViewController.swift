import Capacitor
import Foundation

class TaskNotesBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(TaskNotesAuthorityHttpPlugin())
    }
}

/// Transport for SDK-signed authority requests, not a general browsing proxy.
/// The bundled native publisher has the same identity as its web declaration;
/// WKWebView's capacitor asset origin is not that publisher's grant origin.
@objc(TaskNotesAuthorityHttpPlugin)
public class TaskNotesAuthorityHttpPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionTaskDelegate {
    public let identifier = "TaskNotesAuthorityHttpPlugin"
    public let jsName = "TaskNotesAuthorityHttp"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]

    private static let applicationOrigin = "https://app.tasknotes.dev"
    private static let proofHeaders = [
        "x-mdbase-proof-version", "x-mdbase-proof-timestamp",
        "x-mdbase-proof-nonce", "x-mdbase-proof-signature"
    ]
    private let lock = NSLock()
    private var tasks: [String: URLSessionDataTask] = [:]
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    @objc func request(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), UUID(uuidString: id) != nil,
              let value = call.getString("url"), let url = URL(string: value),
              url.scheme == "https", url.user == nil, url.password == nil, url.fragment == nil,
              let method = call.getString("method"),
              ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].contains(method),
              let supplied = call.getObject("headers") as? [String: String] else {
            call.reject("Invalid native authority request.", "invalid_request")
            return
        }
        let path = url.path.split(separator: "/").map(String.init)
        let headers = supplied.reduce(into: [String: String]()) { result, entry in
            result[entry.key.lowercased()] = entry.value
        }
        guard path.count >= 4, path[0] == "v1", path[1] == "authorities",
              UUID(uuidString: path[2]) != nil,
              ["operations", "sync", "files"].contains(path[3]),
              headers["authorization"]?.hasPrefix("Bearer ") == true,
              Self.proofHeaders.allSatisfy({ !(headers[$0] ?? "").isEmpty }) else {
            call.reject("A signed authority request is required.", "invalid_request")
            return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 600)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        for (name, value) in headers where !["cookie", "cookie2", "host", "origin", "content-length"].contains(name) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        request.setValue(Self.applicationOrigin, forHTTPHeaderField: "Origin")
        if let body = call.getString("body") {
            guard let bytes = Data(base64Encoded: body) else {
                call.reject("Invalid native authority body.", "invalid_request")
                return
            }
            request.httpBody = bytes
        }
        // Capacitor invokes request/cancel on its serial bridge queue. The lock
        // also protects removal by URLSession's completion queue.
        lock.lock()
        let duplicate = tasks[id] != nil
        lock.unlock()
        if duplicate {
            call.reject("Duplicate native request identifier.", "invalid_request")
            return
        }
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            if let self = self {
                self.lock.lock()
                self.tasks.removeValue(forKey: id)
                self.lock.unlock()
            }
            if error != nil {
                // Never expose URLs, query credentials, request bodies or headers.
                call.reject("Native authority request did not complete.", "network_error")
                return
            }
            guard let response = response as? HTTPURLResponse else {
                call.reject("Invalid native authority response.", "network_error")
                return
            }
            var headers: [String: String] = [:]
            for (name, value) in response.allHeaderFields {
                let key = String(describing: name).lowercased()
                if !["set-cookie", "set-cookie2"].contains(key) {
                    headers[key] = String(describing: value)
                }
            }
            call.resolve([
                "url": response.url?.absoluteString ?? url.absoluteString,
                "status": response.statusCode,
                "headers": headers,
                "body": (data ?? Data()).base64EncodedString()
            ])
        }
        lock.lock()
        tasks[id] = task
        lock.unlock()
        task.resume()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        if let id = call.getString("id") {
            lock.lock()
            let task = tasks[id]
            lock.unlock()
            task?.cancel()
        }
        call.resolve()
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask,
                           willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest,
                           completionHandler: @escaping (URLRequest?) -> Void) {
        // A proof binds its target. No redirect may forward it or its credential.
        completionHandler(nil)
    }
}
