# Cloud issue repair and notifications

Notifications run inside the Railway app service every two seconds while healthy. Durable database events survive restarts; opt-in Web Push delivery retries with backoff. PostgreSQL advisory locking prevents simultaneous processing. A crash between delivery and acknowledgement can cause a duplicate; notification tags collapse duplicates on the device. Payloads contain no customer report details. Users enable notifications through My Issue Reports or Report Issue. On iPhone, open the installed Home Screen app first. OS permission, network access, and delivery policies apply.

## Private repair runner

Customer report processing runs in the PRIVATE `zukor/photo-notes-repair-worker` repository. The public application's workflow does not read reports. The canonical workflow is https://github.com/zukor/photo-notes-repair-worker/blob/main/.github/workflows/issue-cloud-repair.yml. Scheduled runs check every five minutes, subject to GitHub scheduling delays. No desktop runtime is required. A manual repair run can target a report. An optional private-repository Actions credential on Railway can enable immediate dispatch, but scheduled operation does not require it.

GitHub secrets in the private runner:
- OPENAI_API_KEY: required working AI credential. API usage is billed to its account.
- TESTER_QUEUE_TOKEN: existing scoped queue credential, configured.
- PHOTO_NOTES_DEPLOY_KEY: write-enabled SSH deploy key restricted to the Photo Notes repository, configured. No personal GitHub token is stored.

Each run checks configuration before claiming a report. It obtains an exclusive 45-minute claim; the claim is encrypted between jobs. The proposing and independently reviewing models have read-only source access and no queue/publishing credentials. Repairs are restricted to ordinary frontend code in app.js, styles.css, i18n.js and send.js. Sensitive operations, network destinations, uncertain evidence, and unsupported defects need human review.

A regression must fail on the original source and pass on the repaired source. The full suite runs in a network-disabled container without cloud secrets. The publishing job independently rebuilds and fingerprints the tested tree; it never executes proposed code. A repository-restricted key fast-forwards main only if its base has not changed. Generated regression source and review details remain in the private run. A generic public commit identifies the issue number without its private report text. This cloud path uses independent model review plus isolated tests instead of a public PR containing customer details.

Railway deploys the resulting commit. Verification requires the running deployment to report the exact commit and healthy database, and five live frontend assets to match the committed files. It repeats the checks before marking ready_to_test. Failed review, test, publishing or verification records a blocker; the worker never confirms its own repair. A stale claim prevents status updates, and an expired unfinished claim can be retried by the next worker. Device retest remains necessary.

## Verification and activation

The check workflow runs unit tests and a synthetic failing/passing repair inside a disposable checkout without changing real reports or production. Passing that check proves deterministic gates, not AI quality or an actual repair release. Keep the desktop repair automation as a fallback until cloud AI execution and the first real repair have been verified.

Admin displays the latest server notification cycle, cloud queue check, and AI-credential readiness. A missing or invalid AI key prevents cloud repairs; do not call the AI pipeline operational until a real authenticated run succeeds. Deployment errors are not success notifications.

## Dispatch reliability and notification delivery

Railway's running app hosts the durable worker; there is no desktop dependency for that cycle. Set `ISSUE_CLOUD_RUNNER_ENABLED=true` and save a fine-grained `ISSUE_GITHUB_TOKEN` scoped only to the private worker repository with Actions read/write. The worker checks active workflow runs every 30 seconds before dispatching, waits while a run is active, and retries missed starts after 15 minutes. Admin displays missing credentials, dispatch errors, stale runs and failed notification deliveries. This is queued processing, not a guaranteed repair deadline.

Owner worker-failure incidents persist in PostgreSQL and notify subscribed admin devices once per incident, with retries. Completion notifications wait 60 seconds and group updates by device/outcome; routine progress does not generate push. My Issue Reports includes deployment time, history and explicit testing/confirmation states. Browser/OS permission is still required. Email is not activated by this release.

The private test workflow installs Playwright 1.63.0 and uses its matching Chromium image. Tests run without network, AI keys, queue tokens or publishing credentials. Visual fixes must test rendered bounds with synthetic content and the actual source; a CSS-string assertion alone is insufficient. `check_ref` validates a branch without claiming that branch is deployed.

A rejected proposal gets at most one revision using independent reviewer feedback, followed by a fresh independent review. Protected/insufficient-evidence proposals do not enter this revision path. Trusted progress updates renew only a currently valid claim. Another rejection stops the run for manual attention; no test or approval gate is bypassed.
