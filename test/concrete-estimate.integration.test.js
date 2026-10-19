const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
test('concrete estimating: areas, price list, estimate, site photo, proposal, quantities and bid versus actual', { skip: process.env.PN_CONCRETE_ESTIMATE_TEST !== '1', timeout: 60000 }, async () => {
  process.env.DATABASE_URL = process.env.PN_LEGACY_TEST_DATABASE_URL;
  process.env.SESSION_SECRET = 'concrete-estimate-local-session-secret';
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-concrete-estimate-'));
  delete process.env.ANTHROPIC_API_KEY;
  const { pool, init } = require('../db'); await init();
  const { app } = require('../server'), jwt = require('jsonwebtoken'), sharp = require('sharp');
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const mk = async pro => (await pool.query("INSERT INTO users(email,password_hash,role,plan,pro_type,name) VALUES($1,'x','user','pro',$2,'Ramo Test') RETURNING id", [pro + Date.now() + Math.random() + '@example.invalid', pro])).rows[0].id;
    const user = await mk('concrete'), other = await mk('concrete'), paving = await mk('paving');
    const cookie = id => 'pn_token=' + jwt.sign({ id }, process.env.SESSION_SECRET);
    const call = async (route, body, id = user, method = body ? 'POST' : 'GET') => { const r = await fetch(base + route, { method, headers: { Cookie: cookie(id), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.arrayBuffer(), type: r.headers.get('content-type') }; };
    const job = (await pool.query("INSERT INTO jobs(user_id,name,customer,address) VALUES($1,'Smith Patio','Pat Smith','12 Elm St') RETURNING id", [user])).rows[0].id;
    assert.equal((await call('/api/concrete/areas?job_id=' + job, null, paving)).status, 403, 'Concrete Pro only');
    assert.equal((await call('/api/concrete/areas?job_id=' + job, null, other)).status, 400, 'another account cannot use this job');

    // Areas: entered, from a saved outline, and imported from plans.
    const a1 = await call('/api/concrete/areas', { job_id: job, name: 'Back patio', shape: 'rect', dims: { length: '20 ft', width: '12 ft' }, method: 'tape' });
    assert.equal(a1.status, 200); assert.equal(Number(a1.body.area.area_sqft), 240);
    assert.equal((await call('/api/concrete/areas', { job_id: job, name: 'Bad', shape: 'rect', dims: { length: '20' } })).status, 400);
    const cap = (await pool.query("INSERT INTO captures(user_id,job_id,photo_path) VALUES($1,$2,'/uploads/p.jpg') RETURNING id", [user, job])).rows[0].id;
    const fp = (await pool.query("INSERT INTO concrete_footprints(user_id,capture_id,name,field_length_ft,field_width_ft,field_method,field_area_sqft) VALUES($1,$2,'Side walk',30,4,'laser',120) RETURNING id", [user, cap])).rows[0].id;
    let list = (await call('/api/concrete/areas?job_id=' + job)).body; assert.equal(list.saved_outlines.length, 1);
    const a2 = await call('/api/concrete/areas/from-outline', { job_id: job, footprint_id: fp });
    assert.equal(a2.status, 200, JSON.stringify(a2.body)); assert.equal(a2.body.area.method, 'laser'); assert.equal(Number(a2.body.area.area_sqft), 120);
    list = (await call('/api/concrete/areas?job_id=' + job)).body; assert.equal(list.saved_outlines.length, 0, 'an outline is offered once');
    const imp = await call('/api/concrete/areas/import', { job_id: job, csv: 'name,sqft,edge,thickness\nPad A,400,80,6' });
    assert.equal(imp.status, 200); assert.equal(imp.body.areas[0].method, 'plans');

    // Price list with examples marked.
    const pb = await call('/api/concrete/price-book', { prices: { concrete_cy: 140, labor_place_sf: 4, forms_lf: 2, sawcut_lf: 1, mobilization_ea: 150, short_load_cy: 43, finish_stamped_sf: 6, finish_colored_sf: 1.5, base_cy: 60 }, examples: ['concrete_cy', 'labor_place_sf'], settings: { concrete_waste_pct: 10, rebar_waste_pct: 25 } });
    assert.deepEqual(pb.body.examples, ['concrete_cy'], 'only real example values are marked');
    assert.equal((await call('/api/concrete/price-book', { prices: { concrete_cy: -5 } })).status, 400);

    // Estimate with the patio and walk, three options, and the city preset.
    const est = (await call('/api/concrete/estimates', { job_id: job, kind: 'detailed' })).body.estimate;
    assert.equal(est.customer.name, 'Pat Smith'); assert.equal(est.options.length, 3);
    const saved = await call('/api/concrete/estimates/' + est.id, { area_ids: [a1.body.area.id, a2.body.area.id, 999999], spec: { city: 'kyle', thickness_in: 4, finish: 'broom', permit: false }, checklist: { access: { answer: 'Gate is 10 ft wide' } } });
    assert.equal(saved.status, 200); assert.deepEqual(saved.body.estimate.area_ids, [a1.body.area.id, a2.body.area.id], 'unknown areas are dropped');
    const good = saved.body.options[0];
    assert.equal(good.takeoff.area_sqft, 360); assert.equal(good.takeoff.purchase_cy, 5);
    assert.equal(good.pricing.complete, true); assert.ok(good.pricing.total > 0);
    assert.ok(saved.body.options[2].pricing.total > good.pricing.total, 'stamped costs more');

    // Site photo becomes a proposal-phase Concrete photo on the job.
    const image = await sharp({ create: { width: 60, height: 60, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const f = new FormData(); f.append('photo', new Blob([image], { type: 'image/jpeg' }), 'gate.jpg'); f.append('key', 'access');
    const ph = await (await fetch(base + `/api/concrete/estimates/${est.id}/checklist-photo`, { method: 'POST', headers: { Cookie: cookie(user) }, body: f })).json();
    assert.equal(ph.checklist.access.photos.length, 1); assert.equal(ph.checklist.access.answer, 'Gate is 10 ft wide');
    const c = (await pool.query('SELECT job_id, concrete_phase, concrete_purpose FROM captures WHERE id=$1', [ph.capture.id])).rows[0];
    assert.deepEqual(c, { job_id: job, concrete_phase: 'proposal', concrete_purpose: 'access' });

    // Proposal, quantities and bid versus actual.
    for (const doc of ['pdf', 'docx']) { const r = await call(`/api/concrete/estimates/${est.id}/proposal?doc=${doc}`); assert.equal(r.status, 200); assert.ok(r.body.byteLength > 1500, doc); }
    const plainSize = (await call(`/api/concrete/estimates/${est.id}/proposal?doc=pdf`)).body.byteLength;

    // Repairs measured on a job photo, saved as measured areas, priced and drawn in the proposal.
    const shot = await sharp({ create: { width: 1000, height: 800, channels: 3, background: '#999' } }).jpeg().toBuffer();
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'damage.jpg'), shot);
    const dmg = (await pool.query("INSERT INTO captures(user_id,job_id,photo_path) VALUES($1,$2,'/uploads/damage.jpg') RETURNING id", [user, job])).rows[0].id;
    const loose = (await pool.query("INSERT INTO captures(user_id,photo_path) VALUES($1,'/uploads/damage.jpg') RETURNING id", [user])).rows[0].id;
    const ref = [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }];
    assert.equal((await call('/api/concrete/repairs/photos?job_id=' + job)).body.photos.some(p => p.id === dmg), true);
    assert.equal((await call('/api/concrete/repairs', { capture_id: loose, kind: 'replace', ref, ref_ft: 2, points: [] })).status, 400, 'the photo needs a job');
    assert.equal((await call('/api/concrete/repairs', { capture_id: dmg, kind: 'replace', ref, ref_ft: 2, points: [{ x: 0.4, y: 0.25 }] })).status, 400, 'needs three corners');
    assert.equal((await call('/api/concrete/repairs', { capture_id: dmg, kind: 'replace', ref, ref_ft: 2, points: [] }, other)).status, 404, 'another account cannot use the photo');
    const rep = await call('/api/concrete/repairs', { capture_id: dmg, kind: 'replace', name: 'Broken panel', thickness_in: 4, ref, ref_ft: 2, points: [{ x: 0.4, y: 0.25 }, { x: 0.8, y: 0.25 }, { x: 0.8, y: 0.5 }, { x: 0.4, y: 0.5 }] });
    assert.equal(rep.status, 200, JSON.stringify(rep.body)); assert.equal(Number(rep.body.area.area_sqft), 8); assert.equal(rep.body.area.repair_kind, 'replace'); assert.equal(rep.body.area.method, 'photo_ref');
    const crk = await call('/api/concrete/repairs', { capture_id: dmg, kind: 'crack', ref, ref_ft: 2, points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.6 }] });
    assert.equal(crk.status, 200); assert.equal(Number(crk.body.area.repair_lf), 8);
    assert.equal((await call('/api/concrete/areas/' + crk.body.area.id, { name: 'Driveway crack' })).body.area.name, 'Driveway crack', 'a crack can be renamed');
    const withRepairs = await call('/api/concrete/estimates/' + est.id, { area_ids: [a1.body.area.id, a2.body.area.id, rep.body.area.id, crk.body.area.id] });
    const keys = withRepairs.body.options[0].takeoff.lines.map(l => l.key);
    assert.ok(keys.includes('demo_sf') && keys.includes('haul_ton') && keys.includes('crack_repair_lf'), keys.join());
    const drawn = await call(`/api/concrete/estimates/${est.id}/proposal?doc=pdf`);
    assert.equal(drawn.status, 200); assert.ok(drawn.body.byteLength > plainSize + 5000, 'plans and the outlined photo are in the proposal');
    const word = await call(`/api/concrete/estimates/${est.id}/proposal?doc=docx`); assert.equal(word.status, 200);
    assert.match(Buffer.from(word.body).toString('latin1'), /word\/media\//, 'drawings embedded in Word');

    const csv = Buffer.from((await call(`/api/concrete/estimates/${est.id}/quantities.csv`)).body).toString();
    assert.match(csv, /Back patio,240/); assert.match(csv, /Option: Best/);
    await pool.query("INSERT INTO concrete_tickets(user_id,job_id,load_yd3,status) VALUES($1,$2,4.9,'saved')", [user, job]);
    const got = (await call('/api/concrete/estimates/' + est.id)).body;
    assert.equal(got.actual.actual_cy, 4.9); assert.equal(got.actual.status, 'within');
    assert.equal((await call('/api/concrete/estimates/' + est.id, null, other)).status, 404);
    assert.equal((await call('/api/concrete/estimates/' + est.id, null, user, 'DELETE')).status, 200);
    assert.equal((await call('/api/concrete/estimates/' + est.id)).status, 404);
    // Yield inputs now offer measured areas.
    const y = (await call(`/api/concrete/yield/inputs?job_id=${job}&date=2026-10-19&tz=America/Chicago`)).body;
    assert.ok(y.areas.some(a => a.name === 'Back patio')); assert.equal(y.areas.filter(a => a.name === 'Side walk').length, 1);
  } finally { server.close(); await pool.end(); }
});
