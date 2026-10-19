const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
test('temperature log and daily yield routes read, check, save and report', { skip: process.env.PN_PAVING_QUALITY_TEST !== '1', timeout: 60000 }, async () => {
  process.env.DATABASE_URL = process.env.PN_LEGACY_TEST_DATABASE_URL;
  process.env.SESSION_SECRET = 'paving-quality-local-session-secret';
  process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pn-paving-quality-'));
  process.env.ANTHROPIC_API_KEY = 'test-only-never-sent';
  const { pool, init } = require('../db'); await init();
  const { app } = require('../server'), jwt = require('jsonwebtoken'), sharp = require('sharp');
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port, nativeFetch = global.fetch; let extracted = {}, providerCalls = 0;
  // Only the AI provider is intercepted, so no paid call is ever made.
  global.fetch = async (url, opts) => String(url) === 'https://api.anthropic.com/v1/messages'
    ? (providerCalls++, new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(extracted) }] }), { status: 200 }))
    : nativeFetch(url, opts);
  try {
    const user = (await pool.query("INSERT INTO users(email,password_hash,role,plan,pro_type) VALUES($1,'x','user','pro','paving') RETURNING id", ['quality-' + Date.now() + '@example.invalid'])).rows[0];
    const other = (await pool.query("INSERT INTO users(email,password_hash,role,plan,pro_type) VALUES($1,'x','user','pro','contractor') RETURNING id", ['quality-other-' + Date.now() + '@example.invalid'])).rows[0];
    const cookie = id => 'pn_token=' + jwt.sign({ id }, process.env.SESSION_SECRET);
    const json = (route, body, id = user.id, method = 'POST') => fetch(base + route, { method, headers: { Cookie: cookie(id), 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const job = (await pool.query("INSERT INTO jobs(user_id,name) VALUES($1,'Quality Lot') RETURNING id", [user.id])).rows[0].id;
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    // Two saved tickets for the job today: 55.5 + 54.5 = 110 tons.
    const t1 = (await pool.query("INSERT INTO asphalt_tickets(user_id,job_id,ticket_number,ticket_date,net_tons,dispatch_temperature_f,status) VALUES($1,$2,'A1',$3,55.5,310,'saved') RETURNING id", [user.id, job, day])).rows[0].id;
    await pool.query("INSERT INTO asphalt_tickets(user_id,job_id,ticket_number,ticket_date,net_tons,status) VALUES($1,$2,'A2',$3,54.5,'saved')", [user.id, job, day]);
    await pool.query("INSERT INTO captures(user_id,job_id,photo_path,dim_area_sqft,dim_confirmed) VALUES($1,$2,'/uploads/x.jpg',4500,true),($1,$2,'/uploads/y.jpg',4500,true),($1,$2,'/uploads/z.jpg',999,false)", [user.id, job]);

    // Thermometer photo read in Celsius, stored in Fahrenheit.
    const image = await sharp({ create: { width: 80, height: 80, channels: 3, background: 'white' } }).jpeg().toBuffer();
    extracted = { reading: 140, unit: 'C', display_mode: 'MAX', emissivity: 0.95, confidence: 'high' };
    const form = new FormData(); form.append('photo', new Blob([image], { type: 'image/jpeg' }), 'ir.jpg'); form.append('latitude', '30.27'); form.append('longitude', '-97.74');
    const scan = await (await fetch(base + '/api/paving/temperatures/scan', { method: 'POST', headers: { Cookie: cookie(user.id) }, body: form })).json();
    assert.equal(scan.ai_read, true); assert.equal(Number(scan.reading.reading_f), 284); assert.equal(scan.display_mode, 'MAX');
    assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, path.basename(scan.reading.photo_path))), 'the thermometer photo is kept');
    // The person corrects the reading and links the job and ticket; PG 76 needs 280°F.
    const saved = await (await json('/api/paving/temperatures/' + scan.reading.id, { reading_f: 276, kind: 'load', binder: 'PG76', job_id: job, ticket_id: t1, location_note: 'Lane 1' })).json();
    assert.equal(saved.check.status, 'low'); assert.equal(Number(saved.reading.ai_reading_f), 284, 'the AI value is kept beside the correction');
    assert.equal((await json('/api/paving/temperatures', { reading_f: 290, kind: 'mat', binder: 'PG64', job_id: job })).status, 200);
    assert.equal((await json('/api/paving/temperatures', { reading_f: 290, kind: 'mat', ticket_id: t1 }, user.id)).status, 200);
    assert.equal((await json('/api/paving/temperatures', { kind: 'mat' })).status, 400, 'a reading is required');
    const log = await (await fetch(base + `/api/paving/temperatures?date=${day}&job_id=${job}&tz=America/Chicago`, { headers: { Cookie: cookie(user.id) } })).json();
    assert.equal(log.summary.total, 2); assert.equal(log.summary.low, 1); assert.equal(log.readings.find(r => r.kind === 'load').ticket_number, 'A1');
    // Another account cannot read, change or link this account's records.
    assert.equal((await json('/api/paving/temperatures/' + scan.reading.id, { reading_f: 300 }, other.id)).status, 403);
    await pool.query("UPDATE users SET pro_type='paving' WHERE id=$1", [other.id]);
    assert.equal((await json('/api/paving/temperatures/' + scan.reading.id, { reading_f: 300 }, other.id)).status, 404);
    assert.equal((await json('/api/paving/temperatures', { reading_f: 300, ticket_id: t1 }, other.id)).status, 400);

    // Yield: 9000 sq ft = 1000 sq yd at 2 in plans 110 tons; the tickets carry 110.
    const inputs = await (await fetch(base + `/api/paving/yield/inputs?job_id=${job}&date=${day}&tz=America/Chicago`, { headers: { Cookie: cookie(user.id) } })).json();
    assert.equal(inputs.tons, 110); assert.equal(inputs.ticket_count, 2); assert.equal(inputs.measured_area_sqft, 9000, 'unconfirmed sizes are left out');
    const y = await (await json('/api/paving/yield', { job_id: job, check_date: day, tz: 'America/Chicago', area: 9000, area_unit: 'sqft', area_source: 'measured', thickness_in: 2, tons: 999 })).json();
    assert.equal(y.result.status, 'on_target'); assert.equal(y.result.tons, 110, 'tons come from the saved tickets, not the request');
    const thin = await (await json('/api/paving/yield', { job_id: job, check_date: day, tz: 'America/Chicago', area: 1000, area_unit: 'sy', thickness_in: 2.5 })).json();
    assert.equal(thin.result.status, 'under');
    assert.equal((await json('/api/paving/yield', { job_id: job, check_date: day, area: 1000, area_unit: 'sy' })).status, 400, 'thickness is required');
    const list = await (await fetch(base + '/api/paving/yield?job_id=' + job, { headers: { Cookie: cookie(user.id) } })).json();
    assert.equal(list.checks.length, 2);

    // The job report includes both, in PDF and Word.
    const lines = await require('../paving-quality').jobReportLines(pool, user.id, job);
    assert.equal(lines.yield.length, 1, 'the latest check for the day'); assert.match(lines.yield[0], /under|less mix/i);
    assert.match(lines.temperatures.join('\n'), /BELOW MINIMUM 280°F, ticket A1, Lane 1 \(photo on file\)/);
    for (const doc of ['pdf', 'docx']) assert.equal((await fetch(base + `/api/paving/jobs/${job}/report?doc=${doc}`, { headers: { Cookie: cookie(user.id) } })).status, 200);
    assert.equal(providerCalls, 1);
  } finally { global.fetch = nativeFetch; server.close(); await pool.end(); }
});
