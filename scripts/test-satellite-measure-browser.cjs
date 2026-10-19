'use strict';
/* Measure from Satellite in a real browser against a real server and database. Imagery and address search are served
   locally. Concrete: find an address, trace a patio, square it, check a side with a tape, save into an estimate.
   Paving: trace a street and a parking lot for a satellite takeoff with square yards and tons. */
const assert = require('node:assert/strict'), jwt = require('jsonwebtoken'), { chromium } = require('playwright'), sharp = require('sharp');
(async () => {
  const url = process.env.SATELLITE_BROWSER_TEST_DATABASE_URL; if (!url || !new URL(url).pathname.endsWith('/pn_satellite_browser')) throw Error('Dedicated pn_satellite_browser database required');
  process.env.DATABASE_URL = url; process.env.SESSION_SECRET = 'satellite-browser-secret'; process.env.UPLOAD_DIR = '/tmp/pn-satellite-browser'; delete process.env.MAPBOX_TOKEN;
  const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#5a7a55' } }).png().toBuffer();
  const nativeFetch = global.fetch;
  global.fetch = async (u, o) => String(u).startsWith('https://server.arcgisonline.com/') ? new Response(tile) : String(u).includes('findAddressCandidates') ? new Response(JSON.stringify({ candidates: [{ address: '5 Oak Ln, San Antonio, Texas', location: { x: -98.49, y: 29.42 } }] })) : nativeFetch(u, o);
  const { pool, init } = require('../db'); await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await init();
  const { app } = require('../server'); const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  const login = async (pro, email) => {
    const id = (await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type) VALUES($1,'Tracer','unused','pro',$2) RETURNING id", [email, pro])).rows[0].id;
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
    await page.route('https://server.arcgisonline.com/**', r => r.fulfill({ body: tile, contentType: 'image/png' }));
    await page.context().addCookies([{ name: 'pn_token', value: jwt.sign({ id }, process.env.SESSION_SECRET), url: base }]);
    await page.addInitScript(e => { localStorage.setItem('pn_install_prompt_dismissed_v1', '1'); localStorage.setItem('pn_first_use_v1:' + encodeURIComponent(e), 'done'); }, email);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    return { id, page, errors };
  };
  const tap = async (page, fx, fy) => { const b = await page.locator('#smMap').boundingBox(); await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy); };
  try {
    // ---- Concrete ----
    const c = await login('concrete', 'sat-concrete@example.invalid');
    const job = (await pool.query("INSERT INTO jobs(user_id,name,address) VALUES($1,'Oak Patio','5 Oak Ln') RETURNING id", [c.id])).rows[0].id;
    await c.page.goto(base); await c.page.locator('#tabCapture').click();
    await c.page.evaluate(() => { state.view = 'concrete-estimates'; renderApp(); });
    await c.page.locator('#cestJob').selectOption(String(job)); await c.page.locator('#cestNewQuick').click();
    await c.page.waitForSelector('#cestSatellite'); await c.page.locator('#cestSatellite').click();
    await c.page.waitForSelector('#smMap .leaflet-tile-loaded', { timeout: 15000 });
    await c.page.locator('#smSearch').fill('5 Oak Ln'); await c.page.locator('#smFind').click();
    await c.page.waitForFunction(() => window.PhotoNotesSatelliteMeasure && !document.querySelector('[data-sm-result]') && /Tap New Area/.test(document.getElementById('smHint').textContent));
    await c.page.locator('#smNewArea').click();
    for (const [x, y] of [[0.4, 0.35], [0.41, 0.6], [0.62, 0.61], [0.6, 0.34]]) await tap(c.page, x, y);
    assert.match(await c.page.locator('#smShapes').innerText(), /sq ft/);
    await c.page.locator('#smSquare').click();
    const sides = await c.page.$$eval('#smTapeSide option', o => o.map(x => x.textContent));
    assert.equal(sides.length, 4);
    await c.page.locator('#smFinish').click();
    await c.page.locator('#smTapeBox summary').click();
    await c.page.locator('#smTapeFt').fill(sides[0].match(/: (\d+) ft/)[1] + ' ft');
    await c.page.locator('#smTapeApply').click();
    assert.match(await c.page.locator('#smTapeStatus').innerText(), /Checked/);
    await c.page.locator('#smSave').click();
    await c.page.waitForFunction(() => !document.getElementById('satMeasure'), null, { timeout: 15000 });
    await c.page.waitForFunction(() => /Satellite map, checked with a tape/.test(document.getElementById('cestAreas').innerText), null, { timeout: 15000 });
    await c.page.waitForFunction(() => /cubic yards placed/.test(document.getElementById('cestResults').innerText), null, { timeout: 15000 });
    const area = (await pool.query('SELECT method, capture_id, geometry FROM concrete_areas WHERE user_id=$1', [c.id])).rows[0];
    assert.equal(area.method, 'map_checked'); assert.ok(area.capture_id, 'satellite picture saved'); assert.equal(area.geometry.points.length, 4);
    assert.deepEqual(c.errors, []);

    // ---- Paving ----
    const p = await login('paving', 'sat-paving@example.invalid');
    const pjob = (await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Oak Hills Streets') RETURNING id", [p.id])).rows[0].id;
    await p.page.goto(base); await p.page.waitForSelector('#tabCapture');
    await p.page.evaluate(() => { state.view = 'paving-takeoff'; renderApp(); });
    await p.page.locator('#ptoJob').selectOption(String(pjob)); await p.page.locator('#ptoMeasure').click();
    await p.page.waitForSelector('#smMap .leaflet-tile-loaded', { timeout: 15000 });
    await p.page.locator('#smSearch').fill('5 Oak Ln'); await p.page.locator('#smFind').click();
    await p.page.waitForFunction(() => /Tap New Area/.test(document.getElementById('smHint').textContent));
    await p.page.locator('#smNewStreet').click();
    for (const [x, y] of [[0.2, 0.2], [0.8, 0.8]]) await tap(p.page, x, y);
    await p.page.locator('[data-sm-width="0"]').fill('27');
    await p.page.locator('#smNewArea').click();
    for (const [x, y] of [[0.6, 0.15], [0.6, 0.35], [0.85, 0.35], [0.85, 0.15]]) await tap(p.page, x, y);
    await p.page.locator('#smFinish').click();
    await p.page.locator('#smSave').click();
    await p.page.waitForFunction(() => !document.getElementById('satMeasure'), null, { timeout: 15000 });
    await p.page.waitForFunction(() => /tons of asphalt to order/.test(document.getElementById('ptoTotals').innerText), null, { timeout: 15000 });
    const totals = await p.page.locator('#ptoTotals').innerText();
    assert.match(totals, /sq yd/); assert.match(totals, /ft of street/); assert.match(totals, /10% allowance/);
    const items = (await pool.query("SELECT kind, width_ft FROM paving_takeoff_items WHERE user_id=$1 ORDER BY id", [p.id])).rows;
    assert.deepEqual(items.map(i => i.kind), ['street', 'area']); assert.equal(Number(items[0].width_ft), 27);
    assert.deepEqual(p.errors, []);
    console.log('satellite-measure-browser PASS');
  } finally { global.fetch = nativeFetch; await browser.close(); server.close(); await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
