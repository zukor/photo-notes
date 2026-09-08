# Photo Notes AI for iOS

Delivery target: TestFlight first. Android, Mac, and Windows are deferred until iOS is complete.

## Current status

The iOS application now packages the existing Photo Notes interface. The eight editions and their access checks remain server-controlled. This branch is still undergoing integration and device testing. It has not been uploaded to TestFlight or deployed to production.

Implemented:

- Native camera, Photo Library and Files selection, with an immediate local copy.
- Keychain session storage. JavaScript never receives the session cookie. Native requests are restricted to the Photo Notes service and do not follow redirects.
- Account-separated, protected local files; persisted capture drafts; an On This iPhone recovery/export screen.
- A persistent upload queue with stable request IDs, photo integrity checks, explicit pending/error states, and server transaction receipts to prevent duplicate captures after a lost response.
- Account checks before transmitting queued files, before the server accepts an upload, and again when saving it. Edition access is checked against the current database record.
- Native audio recording, retained audio files, Apple speech recognition, and protection against late transcripts entering a different photo or account.
- Native share sheets and printing, plus native loading of cloud images for canvas-based photo editing and screenshot markup.
- The existing Report Issue interface and markup tools. Native Apple notification registration and delivery use the existing issue event/delivery tracking, including retries and invalid-device cleanup.
- Separate Debug and Release app identifiers and network configuration, a real Photo Notes icon/splash screen, and an updated privacy manifest.

## Verification so far

- The shared web/server regression suite passed: 191 tests passed, three opt-in tests skipped.
- The PostgreSQL integration suite passed against a fingerprint-checked disposable database: concurrent retries created one record, receipt failures rolled the capture back, wrong editions and revoked permissions were rejected, and account boundaries were enforced.
- Native queue unit tests cover restart recovery, full storage, separate account vaults, acknowledgment, malformed records, integrity checks, and recovery after a failed save.
- The iOS Debug simulator build and unsigned iPhone Release archive passed. The signed archive failed because Xcode classified the available Samuel Turcotte team as a Personal Team, which does not support the requested push capability. In simulator UI checks, a Photo Library sample loaded as a capture and survived an app restart. Denying location access retained the photo and allowed the capture workflow to continue.
- The Mac locked during further UI testing. Real login through the local API, note/save/restart, recording, editor/export, Report Issue markup, all edition screens, and physical-device checks remain to be completed. Native push delivery requires Apple credentials and a physical-device test.

These are separate evidence states. Passing storage tests is not proof that camera hardware or speech recognition has been tested.

## Build

From the repository root:

```sh
npm ci
npm ci --prefix mobile
npm test
npm test --prefix mobile
npm run sync:ios --prefix mobile
```

Open the Xcode project with `npm run ios --prefix mobile`.

Simulator build:

```sh
xcodebuild -project mobile/ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/photo-notes-mobile-build \
  CODE_SIGNING_ALLOWED=NO build
```

Debug is `com.zukor.photonotes.dev`, displayed as Photo Notes Dev. Release is `com.zukor.photonotes.ai`, displayed as Photo Notes AI. Release has no fixture API or localhost service override. Debug-only flags are `PN_IOS_FIXTURE=1`, `PN_IOS_FIXTURE_OFFLINE=1`, `PN_IOS_FIXTURE_EDITION`, and `PN_IOS_TEST_SERVER=http://localhost:33087`.

The local API runner requires `PN_IOS_TEST_DATABASE_URL` and `PN_IOS_TEST_DATA_DIR`, verifies the live database's data directory before use, and is separate from the production startup path. The integration test additionally requires the dedicated `pn_ios_test` database on localhost port 55487. Never point this runner or test at a production database.

## Server release

`db.js` adds `mobile_capture_receipts`. `/api/me` advertises version 1 of the native upload contract. The iOS queue keeps photos locally if that contract is unavailable. The capture, evidence, HOA records, and receipt are committed together for native requests. Existing web requests continue using the existing route without a native receipt.

Apple notifications require server-side `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_TOPIC=com.zukor.photonotes.ai`. Development builds use `APNS_DEVELOPMENT_TOPIC`, defaulting to `com.zukor.photonotes.dev`, and Apple's sandbox delivery host. TestFlight uses production APNs. Keep the private key outside Git. Apple notifications remain unavailable until these settings and signing capabilities are configured; in-app issue updates remain available.

## Storage and recovery behavior

Capture data is stored inside the signed-in account's Application Support folder with iOS data protection and excluded from device backups. Uninstalling the application can remove it. Export needed local files first. Uploads resume while Photo Notes is open and connected; the app does not promise continuous background uploading after it is closed.

A photo and its metadata are saved before the capture form clears. Requests carry a stable capture ID and account binding. The server stores its reply in the same PostgreSQL transaction as the capture, so an interrupted response can be retried without creating another record. A removed or unauthorized edition blocks uploading instead of silently changing the record's meaning.

Local originals and recordings remain accessible under Account menu, On This iPhone. Storage management, large-export behavior, and interrupted-recording recovery still need final device verification. Some workflows, including AI processing and changing authorized versions, require an internet connection.

## TestFlight completion requirements

1. Finish simulator and physical iPhone acceptance checks after the Mac is unlocked.
2. Confirm Apple Developer membership and App Store Connect access, then provision the Release app ID and signing profile.
3. Configure and verify APNs delivery, including logout/account changes and tapping a notification after a cold start.
4. Deploy and verify the compatible backend after its review and tests pass.
5. Complete a signed Release archive, validate its privacy report and release metadata, upload to TestFlight, and verify build processing and tester access.

The TestFlight upload is not complete until Apple has processed the build and the intended testers can access it.

Detailed device acceptance and draft beta copy: [TESTFLIGHT_ACCEPTANCE.md](TESTFLIGHT_ACCEPTANCE.md).
