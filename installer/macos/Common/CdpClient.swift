import Foundation
#if canImport(Darwin)
import Darwin
#endif

struct CdpPageInfo {
    let id: String
    let title: String
    let url: String
    let webSocketDebuggerUrl: String
}

struct CdpError: Error, LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { return message }
}

final class PluginManifest {
    let version: String
    let styleId: String
    let settingBinding: String
    let parts: [String]
    let defaultConfig: [String: JsonValue]
    let validators: [String: JsonValue]
    let removeExpression: String

    init(
        version: String,
        styleId: String,
        settingBinding: String,
        parts: [String],
        defaultConfig: [String: JsonValue],
        validators: [String: JsonValue],
        removeExpression: String
    ) {
        self.version = version
        self.styleId = styleId
        self.settingBinding = settingBinding
        self.parts = parts
        self.defaultConfig = defaultConfig
        self.validators = validators
        self.removeExpression = removeExpression
    }

    static func load(baseDir: String) throws -> PluginManifest {
        let manifestPath = (baseDir as NSString).appendingPathComponent("manifest.json")
        let text = try String(contentsOfFile: manifestPath, encoding: .utf8)
        let raw = try MiniJson.parseObject(text)
        let version = raw["version"]?.stringValue ?? "1.0.0"
        let styleId = raw["styleId"]?.stringValue ?? "ag-claude-style-css"
        let settingBinding = raw["settingBinding"]?.stringValue ?? "__agClaudeStyleSetting"
        let removeExpression = raw["removeExpression"]?.stringValue ?? ""
        var parts: [String] = []
        if let arr = raw["parts"]?.arrayValue {
            for item in arr {
                if let s = item.stringValue, !s.isEmpty {
                    parts.append(s)
                }
            }
        }
        let defaultConfig = raw["defaultConfig"]?.objectValue ?? [:]
        let validators = raw["validators"]?.objectValue ?? [:]
        return PluginManifest(
            version: version,
            styleId: styleId,
            settingBinding: settingBinding,
            parts: parts,
            defaultConfig: defaultConfig,
            validators: validators,
            removeExpression: removeExpression
        )
    }
}

final class CdpSession: NSObject, URLSessionWebSocketDelegate {
    private var urlSession: URLSession?
    private var wsTask: URLSessionWebSocketTask?
    private let lock = NSLock()
    private let sendQueue = DispatchQueue(
        label: "io.github.0dnancy.agy-claude-style.cdp.send",
        autoreleaseFrequency: .workItem
    )
    private var nextId: Int = 0
    private var pending: [Int: (Result<[String: JsonValue], Error>) -> Void] = [:]
    private var listeners: [String: [([String: JsonValue]) -> Void]] = [:]
    private var closed = false
    private var opened = false
    private var openCallback: ((Error?) -> Void)?

    var onClose: (() -> Void)?

    private override init() {
        super.init()
    }

    static func connect(wsUrl: String, timeoutMs: Int = 3000) throws -> CdpSession {
        guard let url = URL(string: wsUrl) else {
            throw CdpError("Invalid WebSocket URL: \(wsUrl)")
        }
        let session = CdpSession()
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]
        cfg.urlCache = nil
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.httpCookieAcceptPolicy = .never
        cfg.httpShouldSetCookies = false
        cfg.timeoutIntervalForRequest = max(1.0, Double(timeoutMs) / 1000.0)
        let delegateQueue = OperationQueue()
        delegateQueue.maxConcurrentOperationCount = 1
        delegateQueue.name = "io.github.0dnancy.agy-claude-style.cdp.ws"

        let sem = DispatchSemaphore(value: 0)
        var connectErr: Error?

        session.lock.lock()
        session.openCallback = { err in
            connectErr = err
            sem.signal()
        }
        session.lock.unlock()

        let urlSession = URLSession(configuration: cfg, delegate: session, delegateQueue: delegateQueue)
        let task = urlSession.webSocketTask(with: url)
        task.maximumMessageSize = 64 * 1024 * 1024
        session.urlSession = urlSession
        session.wsTask = task
        task.resume()

        let waitResult = sem.wait(timeout: .now() + .milliseconds(timeoutMs))
        if waitResult == .timedOut {
            session.lock.lock()
            session.openCallback = nil
            session.lock.unlock()
            session.close()
            throw CdpError("CDP connect timeout")
        }
        if let err = connectErr {
            session.close()
            throw err
        }
        return session
    }

    func on(_ method: String, callback: @escaping ([String: JsonValue]) -> Void) {
        lock.lock()
        var list = listeners[method] ?? []
        list.append(callback)
        listeners[method] = list
        lock.unlock()
    }

    func send(_ method: String, params: [String: JsonValue]? = nil, timeoutMs: Int = 5000) throws -> [String: JsonValue] {
        lock.lock()
        if closed {
            lock.unlock()
            throw CdpError("CDP connection closed")
        }
        nextId += 1
        let id = nextId
        let sem = DispatchSemaphore(value: 0)
        var outcome: Result<[String: JsonValue], Error>?
        pending[id] = { res in
            outcome = res
            sem.signal()
        }
        lock.unlock()

        let payload: JsonValue = .object([
            "id": .int(Int64(id)),
            "method": .string(method),
            "params": .object(params ?? [:])
        ])
        let json = MiniJson.stringify(payload, pretty: false)

        sendQueue.async { [weak self] in
            guard let self = self else { return }
            self.lock.lock()
            let isClosed = self.closed
            let task = self.wsTask
            self.lock.unlock()
            guard !isClosed, let task = task else { return }
            task.send(.string(json)) { [weak self] err in
                if let err = err {
                    self?.failPending(id: id, error: err)
                }
            }
        }

        let waitRes = sem.wait(timeout: .now() + .milliseconds(timeoutMs))
        if waitRes == .timedOut {
            lock.lock()
            pending.removeValue(forKey: id)
            let wasClosed = closed
            lock.unlock()
            if wasClosed {
                throw CdpError("CDP connection closed")
            }
            throw CdpError("CDP \(method) timeout")
        }

        switch outcome {
        case .success(let val):
            return val
        case .failure(let err):
            throw err
        case .none:
            throw CdpError("CDP \(method) failed")
        }
    }

    func evaluate(_ expression: String, awaitPromise: Bool = false) throws -> JsonValue {
        let res = try send("Runtime.evaluate", params: [
            "expression": .string(expression),
            "returnByValue": .bool(true),
            "awaitPromise": .bool(awaitPromise)
        ], timeoutMs: 15000)

        if let exDetails = res["exceptionDetails"]?.objectValue {
            var msg = exDetails["exception"]?.objectValue?["description"]?.stringValue
            if msg == nil || msg!.isEmpty {
                msg = exDetails["text"]?.stringValue
            }
            throw CdpError(msg ?? "Runtime.evaluate exception")
        }

        if let resultObj = res["result"]?.objectValue, let val = resultObj["value"] {
            return val
        }
        return .null
    }

    func close() {
        markClosed(sendCloseFrame: true)
    }

    private func failPending(id: Int, error: Error) {
        lock.lock()
        let cb = pending.removeValue(forKey: id)
        lock.unlock()
        cb?(.failure(error))
    }

    private func startReceiveLoop() {
        lock.lock()
        let isClosed = closed
        let task = wsTask
        lock.unlock()
        guard !isClosed, let task = task else { return }

        task.receive { [weak self] result in
            autoreleasepool {
                guard let self = self else { return }
                switch result {
                case .success(let message):
                    switch message {
                    case .string(let text):
                        self.handleMessage(text)
                    case .data(let data):
                        if let text = String(data: data, encoding: .utf8) {
                            self.handleMessage(text)
                        }
                    @unknown default:
                        break
                    }
                    self.startReceiveLoop()
                case .failure:
                    self.markClosed()
                }
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let msg = try? MiniJson.parseObject(text) else { return }

        if let method = msg["method"]?.stringValue {
            let params = msg["params"]?.objectValue ?? [:]
            lock.lock()
            let callbacks = listeners[method] ?? []
            lock.unlock()
            for cb in callbacks {
                cb(params)
            }
            return
        }

        if let id = msg["id"]?.intValue {
            lock.lock()
            let cb = pending.removeValue(forKey: id)
            lock.unlock()
            guard let callback = cb else { return }
            if let errVal = msg["error"], case .null = errVal {
                // error is null -> treat as success
            } else if let errVal = msg["error"] {
                let errMsg = errVal.objectValue?["message"]?.stringValue ?? MiniJson.stringify(errVal, pretty: false)
                callback(.failure(CdpError(errMsg)))
                return
            }
            let resDict = msg["result"]?.objectValue ?? [:]
            callback(.success(resDict))
        }
    }

    private func markClosed(sendCloseFrame: Bool = false) {
        lock.lock()
        if closed {
            lock.unlock()
            return
        }
        closed = true
        let task = wsTask
        let session = urlSession
        wsTask = nil
        urlSession = nil
        let pendingCallbacks = pending
        pending.removeAll()
        listeners.removeAll()
        let closeHandler = onClose
        onClose = nil
        let openCb = openCallback
        openCallback = nil
        lock.unlock()

        if sendCloseFrame {
            task?.cancel(with: .normalClosure, reason: nil)
        }
        session?.invalidateAndCancel()

        openCb?(CdpError("CDP connection closed"))
        for (_, cb) in pendingCallbacks {
            cb(.failure(CdpError("CDP connection closed")))
        }
        closeHandler?()
    }

    // MARK: - URLSessionWebSocketDelegate

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        lock.lock()
        opened = true
        let cb = openCallback
        openCallback = nil
        lock.unlock()
        startReceiveLoop()
        cb?(nil)
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        markClosed()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let wasOpened = opened
        let cb = openCallback
        openCallback = nil
        lock.unlock()
        if !wasOpened, let cb = cb {
            cb(error ?? CdpError("CDP connect failed"))
        }
        markClosed()
    }
}

enum CdpHelper {
    private static let pollSession: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]
        cfg.urlCache = nil
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        cfg.httpCookieAcceptPolicy = .never
        cfg.httpShouldSetCookies = false
        cfg.timeoutIntervalForRequest = 2.0
        cfg.timeoutIntervalForResource = 2.0
        cfg.httpMaximumConnectionsPerHost = 2
        return URLSession(configuration: cfg)
    }()

    static func getPortFilePath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return ((home as NSString)
            .appendingPathComponent("Library/Application Support/Antigravity/DevToolsActivePort"))
    }

    static func readPort(overridePort: Int?) -> Int? {
        if let p = overridePort, p > 0 { return p }
        if let envPort = ProcessInfo.processInfo.environment["AG_CDP_PORT"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !envPort.isEmpty,
           let p = Int(envPort), p > 0 {
            return p
        }
        let portFile = getPortFilePath()
        guard let text = try? String(contentsOfFile: portFile, encoding: .utf8) else { return nil }
        let firstLine = text.components(separatedBy: CharacterSet.newlines).first?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if let p = Int(firstLine), p > 0 {
            return p
        }
        return nil
    }

    static func listPages(port: Int) throws -> [CdpPageInfo] {
        guard let url = URL(string: "http://127.0.0.1:\(port)/json/list") else {
            throw CdpError("Invalid CDP HTTP URL")
        }
        var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2.0)
        req.setValue("close", forHTTPHeaderField: "Connection")

        let sem = DispatchSemaphore(value: 0)
        var fetchedData: Data?
        var fetchedError: Error?

        let task = pollSession.dataTask(with: req) { data, _, err in
            fetchedData = data
            fetchedError = err
            sem.signal()
        }
        task.resume()

        if sem.wait(timeout: .now() + .milliseconds(2500)) == .timedOut {
            task.cancel()
            throw CdpError("CDP /json/list timeout")
        }
        if let err = fetchedError {
            throw err
        }
        guard let data = fetchedData, let jsonText = String(data: data, encoding: .utf8) else {
            throw CdpError("Empty response from /json/list")
        }
        fetchedData = nil

        let targets = try MiniJson.parseArray(jsonText)
        var pages: [CdpPageInfo] = []
        for targetVal in targets {
            guard let t = targetVal.objectValue else { continue }
            let type = t["type"]?.stringValue ?? ""
            let wsUrl = t["webSocketDebuggerUrl"]?.stringValue ?? ""
            let pageUrl = t["url"]?.stringValue ?? ""
            let lowerUrl = pageUrl.lowercased()
            if type == "page" && !wsUrl.isEmpty && !lowerUrl.hasPrefix("devtools://") && !lowerUrl.hasPrefix("data:") {
                let id = t["id"]?.stringValue ?? wsUrl
                let title = t["title"]?.stringValue ?? ""
                pages.append(CdpPageInfo(id: id, title: title, url: pageUrl, webSocketDebuggerUrl: wsUrl))
            }
        }
        return pages
    }

    static func computeHash(_ str: String) -> String {
        var h: UInt32 = 2166136261
        for unit in str.utf16 {
            h ^= UInt32(unit)
            h = h &* 16777619
        }
        return String(h, radix: 36)
    }

    static func readConfig(baseDir: String, manifest: PluginManifest) -> [String: JsonValue] {
        var cfg = manifest.defaultConfig
        let cfgPath = (baseDir as NSString).appendingPathComponent("config.json")
        if let text = try? String(contentsOfFile: cfgPath, encoding: .utf8),
           let userCfg = try? MiniJson.parseObject(text) {
            for (k, v) in userCfg {
                cfg[k] = v
            }
        }
        return cfg
    }

    static func updateConfigSetting(baseDir: String, manifest: PluginManifest, key: String, value: JsonValue) -> Bool {
        guard let rule = manifest.validators[key] else { return false }
        if let ruleStr = rule.stringValue, ruleStr == "boolean" {
            guard case .bool = value else { return false }
        } else if let allowed = rule.arrayValue {
            guard let strVal = value.stringValue else { return false }
            let matched = allowed.contains { $0.stringValue == strVal }
            if !matched { return false }
        } else {
            return false
        }

        var next = readConfig(baseDir: baseDir, manifest: manifest)
        next[key] = value
        let cfgPath = (baseDir as NSString).appendingPathComponent("config.json")
        let tmpPath = cfgPath + ".tmp"
        let content = MiniJson.stringify(.object(next), pretty: true) + "\n"
        do {
            try content.write(toFile: tmpPath, atomically: false, encoding: .utf8)
            if rename(tmpPath, cfgPath) != 0 {
                try content.write(toFile: cfgPath, atomically: true, encoding: .utf8)
                try? FileManager.default.removeItem(atPath: tmpPath)
            }
            return true
        } catch {
            return false
        }
    }

    static func readRuntimeBundle(baseDir: String, manifest: PluginManifest) throws -> String {
        var partsContent: [String] = []
        partsContent.reserveCapacity(manifest.parts.count)
        for part in manifest.parts {
            let p = (baseDir as NSString).appendingPathComponent(part)
            partsContent.append(try String(contentsOfFile: p, encoding: .utf8))
        }
        return partsContent.joined(separator: "\n")
    }

    static func buildInjectExpression(baseDir: String, manifest: PluginManifest) throws -> String {
        let config = readConfig(baseDir: baseDir, manifest: manifest)
        let cssPath = (baseDir as NSString).appendingPathComponent("style.css")
        let css = try String(contentsOfFile: cssPath, encoding: .utf8)
        let bundle = try readRuntimeBundle(baseDir: baseDir, manifest: manifest)
        let codeHash = computeHash(bundle)

        var initCfg = config
        initCfg["binding"] = .string(manifest.settingBinding)
        initCfg["codeHash"] = .string(codeHash)

        let styleIdJson = MiniJson.stringifyString(manifest.styleId)
        var sb = ""
        sb.reserveCapacity(css.count + bundle.count + 4096)
        sb.append("(() => {\n")
        sb.append("    const css = ")
        sb.append(MiniJson.stringifyString(css))
        sb.append(";\n")
        sb.append("    const applyStyle = () => {\n")
        sb.append("      const targetParent = document.head || document.documentElement;\n")
        sb.append("      if (!targetParent) return;\n")
        sb.append("      let style = document.getElementById(")
        sb.append(styleIdJson)
        sb.append(");\n")
        sb.append("      if (!style) {\n")
        sb.append("        style = document.createElement('style');\n")
        sb.append("        style.id = ")
        sb.append(styleIdJson)
        sb.append(";\n")
        sb.append("      }\n")
        sb.append("      if (style.textContent !== css) style.textContent = css;\n")
        sb.append("      if (style.parentNode !== targetParent || targetParent.lastElementChild !== style) {\n")
        sb.append("        targetParent.appendChild(style);\n")
        sb.append("      }\n")
        sb.append("    };\n\n")
        sb.append("    let status = 'ok';\n")
        sb.append("    let mounted = false;\n")
        sb.append("    const mount = () => {\n")
        sb.append("      if (mounted || !document.documentElement) return;\n")
        sb.append("      mounted = true;\n")
        sb.append("      try {\n")
        sb.append("        if (document.head) applyStyle();\n")
        sb.append("        else document.addEventListener('DOMContentLoaded', applyStyle, { once: true });\n")
        sb.append("        ")
        sb.append(bundle)
        sb.append("\n")
        sb.append("        if (typeof globalThis.__agCsUiMain === 'function') {\n")
        sb.append("          globalThis.__agCsUiMain(")
        sb.append(MiniJson.stringify(.object(initCfg), pretty: false))
        sb.append(");\n")
        sb.append("        }\n")
        sb.append("      } catch (e) {\n")
        sb.append("        status = 'error: ' + (e && e.message ? e.message : String(e));\n")
        sb.append("        if (typeof console !== 'undefined' && console.error) {\n")
        sb.append("          console.error('[agy-claude-style] init error:', e);\n")
        sb.append("        }\n")
        sb.append("      }\n")
        sb.append("    };\n\n")
        sb.append("    if (document.documentElement) {\n")
        sb.append("      mount();\n")
        sb.append("    } else {\n")
        sb.append("      status = 'deferred';\n")
        sb.append("      const onReady = () => {\n")
        sb.append("        if (document.documentElement) {\n")
        sb.append("          document.removeEventListener('readystatechange', onReady);\n")
        sb.append("          document.removeEventListener('DOMContentLoaded', onReady);\n")
        sb.append("          mount();\n")
        sb.append("        }\n")
        sb.append("      };\n")
        sb.append("      document.addEventListener('readystatechange', onReady);\n")
        sb.append("      document.addEventListener('DOMContentLoaded', onReady);\n")
        sb.append("    }\n")
        sb.append("    const st = window.__agClaudeStyle && window.__agClaudeStyle.getState ? window.__agClaudeStyle.getState() : null;\n")
        sb.append("    return {\n")
        sb.append("      version: ")
        sb.append(MiniJson.stringifyString(manifest.version))
        sb.append(",\n")
        sb.append("      status,\n")
        sb.append("      state: st,\n")
        sb.append("    };\n")
        sb.append("  })()")
        return sb
    }

    static func shortTitle(_ page: CdpPageInfo) -> String {
        let t = !page.title.isEmpty ? page.title : page.url
        if t.count > 60 {
            return String(t.prefix(57)) + "..."
        }
        return t
    }
}
