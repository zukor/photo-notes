'use strict';
// Precision Measure field validation: testers measure a pothole with a tape and with the app, and the
// pair is recorded so the real-world accuracy can be reported. Nothing here changes a Photo Note.
const path = require('path');

const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 100) / 100 : null; };
function validationDetail(body, userAgent) {
  const b = body || {}, app = b.app || {}, tape = b.tape || {};
  const detail = {
    app_length_mm: num(app.length_mm, 10, 20000), app_width_mm: num(app.width_mm, 10, 20000), app_area_mm2: num(app.area_mm2, 100, 4e8),
    tape_length_mm: num(tape.length_mm, 10, 20000), tape_width_mm: num(tape.width_mm, 10, 20000),
    app_depth_in: num(app.depth_in, 0, 48), tape_depth_in: num(tape.depth_in, 0, 48),
    card_mm: num(b.card_mm, 50, 1000), tilt_deg: num(b.tilt_deg, 0, 90), phone_tilt_deg: num(b.phone_tilt_deg, 0, 90),
    card_fraction: num(b.card_fraction, 0, 1), px_per_mm: num(b.px_per_mm, 0, 50),
    mode: ['outline', 'rectangle'].includes(b.mode) ? b.mode : 'outline',
    edges: ['clean', 'ragged'].includes(b.edges) ? b.edges : 'unknown',
    capture: ['live', 'existing'].includes(b.capture) ? b.capture : 'live',
    note: typeof b.note === 'string' ? b.note.trim().slice(0, 300) : '',
    device: String(userAgent || '').slice(0, 300),
  };
  if (!detail.app_length_mm || !detail.app_width_mm || !detail.tape_length_mm || !detail.tape_width_mm) return null;
  return detail;
}
const accuracy = (app, tape) => app && tape ? 100 - Math.abs(app - tape) / tape * 100 : null;
function summarize(rows) {
  const items = rows.map(r => {
    const d = r.detail || {};
    const areaTape = d.tape_length_mm && d.tape_width_mm ? d.tape_length_mm * d.tape_width_mm : null;
    const areaApp = d.app_length_mm && d.app_width_mm ? d.app_length_mm * d.app_width_mm : null;
    return { ...d, id: r.id, created_at: r.created_at, name: r.name, length_accuracy: accuracy(d.app_length_mm, d.tape_length_mm), width_accuracy: accuracy(d.app_width_mm, d.tape_width_mm), box_area_accuracy: accuracy(areaApp, areaTape), depth_difference_in: d.app_depth_in != null && d.tape_depth_in != null ? Math.abs(d.app_depth_in - d.tape_depth_in) : null };
  });
  const stats = list => {
    const acc = list.flatMap(i => [i.length_accuracy, i.width_accuracy]).filter(v => v != null);
    if (!acc.length) return { measurements: list.length, mean: null, worst: null, within1: null, within2: null, within5: null };
    const pct = t => Math.round(acc.filter(a => a >= 100 - t).length / acc.length * 1000) / 10;
    return { measurements: list.length, mean: Math.round(acc.reduce((s, v) => s + v, 0) / acc.length * 100) / 100, worst: Math.round(Math.min(...acc) * 100) / 100, within1: pct(1), within2: pct(2), within5: pct(5) };
  };
  return { overall: stats(items), clean: stats(items.filter(i => i.edges === 'clean')), ragged: stats(items.filter(i => i.edges === 'ragged')), items };
}

function register(app, { pool, requireAuth }) {
  // The marker library, served from the installed package so the phone never loads code from elsewhere.
  for (const file of ['cv.js', 'aruco.js']) app.get('/vendor/aruco/' + file, (req, res) => { res.set('Cache-Control', req.query.v !== undefined ? 'public, max-age=31536000, immutable' : 'public, max-age=86400'); res.sendFile(path.join(path.dirname(require.resolve('js-aruco2/src/aruco.js')), file)); });
  const canReview = u => u && (u.role === 'admin' || u.is_testing_manager === true);
  app.post('/api/precision-measure/validation', requireAuth, async (req, res) => {
    try {
      const detail = validationDetail(req.body, req.get('user-agent'));
      if (!detail) return res.status(400).json({ error: 'Enter the app and tape length and width.' });
      await pool.query(`INSERT INTO events(user_id, action, detail) VALUES($1, 'precision_measure_validation', $2)`, [req.user.id, JSON.stringify(detail)]);
      res.json({ ok: true, length_accuracy: accuracy(detail.app_length_mm, detail.tape_length_mm), width_accuracy: accuracy(detail.app_width_mm, detail.tape_width_mm) });
    } catch (e) { res.status(500).json({ error: 'Field test result could not be saved.' }); }
  });
  app.get('/api/admin/precision-measure-validation', requireAuth, async (req, res) => {
    if (!canReview(req.user)) return res.status(403).json({ error: 'Admin or testing manager access required' });
    try {
      const rows = (await pool.query(`SELECT e.id, e.created_at, e.detail, u.name FROM events e LEFT JOIN users u ON u.id = e.user_id WHERE e.action = 'precision_measure_validation' ORDER BY e.created_at DESC LIMIT 500`)).rows;
      res.json(summarize(rows));
    } catch (e) { res.status(500).json({ error: 'Field test results could not be loaded.' }); }
  });
}
module.exports = { register, validationDetail, summarize, accuracy };
