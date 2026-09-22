# Windows Word and ZIP sharing, issue 84

Windows Chromium's native Web Share file allowlist excludes DOCX and ZIP. Changing MIME types or repeating Share does not remove that restriction.

In Send, choose the document format, Share, then Create share link. This uploads an immutable copy of the already-generated file. Copy link works with Teams, WhatsApp, or email; Share link invokes the system's URL share menu where available. No app sends a message automatically. The recipient downloads the original format without signing into Photo Notes.

The dialog explains before creation that anyone with the link can download the file. Links expire after seven days. Send > Shared document links lists active links and allows the owner to copy or revoke them. Revocation removes the snapshot immediately. Expired snapshots are removed hourly. Disabling or deleting the owner also disables download access. Revocation cannot remove copies already downloaded by recipients.

Files are stored in PostgreSQL, outside public uploads. Links use random 256-bit tokens, owner-scoped administration, attachment-only responses, and no-store/no-referrer/noindex headers. The service worker excludes these downloads. Requests require authentication and a custom write header. Limits: 20 MB per file and 20 active links or 100 MB per account, checked transactionally.

English and Spanish labels are included. Windows Chromium DOCX/ZIP takes the link path even if canShare incorrectly reports support. Other browsers retain native sharing and get the link alternative if it fails. PDF and normal downloads remain available.

Verification:
- Standard npm test suite.
- PN_DOCUMENT_LINKS=1 node --test test/document-links.integration.test.js uses only the guarded disposable PostgreSQL database on 127.0.0.1:55489.
- Exact bytes from real PDF/DOCX/ZIP export routes, anonymous recipient download, owner isolation, revoked/expired links, inactive account protection, quotas, and authenticated creation.
- Chromium with Windows user agent and WebKit, desktop English/mobile Spanish: create, copy, URL share, management, revoke. Native share and clipboard are simulated in browser tests; actual Teams/WhatsApp/Windows acceptance remains a tester retest.
