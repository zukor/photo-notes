# Photo Notes web-app readiness

Updated September 7, 2026. Web build 193. Testing manager: Rolando.

Native app development is stopped. The native branch is retained separately and none of its Apple signing, native notifications, or application packaging is part of this web release.

## Delivered changes

- Installation help is always available in Account menu, Install Photo Notes, and at `/install.html`. Instructions cover iPhone/iPad Safari, Android Chrome, Mac Safari, and Windows Edge/Chrome. Customers use the same account and authorized versions.
- The manifest has an explicit app identity and scope. The offline cache deduplicates asset URLs before installation and does not return an HTML page when a missing JavaScript asset fails to load.
- Every regular Capture Save waits for the IndexedDB transaction to commit before clearing the form. Double taps are suppressed. A failed local save retains the photo and notes on screen.
- Pending captures store photo bytes, notes, account binding, version and a stable request ID. Byte storage avoids a File/Blob transaction failure reproduced in the WebKit browser engine.
- Account menu, Pending Photos shows the current account's local pending captures, their versions, original-photo download and notes/details download. Older records with no account metadata are retained and withheld from automatic upload.
- Uploads re-check the signed-in account, bind each request to that account, validate current version access, and use a server transaction receipt. The capture, evidence, applicable HOA records and receipt commit together. A lost response can be retried without creating another capture. Database queries stay on the transaction connection so concurrent retries cannot exhaust the pool while waiting for a second connection.
- Local-save and upload-confirmation messages are distinct. Permanent failures remain pending for review rather than retrying indefinitely. Sign-in connection errors have an actionable message.
- Report Issue records the reporting web build and whether it was opened as an installed web app or browser page. Its existing screenshot markup and tracking remain in use.

## Automated evidence

| Check | Result |
| --- | --- |
| Shared regression suite | 197 passed; 3 opt-in tests skipped |
| Dedicated PostgreSQL integration | 5 passed on a fingerprint-checked disposable database |
| Sixteen concurrent retries of the same capture | One committed capture and one receipt |
| Failed receipt transaction | Capture rolled back; retry succeeded |
| Account and edition mismatch/revocation | Rejected; original local capture retained |
| iPhone-sized WebKit | Login, upload, API outage/reopening, lost-response retry, guides, share preview/cancel, screenshot arrow markup, submission and tracking passed |
| Android-sized Chromium | Same checks with full offline simulation and cached reopening passed |
| Mac-sized WebKit | Same API-outage checks passed |
| Windows-sized Chromium | Same full offline checks; PDF and Word export signatures and payloads passed |
| All eight authorized editions | Version switching, Capture rendering and phone-width overflow checks passed |

These are automated browser-engine tests on this Mac, not installation or hardware tests on four operating systems. The industry-edition checks cover switching and rendering, not every specialized scanner, measurement or report workflow.

The WebKit test runner's offline switch made local files unreadable even in a minimal reproduction outside Photo Notes. Its connection tests therefore block API requests with service workers disabled. Chromium tests use full offline mode and the service worker. Real iPhone airplane-mode behavior still needs a physical-device check.

Live deployment and route verification are recorded in the delivered release checklist. A passing local test is not proof that production or a physical device passed.

## What requires a real device

All physical installation, icon reopening, actual camera capture, English/Spanish microphone recording, OS share sheets and web-push receipt/tap checks remain unverified. The Mac was locked during this task, so its interactive browser/app installation could not be checked. Android and Windows hardware were not available for direct verification.

## Scope and limitations

- The durable queue covers the regular Capture page Save workflow. Road Issue Reporter, ticket/readers, scanning, AI processing and other specialized submissions can require a connection and do not inherit this queue automatically.
- Reopening while offline can require reconnecting before sign-in and upload resumption. No offline identity is invented and no other account's data is automatically adopted.
- Uploads run while Photo Notes is open. Closing the browser is not a promise of continuous background upload.
- Local data belongs to that browser/web-app storage. Private browsing, clearing site data, uninstalling, storage eviction or losing the device can remove it. Download needed backups and confirm uploads first.
- Old unlabeled captures cannot be attributed safely. They are retained for supervised recovery from the original account, not reassigned to whoever signs in next.
- Browser/API tests did not send messages to people, make paid AI calls, change customer records or activate issue-repair workers. The test server blocks external requests.

## Reproduce verification

```sh
npm ci
npm test
```

For PostgreSQL tests, set `PN_WEB_TEST_DATABASE_URL` and `PN_WEB_TEST_DATA_DIR` to the dedicated test database and its actual data directory, then run `node --test test/web-capture-integration.test.js`. The guard requires localhost port 55487, database `pn_ios_test`, and a matching live data-directory fingerprint. This deliberately reuses the isolated development test database, not production.

For browser checks, install Playwright's Chromium and WebKit runtimes, start `node scripts/web-test-server.cjs` with the same guarded environment, and run `npm run test:web-browser`. The server listens only on localhost port 33088. Browser results and screenshots are written to `/tmp/pn-web-browser`. The test account is synthetic. Do not point the acceptance runner at a live service.

## Rolando's release checklist

Record device model, OS version, browser version, edition, tester, date, result, and Report Issue ID for every failure. Use Pass, Fail, Blocked or Not tested. Never mark an unperformed test as Pass.

1. Install from the official device instructions. Open the icon, sign in, close it completely, and reopen. Confirm the intended app name, icon, page layout and account.
2. Confirm Basic and Pro appear first when authorized, with the other authorized editions alphabetized. Verify the logo does not overlap the switcher and no unauthorized edition is offered.
3. Take a new camera photo, select a library photo, deny location permission, retry location, retake and cancel. Confirm the correct photo and useful permission messages at each step.
4. Record English and Spanish notes. Stop, pause, receive an interruption and deny microphone permission. Confirm text belongs to the current photo and a useful fallback is offered when speech recognition is unavailable.
5. Save a photo with typed notes and relevant topic/job. Confirm local saving first, then upload confirmation. Tap Save twice quickly and confirm one result. Close/reopen and verify through the edition's available saved-photo or document workflow.
6. With the app already open, disconnect, capture and Save. Open Pending Photos and download an original plus notes backup. Reopen while disconnected, reconnect, sign in if asked, and confirm one uploaded capture. Repeat during a weak/interrupted upload. Do not clear browser storage during this test.
7. Queue a capture in one edition, switch editions and confirm it is not uploaded as the other edition. Switch back and retry. Sign out and use a second test account; confirm the first account's pending content is not shown or uploaded under the second account.
8. Check Concrete Pro proposal, work-in-progress, completion and follow-up contexts. Check Paving Pro reasons, ticket/scan tools and the normal proposal flow online. Check the remaining industry features that will be advertised to customers.
9. Edit a photo, build a photo document where authorized, download PDF and Word, and use the real OS share sheet. Cancel sharing once and complete a separate share with an explicitly approved recipient. Confirm notes, photos and layout survive export.
10. Open Report Issue. Confirm the whole screenshot can be viewed, add/move/delete an arrow or text, retake the screenshot, and submit. Record the ID. Verify My Issue Reports and the manager's tracking view show the same report and web build 193.
11. Enable issue updates on a supported installed web app. With an approved test issue, verify notification receipt, tap-to-open and sign-out behavior. Actual notification delivery is not covered by local API tests.
12. Retest every fixed issue on the device that failed. Rolando records the evidence and remaining blockers before recommending customer release.

Physical-device status for iPhone, Android, Mac and Windows: Not tested in this task. These rows must be completed before claiming those devices fully verified for sale.
