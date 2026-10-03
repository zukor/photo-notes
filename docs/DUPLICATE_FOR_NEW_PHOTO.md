# Duplicate for New Photo

The shared saved-photo action opens a separate Capture with safe context. Copy Notes is off by default. A new photograph is required before saving. No source record is edited.

## Copied context

- All supported Pro editions: first Topic and owned Job/project, editable before saving.
- Paving: ordinary proposal-photo workflow. Scanner and alignment reasons are not inherited.
- Concrete: project phase, photo purpose, project type and Job/project.
- Property Manager and HOA: available community/property, maintenance category and record type. Priority starts at Routine and a new maintenance record follows the normal save flow.
- General Contractor and Roofer: general Topic and Job/project only.
- Notes: copied only after deliberately selecting Copy Notes.

Basic, Issue Reporter and Road Issue Reporter expose no action.

## Evidence and location safeguards

The implementation constructs an allowlisted context object rather than cloning a Capture. It clears the previous Capture draft's file, preview, location/address promises, quality state, measurements and share-save reference. The normal new-photo flow acquires location and the normal upload computes a new fingerprint, receipt, timestamp and evidence record. The source is unchanged.

No photograph, fingerprint, timestamp, GPS, derived address, evidence history, AI analysis, measurements, findings, annotations, title, Before/After, Related Photos, Photo Set, Favorite/Flagged, approval, completion, maintenance history or submission information is inherited.

The server requires a new photo for context reuse and records a separate `context_reused` history event on the new record only after verifying source ownership. This is provenance, not a relationship. If the source has been deleted or is no longer owned at upload, the new photograph still saves without a provenance event.

## Offline behavior

Starting from an already loaded source needs no network request. Saving uses the existing account/edition-scoped IndexedDB pending queue, including provenance and newly selected photo bytes. Normal retry and upload confirmation rules apply. Local save and confirmed server upload remain distinct.

## Integration boundaries

Location Intelligence, Capture Templates, readers, AI, requests, monitoring, Before/After, incidents, QR codes, Photo Sets, Related Photos and markers are not modified. An active incident workflow must be exited before starting a duplicated Capture.

Property Areas is not yet present on the current main baseline. The allowlist supports a source Area, and the shared workspace's existing Area control receives its selected value, but deployment of that separate feature remains its owner's responsibility. No Area schema or workflow is introduced here. Only the first Topic is preselected because Capture currently accepts one Topic.

## Files

`public/duplicate-context.js`, `public/app.js`, `server.js`, `public/help-catalog.js`, `public/index.html`, `public/sw.js`, `test/duplicate-context.test.js`, `scripts/test-duplicate-context.cjs`, `scripts/test-duplicate-evidence.cjs`, and this report.

## Validation

Allowlist tests cover all seven supported and three excluded editions, plus explicit Notes opt-in. Real disposable local PostgreSQL/HTTP uploads verified distinct records, file paths, SHA-256 fingerprints, timestamps, independent location/history, unchanged source evidence, server photo requirement and source ownership. Browser fixtures exercise the actual shared Capture in Chromium and WebKit at phone and desktop widths, including pending IndexedDB saves. Standard, authored Help and all-edition/property parity checks run before release.

Physical-device acceptance remains unverified. Production checks use read-only health, release, served assets and UI, without creating customer records.
