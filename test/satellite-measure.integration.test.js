const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
test('measure from satellite: address search, Concrete areas, Paving takeoff, pictures and spreadsheet', { skip: process.env.PN_SATELLITE_TEST !== '1', timeout: 60000 }, async () => {
  process.env.DATABASE_URL = process.env.PN_LEGACY_TEST_DATABASE_URL;
  process.env.SESSION_SECRET = 'satellite-local-session-secret';
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-satellite-'));
  delete process.env.MAPBOX_TOKEN;
  const { pool, init } = require('../db'); await init();
  const sharp = require('sharp'), tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#557755' } }).png().toBuffer();
  const nativeFetch = global.fetch; let tiles = 0;
  // Only imagery and the address service are intercepted; nothing leaves this machine.
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://server.arcgisonline.com/')) { tiles++; return new Response(tile, { status: 200 }); }
    if (u.startsWith('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates')) return new Response(JSON.stringify({ candidates: [{ address: '5 Oak Ln, San Antonio, Texas', location: { x: -98.49, y: 29.42 } }] }), { status: 200 });
    return nativeFetch(url, opts);
  };
  const { app } = require('../server'), jwt = require('jsonwebtoken');
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const mk = async pro => (await pool.query("INSERT INTO users(email,password_hash,role,plan,pro_type,name) VALUES($1,'x','user','pro',$2,'Sat Test') RETURNING id", [pro + Date.now() + Math.random() + '@example.invalid', pro])).rows[0].id;
    const concrete = await mk('concrete'), paving = await mk('paving'), general = await mk('general');
    const cookie = id => 'pn_token=' + jwt.sign({ id }, process.env.SESSION_SECRET);
    const call = async (route, body, id, method = body ? 'POST' : 'GET') => { const r = await fetch(base + route, { method, headers: { Cookie: cookie(id), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); const t = r.headers.get('content-type') || ''; return { status: r.status, body: t.includes('json') ? await r.json() : await r.text() }; };
    const lat = 29.42, lng = -98.49, dy = f => f / 3.280839895 / 111320, dx = f => f / 3.280839895 / 111320 / Math.cos(lat * Math.PI / 180);
    const rect = (w, h, x0 = 0) => [{ lat, lng: lng + dx(x0) }, { lat: lat + dy(h), lng: lng + dx(x0) }, { lat: lat + dy(h), lng: lng + dx(x0 + w) }, { lat, lng: lng + dx(x0 + w) }];

    assert.equal((await call('/api/satellite/search?q=5 Oak Ln', null, general)).status, 403, 'Concrete Pro and Paving Pro only');
    const found = await call('/api/satellite/search?q=5 Oak Ln', null, concrete);
    assert.equal(found.body.results[0].label, '5 Oak Ln, San Antonio, Texas');

    // Concrete: traced patio, checked with a tape, becomes a measured area with a satellite picture on the job.
    const cjob = (await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Patio') RETURNING id", [concrete])).rows[0].id;
    const saved = await call('/api/concrete/areas/satellite', { job_id: cjob, picture: true, source: 'esri', shapes: [{ type: 'area', name: 'Back patio', points: rect(20, 40), scale: 1.025, checked: true }] }, concrete);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const area = saved.body.areas[0];
    assert.equal(area.method, 'map_checked'); assert.ok(Math.abs(Number(area.area_sqft) - 840.5) < 0.5); assert.ok(area.capture_id);
    const pic = (await pool.query('SELECT photo_path, job_id, concrete_phase FROM captures WHERE id=$1', [area.capture_id])).rows[0];
    assert.equal(pic.job_id, cjob); assert.equal(pic.concrete_phase, 'proposal');
    assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, path.basename(pic.photo_path)))); assert.ok(tiles > 0);
    assert.equal((await call('/api/concrete/areas/satellite', { job_id: cjob, shapes: [{ type: 'street', points: rect(0, 50).slice(0, 2), width_ft: 20 }] }, concrete)).status, 400, 'streets are a Paving tool');
    assert.equal((await call('/api/paving/takeoff?job_id=' + cjob, null, concrete)).status, 403);

    // Estimates pick up the area with the satellite-checked label.
    const est = (await call('/api/concrete/estimates', { job_id: cjob, kind: 'quick' }, concrete)).body.estimate;
    const ev = (await call('/api/concrete/estimates/' + est.id, { area_ids: [area.id], spec: { thickness_in: 4 } }, concrete)).body;
    assert.equal(ev.options[0].takeoff.areas[0].contingency_pct, 3);

    // Paving: a parking lot, a street and a curb line.
    const pjob = (await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Oak Hills') RETURNING id", [paving])).rows[0].id;
    const tk = await call('/api/paving/takeoff', { job_id: pjob, picture: true, thickness_in: 2, shapes: [
      { type: 'area', name: 'Church lot', points: rect(90, 100) },
      { type: 'street', name: 'Oak Lane', points: rect(0, 1000, 200).slice(0, 2), width_ft: 27 },
      { type: 'line', name: 'Curb', points: rect(0, 300, 120).slice(0, 2) }] }, paving);
    assert.equal(tk.status, 200, JSON.stringify(tk.body));
    const t = tk.body.totals;
    assert.equal(t.area_sqft, 36000); assert.equal(t.area_sy, 4000); assert.equal(t.street_ft, 1000); assert.equal(t.line_ft, 300);
    assert.equal(t.adjusted_sy, 4400, '10% allowance without a tape check');
    assert.equal(t.tons, Math.ceil(4400 * 2 * 110 / 2000 * 1.05));
    const csv = (await call(`/api/paving/takeoff.csv?job_id=${pjob}&thickness_in=2`, null, paving)).body;
    assert.match(csv, /Oak Lane,street,27000/); assert.match(csv, /tons to order/);
    const lot = tk.body.items.find(i => i.name === 'Church lot');
    assert.equal((await call('/api/paving/takeoff/' + lot.id, null, concrete, 'DELETE')).status, 403);
    assert.equal((await call('/api/paving/takeoff/' + lot.id, null, paving, 'DELETE')).status, 200);
    assert.equal((await call('/api/paving/takeoff?job_id=' + pjob, null, paving)).body.items.length, 2);
    // Imagery outage: measurements still save, without the picture.
    global.fetch = async (url, opts) => String(url).startsWith('https://server.arcgisonline.com/') ? new Response('', { status: 503 }) : nativeFetch(url, opts);
    const down = await call('/api/paving/takeoff', { job_id: pjob, picture: true, shapes: [{ type: 'area', name: 'Side lot', points: rect(30, 30) }] }, paving);
    assert.equal(down.status, 200); assert.equal(down.body.picture_failed, true);
  } finally { global.fetch = nativeFetch; server.close(); await pool.end(); }
});
