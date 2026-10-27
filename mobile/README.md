# PhotoNotes AI for iPhone

A Capacitor 8 iPhone app for PhotoNotes AI Basic Capture: take a photo, record spoken notes, upload. Sam's steps for his own iPhone are in [RUN_ON_MY_IPHONE.md](RUN_ON_MY_IPHONE.md).

## How it works

- The app shows the live web app from `https://photonotesapp.com` (`server.url` in `capacitor.config.json`). Library, Create, Send and every edition work as on the web, and web releases reach the app without a new build. With no connection at launch, the app shows `www/offline.html` with Try Again.
- `public/native-capture.js` (served by the web app, inert in browsers) detects the app through the Capacitor bridge and routes Capture to native code:
  - Take Photo: the Capacitor Camera plugin (`getPhoto`, camera source). The photo then follows the normal web path: local draft, durable IndexedDB upload queue, one request ID per capture, server upload receipts, Pending PhotoNotes status.
  - Location: `navigator.geolocation` is answered by Core Location, so iPhone asks once for the app instead of per website.
  - Record Notes: `NativeRecorder.swift`. 16 kHz mono WAV in Application Support, background audio (`UIBackgroundModes` audio), `.playAndRecord` session with Bluetooth input. Phone calls and Siri pause it; it continues in a new segment of the same note when the interruption ends, after route changes, and after an audio system reset. Closing the app finishes the file; the recording is offered on the next launch.
  - Words: after Stop Recording, the full recording is sent in pieces of about five minutes (cut at the quietest moment) to the existing `POST /api/transcription/recording`, the same AssemblyAI path the web app uses, with the web view's session cookie. Finished pieces are saved, so a retry sends only what is left. Save waits for the words; without a connection the person can keep the screen open and tap Transcribe Recording, or save without the spoken words.
  - Recordings stay on the iPhone until the PhotoNote holding their words has uploaded. Account menu, Recordings On This iPhone, lists the rest (transcribe, add to note, copy, share, delete).
- Push notifications are off: no entitlement, `PhotoNotesPushEnabled` false in Info.plist, so a free personal Apple team can sign the app. The code stays in `AppDelegate.swift`, `PhotoNotesPlugin.swift` (`notificationsEnable`) and `ios-push.js` on the server for later.

## Commands

```sh
cd mobile
npm install
npm test            # project checks: Info.plist, signing, plugin methods, guide
npx cap sync ios    # copies capacitor.config.json and plugins into the Xcode project
npx cap open ios
```

Simulator build without signing (also the manual GitHub Actions workflow `Mobile iOS Build`):

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

Bundle identifier: `com.zukor.photonotes.ai` for Debug and Release.

## Later: TestFlight

TestFlight needs the paid Apple Developer Program. Then: add the push entitlement and set `PhotoNotesPushEnabled` to true if notifications are wanted, configure `APNS_*` on the server, archive a signed Release build, and upload it.
