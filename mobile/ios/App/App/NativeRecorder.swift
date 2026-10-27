import Foundation
import AVFoundation
import UIKit

// Record Notes for the PhotoNotes AI iPhone app.
//
// One spoken note is kept as one or more WAV files ("segments") in Application Support.
// A new segment starts after a phone call, Siri, or an audio system restart, so audio that
// was already recorded is never put at risk. Recording keeps going with the screen locked
// (UIBackgroundModes audio). The words come from the full recording, sent to the same
// PhotoNotes server transcription the web app uses, in pieces of about five minutes.
// Files stay on the iPhone until the web app confirms the note was uploaded.

struct RecordingMeta: Codable {
    var id: String
    var account: String
    var language: String
    var createdAt: Double
    var state: String // recording, stopped, transcribed
    var segments: [String]
    var seconds: Double
    var plan: [[Int64]]?
    var chunkTexts: [String?]?
    var text: String?
    var placed: Bool
    var interrupted: Bool
    var lastError: String?
}

enum RecorderError: Error {
    case noRecording
    case couldNotStart
}

final class RecordingStore {
    static let shared = RecordingStore()
    let root: URL
    private let lock = NSLock()

    private init() {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)) ?? FileManager.default.temporaryDirectory
        var folder = base.appendingPathComponent("PhotoNotes/Recordings", isDirectory: true)
        // Readable after the first unlock, so recording and saving continue with the screen locked.
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [FileAttributeKey.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? folder.setResourceValues(values)
        root = folder
    }

    func validID(_ id: String) -> Bool { UUID(uuidString: id) != nil }

    func folder(_ id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }

    func load(_ id: String) -> RecordingMeta? {
        guard validID(id) else { return nil }
        lock.lock()
        defer { lock.unlock() }
        guard let data = try? Data(contentsOf: folder(id).appendingPathComponent("meta.json")) else { return nil }
        return try? JSONDecoder().decode(RecordingMeta.self, from: data)
    }

    func save(_ meta: RecordingMeta) throws {
        let data = try JSONEncoder().encode(meta)
        lock.lock()
        defer { lock.unlock() }
        try data.write(to: folder(meta.id).appendingPathComponent("meta.json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func all() -> [RecordingMeta] {
        let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
        return names.compactMap { load($0) }.sorted { $0.createdAt < $1.createdAt }
    }

    func create(account: String, language: String) throws -> RecordingMeta {
        let id = UUID().uuidString
        try FileManager.default.createDirectory(at: folder(id), withIntermediateDirectories: true, attributes: [FileAttributeKey.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let meta = RecordingMeta(id: id, account: account, language: language, createdAt: Date().timeIntervalSince1970 * 1000, state: "recording", segments: [], seconds: 0, plan: nil, chunkTexts: nil, text: nil, placed: false, interrupted: false, lastError: nil)
        try save(meta)
        return meta
    }

    func remove(_ id: String) {
        guard validID(id) else { return }
        lock.lock()
        defer { lock.unlock() }
        try? FileManager.default.removeItem(at: folder(id))
    }

    // A recording still marked as recording when the app starts was cut off when the app closed.
    // Its files are kept and it is offered for transcription.
    func recoverAfterLaunch() {
        for var meta in all() where meta.state == "recording" {
            meta.state = "stopped"
            meta.interrupted = true
            meta.seconds = WavAudio.seconds(of: meta, in: folder(meta.id))
            try? save(meta)
        }
        // Words from notes that were uploaded long ago are not needed. Untranscribed audio is never removed here.
        let cutoff = (Date().timeIntervalSince1970 - 14 * 86400) * 1000
        for meta in all() where meta.state == "transcribed" && meta.placed && meta.createdAt < cutoff {
            remove(meta.id)
        }
    }
}

struct WavFormat {
    var channels: UInt16
    var sampleRate: UInt32
    var bitsPerSample: UInt16
    var blockAlign: UInt16 { max(1, channels * max(1, bitsPerSample / 8)) }
    var byteRate: UInt32 { sampleRate * UInt32(blockAlign) }
}

struct WavPart {
    let url: URL
    let offset: UInt64
    let length: UInt64
}

struct WavFile {
    let format: WavFormat
    let part: WavPart
}

enum WavAudio {
    private static func u16(_ data: Data, _ index: Int) -> UInt16 {
        let start = data.startIndex + index
        return UInt16(data[start]) | (UInt16(data[start + 1]) << 8)
    }

    private static func u32(_ data: Data, _ index: Int) -> UInt32 {
        let start = data.startIndex + index
        let b0 = UInt32(data[start])
        let b1 = UInt32(data[start + 1])
        let b2 = UInt32(data[start + 2])
        let b3 = UInt32(data[start + 3])
        return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)
    }

    private static func tag(_ data: Data, _ index: Int) -> String {
        let start = data.startIndex + index
        return String(decoding: data[start..<(start + 4)], as: UTF8.self)
    }

    // Reads the format and where the audio samples are. A file cut off when the app closed has
    // an unfinished header; its samples run to the end of the file.
    static func parse(_ url: URL) -> WavFile? {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return nil }
        defer { try? handle.close() }
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        let fileSize = (attributes?[FileAttributeKey.size] as? NSNumber)?.uint64Value ?? 0
        guard fileSize >= 12, let head = try? handle.read(upToCount: 12), head.count == 12,
              tag(head, 0) == "RIFF", tag(head, 8) == "WAVE" else { return nil }
        var position: UInt64 = 12
        var format: WavFormat?
        while position + 8 <= fileSize {
            guard (try? handle.seek(toOffset: position)) != nil,
                  let header = try? handle.read(upToCount: 8), header.count == 8 else { return nil }
            let name = tag(header, 0)
            let size = UInt64(u32(header, 4))
            let body = position + 8
            if name == "fmt " {
                guard let fmt = try? handle.read(upToCount: 16), fmt.count == 16 else { return nil }
                format = WavFormat(channels: u16(fmt, 2), sampleRate: u32(fmt, 4), bitsPerSample: u16(fmt, 14))
            } else if name == "data" {
                guard let found = format, body <= fileSize else { return nil }
                let available = fileSize - body
                let length = (size == 0 || size == 0xFFFF_FFFF || size > available) ? available : size
                let block = UInt64(found.blockAlign)
                return WavFile(format: found, part: WavPart(url: url, offset: body, length: length - length % block))
            }
            position = body + size + (size % 2)
        }
        return nil
    }

    static func files(of meta: RecordingMeta, in folder: URL) -> (WavFormat?, [WavPart]) {
        var format: WavFormat?
        var parts: [WavPart] = []
        for name in meta.segments {
            guard let file = parse(folder.appendingPathComponent(name)), file.part.length > 0 else { continue }
            if let first = format {
                // Every segment is recorded with the same settings; anything else is left out of the joined audio.
                if first.sampleRate != file.format.sampleRate || first.channels != file.format.channels || first.bitsPerSample != file.format.bitsPerSample { continue }
            } else {
                format = file.format
            }
            parts.append(file.part)
        }
        return (format, parts)
    }

    static func seconds(of meta: RecordingMeta, in folder: URL) -> Double {
        let (format, parts) = files(of: meta, in: folder)
        guard let found = format, found.byteRate > 0 else { return 0 }
        let total = parts.reduce(UInt64(0)) { $0 + $1.length }
        return Double(total) / Double(found.byteRate)
    }

    static func header(format: WavFormat, dataLength: UInt32) -> Data {
        var data = Data()
        func put32(_ value: UInt32) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        func put16(_ value: UInt16) { withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) } }
        data.append(contentsOf: Array("RIFF".utf8))
        put32(36 + dataLength)
        data.append(contentsOf: Array("WAVE".utf8))
        data.append(contentsOf: Array("fmt ".utf8))
        put32(16)
        put16(1)
        put16(format.channels)
        put32(format.sampleRate)
        put32(format.byteRate)
        put16(format.blockAlign)
        put16(format.bitsPerSample)
        data.append(contentsOf: Array("data".utf8))
        put32(dataLength)
        return data
    }

    // Reads count bytes of samples starting at start, where the segments are treated as one recording.
    static func read(_ parts: [WavPart], from start: UInt64, count: Int) throws -> Data {
        var output = Data()
        var position: UInt64 = 0
        var cursor = start
        var remaining = UInt64(max(0, count))
        for part in parts {
            let partEnd = position + part.length
            if remaining > 0 && cursor >= position && cursor < partEnd {
                let inPart = cursor - position
                let take = min(remaining, part.length - inPart)
                let handle = try FileHandle(forReadingFrom: part.url)
                defer { try? handle.close() }
                try handle.seek(toOffset: part.offset + inPart)
                let piece = try handle.read(upToCount: Int(take)) ?? Data()
                output.append(piece)
                cursor += UInt64(piece.count)
                remaining -= UInt64(piece.count)
                if UInt64(piece.count) < take { break }
            }
            position = partEnd
        }
        return output
    }

    // The quietest tenth of a second near the end of a piece, so a piece rarely ends in the middle of a word.
    static func quietestCut(_ parts: [WavPart], format: WavFormat, near end: UInt64, window: UInt64) -> UInt64 {
        let block = UInt64(format.blockAlign)
        let from = end > window ? end - window : 0
        guard format.bitsPerSample == 16, end > from,
              let data = try? read(parts, from: from, count: Int(end - from)), data.count >= 4 else { return end - end % block }
        let frame = max(Int(block), (Int(format.byteRate) / 10) / Int(block) * Int(block))
        var best = Int.max
        var bestAt = data.count
        var index = 0
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            while index + frame <= raw.count {
                var energy = 0
                var sample = index
                while sample + 1 < index + frame {
                    let value = Int(Int16(bitPattern: UInt16(raw[sample]) | (UInt16(raw[sample + 1]) << 8)))
                    energy += value * value / 64
                    sample += 2
                }
                if energy < best {
                    best = energy
                    bestAt = index + frame / 2
                }
                index += frame
            }
        }
        let cut = from + UInt64(bestAt)
        return cut - cut % block
    }

    // Byte ranges of about five minutes each. A short last piece joins the one before it.
    static func plan(_ parts: [WavPart], format: WavFormat, pieceSeconds: UInt64 = 300) -> [[Int64]] {
        let total = parts.reduce(UInt64(0)) { $0 + $1.length }
        let rate = UInt64(format.byteRate)
        guard total > 0, rate > 0 else { return [] }
        let target = pieceSeconds * rate
        var ranges: [[Int64]] = []
        var start: UInt64 = 0
        while start < total {
            var end = start + target
            if end + rate * 20 >= total {
                end = total
            } else {
                end = quietestCut(parts, format: format, near: end, window: rate * 10)
                if end <= start { end = min(total, start + target) }
            }
            ranges.append([Int64(start), Int64(end)])
            start = end
        }
        return ranges
    }

    // One WAV file with every segment, for Share Recording.
    static func export(_ meta: RecordingMeta, in folder: URL, to url: URL) throws {
        let (format, parts) = files(of: meta, in: folder)
        guard let found = format else { throw RecorderError.noRecording }
        let total = parts.reduce(UInt64(0)) { $0 + $1.length }
        _ = FileManager.default.createFile(atPath: url.path, contents: header(format: found, dataLength: UInt32(min(total, UInt64(UInt32.max - 36)))))
        let output = try FileHandle(forWritingTo: url)
        defer { try? output.close() }
        _ = try output.seekToEnd()
        var offset: UInt64 = 0
        let step = 1024 * 1024
        while offset < total {
            let piece = try read(parts, from: offset, count: Int(min(UInt64(step), total - offset)))
            if piece.isEmpty { break }
            try output.write(contentsOf: piece)
            offset += UInt64(piece.count)
        }
    }
}

final class NativeRecorder: NSObject, AVAudioRecorderDelegate {
    static let shared = NativeRecorder()
    enum State: String {
        case idle
        case recording
        case interrupted
    }

    // 16 kHz mono 16-bit WAV: what the server transcription expects, and readable even if the app is closed mid-recording.
    static let settings: [String: Any] = [
        AVFormatIDKey: Int(kAudioFormatLinearPCM),
        AVSampleRateKey: 16000.0,
        AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16,
        AVLinearPCMIsFloatKey: false,
        AVLinearPCMIsBigEndianKey: false
    ]
    static let maxSeconds: Double = 2 * 60 * 60

    private(set) var state: State = .idle
    private var meta: RecordingMeta?
    private var recorder: AVAudioRecorder?
    private var finishedSeconds: Double = 0
    private var observers: [NSObjectProtocol] = []
    private var limitTimer: Timer?
    var onChange: (([String: Any]) -> Void)?

    var activeID: String? { meta?.id }

    func currentSeconds() -> Double { finishedSeconds + (recorder?.currentTime ?? 0) }

    func status(reason: String? = nil) -> [String: Any] {
        var data: [String: Any] = ["state": state.rawValue, "seconds": currentSeconds()]
        if let id = meta?.id { data["id"] = id }
        if let reason = reason { data["reason"] = reason }
        if let active = recorder, active.isRecording {
            active.updateMeters()
            data["level"] = Double(active.averagePower(forChannel: 0))
        }
        return data
    }

    private func emit(_ reason: String? = nil) { onChange?(status(reason: reason)) }

    // Main thread only.
    func start(account: String, language: String, completion: @escaping (String?, String?) -> Void) {
        if state != .idle, let id = meta?.id { completion(id, nil); return }
        AVAudioSession.sharedInstance().requestRecordPermission { allowed in
            DispatchQueue.main.async {
                guard allowed else {
                    completion(nil, "Microphone access is off. Open iPhone Settings, PhotoNotes AI, and turn on Microphone.")
                    return
                }
                if self.state != .idle, let id = self.meta?.id { completion(id, nil); return }
                do {
                    try self.activateSession()
                    let created = try RecordingStore.shared.create(account: account, language: language)
                    self.meta = created
                    self.finishedSeconds = 0
                    try self.beginSegment()
                    self.state = .recording
                    self.installObservers()
                    self.emit("started")
                    completion(created.id, nil)
                } catch {
                    if let failed = self.meta, failed.segments.isEmpty { RecordingStore.shared.remove(failed.id) }
                    self.recorder = nil
                    self.meta = nil
                    self.state = .idle
                    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                    completion(nil, "Recording could not start. Close other apps that use the microphone and try again.")
                }
            }
        }
    }

    // Main thread only. Returns the finished recording, kept on the iPhone.
    func stop() -> RecordingMeta? {
        guard state != .idle else { return nil }
        endSegment()
        guard var finished = meta else { return nil }
        finished.state = "stopped"
        finished.seconds = WavAudio.seconds(of: finished, in: RecordingStore.shared.folder(finished.id))
        try? RecordingStore.shared.save(finished)
        meta = nil
        state = .idle
        finishedSeconds = 0
        removeObservers()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        emit("stopped")
        return finished
    }

    private func activateSession() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth])
        try session.setActive(true)
    }

    private func beginSegment() throws {
        guard var current = meta else { throw RecorderError.noRecording }
        let name = String(format: "seg-%03d.wav", current.segments.count + 1)
        let url = RecordingStore.shared.folder(current.id).appendingPathComponent(name)
        let next = try AVAudioRecorder(url: url, settings: NativeRecorder.settings)
        next.delegate = self
        next.isMeteringEnabled = true
        guard next.record() else { throw RecorderError.couldNotStart }
        recorder = next
        current.segments.append(name)
        current.state = "recording"
        meta = current
        try? RecordingStore.shared.save(current)
    }

    // Finishes the current file so its audio is complete on disk.
    private func endSegment() {
        guard let active = recorder else { return }
        finishedSeconds += active.currentTime
        active.delegate = nil
        active.stop()
        recorder = nil
        if var current = meta {
            current.seconds = finishedSeconds
            meta = current
            try? RecordingStore.shared.save(current)
        }
    }

    private func markInterrupted() {
        guard var current = meta else { return }
        current.interrupted = true
        meta = current
        try? RecordingStore.shared.save(current)
    }

    private func restartSegment() {
        endSegment()
        do {
            try activateSession()
            try beginSegment()
            state = .recording
            emit("resumed")
        } catch {
            state = .interrupted
            markInterrupted()
            emit("waiting")
        }
    }

    private func resumeIfInterrupted() {
        guard state == .interrupted, meta != nil else { return }
        do {
            try activateSession()
            try beginSegment()
            state = .recording
            emit("resumed")
        } catch {
            // Still blocked (for example, a call is in progress). Tried again when PhotoNotes AI opens.
            emit("waiting")
        }
    }

    private func installObservers() {
        removeObservers()
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            self?.interruption(note)
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            self?.routeChanged()
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            self?.mediaReset()
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.resumeIfInterrupted()
        })
        observers.append(center.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: .main) { [weak self] _ in
            // Closing the app finishes the file so the recording can be transcribed next time.
            self?.markInterrupted()
            _ = self?.stop()
        })
        limitTimer?.invalidate()
        limitTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            guard let self = self, self.state != .idle, self.currentSeconds() >= NativeRecorder.maxSeconds else { return }
            _ = self.stop()
            self.onChange?(["state": "idle", "seconds": 0, "reason": "limit"])
        }
    }

    private func removeObservers() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers.removeAll()
        limitTimer?.invalidate()
        limitTimer = nil
    }

    private func interruption(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .began {
            guard state == .recording else { return }
            endSegment()
            state = .interrupted
            markInterrupted()
            emit("interrupted")
        } else if type == .ended {
            // Resume into the same note when the call or Siri ends.
            resumeIfInterrupted()
        }
    }

    private func routeChanged() {
        guard state == .recording else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self = self, self.state == .recording else { return }
            // Headphones or Bluetooth changed and the microphone stopped: continue in a new file.
            if self.recorder?.isRecording != true { self.restartSegment() }
        }
    }

    private func mediaReset() {
        guard state != .idle else { return }
        if let active = recorder {
            finishedSeconds += active.currentTime
            active.delegate = nil
        }
        recorder = nil
        if state == .recording {
            restartSegment()
        } else {
            resumeIfInterrupted()
        }
    }

    func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, recorder === self.recorder, self.state == .recording else { return }
            self.restartSegment()
        }
    }

    func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, recorder === self.recorder, self.state == .recording else { return }
            self.restartSegment()
        }
    }
}

private final class RefuseRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // The session cookie is never sent anywhere else.
        completionHandler(nil)
    }
}

final class NativeTranscriber {
    static let shared = NativeTranscriber()
    // One recording at a time. A second request for the same recording waits, then returns the saved words.
    private let queue = DispatchQueue(label: "PhotoNotes.transcription")
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.timeoutIntervalForRequest = 180
        config.timeoutIntervalForResource = 600
        return URLSession(configuration: config, delegate: RefuseRedirects(), delegateQueue: nil)
    }()

    private final class Reply: @unchecked Sendable {
        var status = 0
        var payload: Data?
        var failed = false
    }

    private func send(_ request: URLRequest, body: Data) -> (Int, Data?, Bool) {
        let done = DispatchSemaphore(value: 0)
        let reply = Reply()
        let task = session.uploadTask(with: request, from: body) { data, response, error in
            reply.failed = error != nil
            reply.status = (response as? HTTPURLResponse)?.statusCode ?? 0
            reply.payload = data
            done.signal()
        }
        task.resume()
        done.wait()
        return (reply.status, reply.payload, reply.failed)
    }

    private func message(for status: Int, failed: Bool) -> (String, String) {
        if failed || status == 0 { return ("No connection. The recording is saved on this iPhone and will be turned into words when the connection returns.", "offline") }
        switch status {
        case 401: return ("Sign in to PhotoNotes AI again. The recording stays on this iPhone.", "signin")
        case 429: return ("Too many recordings at once. PhotoNotes AI will try again in a few minutes. The recording stays on this iPhone.", "rate-limit")
        case 503: return ("Turning recordings into words is not available right now. The recording stays on this iPhone.", "unavailable")
        case 400, 413, 415: return ("This recording could not be turned into words. Use Share Recording to keep the audio.", "rejected")
        default: return ("The words could not be prepared right now. The recording stays on this iPhone and PhotoNotes AI will try again.", "server")
        }
    }

    func transcribe(id: String, origin: URL, cookie: String?, completion: @escaping (String?, String?, String?) -> Void) {
        queue.async {
            let finish: (String?, String?, String?) -> Void = { text, error, code in
                DispatchQueue.main.async { completion(text, error, code) }
            }
            guard var meta = RecordingStore.shared.load(id) else {
                finish(nil, "This recording is no longer on this iPhone.", "missing")
                return
            }
            if meta.state == "transcribed", let text = meta.text {
                finish(text, nil, nil)
                return
            }
            guard meta.state != "recording" else {
                finish(nil, "Stop the recording first.", "recording")
                return
            }
            let folder = RecordingStore.shared.folder(id)
            let (format, parts) = WavAudio.files(of: meta, in: folder)
            guard let found = format else {
                meta.state = "transcribed"
                meta.text = ""
                try? RecordingStore.shared.save(meta)
                finish("", nil, nil)
                return
            }
            if meta.plan == nil || meta.chunkTexts?.count != meta.plan?.count {
                let plan = WavAudio.plan(parts, format: found)
                meta.plan = plan
                meta.chunkTexts = Array(repeating: nil, count: plan.count)
                try? RecordingStore.shared.save(meta)
            }
            let plan = meta.plan ?? []
            var texts = meta.chunkTexts ?? []
            let language = meta.language == "es" ? "es" : "en"
            var components = URLComponents(url: origin.appendingPathComponent("api/transcription/recording"), resolvingAgainstBaseURL: false)
            components?.queryItems = [URLQueryItem(name: "language", value: language)]
            guard let url = components?.url else {
                finish(nil, "PhotoNotes AI is not connected to its service.", "origin")
                return
            }
            for index in plan.indices where texts[index] == nil {
                let start = UInt64(max(0, plan[index][0]))
                let end = UInt64(max(0, plan[index][1]))
                guard end > start else { texts[index] = ""; continue }
                let audio: Data
                do { audio = try WavAudio.read(parts, from: start, count: Int(end - start)) } catch {
                    meta.lastError = "The recording could not be read on this iPhone. Use Share Recording to keep the audio."
                    try? RecordingStore.shared.save(meta)
                    finish(nil, meta.lastError, "read")
                    return
                }
                // Less than a quarter second of audio has no words to find.
                if audio.count < Int(found.byteRate) / 4 { texts[index] = ""; continue }
                var body = WavAudio.header(format: found, dataLength: UInt32(audio.count))
                body.append(audio)
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                if let cookie = cookie { request.setValue(cookie, forHTTPHeaderField: "Cookie") }
                let (status, data, failed) = self.send(request, body: body)
                guard !failed, status == 200, let data = data,
                      let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                    let (text, code) = self.message(for: status, failed: failed)
                    meta.chunkTexts = texts
                    meta.lastError = text
                    try? RecordingStore.shared.save(meta)
                    finish(nil, text, code)
                    return
                }
                texts[index] = ((json["text"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                meta.chunkTexts = texts
                try? RecordingStore.shared.save(meta)
            }
            let words = texts.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
            meta.chunkTexts = texts
            meta.text = words
            meta.state = "transcribed"
            meta.lastError = nil
            try? RecordingStore.shared.save(meta)
            finish(words, nil, nil)
        }
    }
}
