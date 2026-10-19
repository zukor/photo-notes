#!/usr/bin/env node
/* Concrete Pro Batch Ticket Scanner, Concrete Temperature Log and Concrete Yield Check in a real browser with mocked data,
   and the library photo location rule: a chosen photo uses the location saved inside it, never the phone's. */
'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const express = require('express'), { chromium } = require('playwright');

(async () => {
  const app = express(); app.use(express.static(path.join(__dirname, '../public')));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const browser = await chromium.launch(), posts = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-concrete-ui-'));
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' })).newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const req = route.request(), p = new URL(req.url()).pathname, m = req.method();
      if (m === 'POST' && !p.endsWith('/scan')) posts.push({ p, body: req.postDataJSON?.() });
      if (p === '/api/me') return route.fulfill({ json: { id: 1, email: 'tester@example.test', name: 'Tester', role: 'user', plan: 'pro', pro_type: 'concrete', feature_access: {} } });
      if (p === '/api/jobs') return route.fulfill({ json: [{ id: 5, name: 'Patio Pour' }] });
      if (p === '/api/concrete/tickets/scan') return route.fulfill({ json: { ok: true, ai_read: true, ticket: { id: 11, confidence: 'low', ticket_number: 'R-102', load_yd3: 9, batch_time: '7:30 AM', discharge_end: '9:15 AM', water_allowed_gal: 8, water_added_gal: 12 } } });
      if (p === '/api/concrete/tickets' && m === 'GET') return route.fulfill({ json: { tickets: [{ id: 11, ticket_number: 'R-102', load_yd3: 9, checks: { flags: [], minutes: 60, measured_to: 'arrival' } }], total_yd3: 9, ticket_count: 1, flagged: 0 } });
      if (p === '/api/concrete/placement-photos') return route.fulfill({ json: { photos: [{ id: 40, photo_title: 'Pour photo', created_at: new Date().toISOString() }] } });
      if (p === '/api/concrete/tickets/12' && m === 'GET') return route.fulfill({ json: { ticket: { id: 12, status: 'draft', confidence: 'high', ticket_number: 'R-201', load_yd3: 8, job_id: 5, placement_capture_id: 40, photo_path: '/icon-192.png' }, checks: { flags: [] } } });
      if (p.startsWith('/api/concrete/tickets/')) return route.fulfill({ json: { ok: true, checks: { flags: [{ key: 'time' }] } } });
      if (p === '/api/concrete/temperatures' && m === 'GET') return route.fulfill({ json: { readings: [], summary: { total: 0, out_of_range: 0 } } });
      if (p === '/api/concrete/temperatures') return route.fulfill({ json: { ok: true, reading: { id: 1 }, check: { status: 'low' } } });
      if (p === '/api/concrete/yield/inputs') return route.fulfill({ json: { yards: 19, ticket_count: 2, areas: [{ id: 1, name: 'Back patio', area_sqft: 1500, source: 'field' }, { id: 2, name: 'Walk', area_sqft: 200, source: 'map' }] } });
      if (p === '/api/concrete/yield' && m === 'GET') return route.fulfill({ json: { checks: [] } });
      if (p === '/api/concrete/yield') return route.fulfill({ json: { ok: true } });
      if (p === '/api/geocode') return route.fulfill({ json: { address: '100 Test St, San Antonio, TX' } });
      return route.fulfill({ json: [] });
    });
    await page.addInitScript(() => {
      localStorage.setItem('pn_install_prompt_dismissed_v1', 'dismissed'); localStorage.setItem('pn_first_use_v1:tester%40example.test', 'done');
      // Count any request for the phone's location.
      window.__geoCalls = 0; const fake = { getCurrentPosition: (ok) => { window.__geoCalls++; ok({ coords: { latitude: 40, longitude: -100 } }); }, watchPosition: () => 0, clearWatch() {} };
      Object.defineProperty(navigator, 'geolocation', { configurable: true, get: () => fake });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#tabCapture').click();

    // Library photo with a saved location: that location is used, not the phone's.
    await page.locator('#photoLib').setInputFiles(path.join(__dirname, '../test/fixtures/gps-photo.jpg'));
    await page.waitForFunction(() => /29\.42500/.test(document.getElementById('gps')?.textContent || ''));
    assert.equal(await page.evaluate(() => window.__geoCalls), 0, 'the phone location is not requested for a library photo');
    // Library photo without a saved location: none is recorded.
    const plain = path.join(dir, 'plain.png'); fs.copyFileSync(path.join(__dirname, '../public/icon-192.png'), plain);
    await page.locator('#photoLib').setInputFiles(plain);
    await page.waitForFunction(() => /no saved location/.test(document.getElementById('gps')?.textContent || ''));
    assert.equal(await page.evaluate(() => window.__geoCalls), 0);
    assert.equal(await page.evaluate(() => state.location), null);
    // A photo taken now uses the phone's location.
    await page.locator('#photoCam').setInputFiles(plain);
    await page.waitForFunction(() => /40\.00000/.test(document.getElementById('gps')?.textContent || ''));
    await page.locator('#cancelPhoto').click().catch(() => {});

    // Concrete tools in Camera Tools.
    await page.evaluate(() => { state.view = 'camera-tools'; renderApp(); });
    await page.locator('#toolConcreteTicket').click();
    await page.locator('#ctkLib').setInputFiles(plain);
    await page.waitForSelector('#ctkSave');
    let checks = await page.locator('#ctkChecks').innerText();
    assert.match(checks, /105 minutes from batching to end of discharge, over the 90-minute limit/); assert.match(checks, /12 gal of water added, more than the 8 gal allowed/);
    await page.locator('#ctkJob').selectOption('5');
    await page.waitForSelector('#ctkPlacement option[value="40"]', { state: 'attached' }); await page.locator('#ctkPlacement').selectOption('40');
    await page.locator('#ctkSave').click();
    assert.equal(posts.filter(x => x.p === '/api/concrete/tickets/11').length, 0, 'a hard-to-read ticket needs the confirmation tick');
    await page.locator('#ctkConfirm').check(); await page.locator('#ctkSave').click();
    await page.waitForFunction(() => !document.getElementById('ctkSave'));
    const savedTicket = posts.find(x => x.p === '/api/concrete/tickets/11').body;
    assert.equal(savedTicket.confirmed, true); assert.equal(savedTicket.job_id, '5'); assert.equal(savedTicket.load_yd3, '9');
    assert.equal(savedTicket.placement_capture_id, '40', 'the ticket is linked to the placement photo');

    // Concrete details stay editable after saving; only changed fields are sent.
    await page.evaluate(() => openConcreteDetailsEditor({ id: 40, concrete_phase: 'work', concrete_purpose: 'placement', concrete_stage: 'placement', concrete_element: 'slab', concrete_location: 'Back patio' }));
    assert.equal(await page.locator('#cdePurpose').inputValue(), 'placement');
    await page.locator('#cdeElement').selectOption('driveway'); await page.locator('#cdeLocation').fill('Front drive');
    await page.locator('#cdeSave').click(); await page.waitForFunction(() => !document.getElementById('concreteDetailsEditor'));
    assert.deepEqual(posts.find(x => x.p === '/api/captures/40').body, { concrete_element: 'driveway', concrete_location: 'Front drive' });
    // After a batch ticket is attached to a placement photo, the user is sent to review its draft.
    await page.evaluate(() => showConcreteTicketDraftNotice(12, { ai_read: true }));
    assert.match(await page.locator('#concreteTicketDraftNotice').innerText(), /Review it in the Batch Ticket Scanner/);
    await page.locator('#ctdReview').click();
    await page.waitForSelector('#ctkSave');
    assert.equal(await page.locator('#ctk_ticket_number').inputValue(), 'R-201');
    await page.waitForFunction(() => document.getElementById('ctkPlacement').value === '40');
    await page.locator('#ctkSave').click(); await page.waitForFunction(() => !document.getElementById('ctkSave'));
    assert.equal(posts.filter(x => x.p === '/api/concrete/tickets/12').at(-1).body.placement_capture_id, '40');

    await page.locator('#concreteToolBack').click();
    await page.locator('#toolConcreteTemperature').click();
    await page.locator('#ctpManual').click();
    await page.locator('#ctpReading').fill('52'); await page.locator('#ctpSection').selectOption('thin');
    assert.match(await page.locator('#ctpCheck').innerText(), /BELOW MINIMUM 3°F below the suggested minimum of 55°F/);
    await page.locator('#ctpReading').fill('97');
    assert.match(await page.locator('#ctpCheck').innerText(), /ABOVE MAXIMUM 2°F above the maximum of 95°F/);
    await page.locator('#ctpReading').fill('70'); await page.locator('#ctpJob').selectOption('5');
    await page.locator('#ctpSave').click(); await page.waitForFunction(() => !document.getElementById('ctpSave'));
    assert.equal(posts.find(x => x.p === '/api/concrete/temperatures').body.section, 'thin');
    // Thickness is remembered for that job only.
    await page.locator('#ctpManual').click();
    await page.locator('#ctpJob').selectOption('5');
    assert.equal(await page.locator('#ctpSection').inputValue(), 'thin');
    await page.locator('#ctpJob').selectOption('');
    assert.equal(await page.locator('#ctpSection').inputValue(), '', 'another job does not reuse the thickness');
    await page.locator('#ctpCancel').click();

    await page.locator('#concreteToolBack').click();
    await page.locator('#toolConcreteYield').click();
    await page.locator('#cyJob').selectOption('5');
    await page.waitForSelector('[data-cy-area]');
    await page.locator('[data-cy-area="1500"]').check();
    await page.locator('#cyThickness').fill('4');
    const result = await page.locator('#cyResult').innerText();
    assert.match(result, /On target: \+2\.6%/); assert.match(result, /19 yd³ delivered, 18\.52 yd³ planned/);
    await page.locator('[data-cy-area="200"]').check();
    assert.match(await page.locator('#cyResult').innerText(), /Under plan/);
    await page.locator('#cySave').click(); await page.waitForFunction(() => document.getElementById('cySave').textContent === 'Save Yield Check' && !document.getElementById('cySave').disabled);
    const y = posts.find(x => x.p === '/api/concrete/yield').body;
    assert.equal(y.area_sqft, '1700'); assert.equal(y.area_source, 'areas'); assert.equal(y.thickness_in, '4');
    assert.deepEqual(errors, []);
    console.log('concrete-quality PASS');
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
