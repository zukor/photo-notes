// Paving Pro daily yield check and mix temperature log.
'use strict';
const path = require('path');
const fs = require('fs');
const Rules = require('./public/paving-quality-rules.js');

const THERMOMETER_PROMPT = 'You are reading a photographed handheld infrared or probe thermometer display used on an asphalt paving job. Read only the main temperature value shown on the display. Never guess or estimate. Respond ONLY JSON: {"reading":number|null,"unit":"F"|"C"|null,"display_mode":string|null,"emissivity":number|null,"confidence":"high"|"medium"|"low"}. Put MAX, MIN, AVG, HOLD or SCAN in display_mode when shown. Put the emissivity setting (for example 0.95) in emissivity when shown. Use null for anything that is not clearly visible. Ignore any weather, clock or phone temperature outside the instrument.';

const text = (v, max = 300) => { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; };
const num = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));
const zone = tz => { try { Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'America/Chicago'; } };

function temperatureRow(b, existing = {}) {
  const kind = Rules.KINDS.some(k => k.id === b.kind) ? b.kind : existing.kind || 'mat';
  const binder = Rules.BINDERS.some(x => x.id === b.binder) ? b.binder : existing.binder || null;
  const reading = b.reading_f !== undefined ? num(b.reading_f) : b.reading !== undefined ? Rules.toFahrenheit(b.reading, b.unit) : num(existing.reading_f);
  const minimum = b.minimum_f !== undefined ? num(b.minimum_f) : null;
  const check = Rules.temperatureCheck({ reading_f: reading, kind, binder, minimum_f: minimum });
  const taken = b.taken_at && Number.isFinite(Date.parse(b.taken_at)) ? new Date(b.taken_at).toISOString() : existing.taken_at || new Date().toISOString();
  return { kind, binder, reading, minimum: check.minimum_f, check, taken, location_note: text(b.location_note, 200), note: text(b.note, 1000) };
}

function register(app, { pool, requireAuth, upload, featureAllowed, currentProduct, visionJSON, visionFeedback, logEvent, ownedJobId }) {
  const allowed = async userId => (await currentProduct(userId)) === 'paving' && await featureAllowed(userId, 'ticket_scanner');
  const unlink = file => { if (file && file.path) { try { fs.unlinkSync(file.path); } catch (e) {} } };
  async function linkIds(userId, b) {
    const out = {};
    if (Object.prototype.hasOwnProperty.call(b, 'job_id')) {
      if (b.job_id == null || b.job_id === '') out.job_id = null;
      else { out.job_id = await ownedJobId(userId, b.job_id); if (!out.job_id) throw Object.assign(Error('Selected job is unavailable.'), { status: 400 }); }
    }
    if (Object.prototype.hasOwnProperty.call(b, 'ticket_id')) {
      if (b.ticket_id == null || b.ticket_id === '') out.ticket_id = null;
      else {
        const t = (await pool.query(`SELECT id FROM asphalt_tickets WHERE id=$1 AND user_id=$2 AND status='saved'`, [Number(b.ticket_id), userId])).rows[0];
        if (!t) throw Object.assign(Error('Selected ticket is unavailable.'), { status: 400 }); out.ticket_id = t.id;
      }
    }
    return out;
  }

  // ---- Temperature log ----
  app.post('/api/paving/temperatures/scan', requireAuth, upload.single('photo'), async (req, res) => {
    try {
      if (!(await allowed(req.user.id))) { unlink(req.file); return res.status(403).json({ error: 'Paving Pro required' }); }
      if (!req.file) return res.status(400).json({ error: 'photo required' });
      const vision = await visionJSON(req.file.path, THERMOMETER_PROMPT, { maxTokens: 400 });
      const ai = vision.data || null;
      const reading = ai ? Rules.toFahrenheit(ai.reading, ai.unit) : null;
      const confidence = ai && ['high', 'medium', 'low'].includes(ai.confidence) ? ai.confidence : 'low';
      const lat = num(req.body && req.body.latitude), lng = num(req.body && req.body.longitude);
      const row = (await pool.query(`INSERT INTO paving_temperatures (user_id, photo_path, reading_f, ai_reading_f, latitude, longitude, confidence, raw_ai, taken_at)
        VALUES ($1,$2,$3,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,now())) RETURNING *`,
        [req.user.id, '/uploads/' + path.basename(req.file.path), reading, lat, lng, confidence, ai ? JSON.stringify(ai) : null,
          req.body && req.body.taken_at && Number.isFinite(Date.parse(req.body.taken_at)) ? new Date(req.body.taken_at).toISOString() : null])).rows[0];
      logEvent(req.user.id, 'paving_temperature_scan', { ai: !!ai, confidence, read: reading != null });
      res.json({ ok: true, ai_read: reading != null, ...visionFeedback(vision), reading: row, display_mode: ai && text(ai.display_mode, 20), emissivity: ai && num(ai.emissivity) });
    } catch (e) { console.error('[paving.temperature.scan]', e); res.status(500).json({ error: 'The thermometer photo could not be read. Enter the reading by hand.' }); }
  });

  async function saveTemperature(req, res, id) {
    try {
      if (!(await allowed(req.user.id))) return res.status(403).json({ error: 'Paving Pro required' });
      const b = req.body || {};
      const existing = id ? (await pool.query(`SELECT * FROM paving_temperatures WHERE id=$1 AND user_id=$2 AND status<>'deleted'`, [id, req.user.id])).rows[0] : {};
      if (id && !existing) return res.status(404).json({ error: 'not found' });
      const r = temperatureRow(b, existing);
      if (r.reading == null) return res.status(400).json({ error: 'Enter the temperature reading.' });
      if (r.check.status === 'check_reading') return res.status(400).json({ error: r.check.message });
      const links = await linkIds(req.user.id, b);
      const lat = b.latitude !== undefined ? num(b.latitude) : existing.latitude ?? null, lng = b.longitude !== undefined ? num(b.longitude) : existing.longitude ?? null;
      const values = [req.user.id, links.job_id !== undefined ? links.job_id : existing.job_id ?? null, links.ticket_id !== undefined ? links.ticket_id : existing.ticket_id ?? null,
        r.kind, r.reading, r.binder, r.minimum, r.check.status, r.location_note, r.note, lat, lng, r.taken];
      const row = id
        ? (await pool.query(`UPDATE paving_temperatures SET job_id=$2,ticket_id=$3,kind=$4,reading_f=$5,binder=$6,minimum_f=$7,check_status=$8,location_note=$9,note=$10,latitude=$11,longitude=$12,taken_at=$13,status='saved',updated_at=now() WHERE id=$14 AND user_id=$1 RETURNING *`, [...values, id])).rows[0]
        : (await pool.query(`INSERT INTO paving_temperatures (user_id,job_id,ticket_id,kind,reading_f,binder,minimum_f,check_status,location_note,note,latitude,longitude,taken_at,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'saved') RETURNING *`, values)).rows[0];
      logEvent(req.user.id, 'paving_temperature_save', { kind: r.kind, status: r.check.status, photo: !!row.photo_path, corrected: row.ai_reading_f != null && Number(row.ai_reading_f) !== Number(row.reading_f) });
      res.json({ ok: true, reading: row, check: r.check });
    } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[paving.temperature.save]', e); res.status(500).json({ error: 'The temperature could not be saved.' }); }
  }
  app.post('/api/paving/temperatures', requireAuth, (req, res) => saveTemperature(req, res, null));
  app.post('/api/paving/temperatures/:id', requireAuth, (req, res) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'bad id' }); saveTemperature(req, res, id); });

  app.get('/api/paving/temperatures', requireAuth, async (req, res) => {
    try {
      if (!(await allowed(req.user.id))) return res.json({ readings: [], summary: { total: 0, low: 0 } });
      const params = [req.user.id, zone(String(req.query.tz || ''))]; let where = `t.user_id=$1 AND t.status='saved'`;
      if (isDate(req.query.date)) { params.push(req.query.date); where += ` AND (t.taken_at AT TIME ZONE $2)::date=$${params.length}::date`; }
      if (req.query.job_id) { const job = await ownedJobId(req.user.id, req.query.job_id); if (!job) return res.status(400).json({ error: 'Selected job is unavailable.' }); params.push(job); where += ` AND t.job_id=$${params.length}`; }
      const rows = (await pool.query(`SELECT t.*, a.ticket_number, a.truck_number, a.dispatch_temperature_f, j.name AS job_name, j.job_number FROM paving_temperatures t LEFT JOIN asphalt_tickets a ON a.id=t.ticket_id AND a.user_id=t.user_id LEFT JOIN jobs j ON j.id=t.job_id AND j.user_id=t.user_id WHERE ${where} ORDER BY t.taken_at DESC, t.id DESC LIMIT 300`, params)).rows;
      res.json({ readings: rows, summary: { total: rows.length, low: rows.filter(r => r.check_status === 'low').length } });
    } catch (e) { console.error('[paving.temperature.list]', e); res.status(500).json({ error: 'temperature list failed' }); }
  });
  app.delete('/api/paving/temperatures/:id', requireAuth, async (req, res) => {
    try {
      if (!(await allowed(req.user.id))) return res.status(403).json({ error: 'Paving Pro required' });
      const r = await pool.query(`UPDATE paving_temperatures SET status='deleted',updated_at=now() WHERE id=$1 AND user_id=$2 AND status<>'deleted' RETURNING id`, [Number(req.params.id), req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'not found' }); res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'delete failed' }); }
  });

  // ---- Daily yield ----
  async function yieldInputs(userId, jobId, date, tz) {
    const day = `COALESCE(ticket_date,(created_at AT TIME ZONE $3)::date)`;
    const t = (await pool.query(`SELECT COALESCE(sum(net_tons),0)::float AS tons, count(*)::int AS n, count(*) FILTER (WHERE net_tons IS NULL)::int AS missing FROM asphalt_tickets WHERE user_id=$1 AND job_id=$2 AND status='saved' AND ${day}=$4::date`, [userId, jobId, tz, date])).rows[0];
    const a = (await pool.query(`SELECT COALESCE(sum(dim_area_sqft),0)::float AS sqft, count(*)::int AS n FROM captures WHERE user_id=$1 AND job_id=$2 AND dim_area_sqft>0 AND dim_confirmed IS NOT FALSE AND (created_at AT TIME ZONE $3)::date=$4::date`, [userId, jobId, tz, date])).rows[0];
    return { tons: Math.round(t.tons * 100) / 100, ticket_count: t.n, missing_tons: t.missing, measured_area_sqft: Math.round(a.sqft * 10) / 10, measured_area_sy: Math.round(a.sqft / 9 * 100) / 100, measured_count: a.n };
  }
  app.get('/api/paving/yield/inputs', requireAuth, async (req, res) => {
    try {
      if (!(await allowed(req.user.id))) return res.status(403).json({ error: 'Paving Pro required' });
      const job = await ownedJobId(req.user.id, req.query.job_id); if (!job) return res.status(400).json({ error: 'Choose a job.' });
      if (!isDate(req.query.date)) return res.status(400).json({ error: 'Choose a date.' });
      res.json(await yieldInputs(req.user.id, job, req.query.date, zone(String(req.query.tz || ''))));
    } catch (e) { console.error('[paving.yield.inputs]', e); res.status(500).json({ error: 'yield inputs failed' }); }
  });
  app.post('/api/paving/yield', requireAuth, async (req, res) => {
    try {
      if (!(await allowed(req.user.id))) return res.status(403).json({ error: 'Paving Pro required' });
      const b = req.body || {}, job = await ownedJobId(req.user.id, b.job_id);
      if (!job) return res.status(400).json({ error: 'Choose a job.' }); if (!isDate(b.check_date)) return res.status(400).json({ error: 'Choose a date.' });
      const inputs = await yieldInputs(req.user.id, job, b.check_date, zone(String(b.tz || '')));
      // Tons come from the saved tickets so the check always matches the ticket record.
      const area = Rules.areaToSquareYards(b.area, b.area_unit);
      const result = Rules.yieldCheck({ tons: inputs.tons, area_sy: area, thickness_in: b.thickness_in, unit_weight: b.unit_weight, tolerance_pct: b.tolerance_pct });
      if (result.status === 'incomplete') return res.status(400).json({ error: result.message, result, inputs });
      const source = ['measured', 'entered'].includes(b.area_source) ? b.area_source : 'entered';
      const row = (await pool.query(`INSERT INTO paving_yield_checks (user_id,job_id,check_date,tons,ticket_count,area_sy,area_source,thickness_in,unit_weight,tolerance_pct,result,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [req.user.id, job, b.check_date, inputs.tons, inputs.ticket_count, result.area_sy, source, result.thickness_in, result.unit_weight, result.tolerance_pct, JSON.stringify({ ...result, missing_tons: inputs.missing_tons }), text(b.note, 1000)])).rows[0];
      logEvent(req.user.id, 'paving_yield_check', { status: result.status, yield_pct: result.yield_pct, area_source: source });
      res.json({ ok: true, check: row, result, inputs });
    } catch (e) { console.error('[paving.yield.save]', e); res.status(500).json({ error: 'The yield check could not be saved.' }); }
  });
  app.get('/api/paving/yield', requireAuth, async (req, res) => {
    try {
      if (!(await allowed(req.user.id))) return res.json({ checks: [] });
      const params = [req.user.id]; let where = `y.user_id=$1 AND y.status='saved'`;
      if (req.query.job_id) { const job = await ownedJobId(req.user.id, req.query.job_id); if (!job) return res.status(400).json({ error: 'Selected job is unavailable.' }); params.push(job); where += ` AND y.job_id=$2`; }
      const rows = (await pool.query(`SELECT y.*, to_char(y.check_date,'YYYY-MM-DD') AS check_day, j.name AS job_name, j.job_number FROM paving_yield_checks y LEFT JOIN jobs j ON j.id=y.job_id AND j.user_id=y.user_id WHERE ${where} ORDER BY y.check_date DESC, y.id DESC LIMIT 200`, params)).rows;
      res.json({ checks: rows });
    } catch (e) { console.error('[paving.yield.list]', e); res.status(500).json({ error: 'yield list failed' }); }
  });
  app.delete('/api/paving/yield/:id', requireAuth, async (req, res) => {
    try {
      if (!(await allowed(req.user.id))) return res.status(403).json({ error: 'Paving Pro required' });
      const r = await pool.query(`UPDATE paving_yield_checks SET status='deleted' WHERE id=$1 AND user_id=$2 AND status='saved' RETURNING id`, [Number(req.params.id), req.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'not found' }); res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: 'delete failed' }); }
  });
}

// Lines for the Paving job report: the latest yield check per day, and the temperature log.
async function jobReportLines(pool, userId, jobId) {
  const lines = { yield: [], temperatures: [] };
  try {
    const checks = (await pool.query(`SELECT DISTINCT ON (check_date) to_char(check_date,'YYYY-MM-DD') AS day, result FROM paving_yield_checks WHERE user_id=$1 AND job_id=$2 AND status='saved' ORDER BY check_date, id DESC`, [userId, jobId])).rows;
    for (const c of checks) { const r = c.result || {}; lines.yield.push(`${c.day}: ${r.tons} tons over ${r.area_sy} sq yd at ${r.thickness_in} in planned. ${r.actual_lb_sy} lb/sy against ${r.design_lb_sy} planned (${r.yield_pct}% of plan). ${r.message || ''}`.trim()); }
    const temps = (await pool.query(`SELECT t.*, a.ticket_number FROM paving_temperatures t LEFT JOIN asphalt_tickets a ON a.id=t.ticket_id WHERE t.user_id=$1 AND t.job_id=$2 AND t.status='saved' ORDER BY t.taken_at`, [userId, jobId])).rows;
    for (const t of temps) {
      const kind = (Rules.KINDS.find(k => k.id === t.kind) || {}).label || t.kind;
      const when = new Date(t.taken_at).toLocaleString('en-US', { timeZone: 'America/Chicago', dateStyle: 'medium', timeStyle: 'short' });
      const check = t.check_status === 'low' ? `BELOW MINIMUM ${Number(t.minimum_f)}°F` : t.check_status === 'ok' ? `meets ${Number(t.minimum_f)}°F minimum` : 'recorded';
      lines.temperatures.push(`${when}: ${kind} ${Number(t.reading_f)}°F, ${check}${t.ticket_number ? ', ticket ' + t.ticket_number : ''}${t.location_note ? ', ' + t.location_note : ''}${t.photo_path ? ' (photo on file)' : ''}`);
    }
  } catch (e) { console.error('[paving.quality.report]', e); }
  return lines;
}

module.exports = { register, jobReportLines, temperatureRow, THERMOMETER_PROMPT };
