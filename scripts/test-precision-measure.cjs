#!/usr/bin/env node
/* Precision Measure end to end in a real browser with a simulated camera.
   Chromium plays a synthetic video of a 6-inch measuring card beside a pothole of known size as its camera.
   The test sets up the card, follows the live coaching to the automatic photo, traces the true pothole edge
   on the corrected view, enters depth, and checks the measurement saved to Capture against the truth.
   It also checks the coaching messages for a photo that is too far away. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const express = require('express'), { chromium } = require('playwright');
const E = require('../public/precision-measure-engine.js'), T = require('./precision-measure-accuracy.cjs');

const W = 1280, H = 960, S = 152.4; // a 6-inch card

function y4m(file, rgba, frames = 3) {
  const out = fs.openSync(file, 'w');
  fs.writeSync(out, `YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`);
  const Y = Buffer.alloc(W * H), UV = Buffer.alloc(W * H / 4, 128);
  for (let i = 0; i < W * H; i++) Y[i] = rgba[i * 4];
  for (let f = 0; f < frames; f++) { fs.writeSync(out, 'FRAME\n'); fs.writeSync(out, Y); fs.writeSync(out, UV); fs.writeSync(out, UV); }
  fs.closeSync(out);
}
function scene({ heightMm, tilt, seed }) {
  const rand = T.rng(seed);
  const poly = T.potholePolygon(S + 230, S / 2, 210, 150, rand);
  const target = { x: (S + poly.reduce((s, p) => s + p.x, 0) / poly.length) / 2, y: S / 2 };
  const cam = T.camera(W, H, 66, heightMm, tilt, 40, target);
  return { poly, rgba: T.render(W, H, cam.H, S, poly, rand) };
}

async function run(video, mode) {
  const app = express();
  app.get('/vendor/aruco/:file', (req, res) => res.sendFile(path.join(path.dirname(require.resolve('js-aruco2/src/aruco.js')), path.basename(req.params.file))));
  app.use(express.static(path.join(__dirname, '../public')));
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block', permissions: ['camera'] });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/**', route => {
      const p = new URL(route.request().url()).pathname;
      return route.fulfill({ json: p === '/api/me' ? { id: 1, email: 'tester@example.test', name: 'Tester', role: 'user', plan: 'pro', pro_type: 'paving', is_tester: true, feature_access: { measurements: true, ticket_scanner: true, camera_readers: true, before_after: true } } : [] });
    });
    await page.addInitScript(() => { localStorage.setItem('pn_install_prompt_dismissed_v1', 'dismissed'); localStorage.setItem('pn_first_use_v1:tester%40example.test', 'done'); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#tabCapture').click();
    await page.locator('#precisionMeasure').click();
    // Card setup on first use: the 6-inch card measured at exactly 6 inches.
    await page.locator('#pmCardSize').selectOption(String(S));
    await page.locator('#pmCardMeasured').fill('6');
    await page.locator('#pmCardSave').click();
    if (mode === 'far') {
      await page.waitForFunction(() => /closer/i.test(document.getElementById('pmGuide')?.textContent || ''), null, { timeout: 20000 }).catch(async e => { console.log('coaching said:', await page.locator('#pmGuide').innerText(), await page.locator('#pmAngle').innerText()); throw e; });
      assert.equal(await page.locator('#pmShoot').isDisabled(), true, 'the shutter stays off while the card is too far');
      await page.locator('#pmCancel').click();
      assert.deepEqual(errors, []);
      return { coaching: 'too_far' };
    }
    // Live coaching reaches "ready" and takes the photo by itself.
    await page.waitForSelector('#pmStage', { timeout: 30000 });
    const session = await page.evaluate(() => { const s = window.PhotoNotesPrecisionMeasure._session; return { tilt: s.tilt, refined: s.refined, w: s.plan.width, h: s.plan.height }; });
    return { page, session, errors };
  } catch (e) { await browser.close(); server.close(); throw e; }
  finally { if (mode === 'far') { await browser.close(); server.close(); } }
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-precision-'));
  // 1. Too far: the coaching asks the person to move closer and the shutter stays off.
  const far = scene({ heightMm: 2100, tilt: 3, seed: 5 }); y4m(path.join(dir, 'far.y4m'), far.rgba);
  const farResult = await run(path.join(dir, 'far.y4m'), 'far');
  assert.equal(farResult.coaching, 'too_far');
  // 2. Good position: automatic photo, outline the true edge, check the measurement.
  const good = scene({ heightMm: 900, tilt: 6, seed: 9 }); y4m(path.join(dir, 'good.y4m'), good.rgba);
  const truth = E.measureOutline(good.poly);
  const { page, session, errors } = await run(path.join(dir, 'good.y4m'), 'good');
  try {
    assert.ok(session.tilt < 15, 'the photo angle was estimated: ' + session.tilt);
    // Click each true vertex of the pothole on the corrected view.
    await page.locator('#pmZoomIn').click();
    for (const p of good.poly) {
      const xy = await page.evaluate(({ x, y }) => {
        const s = window.PhotoNotesPrecisionMeasure._session, E = window.PhotoNotesMeasureEngine, o = E.planeToOverhead(s.plan, x, y);
        const svg = document.querySelector('#pmZoom svg'), stage = document.getElementById('pmStage'), r0 = svg.getBoundingClientRect();
        const px = o.x / s.plan.width * r0.width, py = o.y / s.plan.height * r0.height;
        stage.scrollLeft = Math.max(0, px - stage.clientWidth / 2); stage.scrollTop = Math.max(0, py - stage.clientHeight / 2);
        const r = svg.getBoundingClientRect(); return { x: r.left + px, y: r.top + py };
      }, p);
      await page.mouse.click(xy.x, xy.y);
    }
    const readout = await page.locator('#pmReadout').innerText();
    assert.match(readout, /Length .* × Width .* Area/);
    await page.locator('#pmOutlineDone').click();
    await page.locator('#pmDepth').fill('2.5');
    await page.locator('#pmDepthDone').click();
    // Field test screen appears for testers; skip it here.
    if (await page.locator('#pmTapeSkip').count()) await page.locator('#pmTapeSkip').click();
    await page.waitForFunction(() => /Measured with the card/.test(document.getElementById('precisionMeasureStatus')?.textContent || ''), null, { timeout: 10000 });
    const saved = await page.evaluate(() => ({ dims: state._dims, record: state._measureRecord, hasPhoto: !!state.photoFile, fields: precisionMeasureFields() }));
    const accuracy = (a, b) => 100 - Math.abs(a - b) / b * 100;
    const L = Number(saved.dims.length) * 25.4, Wd = Number(saved.dims.width) * 25.4, A = Number(saved.dims.area) * 92903.04;
    const result = { tilt: session.tilt, length: accuracy(L, truth.lengthMm), width: accuracy(Wd, truth.widthMm), area: accuracy(A, truth.areaMm2) };
    console.log('Precision Measure in the browser with a simulated camera:', JSON.stringify(result));
    assert.ok(saved.hasPhoto, 'the measured photo becomes the Capture photo');
    assert.equal(saved.fields.dim_source, 'card'); assert.equal(saved.dims.depth, '2.5'); assert.equal(saved.record.method, 'card');
    assert.ok(result.area >= 97, 'area accuracy ' + result.area);
    assert.ok(Math.min(result.length, result.width) >= 95, 'length and width (rectangle around a round shape) ' + result.length + ' ' + result.width);
    assert.deepEqual(errors, []);
    console.log('precision-measure PASS');
  } finally { await page.context().browser().close(); process.exit(process.exitCode || 0); }
})().catch(e => { console.error(e); process.exit(1); });
