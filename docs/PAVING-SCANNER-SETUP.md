# Paving Pro scanner setup and verification

Automatic delivery-ticket reading, specialist camera readers, measurements, and pavement classification use the shared Anthropic Messages API integration in vision.js.

Production requires ANTHROPIC_API_KEY in Railway > Photo Notes Production > Variables. VISION_MODEL is optional and defaults to claude-sonnet-4-6. Never put the key in public JavaScript, issue reports, Git, or chat. Adding a key enables paid API use for the existing scanner workflows; the provider account must have billing and appropriate spend limits configured.

The Stripe Projects catalog did not offer Anthropic during the September 21 investigation. No provider was provisioned and no credentials or paid requests were used in this repair.

The integration distinguishes missing configuration, invalid credentials, billing problems, rate limits, outages, a 45-second timeout, invalid images, incomplete responses, and genuinely unreadable photos. Ticket and specialist-reader responses retain the uploaded photo and editable review form when AI is unavailable. Retry remains available. All-null fields and truncated responses are not successful extraction. Admin > Health shows configuration and the last scan outcome for the current server process; configured is not proof of successful extraction.

Verification:
- npm test
- PN_SCANNER_RETEST=1 node --test test/scanner-service.integration.test.js
- The integration test refuses to run outside the disposable PostgreSQL cluster at /tmp/pn-pro-retest/db, port 55489.
- Provider traffic is intercepted in tests. Tests cover extraction into ticket and five specialist-reader fields, manual save, retained photos, error categories, retry, and English/Spanish browser messages.
- Real extraction must still be verified after the production key is configured. Use synthetic, non-customer examples with known ticket numbers/weights, plan titles/scales, and instrument readings. Check extracted values, correct/save, and reopen them. Do not mark tester scanner issues fixed based on mocked results.

Provider references:
- https://platform.claude.com/docs/en/api/errors
- https://platform.claude.com/docs/en/models/sonnet-4-6/overview
