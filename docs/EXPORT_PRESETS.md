# Export Presets

Export Presets are versioned, user-owned packaging defaults. They contain no photograph membership, report evidence records, destinations, or annotation templates.

## Availability and workflow

Available in Photo Notes Pro, Paving, Concrete, Property Manager, HOA Maintenance, General Contractor, and Roofer Pro. Basic, Issue Reporter and Road Issue Reporter are excluded on the client and API.

Use Export Preset appears in shared Create document setup, Send, and the Photo Library's Export Presets panel. The Photo Library provides access in HOA and Property without changing specialty navigation. Choose No preset to restore the configuration present when entering the workspace. The optional default is selected on entry. Download Using Preset uses the chosen format. Existing explicit PDF/Word actions continue to select their stated format.

Save as Preset copies the current controls. Name is required, Description optional. Edit / Rename, Duplicate and Delete manage user-owned entries. Adjust Output Settings applies temporary settings without changing the saved preset or document. Deleting a preset keeps documents and photos. Save Layout and Save Branding Text remain the existing explicit persistence actions.

## Supported configuration, version 1

- Formats: PDF, Word (`docx`), Markdown + Photos (`bundle`).
- Layout: one/two photographs per page, cover, header, footer, page numbers, existing typefaces and accent color.
- Branding: company name, header/footer text and use of the current account logo. Logo files are not copied or stored in presets.
- Image resolution: Standard, maximum 2048 px and JPEG quality 85; Print, 3000 px and quality 92; Web, 1400 px and quality 80. Smaller originals are never enlarged. Existing renderer preserves markings.
- Photo titles, notes, dates, location, topics and available evidence details retain their existing exporter behavior. There are no existing per-field inclusion controls to copy into presets.

Markdown + Photos uses image quality and its existing metadata output; document layout and branding do not apply. Imported document Word templates retain their own presentation and per-document ownership. Existing JPEG embedding is retained; full-resolution/original/WebP choices are not newly exposed.

## Persistence and compatibility

`export_presets`: ID, user ID foreign key, name, description, JSONB configuration, default flag, creation time. One partial unique index enforces at most one default per user. Writes lock the user within a transaction; all reads, updates and deletes include user ownership. The authenticated API rejects excluded editions, and mutation requests require the application header.

Configuration is sanitized into version 1 with supported enum/boolean/text values. Unknown settings and newer versions produce visible warnings. Unavailable values fall back to existing defaults. A missing current logo is omitted. Ad hoc output overrides are sanitized through the same module. No existing documents or shortcuts are migrated.

Specialty paving/proposal, Concrete evidence, HOA and Property reports remain on their existing engines. They have fixed presentation and no compatible shared document configuration. Their photos can use the shared library output without changing specialty evidence or report logic. Send Shortcuts keep their existing destinations, formats, delivery behavior and ownership; there is no automatic shortcut-to-preset reference yet. Native sharing and temporary links retain their existing behavior.

## Files and verification

Implementation: `export-presets.js`, `db.js`, `server.js`, `public/export-presets.js`, `public/app.js`, `public/index.html`, `public/sw.js`, `public/help-catalog.js`. Help cache references also change in `public/admin.html` and `public/install.html`.

Tests: `test/export-presets.test.js`, `scripts/test-export-presets.cjs`, `scripts/test-export-presets-output.cjs`, and the existing `test/help-coverage.test.js` entry-point version check. Integration scripts use only named disposable local PostgreSQL databases. Browser checks cover Chromium and WebKit, all seven Pro editions at phone/desktop widths, account isolation, defaults, CRUD, temporary overrides, excluded editions, document controls and authored Help. Existing shared workflow, Property parity, all-edition Help and Send Shortcut checks remain required.

Physical-device acceptance and team/company sharing are outside this implementation. Presets require an online connection for management and output, consistent with the existing export workflow.
