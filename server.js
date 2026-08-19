const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const sharp = require('sharp');
const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } = require('docx');
const { pool, init, seedUserAreas } = require('./db');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const COOKIE = 'pn_token';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---- static frontend + uploaded photos ----
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---- auth ----
function setSession(res, user) {
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role, plan: user.plan || 'free' }, SESSION_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
function readUser(req) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return null;
  try { return jwt.verify(token, SESSION_SECRET); } catch { return null; }
}
function requireAuth(req, res, next) {
  const u = readUser(req);
  if (!u || !u.id) return res.status(401).json({ error: 'not authenticated' });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  const u = readUser(req);
  if (!u || !u.id) return res.status(401).json({ error: 'not authenticated' });
  if (u.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  req.user = u;
  next();
}
// Single source of truth for Pro gating. Pro features must not render or store
// for free users.
function isPro(user) { return !!(user && user.plan === 'pro'); }

// ---- Pro dimension helpers ----
// Compute area in square feet from canonical inch measurements and shape.
// rectangle: L x W; circle: L x W x 0.785; irregular: L x W x 0.85. Result is
// square inches / 144. Returns null when length or width is missing.
function computeAreaSqft(lengthIn, widthIn, shape) {
  const L = Number(lengthIn), W = Number(widthIn);
  if (!Number.isFinite(L) || !Number.isFinite(W) || L <= 0 || W <= 0) return null;
  let factor = 1;
  if (shape === 'circle') factor = 0.785;
  else if (shape === 'irregular') factor = 0.85;
  const sqin = L * W * factor;
  return sqin / 144;
}
// Normalize a raw dimension value + unit ('ft'|'in') to inches.
function toInches(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  return unit === 'ft' ? v * 12 : v;
}
// Build the export string, e.g. "3.0 ft x 2.0 ft x 4 in deep, 6.0 sq ft".
// Irregular shapes prepend "approx." to the area. Returns '' when no dims.
function fmtDims(c) {
  if (!c || c.dim_area_sqft == null && c.dim_length_in == null && c.dim_width_in == null) return '';
  const parts = [];
  const dispLen = dispDim(c.dim_length_in, c.dim_length_unit);
  const dispWid = dispDim(c.dim_width_in, c.dim_width_unit);
  const lw = [dispLen, dispWid].filter(Boolean);
  if (lw.length) parts.push(lw.join(' x '));
  if (c.dim_depth_in != null && Number.isFinite(Number(c.dim_depth_in))) {
    parts.push(`${trimNum(Number(c.dim_depth_in))} in deep`);
  }
  let line = parts.join(' x ');
  if (c.dim_area_sqft != null && Number.isFinite(Number(c.dim_area_sqft))) {
    const areaStr = `${Number(c.dim_area_sqft).toFixed(1)} sq ft`;
    const areaLabel = c.dim_shape === 'irregular' ? `approx. ${areaStr}` : areaStr;
    line = line ? `${line}, ${areaLabel}` : areaLabel;
  }
  return line;
}
// One length/width value formatted in its chosen display unit, e.g. "3.0 ft".
function dispDim(valueIn, unit) {
  const v = Number(valueIn);
  if (!Number.isFinite(v) || v <= 0) return '';
  if (unit === 'in') return `${trimNum(v)} in`;
  // default display in feet, one decimal
  return `${(v / 12).toFixed(1)} ft`;
}
function trimNum(n) {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

// ---- activity log (admin usage metadata; never stores note text or photos) ----
async function logEvent(userId, action, detail) {
  try {
    await pool.query(`INSERT INTO events (user_id, action, detail) VALUES ($1, $2, $3)`,
      [userId, action, JSON.stringify(detail || {})]);
  } catch (e) { /* analytics is best-effort; never block the real request */ }
}

// Oriented photo dimensions (accounts for EXIF orientation) so we can classify
// landscape vs portrait the way the user actually sees the photo. Content is
// never read or stored, only width/height.
async function imageDims(localPath) {
  try {
    const m = await sharp(localPath).metadata();
    let w = m.width, h = m.height;
    if (m.orientation && m.orientation >= 5) { const t = w; w = h; h = t; }
    if (!w || !h) return null;
    return { w, h };
  } catch (e) { return null; }
}

app.post('/api/login', async (req, res) => {
  try {
    const b = req.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    const password = String(b.password || '');
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1 AND active = true`, [email]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'wrong email or password' });
    }
    await pool.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [user.id]);
    setSession(res, user);
    logEvent(user.id, 'login', {});
    res.json({ ok: true, name: user.name, role: user.role, plan: user.plan || 'free' });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

// Current plan straight from the DB, so an admin plan change takes effect on the
// user's next page load without needing them to sign out and back in.
async function currentPlan(userId) {
  try {
    const { rows } = await pool.query(`SELECT plan FROM users WHERE id = $1`, [userId]);
    return rows.length && rows[0].plan === 'pro' ? 'pro' : 'free';
  } catch { return 'free'; }
}

app.get('/api/me', requireAuth, async (req, res) => {
  const plan = await currentPlan(req.user.id);
  res.json({ authed: true, name: req.user.name, role: req.user.role, email: req.user.email, plan });
});

// ---- photo upload ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(36).slice(2, 8);
    const ext = (file.originalname.match(/\.[a-zA-Z0-9]+$/) || ['.jpg'])[0].toLowerCase();
    cb(null, `${stamp}_${rand}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

// ---- reverse geocode (best effort) ----
async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  const GOOGLE_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
  const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || '';
  try {
    if (GOOGLE_KEY) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}`;
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        if (d.status === 'OK' && d.results && d.results.length) return d.results[0].formatted_address;
      }
      return null;
    }
    if (MAPBOX_TOKEN) {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address&limit=1`;
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        if (d.features && d.features.length) return d.features[0].place_name;
      }
      return null;
    }
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'PhotoNotes/1.0 (turcotte@zukor.com)' } });
    if (!r.ok) return null;
    const data = await r.json();
    const a = data.address || {};
    const line1 = [a.house_number, a.road].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.hamlet || '';
    const parts = [line1, city, [a.state, a.postcode].filter(Boolean).join(' ')].filter(Boolean);
    return parts.length ? parts.join(', ') : data.display_name || null;
  } catch {
    return null;
  }
}

// ---- captures (all scoped to the logged-in user) ----
app.post('/api/captures', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const b = req.body || {};
    const lat = b.latitude ? parseFloat(b.latitude) : null;
    const lng = b.longitude ? parseFloat(b.longitude) : null;
    let address = b.address || null;
    if (!address && lat != null && lng != null) address = await reverseGeocode(lat, lng);

    let areas = [];
    if (b.area_tags) {
      try { areas = JSON.parse(b.area_tags); } catch { areas = String(b.area_tags).split(',').map(s => s.trim()).filter(Boolean); }
    }
    const kind = b.kind === 'task' ? 'task' : 'note';
    const photoPath = req.file ? `/uploads/${req.file.filename}` : null;

    let pw = null, ph = null;
    if (req.file) { const d = await imageDims(req.file.path); if (d) { pw = d.w; ph = d.h; } }

    // Pro-tier dimension fields. Only stored for Pro users; ignored otherwise.
    let dLenIn = null, dLenUnit = null, dWidIn = null, dWidUnit = null, dDepthIn = null, dShape = null, dArea = null;
    if (await currentPlan(req.user.id) === 'pro') {
      const lenUnit = b.dim_length_unit === 'in' ? 'in' : 'ft';
      const widUnit = b.dim_width_unit === 'in' ? 'in' : 'ft';
      const li = toInches(b.dim_length, lenUnit);
      const wi = toInches(b.dim_width, widUnit);
      const di = b.dim_depth != null && b.dim_depth !== '' ? Number(b.dim_depth) : null;
      const shape = ['rectangle', 'circle', 'irregular'].includes(b.dim_shape) ? b.dim_shape : (li || wi ? 'rectangle' : null);
      if (li != null) { dLenIn = li; dLenUnit = lenUnit; }
      if (wi != null) { dWidIn = wi; dWidUnit = widUnit; }
      if (di != null && Number.isFinite(di) && di > 0) dDepthIn = di;
      if (li != null || wi != null) dShape = shape;
      // Area: honor a user-supplied override, else compute from L x W x shape.
      const override = b.dim_area_sqft != null && b.dim_area_sqft !== '' ? Number(b.dim_area_sqft) : null;
      if (override != null && Number.isFinite(override) && override >= 0) dArea = override;
      else dArea = computeAreaSqft(dLenIn, dWidIn, dShape);
    }

    const q = `INSERT INTO captures (user_id, captured_by, photo_path, photo_width, photo_height, note, latitude, longitude, address, area_tags, kind, status,
                 dim_length_in, dim_length_unit, dim_width_in, dim_width_unit, dim_depth_in, dim_shape, dim_area_sqft)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`;
    const status = kind === 'task' ? 'open' : null;
    const vals = [req.user.id, req.user.name, photoPath, pw, ph, b.note || null, lat, lng, address, areas, kind, status,
      dLenIn, dLenUnit, dWidIn, dWidUnit, dDepthIn, dShape, dArea];
    const { rows } = await pool.query(q, vals);
    res.json(rows[0]);
  } catch (err) {
    console.error('[captures.create]', err);
    res.status(500).json({ error: 'failed to save capture' });
  }
});

app.get('/api/captures', requireAuth, async (req, res) => {
  try {
    const { area } = req.query;
    let rows;
    if (area) {
      ({ rows } = await pool.query(
        `SELECT * FROM captures WHERE user_id = $1 AND $2 = ANY(area_tags) ORDER BY created_at DESC`, [req.user.id, area]));
    } else {
      ({ rows } = await pool.query(`SELECT * FROM captures WHERE user_id = $1 ORDER BY created_at DESC`, [req.user.id]));
    }
    res.json(rows);
  } catch (err) {
    console.error('[captures.list]', err);
    res.status(500).json({ error: 'failed to list captures' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- live address preview ----
app.get('/api/geocode', requireAuth, async (req, res) => {
  try {
    const lat = req.query.lat != null ? parseFloat(req.query.lat) : NaN;
    const lng = req.query.lng != null ? parseFloat(req.query.lng) : NaN;
    if (Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: 'lat/lng required' });
    const address = await reverseGeocode(lat, lng);
    res.json({ address: address || null });
  } catch (err) { console.error('[geocode]', err); res.status(500).json({ error: 'geocode failed' }); }
});

// ---- areas (per-user) ----
app.get('/api/areas', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT name FROM user_areas WHERE user_id = $1 ORDER BY created_at ASC, name ASC', [req.user.id]);
    res.json(rows.map((r) => r.name));
  } catch (err) { console.error('[areas.list]', err); res.status(500).json({ error: 'failed to list areas' }); }
});
app.post('/api/areas', requireAuth, async (req, res) => {
  try {
    const name = req.body && req.body.name ? String(req.body.name).trim() : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    await pool.query('INSERT INTO user_areas (user_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, name]);
    const { rows } = await pool.query('SELECT name FROM user_areas WHERE user_id = $1 ORDER BY created_at ASC, name ASC', [req.user.id]);
    res.json(rows.map((r) => r.name));
  } catch (err) { console.error('[areas.add]', err); res.status(500).json({ error: 'failed to add area' }); }
});
app.post('/api/areas/delete', requireAuth, async (req, res) => {
  try {
    const name = req.body && req.body.name ? String(req.body.name) : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    await pool.query('DELETE FROM user_areas WHERE user_id = $1 AND name = $2', [req.user.id, name]);
    const { rows } = await pool.query('SELECT name FROM user_areas WHERE user_id = $1 ORDER BY created_at ASC, name ASC', [req.user.id]);
    res.json(rows.map((r) => r.name));
  } catch (err) { console.error('[areas.delete]', err); res.status(500).json({ error: 'failed to delete area' }); }
});

// ---- delete selected captures ----
app.post('/api/captures/delete', requireAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger)
      : [];
    if (!ids.length) return res.status(400).json({ error: 'no ids provided' });
    const { rows } = await pool.query(`SELECT photo_path FROM captures WHERE id = ANY($1) AND user_id = $2`, [ids, req.user.id]);
    await pool.query(`DELETE FROM captures WHERE id = ANY($1) AND user_id = $2`, [ids, req.user.id]);
    for (const r of rows) {
      const p = localPhoto(r.photo_path);
      if (p) { try { fs.unlinkSync(p); } catch (e) {} }
    }
    logEvent(req.user.id, 'delete', { count: rows.length });
    res.json({ ok: true, deleted: rows.length });
  } catch (err) {
    console.error('[captures.delete]', err);
    res.status(500).json({ error: 'delete failed' });
  }
});

// ---- re-run geocoding on the user's own captures ----
app.post('/api/regeocode', requireAuth, async (req, res) => {
  try {
    const onlyIds = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger)
      : null;
    let rows;
    if (onlyIds && onlyIds.length) {
      ({ rows } = await pool.query(
        `SELECT id, latitude, longitude FROM captures WHERE user_id = $1 AND id = ANY($2) AND latitude IS NOT NULL`, [req.user.id, onlyIds]));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, latitude, longitude FROM captures WHERE user_id = $1 AND latitude IS NOT NULL`, [req.user.id]));
    }
    let updated = 0;
    for (const c of rows) {
      const addr = await reverseGeocode(c.latitude, c.longitude);
      if (addr) { await pool.query(`UPDATE captures SET address = $1 WHERE id = $2 AND user_id = $3`, [addr, c.id, req.user.id]); updated++; }
    }
    logEvent(req.user.id, 'fix_addresses', { updated, total: rows.length });
    res.json({ ok: true, updated, total: rows.length });
  } catch (err) {
    console.error('[regeocode]', err);
    res.status(500).json({ error: 'regeocode failed' });
  }
});

// ---- edit a single capture (own only) ----
app.post('/api/captures/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (typeof b.note === 'string') { vals.push(b.note); sets.push(`note = $${vals.length}`); }
    if (Array.isArray(b.area_tags)) { vals.push(b.area_tags); sets.push(`area_tags = $${vals.length}`); }
    if (b.kind === 'note' || b.kind === 'task') { vals.push(b.kind); sets.push(`kind = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(id);
    vals.push(req.user.id);
    const { rows } = await pool.query(
      `UPDATE captures SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND user_id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    if (typeof b.note === 'string') logEvent(req.user.id, 'note_edit', { chars: b.note.length });
    res.json(rows[0]);
  } catch (err) {
    console.error('[captures.update]', err);
    res.status(500).json({ error: 'update failed' });
  }
});

// ---- rotate a capture's photo (own only) ----
app.post('/api/captures/:id/rotate', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const dir = (req.body && req.body.dir) === 'ccw' ? 'ccw' : 'cw';
    const row = (await pool.query(`SELECT photo_path FROM captures WHERE id = $1 AND user_id = $2`, [id, req.user.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    const p = localPhoto(row.photo_path);
    if (!p) return res.status(400).json({ error: 'no photo file to rotate' });
    const ext = path.extname(p).toLowerCase();
    const angle = dir === 'ccw' ? 270 : 90;
    const buf = fs.readFileSync(p);
    const oriented = await sharp(buf).rotate().toBuffer();
    const s = sharp(oriented).rotate(angle);
    let out;
    if (ext === '.png') out = await s.png().toBuffer();
    else if (ext === '.webp') out = await s.webp().toBuffer();
    else out = await s.jpeg({ quality: 92 }).toBuffer();
    fs.writeFileSync(p, out);
    const d = await imageDims(p);
    if (d) await pool.query(`UPDATE captures SET photo_width = $1, photo_height = $2 WHERE id = $3 AND user_id = $4`, [d.w, d.h, id, req.user.id]);
    logEvent(req.user.id, 'rotate', { dir });
    res.json({ ok: true });
  } catch (err) {
    console.error('[captures.rotate]', err);
    res.status(500).json({ error: 'rotate failed' });
  }
});

// ---- groups (per-user) ----
async function ownsGroup(groupId, userId) {
  const g = (await pool.query(`SELECT id FROM groups WHERE id = $1 AND user_id = $2`, [groupId, userId])).rows[0];
  return !!g;
}
async function addToGroup(groupId, userId, captureIds) {
  // only add captures the user actually owns
  const owned = (await pool.query(`SELECT id FROM captures WHERE id = ANY($1) AND user_id = $2`, [captureIds, userId])).rows.map((r) => r.id);
  if (!owned.length) return 0;
  const maxRow = await pool.query(`SELECT COALESCE(MAX(position), -1) AS m FROM group_items WHERE group_id = $1`, [groupId]);
  let pos = Number(maxRow.rows[0].m) + 1;
  for (const cid of owned) {
    await pool.query(
      `INSERT INTO group_items (group_id, capture_id, position) VALUES ($1,$2,$3)
       ON CONFLICT (group_id, capture_id) DO NOTHING`, [groupId, cid, pos]);
    pos++;
  }
  return owned.length;
}

app.get('/api/groups', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.*, COALESCE(cnt.n, 0)::int AS item_count
      FROM groups g
      LEFT JOIN (SELECT group_id, COUNT(*) n FROM group_items GROUP BY group_id) cnt ON cnt.group_id = g.id
      WHERE g.user_id = $1
      ORDER BY g.created_at DESC`, [req.user.id]);
    res.json(rows);
  } catch (err) { console.error('[groups.list]', err); res.status(500).json({ error: 'failed to list groups' }); }
});

app.post('/api/groups', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const title = (b.title != null && String(b.title).trim()) ? String(b.title).trim() : 'Untitled group';
    const description = b.description ? String(b.description) : null;
    const ids = Array.isArray(b.ids) ? b.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
    const { rows } = await pool.query(`INSERT INTO groups (user_id, title, description) VALUES ($1,$2,$3) RETURNING *`, [req.user.id, title, description]);
    const group = rows[0];
    let added = 0;
    if (ids.length) added = await addToGroup(group.id, req.user.id, ids);
    logEvent(req.user.id, 'group_create', { with_photos: added });
    res.json(group);
  } catch (err) { console.error('[groups.create]', err); res.status(500).json({ error: 'failed to create group' }); }
});

app.get('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const g = (await pool.query(`SELECT * FROM groups WHERE id = $1 AND user_id = $2`, [id, req.user.id])).rows[0];
    if (!g) return res.status(404).json({ error: 'not found' });
    const items = (await pool.query(`
      SELECT c.*, gi.position FROM group_items gi JOIN captures c ON c.id = gi.capture_id
      WHERE gi.group_id = $1 AND c.user_id = $2 ORDER BY gi.position ASC, c.created_at ASC`, [id, req.user.id])).rows;
    res.json({ group: g, items });
  } catch (err) { console.error('[groups.get]', err); res.status(500).json({ error: 'failed' }); }
});

app.post('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (typeof b.title === 'string') { vals.push(b.title); sets.push(`title = $${vals.length}`); }
    if (typeof b.description === 'string') { vals.push(b.description); sets.push(`description = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(id);
    vals.push(req.user.id);
    const { rows } = await pool.query(`UPDATE groups SET ${sets.join(', ')} WHERE id = $${vals.length - 1} AND user_id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) { console.error('[groups.update]', err); res.status(500).json({ error: 'update failed' }); }
});

app.post('/api/groups/:id/delete', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM groups WHERE id = $1 AND user_id = $2`, [id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { console.error('[groups.delete]', err); res.status(500).json({ error: 'delete failed' }); }
});

app.post('/api/groups/:id/add', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await ownsGroup(id, req.user.id))) return res.status(404).json({ error: 'not found' });
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: 'no ids' });
    const added = await addToGroup(id, req.user.id, ids);
    logEvent(req.user.id, 'group_add', { count: added });
    res.json({ ok: true, added });
  } catch (err) { console.error('[groups.add]', err); res.status(500).json({ error: 'add failed' }); }
});

app.post('/api/groups/:id/remove', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await ownsGroup(id, req.user.id))) return res.status(404).json({ error: 'not found' });
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: 'no ids' });
    await pool.query(`DELETE FROM group_items WHERE group_id = $1 AND capture_id = ANY($2)`, [id, ids]);
    res.json({ ok: true });
  } catch (err) { console.error('[groups.remove]', err); res.status(500).json({ error: 'remove failed' }); }
});

app.post('/api/groups/:id/reorder', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await ownsGroup(id, req.user.id))) return res.status(404).json({ error: 'not found' });
    const order = Array.isArray(req.body && req.body.order) ? req.body.order.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
    if (!order.length) return res.status(400).json({ error: 'no order' });
    for (let i = 0; i < order.length; i++) {
      await pool.query(`UPDATE group_items SET position = $1 WHERE group_id = $2 AND capture_id = $3`, [i, id, order[i]]);
    }
    logEvent(req.user.id, 'group_reorder', {});
    res.json({ ok: true });
  } catch (err) { console.error('[groups.reorder]', err); res.status(500).json({ error: 'reorder failed' }); }
});

// ---- admin: manage logins + usage metadata (no photos/notes exposed) ----
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.industry, u.role, u.plan, u.active, u.created_at, u.last_login_at,
        COALESCE(c.cnt, 0)::int      AS capture_count,
        c.first_capture, c.last_capture,
        COALESCE(c.d7, 0)::int       AS last_7d,
        COALESCE(c.d30, 0)::int      AS last_30d,
        COALESCE(c.with_photo, 0)::int    AS with_photo,
        COALESCE(c.with_loc, 0)::int      AS with_location,
        COALESCE(c.with_note, 0)::int     AS with_note,
        COALESCE(c.note_chars_total, 0)::int AS note_chars_total,
        COALESCE(c.note_chars_avg, 0)::int   AS note_chars_avg,
        COALESCE(c.note_chars_max, 0)::int   AS note_chars_max,
        COALESCE(c.landscape, 0)::int     AS landscape,
        COALESCE(c.portrait, 0)::int      AS portrait,
        COALESCE(c.square, 0)::int        AS square,
        COALESCE(c.dims_known, 0)::int    AS dims_known,
        COALESCE(c.tasks, 0)::int         AS tasks,
        COALESCE(g.gcnt, 0)::int     AS group_count,
        COALESCE(gp.grouped_photos, 0)::int AS grouped_photos,
        COALESCE(e.exports, 0)::int       AS exports,
        COALESCE(e.export_pdf, 0)::int    AS export_pdf,
        COALESCE(e.export_docx, 0)::int   AS export_docx,
        COALESCE(e.export_bundle, 0)::int AS export_bundle,
        COALESCE(e.rotates, 0)::int       AS rotates,
        COALESCE(e.note_edits, 0)::int    AS note_edits,
        COALESCE(e.deletes, 0)::int       AS deletes,
        COALESCE(e.reorders, 0)::int      AS reorders,
        COALESCE(e.group_adds, 0)::int    AS group_adds,
        COALESCE(e.fixes, 0)::int         AS fixes,
        COALESCE(e.logins, 0)::int        AS logins,
        e.last_activity
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) cnt, MIN(created_at) first_capture, MAX(created_at) last_capture,
          COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')  d7,
          COUNT(*) FILTER (WHERE created_at > now() - interval '30 days') d30,
          COUNT(*) FILTER (WHERE photo_path IS NOT NULL) with_photo,
          COUNT(*) FILTER (WHERE latitude IS NOT NULL)   with_loc,
          COUNT(*) FILTER (WHERE note IS NOT NULL AND btrim(note) <> '') with_note,
          COALESCE(SUM(char_length(COALESCE(note, ''))), 0) note_chars_total,
          COALESCE(ROUND(AVG(char_length(note)) FILTER (WHERE note IS NOT NULL AND btrim(note) <> '')), 0) note_chars_avg,
          COALESCE(MAX(char_length(note)), 0) note_chars_max,
          COUNT(*) FILTER (WHERE photo_width IS NOT NULL AND photo_height IS NOT NULL AND photo_width > photo_height)  landscape,
          COUNT(*) FILTER (WHERE photo_width IS NOT NULL AND photo_height IS NOT NULL AND photo_height > photo_width)  portrait,
          COUNT(*) FILTER (WHERE photo_width IS NOT NULL AND photo_height IS NOT NULL AND photo_width = photo_height)  square,
          COUNT(*) FILTER (WHERE photo_width IS NOT NULL) dims_known,
          COUNT(*) FILTER (WHERE kind = 'task') tasks
        FROM captures GROUP BY user_id
      ) c ON c.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) gcnt FROM groups GROUP BY user_id) g ON g.user_id = u.id
      LEFT JOIN (
        SELECT g.user_id, COUNT(gi.*) grouped_photos
        FROM groups g JOIN group_items gi ON gi.group_id = g.id
        GROUP BY g.user_id
      ) gp ON gp.user_id = u.id
      LEFT JOIN (
        SELECT user_id,
          COUNT(*) FILTER (WHERE action = 'export') exports,
          COUNT(*) FILTER (WHERE action = 'export' AND detail->>'format' = 'pdf') export_pdf,
          COUNT(*) FILTER (WHERE action = 'export' AND detail->>'format' = 'docx') export_docx,
          COUNT(*) FILTER (WHERE action = 'export' AND detail->>'format' = 'bundle') export_bundle,
          COUNT(*) FILTER (WHERE action = 'rotate') rotates,
          COUNT(*) FILTER (WHERE action = 'note_edit') note_edits,
          COUNT(*) FILTER (WHERE action = 'delete') deletes,
          COUNT(*) FILTER (WHERE action = 'group_reorder') reorders,
          COUNT(*) FILTER (WHERE action = 'group_add') group_adds,
          COUNT(*) FILTER (WHERE action = 'fix_addresses') fixes,
          COUNT(*) FILTER (WHERE action = 'login') logins,
          MAX(created_at) last_activity
        FROM events GROUP BY user_id
      ) e ON e.user_id = u.id
      ORDER BY u.created_at ASC`);
    res.json(rows);
  } catch (err) { console.error('[admin.users]', err); res.status(500).json({ error: 'failed to list users' }); }
});

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const email = String(b.email || '').toLowerCase().trim();
    const name = b.name ? String(b.name).trim() : '';
    const industry = b.industry ? String(b.industry).trim() : null;
    const password = String(b.password || '');
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, password_hash, role, industry, active)
       VALUES ($1,$2,$3,'user',$4,true)
       RETURNING id, email, name, industry, role, plan, active, created_at`,
      [email, name, hash, industry]);
    await seedUserAreas(rows[0].id);
    res.json(rows[0]);
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'that email already has a login' });
    console.error('[admin.create]', err);
    res.status(500).json({ error: 'failed to create login' });
  }
});

app.post('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (typeof b.name === 'string') { vals.push(b.name.trim()); sets.push(`name = $${vals.length}`); }
    if (typeof b.industry === 'string') { vals.push(b.industry.trim()); sets.push(`industry = $${vals.length}`); }
    if (typeof b.active === 'boolean') { vals.push(b.active); sets.push(`active = $${vals.length}`); }
    if (b.role === 'admin' || b.role === 'user') { vals.push(b.role); sets.push(`role = $${vals.length}`); }
    if (b.plan === 'pro' || b.plan === 'free') { vals.push(b.plan); sets.push(`plan = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, email, name, industry, role, plan, active, created_at, last_login_at`, vals);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) { console.error('[admin.update]', err); res.status(500).json({ error: 'update failed' }); }
});

app.post('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const password = String((req.body && req.body.password) || '');
    if (password.length < 4) return res.status(400).json({ error: 'password too short' });
    const hash = bcrypt.hashSync(password, 10);
    const { rowCount } = await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, id]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) { console.error('[admin.password]', err); res.status(500).json({ error: 'reset failed' }); }
});

// ---- exports (scoped to the logged-in user) ----
async function getCaptures({ userId, area, ids, group }) {
  if (group) {
    return (await pool.query(`
      SELECT c.* FROM group_items gi JOIN captures c ON c.id = gi.capture_id
      WHERE gi.group_id = $1 AND c.user_id = $2 ORDER BY gi.position ASC, c.created_at ASC`, [group, userId])).rows;
  }
  if (ids && ids.length) {
    return (await pool.query(`SELECT * FROM captures WHERE id = ANY($1) AND user_id = $2 ORDER BY created_at ASC`, [ids, userId])).rows;
  }
  if (area) {
    return (await pool.query(`SELECT * FROM captures WHERE $1 = ANY(area_tags) AND user_id = $2 ORDER BY created_at ASC`, [area, userId])).rows;
  }
  return (await pool.query(`SELECT * FROM captures WHERE user_id = $1 ORDER BY created_at ASC`, [userId])).rows;
}
function parseIds(q) {
  if (!q) return null;
  const arr = String(q).split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n));
  return arr.length ? arr : null;
}
function localPhoto(photoPath) {
  if (!photoPath) return null;
  const fname = photoPath.replace(/^\/uploads\//, '');
  const p = path.join(UPLOAD_DIR, fname);
  return fs.existsSync(p) ? p : null;
}
function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function suffix(area) { return area ? '-' + slug(area) : ''; }
function fmtWhen(d) { try { return new Date(d).toLocaleString(); } catch { return ''; } }

async function resolveExport(req) {
  const userId = req.user.id;
  const area = req.query.area || '';
  const ids = parseIds(req.query.ids);
  let groupId = req.query.group ? parseInt(req.query.group, 10) : null;
  const imgRes = req.query.res || 'standard';
  const imgFmt = req.query.fmt || 'jpeg';
  let heading = 'Photo Notes' + (area ? ' - ' + area : '');
  let desc = '';
  let fnameBase = 'photonotes' + suffix(area);
  if (groupId) {
    const g = (await pool.query(`SELECT * FROM groups WHERE id = $1 AND user_id = $2`, [groupId, userId])).rows[0];
    if (g) {
      heading = g.title || 'Photo Notes';
      desc = g.description || '';
      fnameBase = 'photonotes-' + (slug(g.title) || 'group');
    } else {
      groupId = null; // not the user's group -> export nothing
    }
  }
  const rows = await getCaptures({ userId, area, ids, group: groupId });
  const scope = groupId ? 'group' : (ids ? 'selection' : (area ? 'area' : 'all'));
  return { imgRes, imgFmt, heading, desc, fnameBase, rows, scope };
}

const RES_PRESETS = {
  full:     { maxEdge: null, quality: 95 },
  print:    { maxEdge: 3000, quality: 92 },
  standard: { maxEdge: 2048, quality: 85 },
  web:      { maxEdge: 1400, quality: 80 },
};
function resSpec(r) { return RES_PRESETS[r] || RES_PRESETS.standard; }

async function renderImage(localPath, imgRes, imgFmt) {
  if (!localPath) return null;
  if (imgFmt === 'original') {
    const ext = (path.extname(localPath) || '.jpg').toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { buffer: fs.readFileSync(localPath), ext, mime };
  }
  const { maxEdge, quality } = resSpec(imgRes);
  let img = sharp(localPath).rotate();
  if (maxEdge) img = img.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  if (imgFmt === 'png') return { buffer: await img.png({ compressionLevel: 9 }).toBuffer(), ext: '.png', mime: 'image/png' };
  if (imgFmt === 'webp') return { buffer: await img.webp({ quality }).toBuffer(), ext: '.webp', mime: 'image/webp' };
  return { buffer: await img.jpeg({ quality }).toBuffer(), ext: '.jpg', mime: 'image/jpeg' };
}

async function renderForEmbed(localPath, imgRes, imgFmt) {
  if (!localPath) return null;
  let f = imgFmt;
  if (f === 'webp') f = 'jpeg';
  if (f === 'original') {
    const ext = (path.extname(localPath) || '.jpg').toLowerCase();
    f = ext === '.png' ? 'png' : 'jpeg';
  }
  try { return await renderImage(localPath, imgRes, f); } catch (e) { return null; }
}

app.get('/api/export/pdf', requireAuth, async (req, res) => {
  try {
    const { imgRes, imgFmt, heading, desc, fnameBase, rows, scope } = await resolveExport(req);
    const pro = await currentPlan(req.user.id) === 'pro';
    logEvent(req.user.id, 'export', { format: 'pdf', scope, count: rows.length, res: imgRes, fmt: imgFmt });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fnameBase}.pdf"`);
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    doc.pipe(res);
    doc.fontSize(20).fillColor('#000').text(heading, { align: 'center' });
    if (desc) { doc.moveDown(0.3); doc.fontSize(12).fillColor('#000').text(desc, { align: 'center' }); }
    doc.moveDown(1);
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      if (i > 0) doc.addPage();
      const img = localPhoto(c.photo_path);
      if (img) {
        const r = await renderForEmbed(img, imgRes, imgFmt);
        if (r) { try { doc.image(r.buffer, { fit: [480, 340], align: 'center' }); doc.moveDown(0.6); } catch (e) {} }
      }
      doc.fontSize(13).fillColor('#000').text((c.address || 'No location') + (c.kind === 'task' ? '   [TASK]' : ''));
      if (c.area_tags && c.area_tags.length) doc.fontSize(10).fillColor('#000').text('Area: ' + c.area_tags.join(', '));
      if (pro) { const dm = fmtDims(c); if (dm) doc.fontSize(10).fillColor('#000').text('Dimensions: ' + dm); }
      doc.fontSize(9).fillColor('#000').text(fmtWhen(c.created_at));
      doc.moveDown(0.4);
      doc.fontSize(12).fillColor('#000').text(c.note || '(no note)');
    }
    if (!rows.length) doc.fontSize(12).fillColor('#000').text('No captures yet.');
    doc.end();
  } catch (err) { console.error('[export.pdf]', err); if (!res.headersSent) res.status(500).json({ error: 'pdf export failed' }); }
});

app.get('/api/export/docx', requireAuth, async (req, res) => {
  try {
    const { imgRes, imgFmt, heading, desc, fnameBase, rows, scope } = await resolveExport(req);
    const pro = await currentPlan(req.user.id) === 'pro';
    logEvent(req.user.id, 'export', { format: 'docx', scope, count: rows.length, res: imgRes, fmt: imgFmt });
    const children = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: heading, bold: true, color: '000000', font: 'Arial' })] })];
    if (desc) children.push(new Paragraph({ children: [new TextRun({ text: desc, color: '000000', font: 'Arial' })] }));
    for (const c of rows) {
      const img = localPhoto(c.photo_path);
      if (img) {
        const r = await renderForEmbed(img, imgRes, imgFmt);
        if (r) { try { children.push(new Paragraph({ children: [new ImageRun({ type: r.ext === '.png' ? 'png' : 'jpg', data: r.buffer, transformation: { width: 420, height: 315 } })] })); } catch (e) {} }
      }
      children.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: (c.address || 'No location') + (c.kind === 'task' ? '   [TASK]' : ''), bold: true, color: '000000', font: 'Arial' })] }));
      if (c.area_tags && c.area_tags.length) children.push(new Paragraph({ children: [new TextRun({ text: 'Area: ' + c.area_tags.join(', '), color: '000000', font: 'Arial' })] }));
      if (pro) { const dm = fmtDims(c); if (dm) children.push(new Paragraph({ children: [new TextRun({ text: 'Dimensions: ' + dm, color: '000000', font: 'Arial' })] })); }
      children.push(new Paragraph({ children: [new TextRun({ text: c.note || '(no note)', color: '000000', font: 'Arial' })] }));
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    }
    if (!rows.length) children.push(new Paragraph({ children: [new TextRun({ text: 'No captures yet.', color: '000000', font: 'Arial' })] }));
    const doc = new Document({ sections: [{ children }] });
    const buf = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fnameBase}.docx"`);
    res.send(buf);
  } catch (err) { console.error('[export.docx]', err); if (!res.headersSent) res.status(500).json({ error: 'docx export failed' }); }
});

app.get('/api/export/bundle', requireAuth, async (req, res) => {
  try {
    const { imgRes, imgFmt, heading, desc, fnameBase, rows, scope } = await resolveExport(req);
    const pro = await currentPlan(req.user.id) === 'pro';
    logEvent(req.user.id, 'export', { format: 'bundle', scope, count: rows.length, res: imgRes, fmt: imgFmt });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fnameBase}-bundle.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (e) => { console.error('[export.bundle]', e); try { res.status(500).end(); } catch {} });
    archive.pipe(res);
    let md = `# ${heading}\n\n`;
    if (desc) md += `${desc}\n\n`;
    md += `Source captures for reports. Each item has its photo, address, area, and note.\n\n`;
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      const n = String(i + 1).padStart(2, '0');
      const img = localPhoto(c.photo_path);
      let imgRef = '';
      if (img) {
        const r = await renderImage(img, imgRes, imgFmt);
        if (r) {
          const base = path.basename(img).replace(/\.[a-zA-Z0-9]+$/, '');
          const name = `photos/${n}_${base}${r.ext}`;
          archive.append(r.buffer, { name });
          imgRef = name;
        }
      }
      md += `## ${i + 1}. ${c.address || 'No location'}${c.kind === 'task' ? ' [TASK]' : ''}\n`;
      if (c.area_tags && c.area_tags.length) md += `Area: ${c.area_tags.join(', ')}  \n`;
      if (pro) { const dm = fmtDims(c); if (dm) md += `Dimensions: ${dm}  \n`; }
      md += `Captured: ${fmtWhen(c.created_at)}\n\n`;
      if (imgRef) md += `![photo](${imgRef})\n\n`;
      md += `${c.note || '(no note)'}\n\n`;
    }
    archive.append(md, { name: 'photonotes.md' });
    archive.finalize();
  } catch (err) { console.error('[export.bundle]', err); if (!res.headersSent) res.status(500).json({ error: 'bundle export failed' }); }
});

// ---- admin page (served only as a page; the data behind it is admin-guarded) ----
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// One-time fill of photo width/height for photos captured before dimensions were
// tracked, so orientation stats cover existing photos too. Best-effort per file.
async function backfillPhotoDims() {
  try {
    const { rows } = await pool.query(`SELECT id, photo_path FROM captures WHERE photo_path IS NOT NULL AND photo_width IS NULL`);
    let done = 0;
    for (const r of rows) {
      const p = localPhoto(r.photo_path);
      if (!p) continue;
      const d = await imageDims(p);
      if (d) { await pool.query(`UPDATE captures SET photo_width = $1, photo_height = $2 WHERE id = $3`, [d.w, d.h, r.id]); done++; }
    }
    if (done) console.log(`[efc] backfilled photo dimensions for ${done} capture(s)`);
  } catch (e) { console.error('[backfill dims]', e); }
}

init()
  .then(() => {
    app.listen(PORT, () => console.log(`[efc] listening on ${PORT}`));
    backfillPhotoDims();
  })
  .catch((err) => {
    console.error('[efc] failed to init db', err);
    app.listen(PORT, () => console.log(`[efc] listening on ${PORT} (db init failed)`));
  });
