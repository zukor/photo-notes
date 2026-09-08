import Foundation
import Capacitor
import Security
import AVFoundation
import Speech
import CryptoKit
import UIKit
import UserNotifications
import UniformTypeIdentifiers

// Only the packaged application can call this bridge. Session cookies never enter JavaScript.
@objc(PhotoNotesPlugin)
public class PhotoNotesPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionTaskDelegate, UIDocumentPickerDelegate {
    public let identifier = "PhotoNotesPlugin"
    public let jsName = "PhotoNotes"
    public let pluginMethods: [CAPPluginMethod] = ["request", "read", "write", "list", "remove", "recordStart", "recordStop", "share", "printPage", "notificationsEnable", "notificationsDisable", "photoSource", "chooseImageFile", "openExternal"].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }
    private let origin: URL = {
        #if DEBUG
        if let value = ProcessInfo.processInfo.environment["PN_IOS_TEST_SERVER"], let url = URL(string: value), url.scheme == "http", ["127.0.0.1", "localhost"].contains(url.host ?? ""), url.port == 33087 { return url }
        #endif
        return URL(string: "https://photonotesapp.com")!
    }()
    private var documentCall: CAPPluginCall?
    private var pushCall: CAPPluginCall?
    private var observers: [NSObjectProtocol] = []
    public override func load() {
        if PhotoNotesPushRouting.pending { PhotoNotesPushRouting.pending = false; notifyListeners("issueNotificationOpened", data: [:], retainUntilConsumed: true) }
        observers.append(NotificationCenter.default.addObserver(forName: Notification.Name("PhotoNotesPushToken"), object: nil, queue: .main) { [weak self] note in
            guard let self = self else { return }; let data = note.userInfo as? [String: String] ?? [:]
            if let error = data["error"] { self.pushCall?.reject(error) } else { self.pushCall?.resolve(data) }
            self.pushCall = nil
        })
        observers.append(NotificationCenter.default.addObserver(forName: Notification.Name("PhotoNotesPushOpened"), object: nil, queue: .main) { [weak self] _ in PhotoNotesPushRouting.pending = false; self?.notifyListeners("issueNotificationOpened", data: [:], retainUntilConsumed: true) })
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            if let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, type == AVAudioSession.InterruptionType.began.rawValue { self?.notifyListeners("recordingInterrupted", data: [:]) }
        })
    }
    deinit { for observer in observers { NotificationCenter.default.removeObserver(observer) } }
    private let sessionLock = NSLock()
    private var generation = 0
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    #if DEBUG
    private var fixtureEdition = ProcessInfo.processInfo.environment["PN_IOS_FIXTURE_EDITION"] ?? "basic"
    private var fixtureEmail = "ios-tester@example.invalid"
    #endif
    private var speechTask: SFSpeechRecognitionTask?
    private lazy var http: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.timeoutIntervalForRequest = 90
        config.timeoutIntervalForResource = 180
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private var keyQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "PhotoNotes.session." + origin.absoluteString, kSecAttrAccount as String: "production"] }
    private func token() -> String? {
        var query = keyQuery; query[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    private func saveToken(_ value: String?) throws {
        let deleted = SecItemDelete(keyQuery as CFDictionary)
        guard deleted == errSecSuccess || deleted == errSecItemNotFound else { throw NSError(domain: "PhotoNotes.Keychain", code: Int(deleted)) }
        if let value = value {
            var query = keyQuery
            query[kSecValueData as String] = Data(value.utf8)
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw NSError(domain: "PhotoNotes", code: 1) }
        }
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward the private session to a redirect destination.
        completionHandler(nil)
    }
    @objc func request(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), path.hasPrefix("/api/") || path.hasPrefix("/uploads/"),
              let url = URL(string: path, relativeTo: origin)?.absoluteURL, url.host == origin.host, url.scheme == origin.scheme, url.port == origin.port, url.user == nil,
              let method = call.getString("method"), ["GET", "POST", "PUT", "PATCH", "DELETE"].contains(method) else { call.reject("Invalid service request"); return }
        #if DEBUG
        if ProcessInfo.processInfo.environment["PN_IOS_FIXTURE"] == "1" {
            fixtureRequest(call, path: path, method: method)
            return
        }
        #endif
        sessionLock.lock()
        if path == "/api/login" || path == "/api/logout" || path == "/api/switch-edition" { generation += 1 }
        let requestGeneration = generation
        let cookie = token()
        if path == "/api/logout" || path == "/api/login" {
            do { try saveToken(nil) }
            catch { sessionLock.unlock(); call.reject("Could not securely clear the session. Please try again.", "SESSION_STORAGE"); return }
        }
        sessionLock.unlock()
        if let expected = call.getString("expectedScope"), path != "/api/login", path != "/api/logout" {
            let parts = (cookie ?? "").split(separator: ".")
            var email: String? = nil
            if parts.count == 3 {
                var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
                while payload.count % 4 != 0 { payload += "=" }
                if let data = Data(base64Encoded: payload), let claims = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { email = claims["email"] as? String }
            }
            let actual = email.map { SHA256.hash(data: Data($0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().utf8)).map { String(format: "%02x", $0) }.joined() }
            guard actual == expected else { call.reject("Account changed. Local files were retained.", "SESSION_CHANGED"); return }
        }
        var request = URLRequest(url: url); request.httpMethod = method
        if let cookie = cookie { request.setValue("pn_token=\(cookie)", forHTTPHeaderField: "Cookie") }
        if let headers = call.getObject("headers") as? [String: String] {
            for (name, value) in headers where ["content-type", "accept", "x-photo-notes-capture-id", "x-photo-notes-edition", "x-photo-notes-account"].contains(name.lowercased()) { request.setValue(value, forHTTPHeaderField: name) }
        }
        if let body = call.getString("body") {
            guard let data = Data(base64Encoded: body), data.count <= 60 * 1024 * 1024 else { call.reject("Request too large"); return }
            request.httpBody = data
        }
        http.dataTask(with: request) { data, response, error in
            guard error == nil, let response = response as? HTTPURLResponse else { call.reject("Connection unavailable. Your local files are retained.", "OFFLINE"); return }
            self.sessionLock.lock()
            let current = self.generation == requestGeneration
            if current, path != "/api/logout", let headers = response.allHeaderFields as? [String: String] {
                for cookie in HTTPCookie.cookies(withResponseHeaderFields: headers, for: url) where cookie.name == "pn_token" {
                    do { try self.saveToken(cookie.value) } catch { self.sessionLock.unlock(); call.reject("Could not securely save the session"); return }
                }
            }
            self.sessionLock.unlock()
            guard current else { call.reject("Account session changed", "SESSION_CHANGED"); return }
            let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, pair in
                let name = String(describing: pair.key).lowercased()
                if ["content-type", "content-disposition", "x-photo-notes-mobile"].contains(name) { result[name] = String(describing: pair.value) }
            }
            call.resolve(["status": response.statusCode, "headers": headers, "body": (data ?? Data()).base64EncodedString()])
        }.resume()
    }
    #if DEBUG
    private func fixtureRequest(_ call: CAPPluginCall, path: String, method: String) {
        if ProcessInfo.processInfo.environment["PN_IOS_FIXTURE_OFFLINE"] == "1" { call.reject("Fixture offline", "OFFLINE"); return }
        let encoded = call.getString("body") ?? ""
        let body = (try? JSONSerialization.jsonObject(with: Data(base64Encoded: encoded) ?? Data())) as? [String: Any] ?? [:]
        var value: Any = [Any](); var status = 200
        if path == "/api/login" { fixtureEmail = body["email"] as? String ?? "ios-tester@example.invalid"; value = ["ok": true] }
        else if path == "/api/logout" { fixtureEmail = ""; value = ["ok": true] }
        else if path == "/api/switch-edition" { fixtureEdition = body["edition"] as? String ?? "basic"; value = ["ok": true] }
        else if path == "/api/me" {
            if fixtureEmail.isEmpty { status = 401; value = ["error": "not authenticated"] }
            else { value = ["authed": true, "email": fixtureEmail, "name": "iOS Fixture Tester", "role": "user", "plan": ["basic", "roads"].contains(fixtureEdition) ? "free" : "pro", "pro_type": ["basic", "pro"].contains(fixtureEdition) ? "general" : fixtureEdition, "edition_access": ["basic", "pro", "contractor", "roads", "paving", "hoa", "concrete", "roofer"], "feature_access": [:]] as [String: Any] }
        } else if path == "/api/captures" && method == "POST" { value = ["id": 900001, "note": "Fixture upload", "duplicate_matches": []] as [String: Any] }
        else if path == "/api/hoa/company" { value = ["id": 1, "name": "Fixture HOA"] }
        else if path.contains("settings") { value = ["branding": [:]] }
        let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
        call.resolve(["status": status, "headers": ["content-type": "application/json", "x-photo-notes-mobile": "1", "x-photo-notes-fixture": "1"], "body": data.base64EncodedString()])
    }
    #endif
    private func directory(_ scope: String) throws -> URL {
        guard scope.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw NSError(domain: "PhotoNotes", code: 2) }
        var root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("PhotoNotes/" + scope, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues(); values.isExcludedFromBackup = true; try root.setResourceValues(values)
        return root
    }
    private func file(_ call: CAPPluginCall) throws -> URL {
        guard let scope = call.getString("scope"), let name = call.getString("name"), name.range(of: "^[a-zA-Z0-9_-]+\\.(json|jpg|png|webp|m4a|caf|bin)$", options: .regularExpression) != nil else { throw NSError(domain: "PhotoNotes", code: 2) }
        return try directory(scope).appendingPathComponent(name)
    }
    @objc func write(_ call: CAPPluginCall) {
        do { let url = try file(call); guard let text = call.getString("data"), let data = Data(base64Encoded: text) else { call.reject("Invalid file"); return }; try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]); call.resolve() } catch { call.reject("Could not save on this iPhone. Check available storage.") }
    }
    @objc func read(_ call: CAPPluginCall) { do { call.resolve(["data": try Data(contentsOf: file(call)).base64EncodedString()]) } catch { call.reject("Local file unavailable", "NOT_FOUND") } }
    @objc func remove(_ call: CAPPluginCall) { do { let url = try file(call); if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }; call.resolve() } catch { call.reject("Local file could not be removed") } }
    @objc func list(_ call: CAPPluginCall) { do { let root = try directory(call.getString("scope") ?? ""); call.resolve(["names": try FileManager.default.contentsOfDirectory(atPath: root.path)]) } catch { call.reject("Local records unavailable") } }
    @objc func recordStart(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.recorder == nil else { call.reject("Recording already active"); return }
            AVAudioSession.sharedInstance().requestRecordPermission { allowed in
                DispatchQueue.main.async {
                    guard allowed else { call.reject("Allow microphone access in Settings to record notes."); return }
                    do {
                        let url = try self.file(call)
                        let audio = AVAudioSession.sharedInstance(); try audio.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP]); try audio.setActive(true)
                        let recording = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
                        guard recording.record() else { throw NSError(domain: "PhotoNotes", code: 3) }
                        self.recorder = recording; self.recordingURL = url; call.resolve()
                    } catch { try? AVAudioSession.sharedInstance().setActive(false); call.reject("Recording could not start") }
                }
            }
        }
    }
    @objc func recordStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let recorder = self.recorder, let url = self.recordingURL else { call.reject("No active recording"); return }
            recorder.stop(); self.recorder = nil; self.recordingURL = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            SFSpeechRecognizer.requestAuthorization { authorization in
                guard authorization == .authorized, let recognizer = SFSpeechRecognizer(locale: Locale(identifier: call.getString("locale") ?? "en-US")), recognizer.isAvailable else { call.resolve(["text": "", "retained": true]); return }
                let request = SFSpeechURLRecognitionRequest(url: url); request.shouldReportPartialResults = false
                let resultLock = NSLock(); var finished = false
                let finish: (String) -> Void = { text in
                    resultLock.lock(); if finished { resultLock.unlock(); return }; finished = true; resultLock.unlock()
                    call.resolve(["text": text, "retained": true])
                }
                var thisTask: SFSpeechRecognitionTask?
                thisTask = recognizer.recognitionTask(with: request) { result, error in
                    if let result = result, result.isFinal { finish(result.bestTranscription.formattedString) }
                    else if error != nil { finish("") }
                }
                self.speechTask = thisTask
                DispatchQueue.main.asyncAfter(deadline: .now() + 30) { finish(""); thisTask?.cancel(); if self.speechTask === thisTask { self.speechTask = nil } }
            }
        }
    }
    @objc func share(_ call: CAPPluginCall) {
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            var items: [Any] = []
            let files = call.getArray("files") as? [[String: Any]] ?? (call.getString("data").map { [["data": $0, "name": call.getString("name") ?? "Photo Notes.pdf"]] } ?? [])
            guard files.count <= 25 else { call.reject("Share up to 25 files at once"); return }
            for (index, file) in files.enumerated() {
                guard let encoded = file["data"] as? String, let data = Data(base64Encoded: encoded) else { throw NSError(domain: "PhotoNotes", code: 4) }
                let name = ((file["name"] as? String) ?? "Photo Notes.pdf").replacingOccurrences(of: "/", with: "-")
                let subfolder = folder.appendingPathComponent(String(index), isDirectory: true)
                try FileManager.default.createDirectory(at: subfolder, withIntermediateDirectories: true)
                let url = subfolder.appendingPathComponent(name); try data.write(to: url, options: .atomic); items.append(url)
            }
            if let text = call.getString("text"), !text.isEmpty { items.append(text) }
            if let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https" { items.append(url) }
            guard !items.isEmpty else { try? FileManager.default.removeItem(at: folder); call.reject("Nothing to share"); return }
            DispatchQueue.main.async {
                let sheet = UIActivityViewController(activityItems: items, applicationActivities: nil)
                sheet.popoverPresentationController?.sourceView = self.bridge?.viewController?.view
                sheet.popoverPresentationController?.sourceRect = CGRect(x: 20, y: 20, width: 1, height: 1)
                sheet.completionWithItemsHandler = { _, completed, _, error in try? FileManager.default.removeItem(at: folder); if error != nil { call.reject("Sharing failed") } else { call.resolve(["completed": completed]) } }
                self.bridge?.viewController?.present(sheet, animated: true)
            }
        } catch { call.reject("Export could not be prepared") }
    }
    @objc func printPage(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let webView = self.bridge?.webView else { call.reject("Page unavailable"); return }
            let controller = UIPrintInteractionController.shared
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true) { _, completed, error in
                if error != nil { call.reject("Printing failed") } else { call.resolve(["completed": completed]) }
            }
        }
    }
    @objc func photoSource(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let sheet = UIAlertController(title: "Choose Photo", message: nil, preferredStyle: .actionSheet)
            sheet.addAction(UIAlertAction(title: "Photo Library", style: .default) { _ in call.resolve(["source": "photos"]) })
            sheet.addAction(UIAlertAction(title: "Files", style: .default) { _ in call.resolve(["source": "files"]) })
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in call.resolve(["source": "cancel"]) })
            sheet.popoverPresentationController?.sourceView = self.bridge?.viewController?.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: 20, y: 20, width: 1, height: 1)
            self.bridge?.viewController?.present(sheet, animated: true)
        }
    }
    @objc func chooseImageFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.documentCall == nil else { call.reject("File picker already open"); return }
            self.documentCall = call
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image], asCopy: true)
            picker.delegate = self; picker.allowsMultipleSelection = false
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }
    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { documentCall?.reject("Selection cancelled", "CANCELLED"); documentCall = nil }
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = documentCall, let url = urls.first else { documentCall?.reject("No file selected"); documentCall = nil; return }; documentCall = nil
        let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let size = (try url.resourceValues(forKeys: [.fileSizeKey])).fileSize ?? 0
            guard size <= 25 * 1024 * 1024 else { call.reject("Photo exceeds 25 MB"); return }
            let data = try Data(contentsOf: url)
            let type = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "image/jpeg"
            call.resolve(["data": data.base64EncodedString(), "name": url.lastPathComponent, "type": type])
        } catch { call.reject("The selected photo could not be read") }
    }
    @objc func notificationsEnable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.pushCall == nil else { call.reject("Notification registration is already pending"); return }
            self.pushCall = call
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { allowed, _ in
                DispatchQueue.main.async {
                    guard allowed else { self.pushCall = nil; call.reject("Allow notifications in iPhone Settings to receive issue updates."); return }
                    UIApplication.shared.registerForRemoteNotifications()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 20) { if self.pushCall === call { self.pushCall = nil; call.reject("Apple notification registration timed out. Try again when connected.") } }
                }
            }
        }
    }
    @objc func notificationsDisable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.unregisterForRemoteNotifications()
            UNUserNotificationCenter.current().removeAllDeliveredNotifications()
            call.resolve()
        }
    }
    @objc func openExternal(_ call: CAPPluginCall) {
        guard let value = call.getString("url"), let url = URL(string: value), ["https", "mailto", "tel"].contains(url.scheme ?? "") else { call.reject("Unsupported link"); return }
        DispatchQueue.main.async { UIApplication.shared.open(url) { opened in call.resolve(["opened": opened]) } }
    }
}

class PhotoNotesViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(PhotoNotesPlugin()) }
}
