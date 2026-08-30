const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { invoiceInput, invoiceTemplates, parseOffers, publicOffers, stripeSecret } = require('../stripe-integration');
const root=path.join(__dirname,'..'),app=fs.readFileSync(path.join(root,'public','app.js'),'utf8'),admin=fs.readFileSync(path.join(root,'public','admin.html'),'utf8'),stripe=fs.readFileSync(path.join(root,'stripe-integration.js'),'utf8');

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

test('invoice rendering templates are allowlisted by DBA and Stripe ID shape',()=>{
  assert.deepEqual(invoiceTemplates({STRIPE_INVOICE_TEMPLATES_JSON:JSON.stringify({'Zukor AI':'inrtem_A1','Unknown':'inrtem_B2','Zukor Marketing':'wrong'})}),{'Zukor AI':'inrtem_A1'});
});

test('customer checkout and administrator draft invoicing are wired without exposing IDs',()=>{
  assert.match(app,/Pay with Stripe/);
  assert.match(app,/api\/billing\/checkout/);
  assert.match(admin,/Create Draft Invoice/);
  assert.match(admin,/api\/admin\/billing\/invoices/);
  assert.match(stripe,/auto_advance: false/);
  assert.match(stripe,/api\/admin\/billing\/status/);
  assert.match(admin,/Sandbox.*webhook activity/);
  assert.doesNotMatch(app,/price_[A-Za-z0-9]+/);
  assert.doesNotMatch(admin,/price_[A-Za-z0-9]+/);
});
