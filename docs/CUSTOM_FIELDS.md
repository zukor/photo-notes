# Custom Fields

Custom Fields are user-entered metadata for individual Photo Notes. They supplement the photograph, normal notes and existing specialty data. They are not verified photographic evidence.

## Availability and permissions

Available in Photo Notes Pro, Paving Pro, Concrete Pro, Property Manager Pro, HOA Maintenance Pro, General Contractor Pro and Roofer Pro. No controls or definition/value APIs are enabled in Basic, Issue Reporter or Road Issue Reporter.

Definitions belong to the signed-in account owner. Existing authentication, current plan/edition checks and capture ownership checks authorize access. This does not create company-wide schemas or a new role system. Property and HOA team workflows remain unchanged.

## Definitions and values

Capture > Additional Details > Manage Custom Fields creates, renames, edits or deactivates a definition. Creation and definition changes require a connection. A definition has a stable UUID, name, type, optional prompt, optional/required setting, scope and active setting. Required is off by default. Type and scope are immutable after creation; deactivate and create another field to change them.

Supported types are Short Text, Number, Date, Yes / No and Choice. Zero and No are real values. Empty optional fields are omitted. Dates are stored as ISO dates and displayed as MM/DD/YYYY.

General scope applies within the owner's supported Pro editions. Edition scope applies in the selected Pro edition. Job and Property scopes are deferred to avoid concurrent architecture changes. There is no rules engine or Photo Set-level schema.

Additional Details is collapsed in Capture and stays above its action buttons. Values survive Capture rerendering and are included in the existing durable IndexedDB upload payload and FormData. Cached, account-specific definitions permit offline entry once loaded. Definition revisions are retained, so queued values remain valid after renaming, option changes or deactivation. Later definitions do not invalidate an older draft. Required validation applies to the definitions presented to that draft.

Photo Details & History displays completed values. Edit Additional Details saves value changes online and records before/after values in existing capture history. Active fields can be edited; deactivated values remain visible and unchanged. Unchanged historical choices remain valid even if removed from the current option list. A saved record retains its field ID, saved label, type, value and revision. No permanent definition deletion is supported.

Value edits update only `captures.custom_fields`. They do not alter original photo bytes, file fingerprint, receipt time, original GPS or specialty fields. Values are never automatically burned onto shared photo pixels. Annotation Templates remain unchanged.

## Search and output

Existing text search includes saved names and values, with readable Yes / No and date forms. Organize supports one simple Choice or Yes / No field filter combined with existing criteria. Archived fields and older choices remain searchable. Clear removes the Custom Field filter too.

Completed values appear in generic PDF, Word and Markdown/bundle output, document previews, Paving job reports, Concrete photo reports and HOA/Property photo maintenance reports. Values accompany their photograph and are labeled user-entered. Empty fields are excluded. Existing report engines and specialty data remain in place.

## Limits

- 12 active fields in General scope, and 12 in each Edition scope.
- Field Name: 60 characters.
- Description / Prompt: 300 characters.
- Short Text value: 250 characters.
- Choice: 1 to 12 unique options, each up to 60 characters.
- Capture payload: at most 36 submitted field entries, with duplicate and unknown IDs rejected.
- Number values must be finite. Dates and choices are validated on the server.

## Schema and files

Additive, idempotent startup migration adds `custom_field_definitions` with account ownership, UUIDs, scope, settings and retained revision snapshots; an owner index; and `captures.custom_fields JSONB NOT NULL DEFAULT '[]'`. Existing records require no user migration.

Feature modules: `custom-fields.js`, `public/custom-fields.js`, `public/custom-fields.css`.

Integration: `db.js`, `server.js`, `public/app.js`, `public/index.html`, `public/sw.js`, `public/help-catalog.js`, `public/admin.html`, `public/install.html`.

Verification: `test/custom-fields.test.js`, `test/help-coverage.test.js`, `scripts/test-custom-fields-browser.cjs`, `scripts/test-custom-fields-integration.cjs`, `scripts/test-custom-fields-app.cjs`.

## Verification and remaining boundaries

Unit and real PostgreSQL/HTTP checks cover type validation, ownership, scope, seven Pro gates, three exclusions, field limits, history, old choices and offline revisions. The actual app fixture checks startup migrations, Capture upload/rollback, search/filter, Photo Details, unchanged original evidence, PDF/Word output and Property maintenance reports. Chromium and WebKit checks cover every supported edition at 320, 390 and 1440 pixels, dynamic authored Help, required values, zero/No, editing, draft rerenders and IndexedDB/FormData preservation. Required global Help and Property Manager regression checks also run.

Use dedicated disposable databases only for integration fixtures. `CUSTOM_FIELDS_TEST_DATABASE_URL` must point to `pn_custom_fields_test`; `CUSTOM_FIELDS_APP_TEST_DATABASE_URL` must point to `pn_custom_fields_app_test`. Fixtures reset those databases and never use production data or paid providers.

Remaining boundaries: no Job/Property scopes, company-shared definitions, complex filters, offline definition/value edits, inactive-field value correction, Annotation Template integration, Capture Template prefill integration or Photo Set fields. Physical-device acceptance remains separate from browser verification. Deployment and live verification results are recorded in the task completion report.
