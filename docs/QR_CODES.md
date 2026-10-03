# Photo Notes QR Codes

## Delivered capability

Create / Manage QR Code appears on existing Property Manager and HOA asset records and shared saved-photo cards in Photo Notes Pro, Property Manager Pro, HOA Maintenance Pro, Concrete Pro, Paving Pro, General Contractor Pro and Roofer Pro. Basic, Issue Reporter and Road Issue Reporter have no QR controls or API access.

Scan an asset label, sign in if needed, and reopen its existing photo history. Add Photo at the top opens the existing condition-photo field. Review purpose, condition and note, then Add Photo to Asset History. The established asset-photo endpoint saves the relationship automatically. Selecting a photograph alone does not save it. Saved-note labels open Edit with the existing Photo Note selected and brought into view.

View a label, edit its short printed name and optional property name, download PNG, or print. Printed-text edits do not rename the record and are not saved label templates. Use non-sensitive label text. Disable closes the link. Reissue creates a new token and invalidates all older physical labels. Neither operation removes photographs or target records.

## Architecture and schema

`qr-codes-schema.sql` adds only `photo_context_qr`, indexed by `(target_type,target_id)`, with a unique random token, creator, disabled flag and update timestamp. Existing records and relationships are unchanged. There is no QR-specific photo history.

Tokens contain 32 cryptographically random bytes encoded as URL-safe text. `/qr/:token` redirects to the ordinary app with a pending QR context. The public route returns no record details. Every resolve, management and PNG request requires existing authentication, the current eligible Pro edition, and target authorization. Asset access matches the existing company membership context; saved notes require ownership. Deleted or inactive targets fail safely. Tokens are record locators, never authorization credentials. No external upload or permission grant is created.

The target adapter currently supports `asset` and `note`. Add future Area or Photo Set adapters only after their authoritative routing and authorization are integrated. There is no dependency on unfinished Areas or Photo Sets. Location Intelligence, Camera Readers, Photo Requests, mapping and pavement AI are unchanged.

## Files

New: `qr-codes.js`, `qr-codes-schema.sql`, `public/qr-codes.js`, `public/qr-codes.css`, `scripts/test-qr-codes-integration.cjs`, `scripts/test-qr-codes-browser.cjs`, this document.

Integration hooks: `db.js` loads the additive schema; `server.js` registers QR routes; `package.json` adds `qrcode`; `public/app.js` resumes scans, adds the shared card control and asset control/action; `public/index.html` loads QR resources; `public/sw.js` updates the shell and caches QR resources; `public/help-catalog.js` authors QR guidance and terms.

## Verification

- Standard suite: 299 passed, 17 optional tests skipped, zero failures.
- Disposable PostgreSQL and actual HTTP: all seven edition gates, excluded editions, unauthorized and cross-account/company scans, existing asset-history capture, PNG response, revoke/reissue and preservation of history.
- Chromium and WebKit at 390 and 1440 pixels: seven enabled editions, excluded controls, scan resume, existing asset history, camera chooser, editable labels, PNG download, print popup, reissue/revoke and no horizontal overflow.
- Help source coverage, complete Help, Admin Help, Property Manager/shared parity and all-edition Help.
- Physical-device checks remaining: print a label at intended size, scan using iPhone/Android system camera, test signed-out login and installed-app handoff, take/save a real asset photograph and rescan an old revoked label. Browser fixtures do not establish physical-device acceptance.

## Concurrent integration

The release was built from current GitHub main in an isolated checkout. The original shared working tree was preserved. Shared-file changes are the small integration hooks above, not copies of concurrent files. Reconcile these hooks when integrating Areas, Photo Requests, Location Intelligence or multi-photo capture. Preserve the QR scripts and cache entries, scan-resume call, shared card wiring, asset Add Photo action, route registration, schema load and authored Help. The shared checkout had unrelated Save/Help test failures; the QR-only release passed its full standard suite.
