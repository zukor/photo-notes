# Shared visual analysis and Concrete Pro

The shared foundation is visual-analysis.js, with domain schema/prompt/normalization in concrete-analyzer.js and reusable browser review in public/visual-analysis.js. Image preparation, provider transport and provider failures continue to use vision.js without changes. Paving prompts, defect vocabulary, batch classification, corrections, measurements and deterministic scoring remain unchanged. Paving persistence migration is deferred; its adapter can adopt this run table in a separate change.

## Persistence and schema

Additive, idempotent migration creates visual_analysis_runs with account/photo cascade links, domain, analyzer version, provider/model, timestamp, original parsed provider JSON, normalized result, confidence, review status, reviewed result and review time. Reruns create new rows. Reviews finalize once, preserve original JSON and record reviewed/corrected/rejected status. A nullable captures.concrete_reviewed_observation stores only the latest explicitly reviewed observation.

Concrete schema: element, condition, severity, confidence, observation and one to eight findings. Each finding contains type, observation and confidence. Elements use the existing 12 values: patio, driveway, sidewalk, slab, foundation, steps, curb, wall, column, beam, deck, other. Condition retains not_assessed, acceptable, monitor, repair_needed, unsafe. Severity retains none, minor, moderate, severe, critical. AI cannot suggest unsafe or critical; human review supports the existing vocabulary. Confidence is high/medium/low overall and per finding.

Finding types: cracking, spalling, scaling, surface_deterioration, exposed_aggregate, staining, apparent_displacement, chipped_edge, joint_deterioration, surface_damage, other, no_obvious_defect. No obvious defect must appear alone. Server validation rejects invalid enums, empty/oversized observations, contradictory findings and invalid arrays. No provider-enforced schema is added; the existing transport remains stable.

## Workflow

Concrete saved photo cards expose Analyze Photo. It is intentional and never automatic. Review shows the original photo, existing fields, suggested fields and separate editable findings. Apply checkboxes start unchecked. Accept / Save Review saves the observation and only explicitly selected structured fields. A stale existing value causes a conflict instead of replacement. Reject applies nothing. Rerun retains history; history displays timestamps, model, version and review status. Close and failures preserve manual documentation.

Exact location, specifications, measurements, notes and photo files are never changed. Prompts prohibit engineering/safety/code conclusions, inferred causes, repair advice, dimensions, exact/geographic location and mix guesses. AI output still requires human judgment.

Reviewed observations appear with a User Reviewed label in Concrete PDF/Word reports, on Concrete photo cards and in ordinary text search. Unreviewed runs never enter reports. Findings remain in analysis history, with the concise reviewed observation used in reports. Existing reports are otherwise preserved.

## Verification and limits

Tests: node --test test/visual-analysis.test.js test/vision.test.js test/paving-workflow.test.js test/paving-photo-reason.test.js test/concrete-pro.test.js; dedicated PostgreSQL/HTTP scripts/test-visual-analysis-integration.cjs; Chromium/WebKit scripts/test-visual-analysis-browser.cjs at 320/390/1440 pixels; help:check, npm test, test:help and all-edition Help checks.

Provider tests use synthetic images and mocked responses, without paid calls. Real concrete photos and physical iPhone/Android acceptance remain required. The original parsed provider JSON is retained, not the entire HTTP envelope. Findings support editing type/text, with whole-run rejection; individual finding deletion and adding findings during review are not implemented. Paving still uses its existing overwrite-based persistence. Next recommended domain: Property/HOA, with its own authored vocabulary and review rules.
