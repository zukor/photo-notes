# Photo Requests

Implemented locally. Not deployed. Production migration and physical-device acceptance are outstanding.

## Capability

Request Photos opens one shared screen in Photo Notes Pro, Property Manager Pro, HOA Maintenance Pro, Paving Pro, Concrete Pro, General Contractor Pro, and Roofer Pro. Basic, Issue Reporter, and Road Issue Reporter have no entry point and their authenticated request APIs return 403.

A request has a title, optional recipient name, instructions, 1 to 8 custom view names, optional related Photo Note/job/maintenance record, expiration, and an explicit Allow partial submissions setting. The default expiration is 14 days, with a simple 1 to 30 day choice. No account is needed to submit. Creation saves a request, not a delivered message. Copy Request Link and supported device sharing let the user send it themselves.

Recipients see sender/account and available company context, title, instructions, views, and expiration. Each missing view has camera and existing-photo selection, preview, replacement, and an optional note. A selected image is distinguished from a received image. All missing views must be supplied together unless partial submissions were explicitly enabled. A partial receipt keeps missing views available. Previously received views cannot be replaced through the public link.

## Existing infrastructure reused

`external-photo-submission.js` shares the existing Multer/disk upload approach and upload directory, 192-bit cryptographic token format, normal `captures` records, `capture_evidence`, SHA-256 fingerprinting, `capture_history`, `hoa_item_photos`, maintenance history, and team notifications.

Existing `/completion-photos/:token` links and `hoa_completion_photo_requests` remain compatible. Their submission handler now uses the shared upload/photo/evidence helper, image validation, file cleanup, transaction, and a row lock. It still expires after 14 days, closes after submission, adds `completed_work` photographs, and notifies the team. Request completion never marks maintenance work completed.

Generalized Photo Requests add request/view records and a recipient page, without introducing a separate photo store or delivery service.

## Schema and initialization

`db.init()` applies `photo-requests-schema.sql` after the existing schema. It adds:

- `photo_requests`: owner, private token, original edition, request text, ordered views, partial flag, optional associations, expiration, status, and timestamps.
- `photo_request_photos`: request/view mapping, normal capture ID, submitter name, per-photo note, original filename, and receipt timestamp. Unique request/view and capture constraints prevent duplicate view receipts.
- `photo_request_history`: created, link_created, submission_received, completed, cancelled, and expired events.
- An owner/date index.

No existing table columns are replaced. Foreign keys retain normal capture/job association behavior and user deletion cascades. A deleted Photo Note leaves submission history and original filename, with its capture reference cleared. Deleting a related Photo Note/job clears that association. Deleting the related maintenance record deletes its request. Existing normal photo deletion controls still apply.

Expiration is enforced at every public read and submission. Expired status/history is materialized on request reads, rather than by a new scheduler.

## Security and evidence

Authenticated operations require an eligible current edition and exact request owner. Related captures/jobs require ownership; maintenance records require the correct edition and company membership. Public bearer links disclose only this request's presentation fields and received-view indexes. They expose no library, unrelated request, internal record IDs, or normal authenticated operations.

Tokens use 24 cryptographically random bytes. Public responses disable caching, search indexing, and referrer forwarding. Anyone possessing the link can submit to that request while it remains open. Recipient names are descriptive, not identity verification.

Uploads are limited to 8 files and 25 MB per file, with bounded multipart fields. Actual image decoding checks JPEG, PNG, WebP, or HEIC support. Filenames are cryptographically random, use validated format extensions, and preserve the submitted original filename separately. All file inspections settle before cleanup, including mixed valid/invalid uploads. Invalid/closed/duplicate/failed submissions remove their files.

Submission, capture/evidence creation, view mapping, history, status, and maintenance notifications commit together. The request row lock serializes concurrent submission and cancellation. Every requested view completes the request; a completed, expired, or cancelled link cannot submit again.

Normal evidence records preserve original bytes, byte count, original filename, and SHA-256. The shared annotation/crop infrastructure retains its existing original-preservation behavior. Fingerprints identify bytes, not the truth of a scene, submitter identity, location, or photograph date. Submission timestamps are server receipt times. No new GPS, maps, Location Intelligence, AI classification, OCR, or Camera Reader functionality was added. Available embedded metadata remains in the original image bytes.

## Receiving and statuses

The owner sees request status, count of received views, per-view Received/Missing, submitter, receipt timestamp, filename, notes, and request history. Open Photo Note selects and focuses the received photograph in the existing Edit/library workflow.

Returned images are ordinary captures belonging to the requesting user. They support existing organize, annotation, comparison, document, export, and report tools where available. Selected related jobs and available related-photo topics are inherited. Maintenance associations add inspection evidence, while legacy completion links retain completed-work evidence.

Statuses:

- Open: no views received.
- Partially Submitted: some views received with partial submission enabled.
- Completed: all views received; link closed.
- Expired: expiration reached; link closed.
- Cancelled: owner closed an open/partial request.

General Pro uses persistent request status/history with Refresh Requests. HOA/Property use existing team notifications for linked maintenance submissions. Broader general notifications remain separate future work.

## Changed files

New:

- `external-photo-submission.js`
- `photo-requests.js`
- `photo-requests-schema.sql`
- `public/photo-requests.js`
- `public/photo-request.html`
- `public/photo-request-recipient.js`
- `public/photo-requests.css`
- `test/photo-requests.test.js`
- `scripts/test-photo-requests-integration.cjs`
- `scripts/test-photo-requests-browser.cjs`
- `docs/PHOTO_REQUESTS.md`

Integration edits:

- `db.js`: additive schema initialization.
- `server.js`: route registration and shared legacy completion submission handling.
- `public/app.js`: gated entry point, shared screen dispatch, and normal photo opening.
- `public/index.html`: shared script and stylesheet.
- `public/help-catalog.js`: authored control instructions and Key Terms.

These integration files already contain concurrent changes. Their full Git diff is not attributable to Photo Requests.

## Validation

Passed:

- `node --test test/photo-requests.test.js`: edition gates, custom views, expiration limits, required/partial receipts, and token structure.
- `scripts/test-photo-requests-integration.cjs` against isolated local PostgreSQL: real schema, owner isolation, public data isolation, required/partial views, corrupt/mixed image cleanup, concurrent submission, closed/expired/cancelled links, metadata/fingerprints, normal library records, document inclusion, inherited job/topics, maintenance attachments/notifications, and legacy HOA and Property completion links and expiration.
- `node scripts/test-photo-requests-browser.cjs`: Chromium and WebKit, 390 and 1440 pixels, all seven eligible editions and excluded editions, creation, dynamic Help, receipt details, recipient selection/preview/replacement, required-view validation, and successful receipt.
- `npm run help:check`.
- `npm run test:help`.
- `node scripts/test-property-global-parity.cjs`, including `test-all-edition-help.cjs`: all-edition shared screens at 320, 390, and 1440 pixels, plus existing Property/Location regression fixtures.
- Live Chromium end-to-end test with actual HTTP/PostgreSQL: owner creates a request, a separate account-free mobile context uploads both views, the owner sees completion and evidence, and Open Photo Note selects the normal library record. Enable this with `PN_REQUEST_BROWSER=1` on the integration script.
- JavaScript syntax checks and visual inspection of new phone/desktop screens.

The latest standard `npm test` run reports 307 passed, 2 failed, and 15 skipped. Remaining failures are the Capture dictation/save source expectation in `test/capture-voice-lifecycle.test.js` and a Help asset-version mismatch across existing entry points in `test/help-coverage.test.js`. Earlier Capture/Save failures changed during concurrent edits. These concurrent paths were left untouched. This is a release blocker, not a passing full regression claim.

Edition/browser fixtures use mocked APIs; server/integration tests use actual local PostgreSQL and HTTP requests, including a live Chromium end-to-end browser run. Neither proves production deployment or physical-device behavior.

## Remaining acceptance and limits

- Resolve the standard-suite failures and integrate current main before release. No deployment, production migration, push, or PR was performed here.
- Physical iPhone/Safari and Android/Chrome: camera permission, actual camera/library choice, orientation, HEIC decoder compatibility, large images, poor connections, replacement, and return to partial links.
- Actual device Copy/Share behavior, including desktop Safari/Chrome and Windows Chrome/Edge. Confirm delivery in the sending application separately.
- Production database migration, durable uploads, authenticated live app, and actual management-team notification acceptance.
- At most 8 named views, one received photograph per view, up to 25 MB each. Individual optional views, post-receipt replacement, reminder scheduling, verified recipient identity, direct email/SMS, and broad general notification work are future enhancements.
- Owner history lists the latest 200 requests. Public links are online workflows; there is no offline/resumable multipart upload.
- HEIC availability depends on the installed server decoder. An unsupported image produces an error and does not complete the request.
- A lost network response after a successful commit may require the recipient to reopen the link; a completed request will be closed. The owner can confirm receipt in history.
- Uploaded photos follow the app's existing randomized upload-path serving model. The request page itself does not disclose submitted-photo paths.

Likely merge conflicts are `public/app.js`, `public/index.html`, `public/help-catalog.js`, `server.js`, and `db.js`, shared with concurrent Location Intelligence, Camera Reader, AI audit, and Property Manager cleanup work. Preserve their latest changes and the new request integration points; do not replace whole files from older branches.

## Integration candidate, October 3

Scoped candidate built from main e81a700, retaining released QR, Duplicate for New Photo, Concrete Visual Analysis, internal Comments, Location Intelligence, Bulk Edit and shared readers. The previously recorded shared-checkout failures were resolved before this candidate: 347 standard tests pass, 17 optional tests skipped. Real PostgreSQL/HTTP ownership, token expiry/revocation, receipts, concurrent submission, invalid-image cleanup and legacy completion links pass. Request browser fixtures pass across seven eligible Pro editions and three excluded editions at 390/1440 in Chromium/WebKit. Main Help cache assertions now validate common asset URLs dynamically, including the public recipient page. Full Help and all-edition release checks are pending; no production publication is established yet.
