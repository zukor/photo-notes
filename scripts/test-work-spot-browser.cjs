'use strict';
/* Work link in real browsers against a real server and database. A property manager opens a maintenance record,
   sees Go to Photo Spot, and creates a work link with instructions. The person doing the work opens the link on a phone
   with no account: sees the problem, the photo and a map pin, gets directions, uses Find the Spot with a simulated
   location walking up to the spot, and sends a completion photo that is saved with its location. */
const assert = require('node:assert/strict'), jwt = require('jsonwebtoken'), { chromium } = require('playwright'), sharp = require('sharp'), fs = require('fs'), path = require('path');
(async () => {
  const url = process.env.WORK_SPOT_TEST_DATABASE_URL; if (!url || !new URL(url).pathname.endsWith('/pn_work_spot_browser')) throw Error('Dedicated pn_work_spot_browser database required');
  process.env.DATABASE_URL = url; process.env.SESSION_SECRET = 'work-spot-browser-secret'; process.env.UPLOAD_DIR = '/tmp/pn-work-spot-browser'; fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
  const { pool, init } = require('../db'); await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await init();
  const { app } = require('../server'); const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch();
  const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#6b8a6b' } }).png().toBuffer();
  const blockTiles = page => page.route(/arcgisonline\.com|tile\.openstreetmap\.org/, r => r.fulfill({ body: tile, contentType: 'image/png' }));
  try {
    const user = (await pool.query("INSERT INTO users(email,name,password_hash,plan,pro_type) VALUES('pm@example.invalid','Pat Manager','unused','pro','property') RETURNING id")).rows[0].id;
    const company = (await pool.query("INSERT INTO hoa_management_companies(name) VALUES('Oak Commercial') RETURNING id")).rows[0].id;
    await pool.query("INSERT INTO hoa_company_members(company_id,user_id,company_role) VALUES($1,$2,'administrator')", [company, user]);
    const community = (await pool.query("INSERT INTO hoa_communities(company_id,name,address) VALUES($1,'Oak Plaza','100 Commerce St, San Antonio, TX') RETURNING id", [company])).rows[0].id;
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'light.jpg'), await sharp({ create: { width: 800, height: 600, channels: 3, background: '#888' } }).jpeg().toBuffer());
    const spot = { lat: 29.42410, lng: -98.49360 };
    const cap = (await pool.query("INSERT INTO captures(user_id,photo_path,note,latitude,longitude,location_accuracy_m,camera_direction) VALUES($1,'/uploads/light.jpg','Pole light out by loading dock',$2,$3,5,90) RETURNING id", [user, spot.lat, spot.lng])).rows[0].id;
    const item = (await pool.query("INSERT INTO hoa_maintenance_items(company_id,community_id,title,description,area,priority,created_by,capture_id) VALUES($1,$2,'Parking light out','Pole light by the loading dock is out','Lighting','high',$3,$4) RETURNING id", [company, community, user, cap])).rows[0].id;
    await pool.query("INSERT INTO hoa_item_photos(item_id,capture_id,photo_stage) VALUES($1,$2,'initial')", [item, cap]);

    // ---- Manager in the app ----
    const mgr = await browser.newPage({ viewport: { width: 390, height: 900 }, serviceWorkers: 'block' });
    await mgr.context().addCookies([{ name: 'pn_token', value: jwt.sign({ id: user }, process.env.SESSION_SECRET), url: base }]);
    await mgr.addInitScript(() => { localStorage.setItem('pn_install_prompt_dismissed_v1', '1'); localStorage.setItem('pn_first_use_v1:pm%40example.invalid', 'done'); });
    const errors = []; mgr.on('pageerror', e => errors.push('manager: ' + e.message));
    await mgr.goto(base); await mgr.waitForSelector('#tabCapture');
    await mgr.evaluate(id => renderHoaItem(id), item);
    await mgr.waitForSelector('#hoaGoToSpot');
    assert.equal(await mgr.locator('#hoaGoToSpot').getAttribute('data-location-id'), String(cap));
    await mgr.locator('#hoaCompletionName').fill('Lee Electric');
    await mgr.locator('#hoaCompletionInstructions').fill('Ladder is in the dock storage room');
    await mgr.locator('#hoaCompletionCreate').click();
    await mgr.waitForSelector('#hoaCompletionUrl');
    const link = await mgr.locator('#hoaCompletionUrl').inputValue();
    assert.match(link, /\/completion-photos\/[A-Za-z0-9_-]{20,}$/);
    assert.match(decodeURIComponent(await mgr.locator('#hoaCompletionText').getAttribute('href')), /Work order: Parking light out\. .*completion-photos/);
    assert.deepEqual(errors, []);

    // ---- Worker on a phone, no account ----
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, hasTouch: true, geolocation: { latitude: spot.lat - 0.0009, longitude: spot.lng, accuracy: 8 }, permissions: ['geolocation'], userAgent: 'Mozilla/5.0 (Linux; Android 14) Mobile' });
    const w = await ctx.newPage(); w.on('pageerror', e => errors.push('worker: ' + e.message)); await blockTiles(w);
    await w.goto(new URL(link).pathname.replace(/^/, base));
    await w.waitForFunction(() => !document.getElementById('wsContent').hidden);
    assert.equal(await w.locator('#wsTitle').innerText(), 'Parking light out');
    const details = await w.locator('#wsDetails').innerText();
    assert.match(details, /Oak Plaza/); assert.match(details, /100 Commerce St/); assert.match(details, /Priority: High/); assert.match(details, /Ladder is in the dock storage room/); assert.match(details, /Sent to: Lee Electric/);
    assert.match(await w.locator('#wsWhere').innerText(), /pin is where the photo was taken.*facing east/);
    assert.equal(await w.locator('#wsDirections').getAttribute('href'), `https://www.google.com/maps/dir/?api=1&destination=${spot.lat},${spot.lng}`);
    await w.waitForSelector('#wsMap .leaflet-marker-icon');
    // The worker has no account: the photo link is signed, loads, and the plain file address stays private.
    const signedSrc = await w.locator('#wsMainPhoto').getAttribute('src');
    assert.match(signedSrc, /^\/uploads\/light\.jpg\?exp=\d+&sig=[0-9a-f]{64}$/);
    await w.waitForFunction(() => document.getElementById('wsMainPhoto').naturalWidth > 0);
    assert.equal((await fetch(base + signedSrc)).status, 200);
    assert.equal((await fetch(base + '/uploads/light.jpg')).status, 401);
    // The manager's history shows the link was opened.
    assert.equal((await pool.query("SELECT count(*)::int n FROM hoa_item_history WHERE item_id=$1 AND action='work_link_opened'", [item])).rows[0].n, 1);
    assert.ok((await pool.query('SELECT opened_at FROM hoa_completion_photo_requests WHERE item_id=$1', [item])).rows[0].opened_at);

    // Find the Spot: about 100 m (330 ft) south, so head north; then walk up to it.
    await w.locator('#wsFind').click();
    await w.waitForFunction(() => /ft away/.test(document.getElementById('wsDistance').textContent));
    const far = await w.locator('#wsDistance').innerText();
    const feet = Number(far.match(/([\d,]+) ft away/)[1].replace(/,/g, ''));
    assert.ok(feet > 300 && feet < 360, far);
    assert.match(await w.locator('#wsDirectionText').innerText(), /Head north/);
    await ctx.setGeolocation({ latitude: spot.lat + 0.00002, longitude: spot.lng, accuracy: 5 });
    await w.waitForFunction(() => /You are at the spot/.test(document.getElementById('wsDistance').textContent), null, { timeout: 15000 });
    if (process.env.WS_SHOT) await w.screenshot({ path: process.env.WS_SHOT, fullPage: true });

    // Completion photo: taken now, so it gets the phone's location.
    const done = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#ddd' } }).jpeg().toBuffer();
    await w.locator('#wsName').fill('Lee'); await w.locator('#wsNote').fill('Replaced ballast and bulb');
    await w.locator('#wsPhotos').setInputFiles({ name: 'fixed.jpg', mimeType: 'image/jpeg', buffer: done });
    await w.waitForFunction(() => /Location saved/.test(document.getElementById('wsFiles').textContent));
    await w.locator('#wsSubmit').click();
    await w.waitForFunction(() => /Photos Received/.test(document.body.innerText), null, { timeout: 15000 });
    const saved = (await pool.query("SELECT c.latitude, c.longitude, c.location_accuracy_m, c.property_community_id, c.captured_by FROM hoa_item_photos p JOIN captures c ON c.id=p.capture_id WHERE p.item_id=$1 AND p.photo_stage='completed_work'", [item])).rows;
    assert.equal(saved.length, 1); assert.ok(Math.abs(Number(saved[0].latitude) - spot.lat) < 0.0001, 'completion photo saved at the spot');
    assert.equal(Number(saved[0].property_community_id), community); assert.equal(saved[0].captured_by, 'Lee');
    // The link closes after photos are sent.
    assert.equal((await fetch(link.replace(/^https?:\/\/[^/]+/, base))).status, 410);

    // A record whose photo has no GPS: directions use the property address, no map or Find the Spot.
    const cap2 = (await pool.query("INSERT INTO captures(user_id,photo_path,note) VALUES($1,'/uploads/light.jpg','Door') RETURNING id", [user])).rows[0].id;
    const item2 = (await pool.query("INSERT INTO hoa_maintenance_items(company_id,community_id,title,area,created_by,capture_id) VALUES($1,$2,'Door closer','Doors, Locks and Access Control',$3,$4) RETURNING id", [company, community, user, cap2])).rows[0].id;
    const tok = 'nogpsworklinktoken000000000000';
    await pool.query("INSERT INTO hoa_completion_photo_requests(item_id,token,expires_at,created_by) VALUES($1,$2,now()+interval '1 day',$3)", [item2, tok, user]);
    const w2 = await ctx.newPage(); w2.on('pageerror', e => errors.push('worker2: ' + e.message)); await blockTiles(w2);
    await w2.goto(base + '/completion-photos/' + tok);
    await w2.waitForFunction(() => !document.getElementById('wsContent').hidden);
    assert.match(await w2.locator('#wsDirections').getAttribute('href'), /destination=100%20Commerce%20St/);
    assert.equal(await w2.locator('#wsFind').isHidden(), true);
    assert.match(await w2.locator('#wsWhere').innerText(), /no saved location/);
    assert.equal((await fetch(base + '/api/public/work-spot/not-a-real-token')).status, 404);
    assert.deepEqual(errors, []);
    console.log('work-spot-browser PASS');
  } finally { await browser.close(); server.close(); await pool.end(); }
})().catch(e => { console.error(e); process.exit(1); });
