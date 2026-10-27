import Foundation
import Capacitor
import AVFoundation
import CoreLocation
import UIKit
import UserNotifications

// Native capture for the PhotoNotes AI iPhone app. The app shows the PhotoNotes web app from
// photonotesapp.com; public/native-capture.js calls these methods for Record Notes and location.
// Take Photo uses the Capacitor Camera plugin.
@objc(PhotoNotesPlugin)
public class PhotoNotesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotoNotesPlugin"
    public let jsName = "PhotoNotes"
    public let pluginMethods: [CAPPluginMethod] = [
        "recordStart", "recordStop", "recordStatus", "transcribe", "recordings", "markPlaced",
        "deleteRecording", "shareRecording", "getCurrentPosition", "appInfo",
        "notificationsEnable", "notificationsDisable"
    ].map { CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise) }

    private lazy var location = NativeLocation()
    private var pushCall: CAPPluginCall?
    private var observers: [NSObjectProtocol] = []

    // Apple push notifications need the paid Apple Developer Program and the push entitlement.
    // They stay off until PhotoNotesPushEnabled is true in Info.plist and the entitlement is added.
    static var pushEnabled: Bool { (Bundle.main.object(forInfoDictionaryKey: "PhotoNotesPushEnabled") as? Bool) == true }

    public override func load() {
        RecordingStore.shared.recoverAfterLaunch()
        DispatchQueue.main.async {
            NativeRecorder.shared.onChange = { [weak self] data in
                self?.notifyListeners("recordingState", data: data)
            }
        }
        observers.append(NotificationCenter.default.addObserver(forName: Notification.Name("PhotoNotesPushToken"), object: nil, queue: .main) { [weak self] note in
            guard let self = self, let call = self.pushCall else { return }
            let data = note.userInfo as? [String: String] ?? [:]
            if let error = data["error"] { call.reject(error) } else { call.resolve(data) }
            self.pushCall = nil
        })
    }

    deinit {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    private func validAccount(_ value: String?) -> String? {
        guard let value = value, value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { return nil }
        return value
    }

    @objc func recordStart(_ call: CAPPluginCall) {
        guard let account = validAccount(call.getString("account")) else { call.reject("Sign in before recording.", "account"); return }
        let language = call.getString("language") == "es" ? "es" : "en"
        DispatchQueue.main.async {
            NativeRecorder.shared.start(account: account, language: language) { id, error in
                if let id = id { call.resolve(["id": id]) } else { call.reject(error ?? "Recording could not start.", "start") }
            }
        }
    }

    @objc func recordStop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let finished = NativeRecorder.shared.stop() else { call.reject("No recording is active.", "idle"); return }
            call.resolve(["id": finished.id, "seconds": finished.seconds, "interrupted": finished.interrupted])
        }
    }

    @objc func recordStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(NativeRecorder.shared.status()) }
    }

    // The PhotoNotes service the app shows. Only https, except a local test server in Debug builds.
    private func serviceOrigin() -> URL? {
        guard let url = bridge?.config.serverURL, let scheme = url.scheme, let host = url.host else { return nil }
        var allowed = scheme == "https"
        #if DEBUG
        if scheme == "http" && (host == "localhost" || host == "127.0.0.1") { allowed = true }
        #endif
        guard allowed else { return nil }
        var components = URLComponents()
        components.scheme = scheme
        components.host = host
        components.port = url.port
        return components.url
    }

    // The signed-in session from the app's web view, sent only to the PhotoNotes service.
    private func cookieHeader(for origin: URL, completion: @escaping (String?) -> Void) {
        guard let store = bridge?.webView?.configuration.websiteDataStore.httpCookieStore, let host = origin.host else { completion(nil); return }
        store.getAllCookies { cookies in
            let matching = cookies.filter { cookie in
                let domain = cookie.domain.hasPrefix(".") ? String(cookie.domain.dropFirst()) : cookie.domain
                return host == domain || host.hasSuffix("." + domain)
            }
            completion(HTTPCookie.requestHeaderFields(with: matching)["Cookie"])
        }
    }

    @objc func transcribe(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), RecordingStore.shared.validID(id) else { call.reject("Recording not found.", "missing"); return }
        DispatchQueue.main.async {
            if NativeRecorder.shared.activeID == id { call.reject("Stop the recording first.", "recording"); return }
            guard let origin = self.serviceOrigin() else { call.reject("PhotoNotes AI is not connected to its service.", "origin"); return }
            // Lets the words finish if the screen locks right after Stop.
            var task = UIBackgroundTaskIdentifier.invalid
            task = UIApplication.shared.beginBackgroundTask(withName: "PhotoNotesTranscription") {
                if task != .invalid {
                    UIApplication.shared.endBackgroundTask(task)
                    task = .invalid
                }
            }
            self.cookieHeader(for: origin) { cookie in
                NativeTranscriber.shared.transcribe(id: id, origin: origin, cookie: cookie) { text, error, code in
                    if task != .invalid {
                        UIApplication.shared.endBackgroundTask(task)
                        task = .invalid
                    }
                    if let text = text { call.resolve(["id": id, "text": text]) } else { call.reject(error ?? "The words could not be prepared right now.", code ?? "server") }
                }
            }
        }
    }

    @objc func recordings(_ call: CAPPluginCall) {
        guard let account = validAccount(call.getString("account")) else { call.resolve(["recordings": [Any]()]); return }
        DispatchQueue.main.async {
            let active = NativeRecorder.shared.activeID
            let list: [[String: Any]] = RecordingStore.shared.all().filter { $0.account == account }.map { (meta: RecordingMeta) -> [String: Any] in
                var item: [String: Any] = [
                    "id": meta.id,
                    "createdAt": meta.createdAt,
                    "seconds": meta.id == active ? NativeRecorder.shared.currentSeconds() : meta.seconds,
                    "state": meta.id == active ? "recording" : meta.state,
                    "placed": meta.placed,
                    "interrupted": meta.interrupted
                ]
                if let text = meta.text { item["text"] = text }
                if let error = meta.lastError { item["error"] = error }
                return item
            }
            call.resolve(["recordings": list])
        }
    }

    @objc func markPlaced(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), var meta = RecordingStore.shared.load(id) else { call.reject("Recording not found.", "missing"); return }
        meta.placed = true
        do { try RecordingStore.shared.save(meta); call.resolve() } catch { call.reject("Could not update the recording on this iPhone.", "storage") }
    }

    @objc func deleteRecording(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), RecordingStore.shared.validID(id) else { call.reject("Recording not found.", "missing"); return }
        DispatchQueue.main.async {
            if NativeRecorder.shared.activeID == id { call.reject("Stop the recording first.", "recording"); return }
            RecordingStore.shared.remove(id)
            call.resolve()
        }
    }

    @objc func shareRecording(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let meta = RecordingStore.shared.load(id) else { call.reject("Recording not found.", "missing"); return }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let file = folder.appendingPathComponent("PhotoNotes Recording.wav")
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try WavAudio.export(meta, in: RecordingStore.shared.folder(id), to: file)
        } catch {
            try? FileManager.default.removeItem(at: folder)
            call.reject("The recording could not be prepared for sharing.", "export")
            return
        }
        DispatchQueue.main.async {
            guard let controller = self.bridge?.viewController else { call.reject("Sharing is not available right now.", "share"); return }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            sheet.popoverPresentationController?.sourceView = controller.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: controller.view.bounds.midX, y: controller.view.bounds.midY, width: 1, height: 1)
            sheet.completionWithItemsHandler = { _, completed, _, _ in
                try? FileManager.default.removeItem(at: folder)
                call.resolve(["completed": completed])
            }
            controller.present(sheet, animated: true)
        }
    }

    // Location for the web app's navigator.geolocation, so iPhone asks once, for the app.
    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        let maximumAge = call.getDouble("maximumAge") ?? 0
        let timeout = call.getDouble("timeout") ?? 15000
        let precise = call.getBool("enableHighAccuracy") ?? true
        DispatchQueue.main.async {
            self.location.current(maximumAge: maximumAge, timeout: timeout, precise: precise) { found, code, message in
                guard let found = found else { call.reject(message ?? "Location is not available.", String(code)); return }
                var coords: [String: Any] = [
                    "latitude": found.coordinate.latitude,
                    "longitude": found.coordinate.longitude,
                    "accuracy": found.horizontalAccuracy
                ]
                coords["altitude"] = found.verticalAccuracy >= 0 ? (found.altitude as Any) : (NSNull() as Any)
                coords["altitudeAccuracy"] = found.verticalAccuracy >= 0 ? (found.verticalAccuracy as Any) : (NSNull() as Any)
                coords["heading"] = found.course >= 0 ? (found.course as Any) : (NSNull() as Any)
                coords["speed"] = found.speed >= 0 ? (found.speed as Any) : (NSNull() as Any)
                call.resolve(["coords": coords, "timestamp": found.timestamp.timeIntervalSince1970 * 1000])
            }
        }
    }

    @objc func appInfo(_ call: CAPPluginCall) {
        let info = Bundle.main.infoDictionary ?? [:]
        call.resolve([
            "version": info["CFBundleShortVersionString"] as? String ?? "",
            "build": info["CFBundleVersion"] as? String ?? "",
            "bundle": Bundle.main.bundleIdentifier ?? "",
            "push": PhotoNotesPlugin.pushEnabled
        ])
    }

    @objc func notificationsEnable(_ call: CAPPluginCall) {
        guard PhotoNotesPlugin.pushEnabled else { call.reject("Notifications are not available in this build of PhotoNotes AI.", "push-off"); return }
        DispatchQueue.main.async {
            guard self.pushCall == nil else { call.reject("Notification registration is already pending."); return }
            self.pushCall = call
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { allowed, _ in
                DispatchQueue.main.async {
                    guard allowed else { self.pushCall = nil; call.reject("Allow notifications in iPhone Settings to receive issue updates."); return }
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }
        }
    }

    @objc func notificationsDisable(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if PhotoNotesPlugin.pushEnabled { UIApplication.shared.unregisterForRemoteNotifications() }
            call.resolve()
        }
    }
}

// One location at a time from Core Location. Waits for a fix of 30 meters or better, or returns
// the best fix found when the time limit is reached.
final class NativeLocation: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var waiting: [(CLLocation?, Int, String?) -> Void] = []
    private var best: CLLocation?
    private var timer: Timer?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    private var denied: Bool {
        let status = manager.authorizationStatus
        return status == .denied || status == .restricted
    }

    func current(maximumAge: Double, timeout: Double, precise: Bool, completion: @escaping (CLLocation?, Int, String?) -> Void) {
        if let last = manager.location, maximumAge > 0, -last.timestamp.timeIntervalSinceNow * 1000 <= maximumAge {
            completion(last, 0, nil)
            return
        }
        if denied {
            completion(nil, 1, "Location access is off. Open iPhone Settings, PhotoNotes AI, Location, and choose While Using the App.")
            return
        }
        waiting.append(completion)
        guard waiting.count == 1 else { return }
        best = nil
        manager.desiredAccuracy = precise ? kCLLocationAccuracyBest : kCLLocationAccuracyHundredMeters
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: max(2, min(60, timeout / 1000)), repeats: false) { [weak self] _ in
            guard let self = self else { return }
            if let found = self.best { self.finish(found, 0, nil) } else { self.finish(nil, 3, "Location took too long. Move to an open area and tap Retry location.") }
        }
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        } else {
            manager.startUpdatingLocation()
        }
    }

    private func finish(_ found: CLLocation?, _ code: Int, _ message: String?) {
        timer?.invalidate()
        timer = nil
        manager.stopUpdatingLocation()
        let callbacks = waiting
        waiting = []
        best = nil
        for callback in callbacks { callback(found, code, message) }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard !waiting.isEmpty else { return }
        let status = manager.authorizationStatus
        if status == .authorizedWhenInUse || status == .authorizedAlways {
            manager.startUpdatingLocation()
        } else if status == .denied || status == .restricted {
            finish(nil, 1, "Location access is off. Open iPhone Settings, PhotoNotes AI, Location, and choose While Using the App.")
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard !waiting.isEmpty else { return }
        for found in locations where found.horizontalAccuracy >= 0 {
            if best == nil || found.horizontalAccuracy < (best?.horizontalAccuracy ?? .greatestFiniteMagnitude) { best = found }
        }
        if let found = best, found.horizontalAccuracy <= 30 { finish(found, 0, nil) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard !waiting.isEmpty else { return }
        if let failure = error as? CLError {
            if failure.code == .locationUnknown { return }
            if failure.code == .denied { finish(nil, 1, "Location access is off. Open iPhone Settings, PhotoNotes AI, Location, and choose While Using the App."); return }
        }
        if let found = best { finish(found, 0, nil) } else { finish(nil, 2, "Location is not available right now.") }
    }
}

class PhotoNotesViewController: CAPBridgeViewController {
    override func capacitorDidLoad() { bridge?.registerPluginInstance(PhotoNotesPlugin()) }
}
