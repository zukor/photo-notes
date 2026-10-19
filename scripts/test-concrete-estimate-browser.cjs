'use strict';
/* Concrete Pro estimating in a real browser against a real server and database:
   price list with examples, Quick Estimate with a measured area, a detailed estimate with options and a city preset,
   live quantities and prices, and proposal and spreadsheet downloads. */
const assert = require('node:assert/strict'), jwt = require('jsonwebtoken'), { chromium } = require('playwright');
(async () => {
  const url = process.env.CONCRETE_ESTIMATE_TEST_DATABASE_URL; if (!url || !new URL(url).pathname.endsWith('/pn_concrete_estimate_browser')) throw Error('Dedicated pn_concrete_estimate_browser database required');
  process.env.DATABASE_URL = url; process.env.SESSION_SECRET = 'concrete-estimate-browser-secret'; process.env.UPLOAD_DIR = '/tmp/pn-concrete-estimate-browser';
  const { pool, init } = require('../db'); await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await init();
  const { app } = require('../server'); const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`; const browser = await chromium.launch();
  try {
    const user = (await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type) VALUES('est@example.invalid','Estimator','unused','pro','concrete') RETURNING id")).rows[0].id;
    const job = (await pool.query("INSERT INTO jobs(user_id,name,customer,address) VALUES($1,'Garcia Driveway','Ana Garcia','5 Oak Ln') RETURNING id", [user])).rows[0].id;
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block', acceptDownloads: true });
    await page.context().addCookies([{ name: 'pn_token', value: jwt.sign({ id: user }, process.env.SESSION_SECRET), url: base }]);
    await page.addInitScript(() => { localStorage.setItem('pn_install_prompt_dismissed_v1', '1'); localStorage.setItem('pn_first_use_v1:est%40example.invalid', 'done'); });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.locator('#tabCapture').click();
    await page.evaluate(() => { state.view = 'camera-tools'; renderApp(); });

    // Price list: examples fill only blanks and are marked.
    await page.locator('#toolConcretePriceBook').click();
    await page.locator('#cpb_labor_place_sf').fill('4.5');
    await page.locator('#cpbExamples').click();
    assert.equal(await page.locator('#cpb_concrete_cy').inputValue(), '140'); assert.equal(await page.locator('#cpbEx_concrete_cy').innerText(), 'EXAMPLE');
    for (const [k, v] of [['forms_lf', '2'], ['sawcut_lf', '1'], ['mobilization_ea', '150'], ['rebar_lf', '1.4'], ['chair_ea', '0.5'], ['finish_stamped_sf', '6'], ['finish_colored_sf', '1.5'], ['permit_ea', '250']]) await page.locator('#cpb_' + k).fill(v);
    await page.locator('#cpbSave').click(); await page.waitForFunction(() => /Price list saved/.test(document.body.innerText));

    // Quick Estimate: one rectangle measured with a tape.
    await page.locator('#concreteToolBack').click(); await page.locator('#toolConcreteQuick').click();
    await page.locator('#cestJob').selectOption(String(job)); await page.locator('#cestNewQuick').click();
    await page.waitForSelector('#cestAddArea'); await page.locator('#cestAddArea').click();
    await page.locator('#cestAName').fill('Driveway'); await page.locator('#cestDim_length').fill("40' 6\""); await page.locator('#cestDim_width').fill('18 ft');
    assert.match(await page.locator('#cestAPreview').innerText(), /729 sq ft/);
    await page.locator('#cestASave').click();
    await page.waitForFunction(() => /Driveway: \$/.test(document.getElementById('cestResults').innerText) || /Proposal: \$/.test(document.getElementById('cestResults').innerText), null, { timeout: 15000 });
    let results = await page.locator('#cestResults').innerText();
    assert.match(results, /729 sq ft, 9 cubic yards placed, 10 to order/);
    // Kyle preset changes thickness and reinforcement and adds the permit.
    await page.locator('#cestCity').selectOption('kyle');
    assert.equal(await page.locator('#cestThick').inputValue(), '5'); assert.equal(await page.locator('#cestReinf').inputValue(), 'rebar');
    assert.match(await page.locator('#cestCityNotes').innerText(), /Wire mesh and fiber are not allowed/);
    await page.waitForFunction(() => /11\.25 cubic yards placed, 13 to order/.test(document.getElementById('cestResults').innerText), null, { timeout: 15000 });
    results = await page.locator('#cestResults').innerText();
    assert.match(results, /Rebar #3 at 18 in each way/); assert.match(results, /Permit and inspections/);
    assert.match(results, /Your price list still contains example prices/);
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.locator('#cestPdf').click()]);
    assert.match(pdf.suggestedFilename(), /concrete-proposal-\d+\.pdf/);
    const [csv] = await Promise.all([page.waitForEvent('download'), page.locator('#cestCsv').click()]);
    assert.match(require('fs').readFileSync(await csv.path(), 'utf8'), /Driveway,729/);

    // Detailed estimate with three options.
    await page.locator('#concreteToolBack').click(); await page.locator('#cestJob').selectOption(String(job));
    await page.locator('#cestNewDetailed').click(); await page.waitForSelector('[data-cest-area]');
    await page.locator('[data-cest-area]').first().check();
    await page.waitForFunction(() => (document.getElementById('cestResults').innerText.match(/\$/g) || []).length > 6, null, { timeout: 15000 });
    results = await page.locator('#cestResults').innerText();
    assert.match(results, /Good: \$/); assert.match(results, /Better: \$/); assert.match(results, /Best: \$/);
    const total = n => Number((results.match(new RegExp(n + ': \\$([\\d,.]+)')) || [])[1].replace(/,/g, ''));
    assert.ok(total('Best') > total('Better') && total('Better') > total('Good'));
    await page.locator('#cestCk_access').fill('Gate is 12 ft wide, no overhead lines');
    await page.locator('#cestSave').click(); await page.waitForFunction(() => /Saved\./.test(document.getElementById('cestStatusLine').textContent));
    const saved = (await pool.query("SELECT checklist, options FROM concrete_estimates WHERE kind='detailed'")).rows[0];
    assert.equal(saved.checklist.access.answer, 'Gate is 12 ft wide, no overhead lines'); assert.equal(saved.options.length, 3);
    // Plan and Control Joints drawn for the driveway.
    await page.locator('[data-cest-plan]').first().click();
    assert.match(await page.locator('.cest-plan svg').first().getAttribute('aria-label'), /control joints/);
    assert.ok(await page.locator('.cest-plan svg line').count() > 0, 'joint lines drawn');

    // Measure Repair on a Photo: a 1000 by 800 job photo, 200 px is 2 ft, a 4 ft by 2 ft broken panel.
    const sharp = require('sharp'), fs = require('fs'), path = require('path'); fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'crack.jpg'), await sharp({ create: { width: 1000, height: 800, channels: 3, background: '#9a9a9a' } }).jpeg().toBuffer());
    await pool.query("INSERT INTO captures(user_id,job_id,photo_path,note) VALUES($1,$2,'/uploads/crack.jpg','Broken panel')", [user, job]);
    await page.locator('#cestRepair').click();
    await page.locator('[data-cest-repair-photo]').first().click();
    await page.waitForFunction(() => { const i = document.getElementById('roImg'); return i && i.complete && i.naturalWidth === 1000; }, null, { timeout: 8000 }).catch(async e => { console.log('DEBUG', await page.evaluate(() => ({ ro: !!document.getElementById('repairOutline'), src: document.getElementById('roImg') && document.getElementById('roImg').src, nw: document.getElementById('roImg') && document.getElementById('roImg').naturalWidth, pick: document.getElementById('cestRepairPhotos').innerHTML.slice(0, 300) }))); throw e; });
    const tapImg = async (fx, fy) => { const b = await page.locator('#roImg').boundingBox(); await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy); };
    await page.locator('#roName').fill('Broken panel');
    await tapImg(0.1, 0.5); await tapImg(0.3, 0.5);
    await page.locator('#roRefFt').fill('2 ft'); await page.locator('#roTraceMode').click();
    for (const [x, y] of [[0.4, 0.25], [0.8, 0.25], [0.8, 0.5], [0.4, 0.5]]) await tapImg(x, y);
    const measured = Number((await page.locator('#roResult').innerText()).match(/([\d.]+) sq ft/)[1]);
    assert.ok(Math.abs(measured - 8) < 0.3, 'about 8 sq ft: ' + measured);
    await page.locator('#roSave').click();
    await page.waitForFunction(() => !document.getElementById('repairOutline') && /Remove and replace/.test(document.getElementById('cestAreas').innerText), null, { timeout: 15000 });
    await page.waitForFunction(() => /Remove damaged concrete/.test(document.getElementById('cestResults').textContent), null, { timeout: 15000 });
    const rep = (await pool.query("SELECT repair_kind, method, capture_id FROM concrete_areas WHERE name='Broken panel'")).rows[0];
    assert.equal(rep.repair_kind, 'replace'); assert.equal(rep.method, 'photo_ref'); assert.ok(rep.capture_id);
    assert.deepEqual(errors, []);
    console.log('concrete-estimate-browser PASS');
  } finally { await browser.close(); server.close(); await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
