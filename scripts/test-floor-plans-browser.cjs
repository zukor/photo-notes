'use strict';
/* Indoor locations in Property Manager Pro, in a real browser against a real server and database.
   Add floor plans (a photo-type image and a PDF page), set Indoor Location and a floor plan pin on Capture, save a photo
   with its indoor location, see it on the maintenance record and on the floor plan, edit it, and see it on the work link. */
const assert = require('node:assert/strict'), crypto = require('node:crypto'), jwt = require('jsonwebtoken'), { chromium } = require('playwright'), sharp = require('sharp'), fs = require('fs'), PDFDocument = require('pdfkit');
(async () => {
  const url = process.env.FLOOR_PLANS_TEST_DATABASE_URL; if (!url || !new URL(url).pathname.endsWith('/pn_floor_plans_browser')) throw Error('Dedicated pn_floor_plans_browser database required');
  process.env.DATABASE_URL = url; process.env.SESSION_SECRET = 'floor-plans-browser-secret'; process.env.UPLOAD_DIR = '/tmp/pn-floor-plans-browser'; fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
  const { pool, init } = require('../db'); await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await init();
  const { app } = require('../server'); const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  try {
    const mk = async (email, name) => (await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type) VALUES($1,$2,'unused','pro','property') RETURNING *", [email, name])).rows[0];
    const user = await mk('fp@example.invalid', 'Pat Manager'), outsider = await mk('fp-other@example.invalid', 'Other Co');
    const company = (await pool.query("INSERT INTO hoa_management_companies(name) VALUES('Oak Commercial') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO hoa_company_members(company_id,user_id,company_role) VALUES($1,$2,'administrator')", [company, user.id]);
    const community = (await pool.query("INSERT INTO hoa_communities(company_id,name,address) VALUES($1,'Oak Tower','100 Commerce St') RETURNING id", [company])).rows[0].id;
    const cookie = u => 'pn_token=' + jwt.sign({ id: u.id }, process.env.SESSION_SECRET);
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
    await page.context().addCookies([{ name: 'pn_token', value: jwt.sign({ id: user.id }, process.env.SESSION_SECRET), url: base }]);
    await page.addInitScript(() => { localStorage.setItem('pn_install_prompt_dismissed_v1', '1'); localStorage.setItem('pn_first_use_v1:fp%40example.invalid', 'done'); });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base); await page.waitForSelector('#tabCapture');

    // Floor plans: a photo of the posted map, and page 2 of a PDF.
    const mapImg = await sharp({ create: { width: 1000, height: 700, channels: 3, background: '#f4f4f4' } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><rect x="50" y="50" width="900" height="600" fill="none" stroke="#000" stroke-width="8"/></svg>') }]).jpeg().toBuffer();
    const pdf = await new Promise(res => { const d = new PDFDocument({ size: 'LETTER' }), parts = []; d.on('data', x => parts.push(x)); d.on('end', () => res(Buffer.concat(parts))); d.text('Cover page'); d.addPage(); d.rect(72, 72, 400, 300).stroke(); d.text('Level 3', 90, 90); d.end(); });
    await page.evaluate(async () => { await loadHoaContext(); renderHoaCommunities(); });
    await page.waitForSelector(`[data-floor-plans-community="${community}"]`);
    await page.locator(`[data-floor-plans-community="${community}"]`).click();
    await page.waitForSelector(`#fpNewSave${community}`);
    await page.locator(`#fpNewBuilding${community}`).fill('B'); await page.locator(`#fpNewFloor${community}`).fill('2');
    await page.locator(`#fpNewCamera${community}`).setInputFiles({ name: 'map.jpg', mimeType: 'image/jpeg', buffer: mapImg });
    await page.locator(`#fpNewSave${community}`).click();
    await page.waitForSelector('.fp-plan');
    await page.locator(`#fpNewFloor${community}`).fill('3');
    await page.locator(`#fpNewFile${community}`).setInputFiles({ name: 'plans.pdf', mimeType: 'application/pdf', buffer: pdf });
    assert.equal(await page.locator(`#fpNewPageWrap${community}`).isHidden(), false, 'PDF page number shown');
    await page.locator(`#fpNewPage${community}`).fill('2');
    await page.locator(`#fpNewSave${community}`).click();
    await page.waitForFunction(() => document.querySelectorAll('.fp-plan').length === 2, null, { timeout: 30000 });
    const plans = (await pool.query('SELECT * FROM property_floor_plans ORDER BY id')).rows;
    assert.deepEqual(plans.map(p => [p.building, p.floor, p.source]), [['B', '2', 'photo'], [null, '3', 'pdf']]);
    assert.ok(plans[1].width > 500 && fs.existsSync(process.env.UPLOAD_DIR + '/' + plans[1].photo_path.split('/').pop()), 'PDF page saved as an image');

    // Capture: Indoor Location with a floor plan pin.
    await page.evaluate(id => { state.communityId = String(id); state.view = 'capture'; renderApp(); }, community);
    await page.waitForSelector('#fpCaptureWrap');
    await page.locator('#fpCaptureWrap summary').click();
    await page.locator('#fpCapPlan').selectOption(String(plans[0].id));
    assert.equal(await page.locator('#fpCapBuilding').inputValue(), 'B'); assert.equal(await page.locator('#fpCapFloor').inputValue(), '2');
    await page.locator('#fpCapSuite').fill('210'); await page.locator('#fpCapRoom').fill('Mechanical room');
    await page.locator('#fpCapPin').click(); await page.waitForSelector('#fpImg');
    await page.waitForFunction(() => document.getElementById('fpImg').naturalWidth > 0);
    const box = await page.locator('#fpImg').boundingBox(); await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.75);
    await page.locator('#fpSave').click();
    assert.match(await page.locator('#fpCapPinStatus').innerText(), /Pin placed/);
    const taken = await page.evaluate(() => takeCaptureIndoor());
    assert.equal(taken.indoor_suite, '210'); assert.equal(taken.floor_plan_id, plans[0].id); assert.ok(Math.abs(Number(taken.floor_plan_x) - 0.25) < 0.02 && Math.abs(Number(taken.floor_plan_y) - 0.75) < 0.02);
    assert.equal(await page.evaluate(() => state._indoor.floor_plan_x), null, 'the pin is per photo');
    assert.equal(await page.evaluate(() => state._indoor.indoor_room), 'Mechanical room', 'building, floor, suite and room carry over');
    const fd = await page.evaluate(t => [...payloadFormData({ note: 'n', ...t }).keys()], taken);
    for (const k of ['indoor_building', 'indoor_floor', 'indoor_suite', 'indoor_room', 'floor_plan_id', 'floor_plan_x', 'floor_plan_y']) assert.ok(fd.includes(k), k);

    // Save a photo with that indoor location through the capture route.
    const photo = await sharp({ create: { width: 200, height: 150, channels: 3, background: '#357' } }).jpeg().toBuffer();
    const save = async (u, fields) => { const f = new FormData(); f.append('photo', new Blob([photo], { type: 'image/jpeg' }), 'p.jpg'); for (const [k, v] of Object.entries(fields)) f.append(k, String(v)); const r = await fetch(base + '/api/captures', { method: 'POST', headers: { Cookie: cookie(u), 'X-Photo-Notes-Capture-Id': crypto.randomUUID(), 'X-Photo-Notes-Edition': 'property', 'X-Photo-Notes-Account': crypto.createHash('sha256').update(u.email).digest('hex') }, body: f }); return { status: r.status, data: await r.json() }; };
    const saved = await save(user, { note: 'Water on floor by the chiller', hoa_community_id: community, hoa_area: 'Plumbing', hoa_title: 'Leak in mechanical room', ...taken });
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.indoor_suite, '210'); assert.equal(saved.data.floor_plan_id, plans[0].id); assert.ok(saved.data.maintenance_item);
    // A plan from another company is refused, and so is another company's photo.
    const other = await save(outsider, { note: 'x', hoa_community_id: community, floor_plan_id: plans[0].id });
    assert.equal(other.data.floor_plan_id ?? null, null, 'not applied to a property the user does not belong to');
    const otherEdit = await fetch(base + `/api/captures/${saved.data.id}/indoor`, { method: 'POST', headers: { Cookie: cookie(outsider), 'Content-Type': 'application/json' }, body: JSON.stringify({ indoor_room: 'x' }) });
    assert.equal(otherEdit.status, 404);

    // The maintenance record shows the indoor location, the floor plan pin, and lets you edit it.
    await page.evaluate(id => renderHoaItem(id), saved.data.maintenance_item.id);
    await page.waitForSelector(`[data-indoor-view="${saved.data.id}"]`);
    assert.match(await page.locator(`[data-indoor-text="${saved.data.id}"]`).first().innerText(), /Building B, Floor 2, Suite 210, Mechanical room/);
    await page.locator(`[data-indoor-view="${saved.data.id}"]`).first().click();
    await page.waitForSelector('#fpPin:not([hidden])');
    assert.match(await page.locator('#fpPin').getAttribute('style'), /left: 2[45]\./);
    await page.locator('#fpClose').click();
    await page.locator(`[data-indoor-edit="${saved.data.id}"]`).first().click(); await page.waitForSelector('#fpEditRoom');
    await page.locator('#fpEditRoom').fill('Chiller room'); await page.locator('#fpEditSave').click();
    await page.waitForFunction(id => /Chiller room/.test(document.querySelector(`[data-indoor-text="${id}"]`).textContent), saved.data.id);
    assert.equal((await pool.query('SELECT indoor_room FROM captures WHERE id=$1', [saved.data.id])).rows[0].indoor_room, 'Chiller room');

    // The work link shows the indoor location and the floor plan with the pin, even without GPS.
    await page.locator('#hoaCompletionName').fill('Lee Plumbing'); await page.locator('#hoaCompletionCreate').click();
    await page.waitForSelector('#hoaCompletionUrl'); const link = await page.locator('#hoaCompletionUrl').inputValue();
    const w = await browser.newPage({ viewport: { width: 390, height: 860 } }); w.on('pageerror', e => errors.push('worker: ' + e.message));
    await w.goto(base + new URL(link).pathname); await w.waitForFunction(() => !document.getElementById('wsIndoor').hidden);
    assert.match(await w.locator('#wsIndoorText').innerText(), /Building B, Floor 2, Suite 210, Chiller room/);
    assert.equal(await w.locator('#wsPlanPin').isHidden(), false); assert.match(await w.locator('#wsPlanLabel').innerText(), /Building B, Floor 2/);
    assert.match(await w.locator('#wsWhere').innerText(), /indoor location below/);
    if (process.env.FP_SHOT) await w.screenshot({ path: process.env.FP_SHOT, fullPage: true });

    // Removing a floor plan keeps existing pins.
    assert.equal((await fetch(base + '/api/property/floor-plans/' + plans[0].id, { method: 'POST', headers: { Cookie: cookie(user), 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) })).status, 200);
    assert.equal((await pool.query('SELECT floor_plan_id FROM captures WHERE id=$1', [saved.data.id])).rows[0].floor_plan_id, plans[0].id);
    assert.equal((await (await fetch(base + '/api/property/floor-plans?community_id=' + community, { headers: { Cookie: cookie(user) } })).json()).length, 1);
    assert.deepEqual(errors, []);
    console.log('floor-plans-browser PASS');
  } finally { await browser.close(); server.close(); await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
