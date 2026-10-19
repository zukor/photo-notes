// Concrete Pro estimating: measured areas, price list, estimates, site-visit photos, proposals, quantity export and bid versus actual.
'use strict';
const fs = require('fs');
const path = require('path');
const E = require('./public/concrete-estimate-rules.js');

const text = (v, max = 300) => { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; };
const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const money = v => v == null ? 'Price needed' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = v => v == null ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const KINDS = ['quick', 'detailed', 'commercial'];
const STATUSES = ['draft', 'sent', 'won', 'lost'];
// Site-visit photos are saved as proposal-phase Concrete photos so they also appear in the Library and reports.
const CHECKLIST_PURPOSE = { access: 'access', distance: 'access', staging: 'access', drainage: 'drainage', existing: 'existing_condition', trees: 'existing_condition', utilities: 'existing_condition', soil: 'existing_condition', row: 'proposed_area' };

function cleanSpec(b) {
  const s = obj(b), re = obj(s.reinforcement), demo = obj(s.demo);
  const pick = (v, list) => list.some(x => x.id === v) ? v : undefined;
  return {
    city: pick(s.city, E.CITY_PRESETS) || 'none', element: text(s.element, 40), thickness_in: num(s.thickness_in), psi: num(s.psi),
    reinforcement: { type: pick(re.type, E.REINFORCEMENT) || 'none', bar: ['#3', '#4', '#5'].includes(re.bar) ? re.bar : '#3', spacing_in: num(re.spacing_in), fiber_lb_cy: num(re.fiber_lb_cy) },
    finish: pick(s.finish, E.FINISHES) || 'broom', base_in: num(s.base_in), vapor: !!s.vapor, joints: s.joints !== false, isolation_lf: num(s.isolation_lf), formless_lf: num(s.formless_lf),
    demo: { sqft: num(demo.sqft), thickness_in: num(demo.thickness_in), reinforced: !!demo.reinforced }, placement: pick(s.placement, E.PLACEMENT) || 'chute',
    pours: num(s.pours), miles: num(s.miles), weekend: !!s.weekend, sealer: !!s.sealer, permit: !!s.permit, mobilizations: num(s.mobilizations)
  };
}
function cleanOptions(list) {
  return (Array.isArray(list) ? list : []).slice(0, 3).map(o => ({ name: text(o && o.name, 60) || 'Option', finish: E.FINISHES.some(f => f.id === (o && o.finish)) ? o.finish : 'broom',
    reinforcement: o && o.reinforcement && E.REINFORCEMENT.some(x => x.id === o.reinforcement.type) ? { type: o.reinforcement.type, bar: ['#3', '#4', '#5'].includes(o.reinforcement.bar) ? o.reinforcement.bar : '#3', spacing_in: num(o.reinforcement.spacing_in), fiber_lb_cy: num(o.reinforcement.fiber_lb_cy) } : null,
    sealer: o && o.sealer != null ? !!o.sealer : null }));
}
function cleanArea(b) {
  const shape = E.SHAPES.some(s => s.id === b.shape) ? b.shape : 'rect';
  const dims = {}; for (const [k, v] of Object.entries(obj(b.dims))) if (/^[a-z_]{1,20}$/.test(k)) dims[k] = text(v, 30);
  const cutouts = (Array.isArray(b.cutouts) ? b.cutouts : []).slice(0, 20).map(c => ({ name: text(c && c.name, 60) || 'Cut-out', area_sqft: num(c && c.area_sqft), perimeter_ft: num(c && c.perimeter_ft) })).filter(c => c.area_sqft > 0);
  const e = obj(b.edge), edge = num(e.depth_in) ? { depth_in: num(e.depth_in), width_in: num(e.width_in), length_ft: num(e.length_ft) } : {};
  const a = { name: text(b.name, 120), shape, dims, cutouts, edge, thickness_in: num(b.thickness_in), method: E.METHODS.some(m => m.id === b.method) ? b.method : 'entered', notes: text(b.notes, 2000) };
  if (!a.name) throw Object.assign(Error('Enter a name for the area.'), { status: 400 });
  const g = E.geometry(a);
  if (!g.ok || g.area_sqft > 2000000) throw Object.assign(Error('Enter the measurements for this shape. Use feet and inches, for example 18 ft 6 in.'), { status: 400 });
  if (a.thickness_in != null && (a.thickness_in <= 0 || a.thickness_in > 48)) throw Object.assign(Error('Thickness must be between 1 and 48 inches.'), { status: 400 });
  return { ...a, area_sqft: g.area_sqft, perimeter_ft: g.perimeter_ft };
}
// Perimeter of a map outline in feet, on a local flat grid (fine at job-site scale).
function outlinePerimeterFt(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length * Math.PI / 180, m = 111320;
  let total = 0;
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; total += Math.hypot((b.lat - a.lat) * m, (b.lng - a.lng) * m * Math.cos(lat0)); }
  return Math.round(total * 3.28084 * 10) / 10;
}
function parseCsv(textIn) {
  const rows = [];
  for (const line of String(textIn || '').split(/\r?\n/).slice(0, 501)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) { const c = line[i]; if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ',') { cells.push(cur); cur = ''; } else cur += c; }
    cells.push(cur); rows.push(cells.map(c => c.trim()));
  }
  return rows;
}
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

function register(app, { pool, requireAuth, requireConcrete, upload, logEvent, ownedJobId, imageDims, recordCaptureHistory, localPhoto, renderForEmbed, fittedWordImage, PDFDocument, docx }) {
  const guard = [requireAuth, requireConcrete];
  const fail = (res, e, tag, msg) => { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[' + tag + ']', e); res.status(500).json({ error: msg }); };
  const jobOrThrow = async (userId, v) => { const id = await ownedJobId(userId, v); if (!id) throw Object.assign(Error('Choose a job.'), { status: 400 }); return id; };
  async function priceBook(userId) {
    const row = (await pool.query('SELECT * FROM concrete_price_books WHERE user_id=$1', [userId])).rows[0];
    return { prices: row ? row.prices : {}, examples: row ? row.examples : [], settings: { ...E.DEFAULT_SETTINGS, ...(row ? row.settings : {}) }, saved: !!row };
  }
  async function areasFor(userId, ids) {
    if (!ids || !ids.length) return [];
    return (await pool.query(`SELECT * FROM concrete_areas WHERE user_id=$1 AND id=ANY($2::int[]) AND status='saved' ORDER BY id`, [userId, ids])).rows;
  }
  async function actualYards(userId, jobId) {
    if (!jobId) return null;
    const t = (await pool.query(`SELECT COALESCE(sum(load_yd3),0)::float AS yards, count(*)::int AS n FROM concrete_tickets WHERE user_id=$1 AND job_id=$2 AND status='saved'`, [userId, jobId])).rows[0];
    return t.n ? t.yards : null;
  }
  async function evaluate(userId, est) {
    const areas = await areasFor(userId, est.area_ids), book = await priceBook(userId);
    const options = E.priceOptions(areas, est.spec || {}, est.options, book.prices, book.settings);
    const first = options[0] && options[0].takeoff;
    const actual = await actualYards(userId, est.job_id);
    return { areas, options, checklist: E.checklistStatus(est.checklist), actual: first && first.ok ? E.compareActual(first.placed_cy, first.purchase_cy, actual) : { status: 'no_data', message: 'Add measured areas first.' }, book: { examples: book.examples, saved: book.saved, settings: book.settings } };
  }
  async function loadEstimate(userId, id) {
    const est = (await pool.query(`SELECT e.*, j.name AS job_name, j.job_number, j.address AS job_address FROM concrete_estimates e LEFT JOIN jobs j ON j.id=e.job_id AND j.user_id=e.user_id WHERE e.id=$1 AND e.user_id=$2 AND e.status<>'deleted'`, [id, userId])).rows[0];
    if (!est) throw Object.assign(Error('Estimate not found.'), { status: 404 });
    return est;
  }

  // ---- Measured areas ----
  app.get('/api/concrete/areas', ...guard, async (req, res) => {
    try {
      const job = await jobOrThrow(req.user.id, req.query.job_id);
      const areas = (await pool.query(`SELECT * FROM concrete_areas WHERE user_id=$1 AND job_id=$2 AND status='saved' ORDER BY id`, [req.user.id, job])).rows;
      const used = new Set(areas.map(a => a.footprint_id).filter(Boolean));
      const outlines = (await pool.query(`SELECT f.id, f.name, f.map_area_sqft, f.field_area_sqft, f.field_length_ft, f.field_width_ft, f.field_method, f.points FROM concrete_footprints f JOIN captures c ON c.id=f.capture_id AND c.user_id=f.user_id WHERE f.user_id=$1 AND c.job_id=$2 ORDER BY f.name`, [req.user.id, job])).rows.filter(f => !used.has(f.id));
      res.json({ areas: areas.map(a => ({ ...a, method_label: (E.METHODS.find(m => m.id === a.method) || {}).label })), saved_outlines: outlines.map(f => ({ id: f.id, name: f.name, map_area_sqft: f.map_area_sqft, field_area_sqft: f.field_area_sqft })) });
    } catch (e) { fail(res, e, 'concrete.areas.list', 'Areas could not be loaded.'); }
  });
  async function saveArea(req, res, id) {
    try {
      const b = req.body || {}, a = cleanArea(b);
      if (id) {
        const row = (await pool.query(`UPDATE concrete_areas SET name=$3,shape=$4,dims=$5,cutouts=$6,edge=$7,thickness_in=$8,method=$9,area_sqft=$10,perimeter_ft=$11,notes=$12,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='saved' RETURNING *`,
          [id, req.user.id, a.name, a.shape, JSON.stringify(a.dims), JSON.stringify(a.cutouts), JSON.stringify(a.edge), a.thickness_in, a.method, a.area_sqft, a.perimeter_ft, a.notes])).rows[0];
        if (!row) return res.status(404).json({ error: 'Area not found.' });
        return res.json({ ok: true, area: row });
      }
      const job = await jobOrThrow(req.user.id, b.job_id);
      let capture = null; if (b.capture_id) { capture = (await pool.query('SELECT id FROM captures WHERE id=$1 AND user_id=$2', [Number(b.capture_id), req.user.id])).rows[0]; if (!capture) return res.status(400).json({ error: 'Selected photo is unavailable.' }); }
      const row = (await pool.query(`INSERT INTO concrete_areas (user_id,job_id,capture_id,name,shape,dims,cutouts,edge,thickness_in,method,area_sqft,perimeter_ft,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
        [req.user.id, job, capture && capture.id, a.name, a.shape, JSON.stringify(a.dims), JSON.stringify(a.cutouts), JSON.stringify(a.edge), a.thickness_in, a.method, a.area_sqft, a.perimeter_ft, a.notes])).rows[0];
      logEvent(req.user.id, 'concrete_area_save', { shape: a.shape, method: a.method });
      res.json({ ok: true, area: row });
    } catch (e) { fail(res, e, 'concrete.areas.save', 'The area could not be saved.'); }
  }
  app.post('/api/concrete/areas', ...guard, (req, res) => saveArea(req, res, null));
  // Removing an area keeps the record; it no longer appears in the job's areas or new estimates.
  app.delete('/api/concrete/areas/:id', ...guard, async (req, res) => {
    try { const r = await pool.query(`UPDATE concrete_areas SET status='removed',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='saved' RETURNING id`, [Number(req.params.id), req.user.id]); if (!r.rowCount) return res.status(404).json({ error: 'Area not found.' }); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: 'remove failed' }); }
  });
  // A saved map outline or tape measurement from Patio and Foundation Areas becomes a measured area.
  app.post('/api/concrete/areas/from-outline', ...guard, async (req, res) => {
    try {
      const job = await jobOrThrow(req.user.id, req.body && req.body.job_id);
      const f = (await pool.query(`SELECT f.* FROM concrete_footprints f JOIN captures c ON c.id=f.capture_id AND c.user_id=f.user_id WHERE f.id=$1 AND f.user_id=$2 AND c.job_id=$3`, [Number(req.body && req.body.footprint_id), req.user.id, job])).rows[0];
      if (!f) return res.status(404).json({ error: 'Saved area not found for this job.' });
      const field = f.field_length_ft > 0 && f.field_width_ft > 0;
      const a = field ? { name: f.name, shape: 'rect', dims: { length: String(f.field_length_ft), width: String(f.field_width_ft) }, method: f.field_method === 'laser' ? 'laser' : 'tape' }
        : { name: f.name, shape: 'custom', dims: { area_sqft: String(f.map_area_sqft), perimeter_ft: String(outlinePerimeterFt(f.points) || '') }, method: 'map' };
      const c = cleanArea(a);
      const row = (await pool.query(`INSERT INTO concrete_areas (user_id,job_id,capture_id,footprint_id,name,shape,dims,method,area_sqft,perimeter_ft) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.user.id, job, f.capture_id, f.id, c.name, c.shape, JSON.stringify(c.dims), c.method, c.area_sqft, c.perimeter_ft])).rows[0];
      res.json({ ok: true, area: row });
    } catch (e) { fail(res, e, 'concrete.areas.outline', 'The saved area could not be added.'); }
  });
  // Commercial: import a takeoff exported from plan software or the Ramo Optimizer. Columns: name, area_sqft, perimeter_ft, thickness_in.
  app.post('/api/concrete/areas/import', ...guard, async (req, res) => {
    try {
      const job = await jobOrThrow(req.user.id, req.body && req.body.job_id);
      const rows = parseCsv(req.body && req.body.csv);
      if (rows.length && rows[0].some(c => /[a-z]/i.test(c) && !/^\d/.test(c)) && !num(rows[0][1])) rows.shift();
      if (!rows.length) return res.status(400).json({ error: 'Paste rows of: name, area in square feet, edge length in feet, thickness in inches.' });
      const made = [], errors = [];
      for (const [i, r] of rows.entries()) {
        try { const a = cleanArea({ name: r[0], shape: 'custom', dims: { area_sqft: r[1], perimeter_ft: r[2] }, thickness_in: r[3], method: 'plans' }); made.push(a); }
        catch (e) { errors.push(`Row ${i + 1}: ${e.message}`); }
      }
      if (errors.length) return res.status(400).json({ error: errors.slice(0, 5).join(' ') });
      const saved = [];
      for (const a of made) saved.push((await pool.query(`INSERT INTO concrete_areas (user_id,job_id,name,shape,dims,thickness_in,method,area_sqft,perimeter_ft) VALUES ($1,$2,$3,'custom',$4,$5,'plans',$6,$7) RETURNING *`, [req.user.id, job, a.name, JSON.stringify(a.dims), a.thickness_in, a.area_sqft, a.perimeter_ft])).rows[0]);
      logEvent(req.user.id, 'concrete_area_import', { rows: saved.length });
      res.json({ ok: true, areas: saved });
    } catch (e) { fail(res, e, 'concrete.areas.import', 'The takeoff could not be imported.'); }
  });

  // Registered after the named routes above so 'import' and 'from-outline' are not read as an id.
  app.post('/api/concrete/areas/:id', ...guard, (req, res) => { const id = Number(req.params.id); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'bad id' }); saveArea(req, res, id); });

  // ---- Price list ----
  app.get('/api/concrete/price-book', ...guard, async (req, res) => {
    try { const b = await priceBook(req.user.id); res.json({ ...b, items: E.PRICE_ITEMS, example_prices: E.EXAMPLE_PRICES, accuracy: await accuracy(req.user.id) }); } catch (e) { fail(res, e, 'concrete.price.get', 'The price list could not be loaded.'); }
  });
  app.post('/api/concrete/price-book', ...guard, async (req, res) => {
    try {
      const b = req.body || {}, prices = {}, examples = [];
      for (const [key] of E.PRICE_ITEMS) { const v = num(obj(b.prices)[key]); if (v != null) { if (v < 0 || v > 1000000) return res.status(400).json({ error: 'Prices must be between 0 and 1,000,000.' }); prices[key] = v; } }
      for (const key of Array.isArray(b.examples) ? b.examples : []) if (prices[key] != null && E.EXAMPLE_PRICES[key] === prices[key]) examples.push(key);
      const s = obj(b.settings), settings = {};
      for (const [k, lo, hi] of [['concrete_waste_pct', 0, 50], ['rebar_waste_pct', 0, 100], ['short_load_cy', 0, 15], ['free_miles', 0, 500], ['markup_pct', 0, 200], ['chair_spacing_ft', 1, 10]]) { const v = num(s[k]); if (v != null) { if (v < lo || v > hi) return res.status(400).json({ error: `${k.replace(/_/g, ' ')} must be between ${lo} and ${hi}.` }); settings[k] = v; } }
      settings.round_up = s.round_up !== false;
      const row = (await pool.query(`INSERT INTO concrete_price_books (user_id,prices,examples,settings,updated_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (user_id) DO UPDATE SET prices=$2,examples=$3,settings=$4,updated_at=now() RETURNING *`, [req.user.id, JSON.stringify(prices), JSON.stringify(examples), JSON.stringify(settings)])).rows[0];
      logEvent(req.user.id, 'concrete_price_book_save', { priced: Object.keys(prices).length, examples: examples.length });
      res.json({ ok: true, prices: row.prices, examples: row.examples, settings: { ...E.DEFAULT_SETTINGS, ...row.settings } });
    } catch (e) { fail(res, e, 'concrete.price.save', 'The price list could not be saved.'); }
  });

  // ---- Estimates ----
  app.get('/api/concrete/estimates', ...guard, async (req, res) => {
    try {
      const params = [req.user.id]; let where = `e.user_id=$1 AND e.status<>'deleted'`;
      if (req.query.job_id) { params.push(await jobOrThrow(req.user.id, req.query.job_id)); where += ' AND e.job_id=$2'; }
      const rows = (await pool.query(`SELECT e.id,e.name,e.kind,e.status,e.job_id,e.updated_at,e.result,j.name AS job_name FROM concrete_estimates e LEFT JOIN jobs j ON j.id=e.job_id AND j.user_id=e.user_id WHERE ${where} ORDER BY e.updated_at DESC LIMIT 200`, params)).rows;
      res.json({ estimates: rows });
    } catch (e) { fail(res, e, 'concrete.estimates.list', 'Estimates could not be loaded.'); }
  });
  app.post('/api/concrete/estimates', ...guard, async (req, res) => {
    try {
      const b = req.body || {}, job = await jobOrThrow(req.user.id, b.job_id), kind = KINDS.includes(b.kind) ? b.kind : 'detailed';
      const spec = cleanSpec({ thickness_in: kind === 'quick' ? 4 : null, finish: 'broom', ...obj(b.spec) });
      const options = kind === 'quick' ? [] : cleanOptions([{ name: 'Good', finish: 'broom' }, { name: 'Better', finish: 'colored' }, { name: 'Best', finish: 'stamped' }]);
      const j = (await pool.query('SELECT customer, address FROM jobs WHERE id=$1 AND user_id=$2', [job, req.user.id])).rows[0] || {};
      const customer = { name: text(obj(b.customer).name, 200) || j.customer || null, address: text(obj(b.customer).address, 200) || j.address || null };
      const row = (await pool.query(`INSERT INTO concrete_estimates (user_id,job_id,name,kind,spec,options,customer) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [req.user.id, job, text(b.name, 120) || (kind === 'quick' ? 'Quick Estimate' : 'Estimate'), kind, JSON.stringify(spec), JSON.stringify(options), JSON.stringify(customer)])).rows[0];
      logEvent(req.user.id, 'concrete_estimate_create', { kind });
      res.json({ ok: true, estimate: row });
    } catch (e) { fail(res, e, 'concrete.estimates.create', 'The estimate could not be created.'); }
  });
  app.get('/api/concrete/estimates/:id', ...guard, async (req, res) => {
    try { const est = await loadEstimate(req.user.id, Number(req.params.id)); res.json({ estimate: est, ...(await evaluate(req.user.id, est)) }); } catch (e) { fail(res, e, 'concrete.estimates.get', 'The estimate could not be loaded.'); }
  });
  app.post('/api/concrete/estimates/:id', ...guard, async (req, res) => {
    try {
      const est = await loadEstimate(req.user.id, Number(req.params.id)), b = req.body || {};
      const customer = b.customer ? Object.fromEntries(['name', 'phone', 'email', 'address'].map(k => [k, text(obj(b.customer)[k], 200)])) : est.customer;
      let areaIds = est.area_ids;
      if (Array.isArray(b.area_ids)) {
        const ids = b.area_ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
        const ok = ids.length ? (await pool.query(`SELECT id FROM concrete_areas WHERE user_id=$1 AND job_id=$2 AND status='saved' AND id=ANY($3::int[])`, [req.user.id, est.job_id, ids])).rows.map(r => r.id) : [];
        areaIds = ids.filter(id => ok.includes(id));
      }
      let checklist = est.checklist || {};
      if (b.checklist) { const next = {}; for (const i of E.CHECKLIST) { const c = obj(obj(b.checklist)[i.key]), old = obj(checklist[i.key]); next[i.key] = { answer: text(c.answer, 1000), photos: Array.isArray(old.photos) ? old.photos : [] }; } checklist = next; }
      const spec = b.spec ? cleanSpec(b.spec) : est.spec, options = b.options ? cleanOptions(b.options) : est.options;
      const status = STATUSES.includes(b.status) ? b.status : est.status;
      const next = { ...est, spec, options, area_ids: areaIds, checklist };
      const ev = await evaluate(req.user.id, next);
      const summary = { options: ev.options.map(o => ({ name: o.name, total: o.pricing.total, complete: o.pricing.complete, per_sqft: o.pricing.per_sqft })), area_sqft: ev.options[0] && ev.options[0].takeoff.area_sqft, placed_cy: ev.options[0] && ev.options[0].takeoff.placed_cy, purchase_cy: ev.options[0] && ev.options[0].takeoff.purchase_cy };
      const row = (await pool.query(`UPDATE concrete_estimates SET name=$3,customer=$4,spec=$5,options=$6,area_ids=$7,checklist=$8,notes=$9,status=$10,result=$11,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *`,
        [est.id, req.user.id, text(b.name, 120) || est.name, JSON.stringify(customer || {}), JSON.stringify(spec), JSON.stringify(options), areaIds, JSON.stringify(checklist), b.notes !== undefined ? text(b.notes, 4000) : est.notes, status, JSON.stringify(summary)])).rows[0];
      if (status !== est.status) logEvent(req.user.id, 'concrete_estimate_status', { status });
      res.json({ ok: true, estimate: { ...row, job_name: est.job_name }, ...ev });
    } catch (e) { fail(res, e, 'concrete.estimates.save', 'The estimate could not be saved.'); }
  });
  app.delete('/api/concrete/estimates/:id', ...guard, async (req, res) => {
    try { const r = await pool.query(`UPDATE concrete_estimates SET status='deleted',updated_at=now() WHERE id=$1 AND user_id=$2 AND status<>'deleted' RETURNING id`, [Number(req.params.id), req.user.id]); if (!r.rowCount) return res.status(404).json({ error: 'Estimate not found.' }); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: 'delete failed' }); }
  });
  // A site-visit photo is saved as a proposal-phase Concrete photo on the job and attached to the checklist item.
  app.post('/api/concrete/estimates/:id/checklist-photo', ...guard, upload.single('photo'), async (req, res) => {
    try {
      const est = await loadEstimate(req.user.id, Number(req.params.id)), key = String(req.body && req.body.key || '');
      const item = E.CHECKLIST.find(i => i.key === key);
      if (!item || !req.file) { if (req.file) try { fs.unlinkSync(req.file.path); } catch (e) {} return res.status(400).json({ error: 'Choose a checklist item and a photo.' }); }
      const dims = await imageDims(req.file.path), lat = num(req.body.latitude), lng = num(req.body.longitude);
      const note = `Site visit: ${item.label}.${est.checklist && est.checklist[key] && est.checklist[key].answer ? ' ' + est.checklist[key].answer : ''}`.slice(0, 2000);
      const cap = (await pool.query(`INSERT INTO captures (user_id,captured_by,photo_path,photo_width,photo_height,note,kind,job_id,latitude,longitude,concrete_phase,concrete_purpose,concrete_stage,concrete_element,concrete_condition,concrete_severity) VALUES ($1,$2,$3,$4,$5,$6,'note',$7,$8,$9,'proposal',$10,'existing_condition',$11,'not_assessed','none') RETURNING id,photo_path`,
        [req.user.id, req.user.name, '/uploads/' + path.basename(req.file.path), dims && dims.w, dims && dims.h, note, est.job_id, lat, lng, CHECKLIST_PURPOSE[key] || 'existing_condition', est.spec && est.spec.element || null])).rows[0];
      await recordCaptureHistory(req.user.id, cap.id, 'captured', { photo: true, concrete_estimate: est.id, checklist: key });
      const checklist = est.checklist || {}, entry = obj(checklist[key]);
      checklist[key] = { answer: entry.answer || null, photos: [...(Array.isArray(entry.photos) ? entry.photos : []), cap.id].slice(-6) };
      await pool.query(`UPDATE concrete_estimates SET checklist=$3,updated_at=now() WHERE id=$1 AND user_id=$2`, [est.id, req.user.id, JSON.stringify(checklist)]);
      res.json({ ok: true, capture: cap, checklist });
    } catch (e) { fail(res, e, 'concrete.estimates.photo', 'The photo could not be saved.'); }
  });
  app.get('/api/concrete/estimates/:id/quantities.csv', ...guard, async (req, res) => {
    try {
      const est = await loadEstimate(req.user.id, Number(req.params.id)), ev = await evaluate(req.user.id, est);
      const out = [['Estimate', est.name], ['Job', est.job_name || ''], [], ['Area', 'Square feet', 'Edge length (ft)', 'Thickness (in)', 'Cubic yards', 'Measured by', 'Contingency %']];
      for (const a of (ev.options[0] && ev.options[0].takeoff.areas) || []) out.push([a.name, a.area_sqft, a.perimeter_ft, a.thickness_in, a.cubic_yards, a.method, a.contingency_pct]);
      for (const o of ev.options) {
        out.push([], [`Option: ${o.name}`, o.description], ['Item', 'Placed quantity', 'Purchase quantity', 'Unit', 'Unit price', 'Amount', 'Note']);
        for (const l of o.pricing.lines) out.push([l.label, l.placed, l.purchase, l.unit, l.unit_price, l.amount, l.note]);
        out.push(['Total', '', '', '', '', o.pricing.total, o.pricing.complete ? '' : 'Some items need a price']);
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="concrete-estimate-${est.id}-quantities.csv"`);
      res.send(out.map(r => r.map(csvCell).join(',')).join('\r\n'));
    } catch (e) { fail(res, e, 'concrete.estimates.csv', 'The quantities could not be exported.'); }
  });
  app.get('/api/concrete/estimates/:id/proposal', ...guard, async (req, res) => {
    try {
      const est = await loadEstimate(req.user.id, Number(req.params.id)), ev = await evaluate(req.user.id, est);
      const format = req.query.doc === 'docx' ? 'docx' : 'pdf';
      const preset = E.CITY_PRESETS.find(c => c.id === (est.spec && est.spec.city));
      const photoIds = E.CHECKLIST.flatMap(i => (obj(est.checklist[i.key]).photos || [])).slice(0, 6);
      const photos = photoIds.length ? (await pool.query(`SELECT id, photo_path, note FROM captures WHERE user_id=$1 AND id=ANY($2::int[])`, [req.user.id, photoIds])).rows : [];
      const cust = obj(est.customer), date = new Date().toLocaleDateString('en-US', { dateStyle: 'long' });
      const areaRows = ((ev.options[0] && ev.options[0].takeoff.areas) || []).map(a => [a.name, `${qty(a.area_sqft)} sq ft`, `${a.thickness_in} in`, `${a.method} (${a.confidence})`]);
      const siteNotes = E.CHECKLIST.map(i => obj(est.checklist[i.key]).answer ? `${i.label}: ${obj(est.checklist[i.key]).answer}` : null).filter(Boolean);
      const exclusions = ['Work not listed above.', 'Unforeseen subsurface conditions, rock, or unsuitable soil found during excavation.', 'Repairs to sprinkler lines, utilities or landscaping not marked before work begins.', 'Permit fees unless listed.'];
      const any = ev.options.some(o => !o.pricing.complete);
      const lines = {
        intro: [`Prepared by ${req.user.name || 'your contractor'} on ${date}.`, cust.name ? `For: ${cust.name}${cust.address ? ', ' + cust.address : ''}` : null, est.job_name ? `Project: ${est.job_name}` : null].filter(Boolean),
        options: ev.options.map(o => [o.name, o.description, o.pricing.complete ? money(o.pricing.total) : 'Price to follow', o.pricing.complete && o.pricing.per_sqft ? `${money(o.pricing.per_sqft)} per sq ft` : '']),
        notes: [...(preset && preset.notes ? preset.notes : []), ...(est.notes ? [est.notes] : [])],
        measurement: `Quantities are based on ${ev.options[0] && ev.options[0].takeoff.confidence ? ev.options[0].takeoff.confidence.toLowerCase() + '-accuracy' : ''} measurements as listed. Final pricing may be adjusted if field measurements differ.`
      };
      logEvent(req.user.id, 'concrete_proposal', { format, options: ev.options.length, incomplete: any });
      if (format === 'pdf') {
        res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="concrete-proposal-${est.id}.pdf"`);
        const pdf = new PDFDocument({ size: 'LETTER', margin: 54 }); pdf.pipe(res);
        pdf.fillColor('#000').font('Helvetica-Bold').fontSize(20).text(`Concrete Proposal: ${est.name}`).font('Helvetica').fontSize(12).moveDown(0.5);
        for (const l of lines.intro) pdf.text(l);
        const section = t => { if (pdf.y > 640) pdf.addPage(); pdf.moveDown().font('Helvetica-Bold').fontSize(14).text(t).font('Helvetica').fontSize(12); };
        section('Areas'); for (const r of areaRows) pdf.text(`${r[0]}: ${r[1]}, ${r[2]}. Measured by ${r[3]}.`);
        pdf.text(lines.measurement);
        section('Options'); for (const o of lines.options) { pdf.font('Helvetica-Bold').text(`${o[0]}: ${o[2]}${o[3] ? ' (' + o[3] + ')' : ''}`).font('Helvetica').text(o[1]).moveDown(0.3); }
        if (siteNotes.length) { section('Site conditions noted'); for (const n of siteNotes) pdf.text(n); }
        if (lines.notes.length) { section('Requirements and notes'); for (const n of lines.notes) pdf.text(n); }
        section('Not included'); for (const n of exclusions) pdf.text(n);
        for (const p of photos) { const img = localPhoto(p.photo_path), r = img ? await renderForEmbed(img, 'standard', 'jpeg') : null; if (!r) continue; if (pdf.y > 420) pdf.addPage(); pdf.image(r.buffer, { fit: [500, 300] }); pdf.moveDown(0.3).text(p.note || ''); }
        section('Acceptance'); pdf.text('Option chosen: ______________________').moveDown().text('Customer signature: ______________________   Date: ____________').moveDown().text('Contractor signature: ______________________   Date: ____________');
        pdf.end(); return;
      }
      const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = docx;
      const P = (t, bold) => new Paragraph({ children: [new TextRun({ text: t, bold: !!bold, font: 'Arial', size: 24, color: '000000' })] });
      const H = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: t, bold: true, font: 'Arial', size: 28, color: '000000' })] });
      const kids = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: `Concrete Proposal: ${est.name}`, bold: true, font: 'Arial', size: 36, color: '000000' })] }), ...lines.intro.map(l => P(l)), H('Areas'), ...areaRows.map(r => P(`${r[0]}: ${r[1]}, ${r[2]}. Measured by ${r[3]}.`)), P(lines.measurement), H('Options')];
      for (const o of lines.options) kids.push(P(`${o[0]}: ${o[2]}${o[3] ? ' (' + o[3] + ')' : ''}`, true), P(o[1]));
      if (siteNotes.length) kids.push(H('Site conditions noted'), ...siteNotes.map(n => P(n)));
      if (lines.notes.length) kids.push(H('Requirements and notes'), ...lines.notes.map(n => P(n)));
      kids.push(H('Not included'), ...exclusions.map(n => P(n)));
      for (const p of photos) { const img = localPhoto(p.photo_path), r = img ? await renderForEmbed(img, 'standard', 'jpeg') : null; if (!r) continue; kids.push(new Paragraph({ children: [new ImageRun({ type: 'jpg', data: r.buffer, transformation: await fittedWordImage(r.buffer, 480, 300) })] }), P(p.note || '')); }
      kids.push(H('Acceptance'), P('Option chosen: ______________________'), P('Customer signature: ______________________   Date: ____________'), P('Contractor signature: ______________________   Date: ____________'));
      const buffer = await Packer.toBuffer(new Document({ sections: [{ children: kids }] }));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); res.setHeader('Content-Disposition', `attachment; filename="concrete-proposal-${est.id}.docx"`); res.send(buffer);
    } catch (e) { if (!res.headersSent) fail(res, e, 'concrete.estimates.proposal', 'The proposal could not be created.'); }
  });
  // Bid versus actual across the company's estimates that have batch tickets.
  async function accuracy(userId) {
    const rows = (await pool.query(`SELECT e.id, e.job_id, e.result FROM concrete_estimates e WHERE e.user_id=$1 AND e.status IN ('won','sent','draft') AND e.job_id IS NOT NULL AND e.result IS NOT NULL ORDER BY e.updated_at DESC LIMIT 100`, [userId])).rows;
    const results = [];
    for (const r of rows) { const a = await actualYards(userId, r.job_id); if (a && r.result && r.result.placed_cy) results.push(E.compareActual(r.result.placed_cy, r.result.purchase_cy, a)); }
    return E.suggestedWaste(results);
  }
}

module.exports = { register, cleanArea, cleanSpec, cleanOptions, parseCsv, outlinePerimeterFt };
