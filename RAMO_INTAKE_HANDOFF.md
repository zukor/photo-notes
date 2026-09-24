# Concrete Pro to Ramo intake

Concrete Pro > Organize > select 1-20 photos > Send to Ramo Optimizer. Review each caption, add a title and optional group description, then send the group. The job and change order are selected in Ramo. One send remains one intake item.

Server-only configuration: RAMO_INTAKE_TOKEN. Sending is permitted for configured super-admins or explicit RAMO_INTAKE_ALLOWED_USER_IDS. The browser never receives the token. There is no project or financial lookup.

Receiver: https://ramo-optimizer.up.railway.app/api/project-delivery/photo-notes-intake, agreed schemaVersion 1.0. POST /submissions creates or replays a stable manifest. PUT /submissions/:intakeId/files/:attachmentId stores original bytes. POST /submissions/:intakeId/complete must return the matching submission/intake IDs, received status, a valid receipt timestamp, and exact attachment count. Only this receipt marks the sender received.

Limits: 1-20 photos, 20 MiB each, 100 MiB total, title 240 characters, description 50,000, each caption 20,000. JPEG, PNG, WebP, HEIC, HEIF. Group description or at least one caption is required. The API validates ownership, original fingerprints when available, file signatures, and all limits before creating a submission.

Persistence: ramo_intake_submissions stores the immutable manifest, browser request ID/hash, status, and receipt. ramo_intake_files stores original file snapshots as BYTEA. This preserves retry bytes across source edits/deletion, page close, process restart, and deployments. Account deletion cascades to sender records and snapshots. There is no automatic retention purge in V1. Review edits affect the submission only. Text annotations are copied into review captions, not flattened into originals.

The worker resumes sending rows after startup, serializes workers with a PostgreSQL advisory lock, and requests only missing files on replay. Failed sends wait for explicit Retry. Lost browser acknowledgements replay the same durable browser request instead of creating a duplicate. Later intentional sends get new IDs.

Validation on September 24, 2026:
- Core tests: grouping/limits, original preservation/fingerprints, interrupted uploads, missing-file resume, false receipt rejection, access default.
- Disposable PostgreSQL integration: two photos stay in one row; partial failure/retry; changed manifest conflict; source edit after snapshot; account/foreign-photo/origin boundaries.
- Full suite: 254 passed, 14 optional skips.
- Chromium: 390px and 1440px, original photo/note review, one grouped receipt, history after reload, Spanish, black left-aligned body text, no horizontal overflow or page errors. Receiver was mocked for these local browser checks.

Production and physical phone acceptance must be recorded separately after deployment. No real project/change order should be created for synthetic verification.
