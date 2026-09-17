# Pro retest repairs, September 17, 2026

Release changes validated below. Tester confirmation is tracked separately from automated verification.

- Saved annotations now appear in photo cards and document previews using the authenticated marked-image renderer. Editors retain the original image plus editable annotations. Save failures retain the draft, restore the button, and block downloading an older marked copy.
- Clear resets every search filter. Request sequencing prevents an older search from replacing the latest result.
- Crop creates a new photo URL and persists it with its dimensions and original backup, avoiding stale images after reopening.
- Preview and PDF/Word include capture date, topics, address and GPS. Word retains photo aspect ratio and page breaks; two-photo layouts use vertical placement consistently.
- Word template validation recognizes placeholders split across Word runs. Insertion preserves paragraphs before and after the content marker, remaps image relationships and content types, and does not silently discard an unavailable template.
- Unsupported native sharing keeps a fresh-tap Download action for Word/ZIP and explains attaching the file in Teams. Native sharing errors retain retry/download actions.

Validation: 206 standard tests passed, 7 optional tests skipped. A separate disposable PostgreSQL integration test passed, including Chromium and WebKit save/reopen, marked-image pixels, crop persistence, PDF text extraction, Word metadata in both layouts, and split-run template upload/export. Rendered and visually inspected all seven Word pages across one-photo, two-photo, and imported-template samples, plus both pages of the two-photo PDF. A long-caption regression confirms that later photos cannot overwrite caption text. Tests used synthetic data only.

Commands: `npm test`; `PN_PRO_RETEST=1 node --test test/pro-retest.integration.test.js` after creating the guarded disposable database at `/tmp/pn-pro-retest/db`, port 55489, database `pn_pro_retest`.

Remaining tester acceptance: the testers' original attachments and exact failure cases, Windows Chrome/Edge with actual Teams and Word/ZIP attachments, physical-device crop gestures, and additional customer templates. The preview represents the built-in layout; it does not render the imported Word template's full design. No external messages or production data changes were made.
