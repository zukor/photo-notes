const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
test('concrete batch tickets, temperature log and yield: read, check, save and report', { skip: process.env.PN_CONCRETE_QUALITY_TEST !== '1', timeout: 60000 }, async () => {
  process.env.DATABASE_URL = process.env.PN_LEGACY_TEST_DATABASE_URL;
  process.env.SESSION_SECRET = 'concrete-quality-local-session-secret';
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-concrete-quality-'));
  process.env.ANTHROPIC_API_KEY = 'test-only-never-sent';
  const { pool, init } = require('../db'); await init();
  const { app } = require('../server'), jwt = require('jsonwebtoken'), sharp = require('sharp');
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port, nativeFetch = global.fetch; let extracted = {};
  // Only the AI provider is intercepted, so no paid call is ever made.
  global.fetch = async (url, opts) => String(url) === 'https://api.anthropic.com/v1/messages' ? new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(extracted) }] }), { status: 200 }) : nativeFetch(url, opts);
  try {
    const mk = async (pro) => (await pool.query("INSERT INTO users(email,password_hash,role,plan,pro_type) VALUES($1,'x','user','pro',$2) RETURNING id", [pro + '-' + Date.now() + Math.random() + '@example.invalid', pro])).rows[0].id;
    const user = await mk('concrete'), paving = await mk('paving');
    const cookie = id => 'pn_token=' + jwt.sign({ id }, process.env.SESSION_SECRET);
    const json = (route, body, id = user, method = 'POST') => fetch(base + route, { method, headers: { Cookie: cookie(id), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const get = (route, id = user) => fetch(base + route, { headers: { Cookie: cookie(id) } }).then(r => r.json());
    const job = (await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Patio Pour') RETURNING id", [user])).rows[0].id;
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const image = await sharp({ create: { width: 80, height: 80, channels: 3, background: 'white' } }).jpeg().toBuffer();
    const scan = async (route, id = user) => { const f = new FormData(); f.append('photo', new Blob([image], { type: 'image/jpeg' }), 'x.jpg'); const r = await fetch(base + route, { method: 'POST', headers: { Cookie: cookie(id) }, body: f }); return { status: r.status, body: await r.json() }; };

    assert.equal((await scan('/api/concrete/tickets/scan', paving)).status, 403, 'Concrete Pro only');
    // Ticket 1: read cleanly, on time.
    extracted = { ticket_number: 'R-101', ticket_date: day, mix_code: '4000-3/4', strength_psi: 4000, load_quantity: 10, load_unit: 'yd3', slump_in: 4, water_allowed_gal: 10, water_added_gal: 5, truck_number: '22', batch_time: '07:00', discharge_end: '08:10', confidence: 'high' };
    const t1 = (await scan('/api/concrete/tickets/scan')).body;
    assert.equal(t1.ai_read, true); assert.equal(Number(t1.ticket.load_yd3), 10); assert.equal(t1.checks.status, 'ok');
    const s1 = await (await json('/api/concrete/tickets/' + t1.ticket.id, { ...t1.ticket, job_id: job })).json();
    assert.equal(s1.ok, true);
    // Ticket 2: hard to read, late and over-watered; needs confirmation.
    extracted = { ticket_number: 'R-102', ticket_date: day, load_quantity: 9, slump_in: 6, water_allowed_gal: 8, water_added_gal: 12, batch_time: '7:30 AM', discharge_end: '9:15 AM', confidence: 'high' };
    const t2 = (await scan('/api/concrete/tickets/scan')).body;
    assert.equal(t2.ticket.confidence, 'low', 'no unit printed');
    assert.equal((await json('/api/concrete/tickets/' + t2.ticket.id, { ...t2.ticket, job_id: job })).status, 400);
    assert.equal((await json('/api/concrete/tickets/' + t2.ticket.id, { ...t2.ticket, job_id: job, load_yd3: 90, confirmed: true })).status, 400, 'an order total is refused');
    const s2 = await (await json('/api/concrete/tickets/' + t2.ticket.id, { ...t2.ticket, job_id: job, confirmed: true })).json();
    assert.deepEqual(s2.checks.flags.map(f => f.key).sort(), ['time', 'water']);
    assert.equal((await json('/api/concrete/tickets/' + t2.ticket.id, { ...t2.ticket, ticket_number: 'R-101', job_id: job, confirmed: true })).status, 409, 'duplicate ticket number for the day');
    const list = await get(`/api/concrete/tickets?date=${day}&job_id=${job}&tz=America/Chicago`);
    assert.equal(list.total_yd3, 19); assert.equal(list.ticket_count, 2); assert.equal(list.flagged, 1);
    assert.equal((await json('/api/concrete/tickets/' + t1.ticket.id, { load_yd3: 5 }, paving)).status, 403);

    // Temperature: 52°F delivery into a slab is below the 55°F minimum.
    extracted = { reading: 11, unit: 'C', confidence: 'high' };
    const tp = (await scan('/api/concrete/temperatures/scan')).body;
    assert.equal(Number(tp.reading.reading_f), 51.8);
    const st = await (await json('/api/concrete/temperatures/' + tp.reading.id, { reading_f: 52, kind: 'delivery', section: 'thin', job_id: job, ticket_id: t1.ticket.id })).json();
    assert.equal(st.check.status, 'low');
    assert.equal((await json('/api/concrete/temperatures', { reading_f: 80, kind: 'placed', section: 'thin', job_id: job })).status, 200);
    const log = await get(`/api/concrete/temperatures?date=${day}&job_id=${job}&tz=America/Chicago`);
    assert.equal(log.summary.total, 2); assert.equal(log.summary.out_of_range, 1); assert.equal(log.readings.find(r => r.kind === 'delivery').ticket_number, 'R-101');

    // Yield: 19 yd³ against 1500 sq ft at 4 in (18.52 yd³) is on target; a saved footprint is offered as the area.
    const cap = (await pool.query("INSERT INTO captures(user_id,job_id,photo_path) VALUES($1,$2,'/uploads/p.jpg') RETURNING id", [user, job])).rows[0].id;
    await pool.query("INSERT INTO concrete_footprints(user_id,capture_id,name,field_area_sqft) VALUES($1,$2,'Back patio',1500)", [user, cap]);
    const inputs = await get(`/api/concrete/yield/inputs?job_id=${job}&date=${day}&tz=America/Chicago`);
    assert.equal(inputs.yards, 19); assert.equal(inputs.areas[0].name, 'Back patio'); assert.equal(inputs.areas[0].area_sqft, 1500);
    const y = await (await json('/api/concrete/yield', { job_id: job, check_date: day, tz: 'America/Chicago', area_sqft: 1500, area_source: 'areas', thickness_in: 4, yards: 999 })).json();
    assert.equal(y.result.status, 'on_target'); assert.equal(y.result.yards, 19, 'yards come from the saved tickets');
    const thin = await (await json('/api/concrete/yield', { job_id: job, check_date: day, area_sqft: 1500, thickness_in: 5 })).json();
    assert.equal(thin.result.status, 'under');

    // The Concrete report includes all three.
    const lines = await require('../concrete-quality').reportLines(pool, user, job);
    assert.equal(lines.tickets.length, 2); assert.match(lines.tickets.join('\n'), /FLAGGED: .*over the 90-minute limit/);
    assert.equal(lines.yield.length, 1); assert.match(lines.temperatures.join('\n'), /BELOW MINIMUM 55°F, ticket R-101/);
    for (const doc of ['pdf', 'docx']) assert.equal((await fetch(base + `/api/concrete/report?job_id=${job}&doc=${doc}`, { headers: { Cookie: cookie(user) } })).status, 200);

    // Concrete details stay editable after saving, for Concrete Pro only, with history.
    const placed = (await pool.query("INSERT INTO captures(user_id,job_id,photo_path,concrete_phase,concrete_purpose,concrete_stage,concrete_element) VALUES($1,$2,'/uploads/placed.jpg','work','placement','placement','slab') RETURNING id", [user, job])).rows[0].id;
    fs.writeFileSync(path.join(process.env.UPLOAD_DIR, 'placed.jpg'), image);
    const edited = await (await json('/api/captures/' + placed, { concrete_phase: 'follow_up', concrete_purpose: 'repair', concrete_element: 'driveway', concrete_condition: 'repair_needed', concrete_severity: 'moderate', concrete_mix: '4000 psi', concrete_location: 'North edge' })).json();
    assert.equal(edited.concrete_stage, 'repair'); assert.equal(edited.concrete_element, 'driveway'); assert.equal(edited.concrete_location, 'North edge');
    assert.equal((await json('/api/captures/' + placed, { concrete_element: 'roof' })).status, 400, 'same rules as capture creation');
    const pavingCap = (await pool.query("INSERT INTO captures(user_id,photo_path) VALUES($1,'/uploads/p2.jpg') RETURNING id", [paving])).rows[0].id;
    assert.equal((await json('/api/captures/' + pavingCap, { concrete_element: 'slab' }, paving)).status, 403);
    const hist = (await pool.query("SELECT detail FROM capture_history WHERE capture_id=$1 AND action='details_updated' ORDER BY id DESC LIMIT 1", [placed])).rows[0].detail;
    assert.equal(hist.concrete.before.concrete_element, 'slab'); assert.equal(hist.concrete.after.concrete_element, 'driveway');
    await json('/api/captures/' + placed, { concrete_phase: 'work', concrete_purpose: 'placement' });

    // A ticket attached to the placement photo is read into a linked draft; a specification is not read.
    extracted = { ticket_number: 'R-201', ticket_date: day, load_quantity: 8, load_unit: 'yd3', batch_time: '10:00', discharge_end: '10:40', confidence: 'high' };
    const attach = async type => { const f = new FormData(); f.append('photo', new Blob([image], { type: 'image/jpeg' }), 't.jpg'); f.append('reference_type', type); return (await fetch(base + `/api/concrete/captures/${placed}/ticket`, { method: 'POST', headers: { Cookie: cookie(user) }, body: f })).json(); };
    const spec = await attach('specification'); assert.equal(spec.ticket_draft_id, null);
    const linked = await attach('batch_ticket'); assert.ok(linked.ticket_draft_id);
    const draft = await get('/api/concrete/tickets/' + linked.ticket_draft_id);
    assert.equal(draft.ticket.status, 'draft'); assert.equal(draft.ticket.placement_capture_id, placed); assert.equal(draft.ticket.job_id, job); assert.equal(Number(draft.ticket.load_yd3), 8);
    const other = (await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Other') RETURNING id", [user])).rows[0].id;
    assert.equal((await json('/api/concrete/tickets/' + linked.ticket_draft_id, { ...draft.ticket, job_id: other, placement_capture_id: placed })).status, 400, 'placement photo must be from the same job');
    assert.equal((await json('/api/concrete/tickets/' + linked.ticket_draft_id, { ...draft.ticket, placement_capture_id: pavingCap })).status, 400, 'placement photo must belong to the user');
    const savedDraft = await (await json('/api/concrete/tickets/' + linked.ticket_draft_id, { ...draft.ticket, job_id: job, placement_capture_id: placed })).json();
    assert.equal(savedDraft.ticket.placement_capture_id, placed);
    const photos = await get('/api/concrete/placement-photos?job_id=' + job); assert.ok(photos.photos.some(p => p.id === placed));

    // Readiness: a saved scanned ticket for the job counts as a linked batch ticket, even with no ticket photo link.
    const job2 = (await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Scanned only') RETURNING id", [user])).rows[0].id;
    await pool.query("INSERT INTO captures(user_id,job_id,photo_path,concrete_stage) VALUES($1,$2,'/uploads/q.jpg','placement')", [user, job2]);
    const ticketCheck = async () => (await get('/api/concrete/report?job_id=' + job2)).completeness.checks.find(c => c.key === 'ticket').complete;
    assert.equal(await ticketCheck(), false);
    await pool.query("UPDATE concrete_tickets SET job_id=$1 WHERE id=$2", [job2, t1.ticket.id]);
    assert.equal(await ticketCheck(), true);
    await pool.query("UPDATE concrete_tickets SET job_id=$1 WHERE id=$2", [job, t1.ticket.id]);

    // Report lines use the client time zone and include size and reviewed findings.
    await pool.query("UPDATE captures SET dim_length_in=120,dim_width_in=48,dim_length_unit='ft',dim_width_unit='ft',dim_confirmed=true,concrete_reviewed_findings=$2 WHERE id=$1", [placed, JSON.stringify([{ type: 'cracking', observation: 'Hairline crack near the joint.', confidence: 'high' }])]);
    const docx = await fetch(base + `/api/concrete/report?job_id=${job}&doc=docx&tz=America/Los_Angeles`, { headers: { Cookie: cookie(user) } });
    assert.equal(docx.status, 200);
    const xml = await (await require('jszip').loadAsync(Buffer.from(await docx.arrayBuffer()))).file('word/document.xml').async('string');
    assert.match(xml, /Size: 10(\.0)? ft x 4(\.0)? ft/); assert.match(xml, /User Reviewed findings: cracking: Hairline crack near the joint\./);
    assert.equal((await fetch(base + `/api/concrete/report?job_id=${job}&doc=pdf&tz=America/Los_Angeles`, { headers: { Cookie: cookie(user) } })).status, 200);

    // Measure From Photo: a reference length is required and impossible values are rejected.
    const measure = async fields => { const f = new FormData(); f.append('capture_id', String(placed)); for (const [k, v] of Object.entries(fields)) f.append(k, v); const r = await fetch(base + '/api/measure', { method: 'POST', headers: { Cookie: cookie(user) }, body: f }); return { status: r.status, body: await r.json() }; };
    const noRef = await measure({ reference_type: 'custom' }); assert.equal(noRef.status, 400); assert.equal(noRef.body.error, 'reference length required');
    extracted = { length_in: 5000, width_in: 6, depth_in: -1, shape: 'irregular', confidence: 'high', warning: null };
    const m = (await measure({ reference_type: 'ruler_12in' })).body;
    assert.equal(m.length_in, null); assert.equal(m.width_in, 6); assert.equal(m.depth_in, null); assert.equal(m.confidence, 'low'); assert.match(m.warning, /not possible/);
  } finally { global.fetch = nativeFetch; server.close(); await pool.end(); }
});
