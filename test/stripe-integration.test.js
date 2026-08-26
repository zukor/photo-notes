const test = require('node:test');
const assert = require('node:assert/strict');
const { invoiceInput, parseOffers, publicOffers, stripeSecret } = require('../stripe-integration');

test('restricted Stripe key takes precedence over a secret key', () => {
  assert.equal(stripeSecret({ STRIPE_RESTRICTED_KEY: 'rk_test_restricted', STRIPE_SECRET_KEY: 'sk_test_secret' }), 'rk_test_restricted');
});

test('checkout offers expose labels but never Stripe price IDs', () => {
  const raw = JSON.stringify({ pro: { price_id: 'price_123ABC', label: 'Photo Notes Pro', dba: 'Zukor AI' } });
  assert.deepEqual(parseOffers(raw).pro, { price_id: 'price_123ABC', label: 'Photo Notes Pro', dba: 'Zukor AI' });
  assert.deepEqual(publicOffers({ STRIPE_CHECKOUT_OFFERS_JSON: raw }), { pro: { label: 'Photo Notes Pro', dba: 'Zukor AI' } });
});

test('invalid checkout offers are ignored', () => {
  assert.deepEqual(parseOffers('{"bad":{"price_id":"prod_not_a_price"}}'), {});
  assert.deepEqual(parseOffers('not json'), {});
});

test('invoice input normalizes amounts, quantity, due date, and DBA', () => {
  assert.deepEqual(invoiceInput({
    email: ' Billing@Example.com ', customer_name: 'Example LLC', dba: 'Zukor Marketing', due_days: 45,
    items: [{ description: 'SEO services', quantity: 2, unit_amount: 125000 }],
  }), {
    email: 'billing@example.com', customerName: 'Example LLC', dba: 'Zukor Marketing', dueDays: 45,
    items: [{ description: 'SEO services', quantity: 2, unit_amount: 125000 }],
  });
});

test('invoice input rejects invalid email and unsafe line items', () => {
  assert.throws(() => invoiceInput({ email: 'wrong', items: [{ description: 'Work', unit_amount: 1000 }] }), /email/);
  assert.throws(() => invoiceInput({ email: 'a@example.com', items: [{ description: '', unit_amount: 1000 }] }), /invoice items/);
  assert.throws(() => invoiceInput({ email: 'a@example.com', items: [{ description: 'Work', unit_amount: 1 }] }), /invoice items/);
});
