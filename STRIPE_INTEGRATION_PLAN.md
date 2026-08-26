# Stripe Payments and Invoicing Plan

Stripe planner guide: `iguide_61VI25CRwN72mK7mj41ALTM9Al7QZ`

## Business shape

Zukor, Inc. operates three DBAs under one corporation:

- Zukor Interactive: neurofeedback games.
- Zukor Marketing: online marketing and SEO services.
- Zukor AI: business and consumer AI applications, including Photo Notes.

The initial integration supports one Stripe account with DBA identity recorded in metadata and invoice presentation. It does not use Stripe Connect because money is not being routed to separate third-party sellers.

## Accepted architecture

### Online payments

- Use Stripe-hosted Checkout Sessions for one-time web payments.
- Define products and prices in Stripe, then map stable application offer slugs to Stripe Price IDs through `STRIPE_CHECKOUT_OFFERS_JSON`.
- Keep Price IDs and all secret credentials on the server.
- Omit `payment_method_types` so Stripe can use dynamic payment methods.
- Do not enable automatic tax until Zukor confirms the applicable Stripe Tax registrations are active.
- Do not add subscriptions, Connect, or Managed Payments until a specific product requires them.

### Invoicing

- Continue using the Stripe Dashboard for unique, manually prepared consulting and SEO invoices.
- Use the Invoicing API only for explicit business events that genuinely need automation.
- Default customer payment to Stripe's Hosted Invoice Page.
- Create API-generated invoices as drafts with `auto_advance: false`; an administrator reviews and sends the legal invoice from Stripe Dashboard.
- Use separate Stripe invoice rendering templates for Zukor Interactive, Zukor Marketing, and Zukor AI.
- Put DBA, application, project, job, and internal customer identifiers in metadata. Put customer-visible work detail in invoice line-item descriptions.

### Reconciliation and webhooks

- Stripe Dashboard is the initial source of truth for invoice status and reconciliation.
- The application verifies every webhook signature against the raw request body.
- A minimal webhook ledger stores only Stripe event ID, event type, related object ID, mode, and processing time. The event ID makes retries idempotent.
- Relevant events for later business-state automation are `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, and `credit_note.created`.
- Do not enable ACH or bank transfer until a process exists for delayed settlement, partial payments, and customer cash-balance exceptions.

## Security requirements

- Prefer a least-privilege restricted key (`rk_`) over a general secret key (`sk_`).
- Use separate test and live keys and webhook secrets.
- Store secrets only in Railway's protected service variables, never in source, client JavaScript, logs, screenshots, or support messages.
- Require an `Idempotency-Key` header for every endpoint that creates Stripe objects.
- Use Stripe Node SDK 22.4.0 and API version `2026-07-29.dahlia`.
- Begin in Stripe test mode. Do not create live products, prices, invoices, or charges until test checkout and webhook verification pass.

## Implemented foundation

- `GET /api/billing/config`: authenticated feature/config discovery with public offer labels only.
- `POST /api/billing/checkout`: authenticated hosted Checkout creation using a server-allowlisted Price ID.
- `POST /api/admin/billing/invoices`: administrator-only draft invoice creation; never sends or finalizes automatically.
- `POST /api/stripe/webhook`: signed raw-body webhook intake with idempotent storage.
- `stripe_events` database table: minimal content-free event ledger.

## Activation checklist

1. In Stripe test mode, create the actual products and one-time prices Zukor intends to sell.
2. Decide each offer's name, price, currency, fulfillment, refund policy, and DBA.
3. Create a test-mode restricted API key with only the permissions required for Checkout Sessions, Customers, Invoices, and Invoice Items.
4. Create a Stripe webhook endpoint for `https://photonotesapp.com/api/stripe/webhook` and subscribe only to the events the application handles.
5. Add `STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_BASE_URL`, and `STRIPE_CHECKOUT_OFFERS_JSON` to Railway's Photo Notes service variables.
6. Exercise Checkout and draft invoice creation in test mode using unique idempotency keys.
7. Verify valid webhooks are stored once and invalid signatures return HTTP 400.
8. Confirm fulfillment and entitlement rules for every paid offer before enabling a customer-facing purchase button.
9. Repeat the configuration with separate live-mode credentials only after the test-mode go-live review passes.
