# Photo Notes AI mobile foundation

Status: development preview, September 7, 2026. Branch: `codex/native-mobile-foundation`.

This is the first iOS and Android engineering milestone. It is a separate local capture preview, not a replacement for the current Photo Notes web application or a customer release. Mac and Windows applications are later phases.

## Implemented

- Packaged Capacitor 8 application with iOS and Android projects and the existing Photo Notes logo.
- Native camera and photo-library selection, photo preview, typed notes, and a local record list.
- Each photo becomes a recoverable draft before the interface reports success. Notes are committed with Save on this device.
- App-private filesystem storage on native devices. The browser fallback uses Capacitor's web storage implementation.
- Serialized, append-only metadata revisions. Each revision is written to a temporary file and renamed before success is reported. Incomplete revisions are ignored, earlier records remain available, and malformed records are retained and flagged.
- Android camera-result restoration is wired through Capacitor App. Results arriving during initialization are queued.
- Camera/library permission descriptions and a bundled iOS filesystem privacy manifest.

## Build

Run these commands in this `mobile` directory:

```sh
npm ci
npm test
npm run sync
npm run ios
# Or, with Java and the Android SDK installed:
npm run android
```

For a simulator build without Apple signing credentials:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/photo-notes-mobile-build \
  CODE_SIGNING_ALLOWED=NO build
```

The development identifier is `com.zukor.photonotes.dev`; the displayed app name is Photo Notes Dev. No production bundle identifier or store listing has been registered.

## Boundaries

This preview has no account connection, edition authorization, recording, AI processing, or upload path. The existing server and web app are unchanged. Its local records are not associated with a customer or an edition. Do not collect real job records in this preview.

Saved records survive an ordinary restart but are not a backup. Uninstalling the app can remove them. Unsaved typed note edits are not automatically retained. OS backup behavior differs by platform; Android backup is disabled in this development package. There is no application-level encryption or secure credential storage yet.

Photos currently use base64 text files and metadata retains every revision. Binary storage, checksums, compaction, deletion, storage quotas, and backup/export behavior need production implementation. This provides process-interruption recovery, not a guarantee against device loss or filesystem corruption.

## Verification

Six automated storage tests pass: reopen photo and notes, recover draft before Save, retain previous revision after interrupted rename, reject full-disk capture, retain malformed metadata, and serialize concurrent saves. TypeScript checking and the packaged web build pass.

The iOS simulator Debug build passed with Xcode 26.6, and the application launched on the iPhone 17 simulator running iOS 26.5. The logo, local-storage notice, photo controls, notes area, and empty record list were visually checked. Native capture/save/relaunch interaction has not yet been verified. The Android project was generated and synced, but Java and the Android SDK are absent on this computer, so no APK build was attempted. Native camera hardware, permission refusal, OS process termination during capture, and low-storage behavior still require physical-device testing. The unit tests use an injected disk implementation, not a simulated claim that those device tests passed.

`npm audit` reports three moderate development-tool findings through Capacitor CLI -> xcode -> uuid. They are not bundled runtime dependencies. Resolve or reassess before release; no forced dependency downgrade has been applied.

## Next milestones

1. Reuse the existing Photo Notes interface in the native package. Adapt its login/session flow for native origins and secure storage, with staging verification of sign-in, logout, and expiry.
2. Keep the existing server-authorized eight-edition selector. Bind every local capture and sync operation to the signed-in account and selected authorized edition. Isolate local records across accounts.
3. Add native audio recording with durable audio drafts and interruption recovery. Connect transcription only through authenticated server requests.
4. Add an upload queue and a server-side idempotency contract before retries are enabled. Validate lost responses, repeated submissions, sign-out, permission changes, and airplane-mode recovery without duplicate captures.
5. Restore the edition-specific capture workflows, markup, exports, and Report Issue experience. Test offline and online behavior with Rolando.
6. Complete Android toolchain setup, physical iPhone and Android checks, accessibility, signing, privacy disclosures, release icons, and internal distribution before store submission.

The existing `/api/login` and `/api/captures` handlers are integration points, not a ready native session or retry contract. Do not simply point an unrestricted native WebView at production or replay uploads without duplicate protection.

Filesystem privacy configuration follows the [official Capacitor Filesystem documentation](https://capacitorjs.com/docs/apis/filesystem).
