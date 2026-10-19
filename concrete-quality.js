// Concrete Pro: batch ticket reader, concrete temperature log and daily yield check.
'use strict';
const path = require('path');
const fs = require('fs');
const Rules = require('./public/concrete-quality-rules.js');

const TICKET_PROMPT = 'You are reading a photographed ready-mix concrete delivery (batch) ticket. Extract only what is printed or clearly handwritten on the ticket. Never guess. Respond ONLY JSON with exactly these keys: {"ticket_number":string|null,"ticket_date":string|null,"plant_name":string|null,"mix_code":string|null,"mix_description":string|null,"strength_psi":number|null,"load_quantity":number|null,"load_unit":"yd3"|"m3"|null,"slump_in":number|null,"water_allowed_gal":number|null,"water_added_gal":number|null,"truck_number":string|null,"batch_time":string|null,"arrival_time":string|null,"discharge_start":string|null,"discharge_end":string|null,"concrete_temp":number|null,"temp_unit":"F"|"C"|null,"confidence":"high"|"medium"|"low"}. load_quantity is THIS load only, not the cumulative total for the order. batch_time is when water was added at the plant (often labeled batch, load or ticket time). water_allowed_gal is the water the ticket allows to be added on site (often "water allowed", "max water to add" or "trim water"). water_added_gal is water recorded as added on site. Give times as printed, for example 14:05 or 2:05 PM. ticket_date as YYYY-MM-DD when the year is printed.';
const THERMOMETER_PROMPT = 'You are reading a photographed concrete thermometer or infrared thermometer display. Read only the main temperature shown on the instrument. Never guess. Respond ONLY JSON: {"reading":number|null,"unit":"F"|"C"|null,"confidence":"high"|"medium"|"low"}. Use null when not clearly visible. Ignore phone, clock or weather temperatures outside the instrument.';

const text = (v, max = 300) => { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; };
const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; };
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));
const zone = tz => { try { Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'America/Chicago'; } };
const dateText = v => { if (!v) return null; if (Object.prototype.toString.call(v) === '[object Date]') return Number.isFinite(+v) ? v.toISOString().slice(0, 10) : null; const s = String(v).trim(); if (isDate(s)) return s; const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; const d = `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`; return isDate(d) ? d : null; } return null; };
// A ready-mix truck carries about 8 to 11 cubic yards; more than 14 on one ticket is a misread.
const MAX_YD3_PER_LOAD = 14;

function ticketFields(src = {}, fromAi = false) {
  const load = fromAi ? Rules.toCubicYards(src.load_quantity, src.load_unit) : num(src.load_yd3);
  const temp = fromAi ? Rules.toFahrenheit(src.concrete_temp, src.temp_unit) : num(src.concrete_temp_f);
  return {
    ticket_number: text(src.ticket_number, 80), ticket_date: dateText(src.ticket_date), plant_name: text(src.plant_name, 200),
    mix_code: text(src.mix_code, 80), mix_description: text(src.mix_description, 300), strength_psi: num(src.strength_psi),
    load_yd3: load, slump_in: num(src.slump_in), water_allowed_gal: num(src.water_allowed_gal), water_added_gal: num(src.water_added_gal),
    truck_number: text(src.truck_number, 40), batch_time: text(src.batch_time, 20), arrival_time: text(src.arrival_time, 20),
    discharge_start: text(src.discharge_start, 20), discharge_end: text(src.discharge_end, 20), concrete_temp_f: temp
  };
}
function scanConfidence(ai, fields) {
  let c = ai && ['high', 'medium', 'low'].includes(ai.confidence) ? ai.confidence : 'low';
  if (fields.load_yd3 == null || fields.load_yd3 <= 0 || fields.load_yd3 > MAX_YD3_PER_LOAD) c = 'low';
  if (ai && ai.load_quantity != null && !ai.load_unit) c = 'low';
  return c;
}
const FIELD_KEYS = Object.keys(ticketFields({}));

function register(app, { pool, requireAuth, requireConcrete, upload, visionJSON, visionFeedback, logEvent, ownedJobId }) {
  const unlink = file => { if (file && file.path) { try { fs.unlinkSync(file.path); } catch (e) {} } };
  const guard = [requireAuth, requireConcrete];
  async function jobFrom(userId, b, existing) {
    if (!Object.prototype.hasOwnProperty.call(b, 'job_id')) return existing ?? null;
    if (b.job_id == null || b.job_id === '') return null;
    const id = await ownedJobId(userId, b.job_id); if (!id) throw Object.assign(Error('Selected job is unavailable.'), { status: 400 }); return id;
  }
  const fail = (res, e, tag, msg) => { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[' + tag + ']', e); res.status(500).json({ error: msg }); };

  // ---- Batch tickets ----
  app.post('/api/concrete/tickets/scan', ...guard, upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'photo required' });
      const vision = await visionJSON(req.file.path, TICKET_PROMPT, { maxTokens: 900 });
      const ai = vision.data || null, fields = ai ? ticketFields(ai, true) : ticketFields({});
      const confidence = ai ? scanConfidence(ai, fields) : 'low';
      const cols = FIELD_KEYS, vals = cols.map(k => fields[k]);
      const row = (await pool.query(`INSERT INTO concrete_tickets (user_id, photo_path, confidence, raw_ai, ${cols.join(',')}) VALUES ($1,$2,$3,$4,${cols.map((_, i) => '$' + (i + 5)).join(',')}) RETURNING *`,
        [req.user.id, '/uploads/' + path.basename(req.file.path), confidence, ai ? JSON.stringify(ai) : null, ...vals])).rows[0];
      logEvent(req.user.id, 'concrete_ticket_scan', { ai: !!ai, confidence });
      res.json({ ok: true, ai_read: !!ai, ...visionFeedback(vision), ticket: { ...row, ticket_date: dateText(row.ticket_date) }, checks: Rules.ticketChecks(row) });
    } catch (e) { unlink(req.file); fail(res, e, 'concrete.ticket.scan', 'The ticket could not be read. Enter the details by hand.'); }
  });
  app.post('/api/concrete/tickets/:id', ...guard, async (req, res) => {
    try {
      const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'bad id' });
      const old = (await pool.query(`SELECT * FROM concrete_tickets WHERE id=$1 AND user_id=$2 AND status<>'deleted'`, [id, req.user.id])).rows[0];
      if (!old) return res.status(404).json({ error: 'not found' });
      const b = req.body || {}, f = ticketFields(b);
      if (f.load_yd3 == null || f.load_yd3 <= 0) return res.status(400).json({ error: 'Enter the cubic yards on this load.' });
      if (f.load_yd3 > MAX_YD3_PER_LOAD) return res.status(400).json({ error: `${f.load_yd3} cubic yards is more than one truck carries. Enter this load only, not the order total.` });
      if (old.confidence === 'low' && b.confirmed !== true) return res.status(400).json({ error: 'This ticket was hard to read. Check every value against the photo and confirm before saving.' });
      const job = await jobFrom(req.user.id, b, old.job_id);
      if (f.ticket_number) {
        const dup = (await pool.query(`SELECT id FROM concrete_tickets WHERE user_id=$1 AND status='saved' AND id<>$2 AND lower(ticket_number)=lower($3) AND COALESCE(ticket_date,'1900-01-01')=COALESCE($4::date,'1900-01-01')`, [req.user.id, id, f.ticket_number, f.ticket_date])).rows[0];
        if (dup) return res.status(409).json({ error: 'This ticket number is already saved for that date.' });
      }
      const cols = FIELD_KEYS;
      const row = (await pool.query(`UPDATE concrete_tickets SET ${cols.map((k, i) => `${k}=$${i + 3}`).join(',')}, job_id=$${cols.length + 3}, user_confirmed=$${cols.length + 4}, status='saved', updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,
        [id, req.user.id, ...cols.map(k => f[k]), job, b.confirmed === true])).rows[0];
      const checks = Rules.ticketChecks(row);
      logEvent(req.user.id, 'concrete_ticket_save', { confidence: old.confidence, flags: checks.flags.map(x => x.key) });
      res.json({ ok: true, ticket: { ...row, ticket_date: dateText(row.ticket_date) }, checks });
    } catch (e) { fail(res, e, 'concrete.ticket.save', 'The ticket could not be saved.'); }
  });
  app.get('/api/concrete/tickets', ...guard, async (req, res) => {
    try {
      const params = [req.user.id, zone(String(req.query.tz || ''))]; let where = `t.user_id=$1 AND t.status='saved' AND $2::text IS NOT NULL`;
      const day = `COALESCE(t.ticket_date,(t.created_at AT TIME ZONE $2)::date)`;
      if (isDate(req.query.date)) { params.push(req.query.date); where += ` AND ${day}=$${params.length}::date`; }
      if (req.query.job_id) { const job = await ownedJobId(req.user.id, req.query.job_id); if (!job) return res.status(400).json({ error: 'Selected job is unavailable.' }); params.push(job); where += ` AND t.job_id=$${params.length}`; }
      const rows = (await pool.query(`SELECT t.*, to_char(${day},'YYYY-MM-DD') AS ticket_day, j.name AS job_name FROM concrete_tickets t LEFT JOIN jobs j ON j.id=t.job_id AND j.user_id=t.user_id WHERE ${where} ORDER BY ${day} DESC, t.created_at DESC LIMIT 300`, params)).rows;
      for (const r of rows) { r.ticket_date = dateText(r.ticket_date); r.checks = Rules.ticketChecks(r); }
      const yards = rows.reduce((s, r) => s + (Number(r.load_yd3) || 0), 0);
      res.json({ tickets: rows, total_yd3: Math.round(yards * 100) / 100, ticket_count: rows.length, flagged: rows.filter(r => r.checks.flags.length).length });
    } catch (e) { fail(res, e, 'concrete.ticket.list', 'ticket list failed'); }
  });
  app.delete('/api/concrete/tickets/:id', ...guard, async (req, res) => {
    try {
      const r = await pool.query(`UPDATE concrete_tickets SET status='deleted',updated_at=now() WHERE id=$1 AND user_id=$2 AND status<>'deleted' RETURNING id`, [Number(req.params.id), req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'not found' }); res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'delete failed' }); }
  });

  // ---- Concrete temperature log ----
  app.post('/api/concrete/temperatures/scan', ...guard, upload.single('photo'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'photo required' });
      const vision = await visionJSON(req.file.path, THERMOMETER_PROMPT, { maxTokens: 300 });
      const ai = vision.data || null, reading = ai ? Rules.toFahrenheit(ai.reading, ai.unit) : null;
      const confidence = ai && ['high', 'medium', 'low'].includes(ai.confidence) ? ai.confidence : 'low';
      const b = req.body || {}, taken = b.taken_at && Number.isFinite(Date.parse(b.taken_at)) ? new Date(b.taken_at).toISOString() : null;
      const row = (await pool.query(`INSERT INTO concrete_temperatures (user_id, photo_path, reading_f, ai_reading_f, latitude, longitude, confidence, raw_ai, taken_at) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,now())) RETURNING *`,
        [req.user.id, '/uploads/' + path.basename(req.file.path), reading, num(b.latitude), num(b.longitude), confidence, ai ? JSON.stringify(ai) : null, taken])).rows[0];
      logEvent(req.user.id, 'concrete_temperature_scan', { ai: !!ai, read: reading != null });
      res.json({ ok: true, ai_read: reading != null, ...visionFeedback(vision), reading: row });
    } catch (e) { unlink(req.file); fail(res, e, 'concrete.temperature.scan', 'The thermometer photo could not be read. Enter the reading by hand.'); }
  });
  async function saveTemperature(req, res, id) {
    try {
      const b = req.body || {};
      const old = id ? (await pool.query(`SELECT * FROM concrete_temperatures WHERE id=$1 AND user_id=$2 AND status<>'deleted'`, [id, req.user.id])).rows[0] : {};
      if (id && !old) return res.status(404).json({ error: 'not found' });
      const kind = Rules.KINDS.some(k => k.id === b.kind) ? b.kind : old.kind || 'delivery';
      const section = Rules.SECTIONS.some(s => s.id === b.section) ? b.section : null;
      const reading = b.reading_f !== undefined ? num(b.reading_f) : num(old.reading_f);
      const check = Rules.temperatureCheck({ reading_f: reading, kind, section, minimum_f: b.minimum_f, maximum_f: b.maximum_f });
      if (reading == null) return res.status(400).json({ error: 'Enter the temperature reading.' });
      if (check.status === 'check_reading') return res.status(400).json({ error: check.message });
      const job = await jobFrom(req.user.id, b, old.job_id);
      let ticket = old.ticket_id ?? null;
      if (Object.prototype.hasOwnProperty.call(b, 'ticket_id')) {
        ticket = null;
        if (b.ticket_id) { const t = (await pool.query(`SELECT id FROM concrete_tickets WHERE id=$1 AND user_id=$2 AND status='saved'`, [Number(b.ticket_id), req.user.id])).rows[0]; if (!t) return res.status(400).json({ error: 'Selected ticket is unavailable.' }); ticket = t.id; }
      }
      const lat = b.latitude !== undefined ? num(b.latitude) : old.latitude ?? null, lng = b.longitude !== undefined ? num(b.longitude) : old.longitude ?? null;
      const taken = b.taken_at && Number.isFinite(Date.parse(b.taken_at)) ? new Date(b.taken_at).toISOString() : old.taken_at || new Date().toISOString();
      const v = [req.user.id, job, ticket, kind, reading, section, check.minimum_f, check.maximum_f, check.status, text(b.location_note, 200), text(b.note, 1000), lat, lng, taken];
      const row = id
        ? (await pool.query(`UPDATE concrete_temperatures SET job_id=$2,ticket_id=$3,kind=$4,reading_f=$5,section=$6,minimum_f=$7,maximum_f=$8,check_status=$9,location_note=$10,note=$11,latitude=$12,longitude=$13,taken_at=$14,status='saved',updated_at=now() WHERE id=$15 AND user_id=$1 RETURNING *`, [...v, id])).rows[0]
        : (await pool.query(`INSERT INTO concrete_temperatures (user_id,job_id,ticket_id,kind,reading_f,section,minimum_f,maximum_f,check_status,location_note,note,latitude,longitude,taken_at,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'saved') RETURNING *`, v)).rows[0];
      logEvent(req.user.id, 'concrete_temperature_save', { kind, status: check.status, photo: !!row.photo_path });
      res.json({ ok: true, reading: row, check });
    } catch (e) { fail(res, e, 'concrete.temperature.save', 'The temperature could not be saved.'); }
  }
  app.post('/api/concrete/temperatures', ...guard, (req, res) => saveTemperature(req, res, null));
  app.post('/api/concrete/temperatures/:id', ...guard, (req, res) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'bad id' }); saveTemperature(req, res, id); });
  app.get('/api/concrete/temperatures', ...guard, async (req, res) => {
    try {
      const params = [req.user.id, zone(String(req.query.tz || ''))]; let where = `t.user_id=$1 AND t.status='saved' AND $2::text IS NOT NULL`;
      if (isDate(req.query.date)) { params.push(req.query.date); where += ` AND (t.taken_at AT TIME ZONE $2)::date=$${params.length}::date`; }
      if (req.query.job_id) { const job = await ownedJobId(req.user.id, req.query.job_id); if (!job) return res.status(400).json({ error: 'Selected job is unavailable.' }); params.push(job); where += ` AND t.job_id=$${params.length}`; }
      const rows = (await pool.query(`SELECT t.*, c.ticket_number, c.truck_number, j.name AS job_name FROM concrete_temperatures t LEFT JOIN concrete_tickets c ON c.id=t.ticket_id AND c.user_id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id AND j.user_id=t.user_id WHERE ${where} ORDER BY t.taken_at DESC, t.id DESC LIMIT 300`, params)).rows;
      res.json({ readings: rows, summary: { total: rows.length, out_of_range: rows.filter(r => ['low', 'high'].includes(r.check_status)).length } });
    } catch (e) { fail(res, e, 'concrete.temperature.list', 'temperature list failed'); }
  });
  app.delete('/api/concrete/temperatures/:id', ...guard, async (req, res) => {
    try {
      const r = await pool.query(`UPDATE concrete_temperatures SET status='deleted',updated_at=now() WHERE id=$1 AND user_id=$2 AND status<>'deleted' RETURNING id`, [Number(req.params.id), req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'not found' }); res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'delete failed' }); }
  });

  // ---- Daily yield ----
  async function yieldInputs(userId, jobId, date, tz) {
    const t = (await pool.query(`SELECT COALESCE(sum(load_yd3),0)::float AS yards, count(*)::int AS n FROM concrete_tickets WHERE user_id=$1 AND job_id=$2 AND status='saved' AND COALESCE(ticket_date,(created_at AT TIME ZONE $3)::date)=$4::date`, [userId, jobId, tz, date])).rows[0];
    const areas = (await pool.query(`SELECT f.id, f.name, COALESCE(f.field_area_sqft, f.map_area_sqft)::float AS area_sqft, CASE WHEN f.field_area_sqft IS NOT NULL THEN 'field' ELSE 'map' END AS source FROM concrete_footprints f JOIN captures c ON c.id=f.capture_id AND c.user_id=f.user_id WHERE f.user_id=$1 AND c.job_id=$2 AND COALESCE(f.field_area_sqft, f.map_area_sqft)>0 ORDER BY f.name`, [userId, jobId])).rows;
    return { yards: Math.round(t.yards * 100) / 100, ticket_count: t.n, areas: areas.map(a => ({ ...a, area_sqft: Math.round(a.area_sqft * 10) / 10 })) };
  }
  app.get('/api/concrete/yield/inputs', ...guard, async (req, res) => {
    try {
      const job = await ownedJobId(req.user.id, req.query.job_id); if (!job) return res.status(400).json({ error: 'Choose a job.' });
      if (!isDate(req.query.date)) return res.status(400).json({ error: 'Choose a date.' });
      res.json(await yieldInputs(req.user.id, job, req.query.date, zone(String(req.query.tz || ''))));
    } catch (e) { fail(res, e, 'concrete.yield.inputs', 'yield inputs failed'); }
  });
  app.post('/api/concrete/yield', ...guard, async (req, res) => {
    try {
      const b = req.body || {}, job = await ownedJobId(req.user.id, b.job_id);
      if (!job) return res.status(400).json({ error: 'Choose a job.' }); if (!isDate(b.check_date)) return res.status(400).json({ error: 'Choose a date.' });
      const inputs = await yieldInputs(req.user.id, job, b.check_date, zone(String(b.tz || '')));
      // Yards come from the saved tickets so the check always matches the ticket record.
      const result = Rules.yieldCheck({ yards: inputs.yards, area_sqft: b.area_sqft, thickness_in: b.thickness_in, waste_pct: b.waste_pct });
      if (result.status === 'incomplete') return res.status(400).json({ error: result.message, result, inputs });
      const source = ['areas', 'entered'].includes(b.area_source) ? b.area_source : 'entered';
      const row = (await pool.query(`INSERT INTO concrete_yield_checks (user_id,job_id,check_date,yards,ticket_count,area_sqft,area_source,thickness_in,waste_pct,result,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [req.user.id, job, b.check_date, inputs.yards, inputs.ticket_count, result.area_sqft, source, result.thickness_in, result.waste_pct, JSON.stringify(result), text(b.note, 1000)])).rows[0];
      logEvent(req.user.id, 'concrete_yield_check', { status: result.status, difference_pct: result.difference_pct, area_source: source });
      res.json({ ok: true, check: row, result, inputs });
    } catch (e) { fail(res, e, 'concrete.yield.save', 'The yield check could not be saved.'); }
  });
  app.get('/api/concrete/yield', ...guard, async (req, res) => {
    try {
      const job = await ownedJobId(req.user.id, req.query.job_id); if (!job) return res.status(400).json({ error: 'Choose a job.' });
      const rows = (await pool.query(`SELECT *, to_char(check_date,'YYYY-MM-DD') AS check_day FROM concrete_yield_checks WHERE user_id=$1 AND job_id=$2 AND status='saved' ORDER BY check_date DESC, id DESC LIMIT 200`, [req.user.id, job])).rows;
      res.json({ checks: rows });
    } catch (e) { fail(res, e, 'concrete.yield.list', 'yield list failed'); }
  });
  app.delete('/api/concrete/yield/:id', ...guard, async (req, res) => {
    try {
      const r = await pool.query(`UPDATE concrete_yield_checks SET status='deleted' WHERE id=$1 AND user_id=$2 AND status='saved' RETURNING id`, [Number(req.params.id), req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'not found' }); res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'delete failed' }); }
  });
}

// Lines for the Concrete report: tickets with their checks, the latest yield check per day, and temperatures.
async function reportLines(pool, userId, jobId) {
  const out = { tickets: [], yield: [], temperatures: [] };
  if (!jobId) return out;
  try {
    const tickets = (await pool.query(`SELECT * FROM concrete_tickets WHERE user_id=$1 AND job_id=$2 AND status='saved' ORDER BY COALESCE(ticket_date,created_at::date), batch_time NULLS LAST, id`, [userId, jobId])).rows;
    for (const t of tickets) {
      const c = Rules.ticketChecks(t);
      out.tickets.push(`${dateText(t.ticket_date) || ''} Ticket ${t.ticket_number || t.id}${t.truck_number ? ', truck ' + t.truck_number : ''}: ${Number(t.load_yd3)} yd³ ${t.mix_code || t.mix_description || ''}${t.slump_in != null ? ', slump ' + Number(t.slump_in) + ' in' : ''}${c.minutes != null ? ', ' + c.minutes + ' min to ' + c.measured_to : ''}${c.flags.length ? '. FLAGGED: ' + c.flags.map(f => f.message).join(' ') : ''}`.trim());
    }
    const checks = (await pool.query(`SELECT DISTINCT ON (check_date) to_char(check_date,'YYYY-MM-DD') AS day, result FROM concrete_yield_checks WHERE user_id=$1 AND job_id=$2 AND status='saved' ORDER BY check_date, id DESC`, [userId, jobId])).rows;
    for (const c of checks) { const r = c.result || {}; out.yield.push(`${c.day}: ${r.yards} yd³ delivered for ${r.area_sqft} sq ft at ${r.thickness_in} in planned (${r.design_yards} yd³). ${r.message || ''}`.trim()); }
    const temps = (await pool.query(`SELECT t.*, c.ticket_number FROM concrete_temperatures t LEFT JOIN concrete_tickets c ON c.id=t.ticket_id WHERE t.user_id=$1 AND t.job_id=$2 AND t.status='saved' ORDER BY t.taken_at`, [userId, jobId])).rows;
    for (const t of temps) {
      const kind = (Rules.KINDS.find(k => k.id === t.kind) || {}).label || t.kind;
      const when = new Date(t.taken_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
      const status = t.check_status === 'low' ? `BELOW MINIMUM ${Number(t.minimum_f)}°F` : t.check_status === 'high' ? `ABOVE MAXIMUM ${Number(t.maximum_f)}°F` : t.check_status === 'ok' ? 'within limits' : 'recorded';
      out.temperatures.push(`${when}: ${kind} ${Number(t.reading_f)}°F, ${status}${t.ticket_number ? ', ticket ' + t.ticket_number : ''}${t.location_note ? ', ' + t.location_note : ''}${t.photo_path ? ' (photo on file)' : ''}`);
    }
  } catch (e) { console.error('[concrete.quality.report]', e); }
  return out;
}

module.exports = { register, reportLines, ticketFields, scanConfidence, TICKET_PROMPT, MAX_YD3_PER_LOAD };
