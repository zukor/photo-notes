# Export Presets

Export Presets are versioned document settings saved on each user's account. They contain no photograph membership, report evidence records, destinations, Word templates or annotation templates.

## One set of document settings

There is one set of document settings with three layers:

1. Account defaults, saved on the `users` row next to the existing account branding: layout options (`document_layout`, NULL until first saved), company name, header and footer (`document_branding`), the logo (`document_logo_path`) and an optional default Word template (`default_template_path`). New Document setup's Save as Default writes these. The document page's Save as Account Default writes the branding text.
2. Saved presets are the Export Presets in this file. New Document setup, the document page and Send all list the same presets. A preset holds every document layout option plus branding text, logo use, format and image quality.
3. Each document keeps its own layout (`groups.layout`), its own Word template (`groups.word_template_path`) and, optionally, its own company name, header and footer. Blank document values follow the account branding in the preview, PDF and Word. Values equal to the account branding are stored blank so the document keeps following it.

A new document copies the layout from the chosen preset or the account defaults, and receives its own copy of the account default Word template, so later default changes never alter existing documents. Branding text and the logo stay live: a document without its own text uses the current account branding.

New Document presets and defaults used to live only in browser storage (`pn-document-presets-<user>`, `pn-document-default-<user>`). The first time Create, a document page or Send loads, the client copies them to Export Presets with their names (the saved default becomes "New Document Defaults"), skips copies that already exist with the same settings, adds " (New Document)" when a different preset already uses the name, and fills account defaults that were never saved. The browser copies are removed only after every copy succeeds, so an interrupted move is retried.

Document captions are stored per document in `group_items.caption`. NULL means the document shows the photo's own note. Exports and the preview use the document caption when set; Use Photo Note clears it.

## Availability and workflow

Available in Photo Notes Pro, Paving, Concrete, Property Manager, HOA Maintenance, General Contractor, and Roofer Pro. Basic, Issue Reporter and Road Issue Reporter are excluded on the client and API.

Use Export Preset appears in New Document setup (as Document Settings Presets), on each document page, in Send, and the Photo Library's Export Presets panel. The Photo Library provides access in HOA and Property without changing specialty navigation. Choose No preset to restore saved document settings, or the entry defaults for selected-photo packaging. The optional default is selected on entry. Download Using Preset uses the chosen format. Existing explicit PDF/Word actions continue to select their stated format.

Save as Preset copies the current controls. Name is required, Description optional. Edit / Rename, Duplicate and Delete manage the user's own entries. Adjust Output Settings applies temporary settings without changing the saved preset or document. Deleting a preset keeps documents and photos. Save Layout, Save for This Document and Save as Account Default remain the explicit persistence actions on the document page.

## Supported configuration, version 1

- Formats: PDF, Word (`docx`), Markdown + Photos (`bundle`).
- Layout: document type, orientation, photos per page (1 to 6, including vertical and horizontal 2 and 3), cover, header, footer, page numbers and their position, typefaces including Helvetica, and accent color.
- Branding: company name, header/footer text and use of the current account logo. Logo files are not copied or stored in presets.
- Image resolution: Standard, maximum 2048 px and JPEG quality 85; Print, 3000 px and quality 92; Web, 1400 px and quality 80. Smaller originals are never enlarged. Existing renderer preserves markings.
- Photo titles, notes, dates, location, topics and available evidence details retain their existing exporter behavior. There are no existing per-field inclusion controls to copy into presets.

Markdown + Photos uses image quality and its existing metadata output; document layout and branding do not apply. Imported document Word templates retain their own presentation and stay with their document. Existing JPEG embedding is retained; full-resolution/original/WebP choices are not newly exposed.

## Persistence and compatibility

`export_presets`: ID, user ID foreign key, name, description, JSONB configuration, default flag, creation time. One partial unique index enforces at most one default per user. Writes lock the user within a transaction; all reads, updates and deletes include user ownership. The authenticated API rejects excluded editions, and mutation requests require the application header.

Configuration is sanitized into version 1 with supported enum/boolean/text values. Unknown settings and newer versions produce visible warnings. Unavailable values fall back to existing defaults. A missing current logo is omitted. Ad hoc output overrides are sanitized through the same module. No existing documents or shortcuts are migrated; only New Document settings kept in browser storage are copied, as described above.

Specialty paving/proposal, Concrete evidence, HOA and Property reports remain on their existing engines. They have fixed presentation and no compatible shared document configuration. Their photos can use the shared library output without changing specialty evidence or report logic. Send Shortcuts keep their existing destinations, formats, delivery behavior and ownership; there is no automatic shortcut-to-preset reference yet. Native sharing and temporary links retain their existing behavior.

## Files and verification

Implementation: `export-presets.js`, `db.js`, `server.js`, `public/export-presets.js`, `public/app.js`, `public/index.html`, `public/sw.js`, `public/help-catalog.js`.

Tests: `test/export-presets.test.js`, `scripts/test-export-presets.cjs`, `scripts/test-export-presets-output.cjs`, and the existing `test/web-app-readiness.test.js` offline-shell check. Integration scripts use only named disposable local PostgreSQL databases. Browser checks cover Chromium and WebKit, all seven Pro editions at phone/desktop widths, account isolation, defaults, CRUD, temporary overrides, excluded editions, document controls and authored Help. Existing shared workflow, Property parity, all-edition Help and Send Shortcut checks remain required.

Physical-device acceptance and team/company sharing are outside this implementation. Presets require an online connection for management and output, consistent with the existing export workflow.

The preset shell uses an additional cache namespace and an additive build query for app/Help catalog assets. The served index applies the same query. Installation reloads these resources, refreshing the four-hour HTTP cache while preserving shared asset version counters used by concurrent releases.
