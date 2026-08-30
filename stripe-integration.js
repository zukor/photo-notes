const crypto = require('crypto');
const express = require('express');
const Stripe = require('stripe');

const STRIPE_API_VERSION = '2026-07-29.dahlia';
const DBA_NAMES = new Set(['Zukor Interactive', 'Zukor Marketing', 'Zukor AI']);

function stripeSecret(env = process.env) {
  return String(env.STRIPE_RESTRICTED_KEY || env.STRIPE_SECRET_KEY || '').trim();
}

function stripeConfigured(env = process.env) {
  return !!stripeSecret(env);
}

function createStripeClient(env = process.env) {
  const key = stripeSecret(env);
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

function parseOffers(raw) {
  if (!raw) return {};
  let value;
  try { value = JSON.parse(raw); } catch { return {}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const offers = {};
  for (const [slug, item] of Object.entries(value)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(slug)) continue;
    if (!item || typeof item !== 'object' || !/^price_[A-Za-z0-9]+$/.test(String(item.price_id || ''))) continue;
    offers[slug] = {
      price_id: String(item.price_id),
      label: String(item.label || slug).trim().slice(0, 120),
      dba: DBA_NAMES.has(item.dba) ? item.dba : 'Zukor AI',
    };
  }
  return offers;
}

function publicOffers(env = process.env) {
  const offers = parseOffers(env.STRIPE_CHECKOUT_OFFERS_JSON);
  return Object.fromEntries(Object.entries(offers).map(([slug, item]) => [slug, { label: item.label, dba: item.dba }]));
}

function invoiceTemplates(env = process.env) {
  let value={};try{value=JSON.parse(String(env.STRIPE_INVOICE_TEMPLATES_JSON||'{}'));}catch{return {};}
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const out={};for(const dba of DBA_NAMES){const id=String(value[dba]||'');if(/^inrtem_[A-Za-z0-9]+$/.test(id))out[dba]=id;}return out;
}

function baseUrl(req, env = process.env) {
  const configured = String(env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(configured)) return configured;
  const protocol = env.NODE_ENV === 'production' ? 'https' : req.protocol;
  return `${protocol}://${req.get('host')}`;
}

function integrationIdentifier(env = process.env) {
  const configured = String(env.STRIPE_INTEGRATION_IDENTIFIER || '').trim();
  if (/^[A-Za-z0-9_-]{8,64}$/.test(configured)) return configured;
  const suffix = crypto.randomBytes(8).toString('base64url').replace(/[^A-Za-z]/g, '').slice(0, 8).padEnd(8, 'x');
  return `photo_notes_${suffix}`;
}

function invoiceInput(body) {
  const b = body && typeof body === 'object' ? body : {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('valid customer email required');
  const customerName = String(b.customer_name || '').trim().slice(0, 200);
  const dba = DBA_NAMES.has(b.dba) ? b.dba : 'Zukor AI';
  const dueDays = Math.max(1, Math.min(90, Number.parseInt(b.due_days, 10) || 30));
  const sourceItems = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
  const items = sourceItems.map((item) => ({
    description: String(item && item.description || '').trim().slice(0, 1000),
    quantity: Math.max(1, Math.min(10000, Number.parseInt(item && item.quantity, 10) || 1)),
    unit_amount: Number.parseInt(item && item.unit_amount, 10),
  }));
  if (!items.length || items.some((item) => !item.description || !Number.isSafeInteger(item.unit_amount) || item.unit_amount < 50 || item.unit_amount > 100000000)) {
    throw new Error('invoice items require a description and unit_amount in cents');
  }
  return { email, customerName, dba, dueDays, items };
}

function idempotencyKey(req) {
  const key = String(req.get('idempotency-key') || '').trim();
  if (!/^[A-Za-z0-9._:-]{12,200}$/.test(key)) return null;
  return key;
}

function stripeError(res, error, label) {
  const status = error && error.statusCode >= 400 && error.statusCode < 500 ? 400 : 502;
  console.error(`[stripe.${label}]`, {
    type: error && error.type,
    code: error && error.code,
    param: error && error.param,
    message: error && error.message,
  });
  return res.status(status).json({ error: 'Stripe request could not be completed' });
}

function registerStripeWebhook(app, { pool, env = process.env } = {}) {
  app.post('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    const client = createStripeClient(env);
    const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || '').trim();
    if (!client || !webhookSecret) return res.status(503).json({ error: 'Stripe webhook is not configured' });
    let event;
    try {
      event = client.webhooks.constructEvent(req.body, req.get('stripe-signature'), webhookSecret);
    } catch (error) {
      return res.status(400).json({ error: 'invalid Stripe signature' });
    }
    try {
      const objectId = event.data && event.data.object && event.data.object.id || null;
      const inserted = await pool.query(
        `INSERT INTO stripe_events(event_id,event_type,object_id,livemode) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING event_id`,
        [event.id, event.type, objectId, !!event.livemode]
      );
      if (inserted.rowCount) console.log(`[stripe.webhook] ${event.type} ${event.id}`);
      return res.json({ received: true, duplicate: !inserted.rowCount });
    } catch (error) {
      console.error('[stripe.webhook.store]', error && error.message);
      return res.status(500).json({ error: 'webhook could not be recorded' });
    }
  });
}

function registerStripeRoutes(app, { pool, requireAuth, requireAdmin, env = process.env } = {}) {
  app.get('/api/billing/config', requireAuth, (req, res) => {
    res.json({
      checkout_enabled: stripeConfigured(env) && Object.keys(parseOffers(env.STRIPE_CHECKOUT_OFFERS_JSON)).length > 0,
      invoicing_enabled: stripeConfigured(env),
      offers: publicOffers(env),
    });
  });

  app.get('/api/admin/billing/status', requireAdmin, async (req, res) => {
    try {
      const events = (await pool.query(`SELECT event_type,object_id,livemode,processed_at FROM stripe_events ORDER BY processed_at DESC LIMIT 50`)).rows;
      const counts = {}; for (const event of events) counts[event.event_type] = (counts[event.event_type] || 0) + 1;
      res.json({ configured:stripeConfigured(env), webhook_configured:!!String(env.STRIPE_WEBHOOK_SECRET||'').trim(), environment:events.some(e=>e.livemode)?'live':'sandbox', counts, events });
    } catch (error) { console.error('[stripe.admin-status]', error && error.message); res.status(500).json({ error:'Stripe activity could not be loaded' }); }
  });

  app.post('/api/billing/checkout', requireAuth, async (req, res) => {
    const client = createStripeClient(env);
    const offers = parseOffers(env.STRIPE_CHECKOUT_OFFERS_JSON);
    const offer = offers[String(req.body && req.body.offer || '')];
    const idem = idempotencyKey(req);
    if (!client) return res.status(503).json({ error: 'Payments are not configured' });
    if (!offer) return res.status(400).json({ error: 'invalid checkout offer' });
    if (!idem) return res.status(400).json({ error: 'valid Idempotency-Key header required' });
    const quantity = Math.max(1, Math.min(99, Number.parseInt(req.body && req.body.quantity, 10) || 1));
    const origin = baseUrl(req, env);
    try {
      const session = await client.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: offer.price_id, quantity }],
        client_reference_id: String(req.user.id),
        customer_email: req.user.email,
        success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/?checkout=cancelled`,
        metadata: { app: 'photo_notes', dba: offer.dba, offer: String(req.body.offer), user_id: String(req.user.id) },
      }, { idempotencyKey: `${idem}:checkout` });
      await pool.query(`INSERT INTO events(user_id,action,detail) VALUES($1,'stripe_checkout_created',$2)`, [req.user.id, JSON.stringify({ session_id: session.id, offer: String(req.body.offer) })]);
      return res.json({ url: session.url });
    } catch (error) { return stripeError(res, error, 'checkout'); }
  });

  app.post('/api/admin/billing/invoices', requireAdmin, async (req, res) => {
    const client = createStripeClient(env);
    const idem = idempotencyKey(req);
    if (!client) return res.status(503).json({ error: 'Invoicing is not configured' });
    if (!idem) return res.status(400).json({ error: 'valid Idempotency-Key header required' });
    let input;
    try { input = invoiceInput(req.body); } catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const customer = await client.customers.create({
        email: input.email,
        name: input.customerName || undefined,
        metadata: { app: 'photo_notes', dba: input.dba },
      }, { idempotencyKey: `${idem}:customer` });
      const invoice = await client.invoices.create({
        customer: customer.id,
        collection_method: 'send_invoice',
        days_until_due: input.dueDays,
        auto_advance: false,
        description: `${input.dba} invoice draft`,
        metadata: { app: 'photo_notes', dba: input.dba, created_by_user_id: String(req.user.id) },
        ...(invoiceTemplates(env)[input.dba] ? { rendering: { template: invoiceTemplates(env)[input.dba] } } : {}),
      }, { idempotencyKey: `${idem}:invoice` });
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        await client.invoiceItems.create({
          customer: customer.id,
          invoice: invoice.id,
          amount: item.unit_amount * item.quantity,
          currency: 'usd',
          description: item.quantity === 1 ? item.description : `${item.description} (quantity ${item.quantity})`,
          metadata: { app: 'photo_notes', dba: input.dba },
        }, { idempotencyKey: `${idem}:item:${i}` });
      }
      await pool.query(`INSERT INTO events(user_id,action,detail) VALUES($1,'stripe_invoice_draft_created',$2)`, [req.user.id, JSON.stringify({ invoice_id: invoice.id, dba: input.dba })]);
      return res.json({ invoice_id: invoice.id, status: 'draft', dashboard_review_required: true });
    } catch (error) { return stripeError(res, error, 'invoice'); }
  });
}

module.exports = {
  STRIPE_API_VERSION,
  baseUrl,
  createStripeClient,
  idempotencyKey,
  integrationIdentifier,
  invoiceInput,
  invoiceTemplates,
  parseOffers,
  publicOffers,
  registerStripeRoutes,
  registerStripeWebhook,
  stripeConfigured,
  stripeSecret,
};
