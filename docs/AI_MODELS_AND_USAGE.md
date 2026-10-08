# AI Models & Usage

Super Admin opens **AI Models & Usage**, chooses OpenAI, Anthropic or Grok, chooses an available photo-analysis model, and presses **Save AI Selection**. The global database setting applies to the next shared AI request in every edition. Edition and account feature access stays in force. Requests already running retain their model.

Configure provider keys in the server environment: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY` (or `GROK_API_KEY`). Credentials never enter the browser. Existing installations keep Anthropic and `VISION_MODEL`, defaulting to `claude-sonnet-4-6`, until Super Admin changes the setting. Startup creates the settings, change history and usage tables through the existing database initializer.

Refresh Models retrieves the provider account's available API models. Anthropic pagination is supported. Non-photo models are listed but disabled. Capability order is approximate and curated, not a universal benchmark. OpenAI's list API lacks image capability metadata, so its documented model families are used for compatibility. New families need compatibility review. Model access ultimately depends on the provider account.

Daily usage shows the last 30 days, grouped in America/Chicago, with request counts, provider/model breakdowns and estimated USD charges. Token rates were verified against official provider pricing on October 8, 2026. The ledger reserves an entry before calling the provider, and records usage even when the model's returned text cannot be parsed. Missing usage, missing rates, unknown cache prices, long-context pricing and interrupted calls remain explicitly unknown, never zero. Estimates exclude unknown charges, credits, taxes, negotiated rates, historical usage before installation and usage outside Photo Notes. Provider invoices remain authoritative.

The current documented rates cover the latest flagship families, the existing Sonnet default and selected legacy Claude models. Other models remain selectable but may show unknown cost until their rates are added. Refresh Models updates availability, not the verified pricing table.

## Validation

- `node --test test/ai-settings.test.js test/vision.test.js test/super-admin.test.js`
- `node scripts/test-admin-ai.cjs`, Chromium and WebKit, 320, 390 and 1440 pixels
- `npm run help:check`, `npm test`, `npm run test:help`
- `node scripts/test-property-global-parity.cjs`
- `node scripts/test-all-edition-help.cjs`

Provider request/response contracts are tested using fixtures. Live paid provider requests and production deployment require separate verification.
