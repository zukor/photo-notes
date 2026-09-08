# Photo Notes AI iOS beta acceptance

Updated September 7, 2026. Delivery is TestFlight first. This is a release checklist, not a claim that the build has shipped.

## Current evidence

| Check | Result |
| --- | --- |
| Shared server and web tests | 191 passed, 3 opt-in tests skipped |
| Native queue tests | 8 passed |
| Isolated PostgreSQL transaction tests | Passed, including simultaneous retries, rollback and account boundaries |
| Debug simulator build | Passed |
| Unsigned iPhone Release archive | Passed; cannot be installed through TestFlight |
| Simulator photo selection | Limited-library selection worked; local photo survived restart |
| Location permission denied | Photo retained and explanation displayed |
| Apple distribution signing | Blocked: available team is classified by Xcode as a Personal Team |
| App Store Connect | Sign-in required |
| Further interactive testing | Paused while Mac is locked |
| Production backend deployment | Not performed |
| TestFlight upload and tester access | Not performed |

## Required device checks before inviting testers

Use synthetic photos and notes. Confirm every result on a signed iPhone build.

1. Sign in and verify that the version switcher lists only authorized editions. Check Basic, Pro, and each authorized industry edition. Switch accounts and confirm the previous account's photos and drafts are inaccessible.
2. Take a photo, choose a limited-access Photo Library item, and choose an image in Files. Deny permissions and confirm a useful recovery message. Confirm scrolling and keyboard access throughout Capture, including the Save controls.
3. Enter notes, select the relevant topic, job and photo reason, close the app, and reopen it. Confirm the photo, notes and context are restored. Repeat for Concrete Pro phases and Paving Pro reasons.
4. Disconnect the network, save several photos, restart, reconnect and confirm each capture uploads exactly once. Interrupt a request after saving on the server and repeat. Revoke edition access while a capture is queued and confirm it remains blocked and recoverable.
5. Record English and Spanish notes, stop, background the app, and simulate an audio interruption. Deny speech recognition and microphone permissions separately. Confirm retained audio can be exported and that a late transcript never enters another photo.
6. Open cloud photos, annotate a photo, and export a PDF and Word document. Use the native share sheet, cancel it, then share successfully. Test a large real-world report and printing.
7. Open Report Issue, view and mark up the screenshot, submit it, and verify its report ID and iOS build details in issue tracking. Repeat at different font sizes and orientations.
8. Enable issue notifications, receive a test update, and open the report from both a running and fully closed app. Disable notifications and switch accounts. Confirm notifications do not disclose another account's issue.
9. Recover and export photos and recordings from Account menu, On This iPhone. Test low storage, retained originals and recordings, and a failed export without losing the source.

## TestFlight setup and delivery

- Sign in with the Apple Developer team that has active membership and access to App Store Connect. The detected Personal Team cannot provide the needed push capability.
- Register or select `com.zukor.photonotes.ai`, enable push notifications, configure signing and create the App Store Connect app record.
- Configure the backend APNs key, team, key ID and production topic. Keep the private key outside the repository.
- Review the app privacy declarations against the actual backend processing and published privacy policy. Confirm the beta support contact, beta review login and export-compliance answers with the account owner.
- Deploy and verify the compatible capture receipt and issue-notification backend before device acceptance.
- Archive and validate a signed Release build, upload it, and wait for Apple processing. Complete any required beta review.
- Confirm the owner and Rolando can access the processed build through TestFlight. No invitation has been sent by this task.

## Draft beta description

Photo Notes AI starts with a photo and adds recorded or typed notes. This iPhone beta includes native camera and photo selection, local capture recovery, retry-safe uploads, native sharing and printing, and the existing authorized Photo Notes editions. Report Issue includes screenshot markup and build information.

For testing, focus on capturing and recovering photos, recording notes, switching authorized editions, offline saving, document exports, and reporting issues. Uploads resume while the app is open and connected. Keep important local originals exported before uninstalling the app.
