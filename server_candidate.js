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
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, SESSION_SECRET, { expiresIn: '30d' });
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
    res.json({ ok: true, name: user.name, role: user.role });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ error: 'login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ authed: true, name: req.user.name, role: req.user.role, email: req.user.email });
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

    const q = `INSERT INTO captures (user_id, captured_by, photo_path, note, latitude, longitude, address, area_tags, kind, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`;
    const status = kind === 'task' ? 'open' : null;
    const vals = [req.user.id, req.user.name, photoPath, b.note || null, lat, lng, address, areas, kind, status];
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
    if (ids.length) await addToGroup(group.id, req.user.id, ids);
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
    res.json({ ok: true });
  } catch (err) { console.error('[groups.reorder]', err); res.status(500).json({ error: 'reorder failed' }); }
});

// ---- admin: manage logins + usage metadata (no photos/notes exposed) ----
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.email, u.name, u.industry, u.role, u.active, u.created_at, u.last_login_at,
        COALESCE(c.cnt, 0)::int      AS capture_count,
        c.first_capture, c.last_capture,
        COALESCE(c.d7, 0)::int       AS last_7d,
        COALESCE(c.d30, 0)::int      AS last_30d,
        COALESCE(c.with_photo, 0)::int    AS with_photo,
        COALESCE(c.with_loc, 0)::int      AS with_location,
        COALESCE(g.gcnt, 0)::int     AS group_count
      FROM users u
      LEFT JOIN (
        SELECT user_id, COUNT(*) cnt, MIN(created_at) first_capture, MAX(created_at) last_capture,
          COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')  d7,
          COUNT(*) FILTER (WHERE created_at > now() - interval '30 days') d30,
          COUNT(*) FILTER (WHERE photo_path IS NOT NULL) with_photo,
          COUNT(*) FILTER (WHERE latitude IS NOT NULL)   with_loc
        FROM captures GROUP BY user_id
      ) c ON c.user_id = u.id
      LEFT JOIN (SELECT user_id, COUNT(*) gcnt FROM groups GROUP BY user_id) g ON g.user_id = u.id
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
       RETURNING id, email, name, industry, role, active, created_at`,
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
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, email, name, industry, role, active, created_at, last_login_at`, vals);
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
  return { imgRes, imgFmt, heading, desc, fnameBase, rows };
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
    const { imgRes, imgFmt, heading, desc, fnameBase, rows } = await resolveExport(req);
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
    const { imgRes, imgFmt, heading, desc, fnameBase, rows } = await resolveExport(req);
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
    const { imgRes, imgFmt, heading, desc, fnameBase, rows } = await resolveExport(req);
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

init()
  .then(() => app.listen(PORT, () => console.log(`[efc] listening on ${PORT}`)))
  .catch((err) => {
    console.error('[efc] failed to init db', err);
    app.listen(PORT, () => console.log(`[efc] listening on ${PORT} (db init failed)`));
  });
