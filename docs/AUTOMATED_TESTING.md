# Photo Notes automated testing

Run `npm test` for normal development. Run `npm run test:full` before integration or a human-testing handoff. `npm run test:release` invokes the full gate. A nonzero exit means the candidate cannot be called release-ready. Required CI is `Automated testing gate / full-regression`; the repository administrator must enable it as a required branch protection check. This task does not change GitHub branch protection or Railway deployment settings.

The full runner uses a fresh PostgreSQL cluster in a private temporary Unix socket directory, creates separate feature databases, and removes the cluster after completion. Install local PostgreSQL binaries and Playwright Chromium/WebKit first. It never reads `.env`. Production database URLs, credentials and paid provider keys are removed from child environments. Node HTTP/fetch calls outside localhost are rejected. AI behavior uses the existing injectable deterministic mocks. Live AI evaluation remains deliberately outside this gate. `npm run test:ai:live -- --allow-paid` deliberately makes one paid Anthropic request against an original synthetic plate; provide the API key explicitly. This command was not run.

Outputs are `output/automated-testing/{fast,full}/status.json`, feature-specific logs and `human-testing.md`. Screenshots and interaction diagnostics are in `output/automated-testing/screenshots`. Failures retain expected/actual assertion information and fixture identity. Focused rechecks use `node scripts/test-system.cjs full RUN-LABEL SUITE-NAME[,SUITE-NAME]`; they never establish full readiness. Each child has a timeout; remaining independent suites still run after an assertion failure. Do not run two gates of the same mode simultaneously because their output paths are shared.

## Current coverage

| Area | Automated behavior |
| --- | --- |
| All ten editions | Actual account edition identity, browser startup at iPhone/WebKit, Android, tablet and desktop sizes, Basic workspace exclusions, viewport fit, visible control names and JavaScript errors |
| Existing unit/regression suite | Basic, Pro, Paving, Concrete, HOA, Property, Contractor, Roofer, Issue/Road Reporter, export, voice lifecycle, GPS fallbacks, jobs, Help and specialist regressions |
| Real PostgreSQL/HTTP | Requests and completion links, QR, Related Photos, Concrete visual analysis, Custom Fields, Saved Views, bulk metadata, Comments, property incidents, Areas/visit/capture association, incident deletion/upload replay, recurring follow-ups, Export Presets and shared Before/After |
| Core database | Fresh schema, repeat migration with existing evidence, authentication, cross-owner evidence/export access, real PDF/Word/Markdown bundle generation |
| Offline | Real browser save/offline reload/reconnect, post-commit lost-response retry and duplicate prevention on Chromium/WebKit; real IndexedDB reload, stored image bytes, specialty payload preservation, retry identity, deletion, account/edition eligibility and permanent/retryable failures; existing browser offline scripts remain separately available |
| Shared browser workflows | Help, shared Pro layout, Location Intelligence, Camera Readers and correction-to-library, Capture Templates, Property Areas/Incidents, requests, QR, related photos, comments, custom fields and saved views |
| Images | 60 original synthetic fixtures covering pavement, concrete, buildings, plates, labels, gauges, plans, property conditions and Before/After; landscape/portrait/small/blur/dark/overexposure |

Factories live in `test/support/factories.cjs`. Synthetic image source is `test/support/golden-images.cjs`; regenerate files with `node scripts/generate-golden-images.cjs`. These are deterministic workflow inputs, not a claim that AI interprets real field photographs accurately. No customer images were used.

## Acceptance gaps and next work

Seventeen legacy integrations now run on separate disposable databases in the full gate. They remain intentionally skipped in the fast suite. Full-suite status accounts for their separate results, including capture rollback/idempotence, exact document links, evidence exports, Ramo intake, scanner integration, tester administration and real deletion/cascades and issue follow-up/backlog repairs. Old standalone commands remain opt-in and retain their historical directory guards. Full runs record source fingerprints and refuse release readiness if source changes during execution.

Screenshots are review artifacts until approved baselines are supplied. `PN_VISUAL_BASELINES=/absolute/reviewed-baselines npm run test:visual` compares all forty PNGs, rejects changed dimensions and reports differences exceeding 0.5% of pixels with a per-channel tolerance of 24. The command never replaces or approves baselines. Use the same OS/browser/fonts for comparisons. Establish reviewed baselines per edition/viewport and deterministic populated records before enabling pixel comparisons. Capture startup checks do not yet establish navigation through every populated specialist screen, keyboard focus order, touch-target sizes or full contrast conformance. Add populated Organize, Details, inspection and report-preview cases. Automated control naming is a focused check, not accessibility certification.

Fresh and repeat schema checks do not yet replace an historical-database fixture library with upgrade/deletion/cascade assertions. Add versioned minimal legacy schema fixtures and ownership/company deletion cases. Area and incident capture checks cover stored Property/Area, GPS, receipt replay and original fingerprints. Output tests cover Custom Fields and internal-comment exclusion. Expand combined Follow-Up + Before/After and reviewed historical migration fixtures as integrations stabilize. Photo Sets implementation status remains unestablished. Export Presets and shared Before/After are deployed and included in this gate.

The four-hour maintenance automation checks completed approved changes and expands meaningful regressions. Integration/QA owns the immutable combined candidate and deployment. A passing local gate does not establish Railway status, deployed assets, live authenticated UI or physical-device behavior.

## Tester-bug rule

Reproduce using synthetic records. Add a behavioral test that fails on the old implementation when practical, apply the smallest unambiguous fix, and demonstrate that it passes. Record cases where a reliable automated reproduction is not practical. Never weaken an assertion simply to make a candidate green.

## Human handoff

For each candidate, identify changed workflows and relevant editions. Ask Hassan's team only for affected physical camera, real microphone/final transcript, GPS accuracy, PWA installation, native sharing, field usability, printed QR and real AI-quality checks. Include print/report visual review when output changes. Report automated failures and untested workflows separately. Do not ask humans to compensate for failed basic software tests.

The integrated runner preserves latest-main template/Paving export assertions and uses explicit disposable database URLs for standalone fixtures. Real offline upload checks run in Pro; Basic retains its capture/share workflow. Shared Camera Reader gating checks preserve the independent Paving ticket scanner. First-use dialogs and Super Admin IDs use synthetic fixture setup. No paid smoke is part of fast/full/release.
