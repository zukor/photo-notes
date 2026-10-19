#!/usr/bin/env node
/* Mix Temperature Log and Daily Yield Check in a real browser with mocked Paving Pro data.
   Checks the live temperature check, the plant-to-arrival drop, saving, and the live yield result. */
'use strict';
const assert = require('node:assert/strict'), path = require('node:path');
const express = require('express'), { chromium } = require('playwright');

(async () => {
  const app = express(); app.use(express.static(path.join(__dirname, '../public')));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const browser = await chromium.launch();
  const posts = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' })).newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const req = route.request(), p = new URL(req.url()).pathname;
      if (req.method() === 'POST') posts.push({ p, body: req.postDataJSON?.() });
      if (p === '/api/me') return route.fulfill({ json: { id: 1, email: 'tester@example.test', name: 'Tester', role: 'user', plan: 'pro', pro_type: 'paving', feature_access: { measurements: true, ticket_scanner: true, camera_readers: true, before_after: true } } });
      if (p === '/api/jobs') return route.fulfill({ json: [{ id: 5, name: 'Main Street Lot' }] });
      if (p === '/api/asphalt-tickets') return route.fulfill({ json: { tickets: [{ id: 9, ticket_number: 'A1', truck_number: '12', dispatch_temperature_f: 310 }] } });
      if (p === '/api/paving/temperatures' && req.method() === 'GET') return route.fulfill({ json: { readings: [], summary: { total: 0, low: 0 } } });
      if (p === '/api/paving/temperatures') return route.fulfill({ json: { ok: true, reading: { id: 1 }, check: { status: 'low' } } });
      if (p === '/api/paving/yield/inputs') return route.fulfill({ json: { tons: 99, ticket_count: 2, missing_tons: 0, measured_area_sqft: 9000, measured_area_sy: 1000, measured_count: 3 } });
      if (p === '/api/paving/yield' && req.method() === 'GET') return route.fulfill({ json: { checks: [] } });
      if (p === '/api/paving/yield') return route.fulfill({ json: { ok: true } });
      return route.fulfill({ json: [] });
    });
    await page.addInitScript(() => { localStorage.setItem('pn_install_prompt_dismissed_v1', 'dismissed'); localStorage.setItem('pn_first_use_v1:tester%40example.test', 'done'); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#tabCapture').click();
    await page.locator('#pavingCaptureType').selectOption('scanner');
    await page.locator('#pavingScannerButton').click(); await page.locator('#pavingScannerMenu').getByRole('option', { name: 'Mix Temperature Log', exact: true }).click();
    await page.locator('#tempManual').click();
    await page.locator('#tempReading').fill('276');
    await page.locator('#tempKind').selectOption('load');
    await page.locator('#tempBinder').selectOption('PG76');
    await page.locator('#tempJob').selectOption('5');
    await page.waitForFunction(() => document.querySelectorAll('#tempTicket option').length > 1);
    await page.locator('#tempTicket').selectOption('9');
    const check = await page.locator('#tempCheck').innerText();
    assert.match(check, /BELOW MINIMUM/); assert.match(check, /4°F below the suggested minimum of 280°F/); assert.match(check, /drop of 34°F/);
    await page.locator('#tempSave').click();
    await page.waitForFunction(() => !document.getElementById('tempSave'));
    const saved = posts.find(x => x.p === '/api/paving/temperatures');
    assert.equal(saved.body.reading_f, '276'); assert.equal(saved.body.ticket_id, '9'); assert.equal(saved.body.binder, 'PG76');

    await page.locator('#pavingScannerButton').click(); await page.locator('#pavingScannerMenu').getByRole('option', { name: 'Daily Yield Check', exact: true }).click();
    await page.locator('#yieldJob').selectOption('5');
    await page.waitForFunction(() => /99 tons/.test(document.getElementById('yieldTons').textContent));
    await page.locator('#yieldUseMeasured').click();
    await page.locator('#yieldThickness').fill('2');
    const result = await page.locator('#yieldResult').innerText();
    assert.match(result, /Under plan: 90% of plan/); assert.match(result, /1\.8 in of mat/);
    await page.locator('#yieldSave').click();
    await page.waitForFunction(() => document.getElementById('yieldSave').textContent === 'Save Yield Check');
    const y = posts.find(x => x.p === '/api/paving/yield');
    assert.equal(y.body.area, '9000'); assert.equal(y.body.area_source, 'measured'); assert.equal(y.body.thickness_in, '2');
    assert.deepEqual(errors, []);
    console.log('paving-quality PASS');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
