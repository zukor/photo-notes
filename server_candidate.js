const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const sharp = require('sharp');
const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } = require('docx');
const { pool, init } = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-secret-change-me';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
const ADMIN_NAME = process.env.ADMIN_NAME || 'Sam';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---- static frontend + uploaded photos ----
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---- auth ----
function setSession(res) {
  const token = jwt.sign({ role: 'admin', name: ADMIN_NAME }, SESSION_SECRET, { expiresIn: '30d' });
  res.cookie('efc_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.efc_token;
  if (!token) return res.status(401).json({ error: 'not authenticated' });
  try {
    req.user = jwt.verify(token, SESSION_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'session expired' });
  }
}

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'ADMIN_PASSWORD not set on server' });
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'wrong password' });
  }
  setSession(res);
  res.json({ ok: true, name: ADMIN_NAME });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('efc_token');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ authed: true, name: req.user.name });
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
    // Best accuracy: Google
    if (GOOGLE_KEY) {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_KEY}`;
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        if (d.status === 'OK' && d.results && d.results.length) return d.results[0].formatted_address;
      }
      return null;
    }
    // Good: Mapbox
    if (MAPBOX_TOKEN) {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address&limit=1`;
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        if (d.features && d.features.length) return d.features[0].place_name;
      }
      return null;
    }
    // Fallback: free OpenStreetMap (low accuracy)
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

// ---- captures ----
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

    const q = `INSERT INTO captures (captured_by, photo_path, note, latitude, longitude, address, area_tags, kind, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`;
    const status = kind === 'task' ? 'open' : null;
    const vals = [req.user.name, photoPath, b.note || null, lat, lng, address, areas, kind, status];
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
        `SELECT * FROM captures WHERE $1 = ANY(area_tags) ORDER BY created_at DESC`, [area]));
    } else {
      ({ rows } = await pool.query(`SELECT * FROM captures ORDER BY created_at DESC`));
    }
    res.json(rows);
  } catch (err) {
    console.error('[captures.list]', err);
    res.status(500).json({ error: 'failed to list captures' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

// ---- live address preview for a lat/lng (used right after a photo is taken) ----
app.get('/api/geocode', requireAuth, async (req, res) => {
  try {
    const lat = req.query.lat != null ? parseFloat(req.query.lat) : NaN;
    const lng = req.query.lng != null ? parseFloat(req.query.lng) : NaN;
    if (Number.isNaN(lat) || Number.isNaN(lng)) return res.status(400).json({ error: 'lat/lng required' });
    const address = await reverseGeocode(lat, lng);
    res.json({ address: address || null });
  } catch (err) { console.error('[geocode]', err); res.status(500).json({ error: 'geocode failed' }); }
});

// ---- areas (editable list of area tags) ----
app.get('/api/areas', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT name FROM areas ORDER BY created_at ASC, name ASC');
    res.json(rows.map((r) => r.name));
  } catch (err) { console.error('[areas.list]', err); res.status(500).json({ error: 'failed to list areas' }); }
});
app.post('/api/areas', requireAuth, async (req, res) => {
  try {
    const name = req.body && req.body.name ? String(req.body.name).trim() : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    await pool.query('INSERT INTO areas (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    const { rows } = await pool.query('SELECT name FROM areas ORDER BY created_at ASC, name ASC');
    res.json(rows.map((r) => r.name));
  } catch (err) { console.error('[areas.add]', err); res.status(500).json({ error: 'failed to add area' }); }
});
app.post('/api/areas/delete', requireAuth, async (req, res) => {
  try {
    const name = req.body && req.body.name ? String(req.body.name) : '';
    if (!name) return res.status(400).json({ error: 'name required' });
    await pool.query('DELETE FROM areas WHERE name = $1', [name]);
    const { rows } = await pool.query('SELECT name FROM areas ORDER BY created_at ASC, name ASC');
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
    const { rows } = await pool.query(`SELECT photo_path FROM captures WHERE id = ANY($1)`, [ids]);
    await pool.query(`DELETE FROM captures WHERE id = ANY($1)`, [ids]);
    for (const r of rows) {
      const p = localPhoto(r.photo_path);
      if (p) { try { fs.unlinkSync(p); } catch (e) {} }
    }
    res.json({ ok: true, deleted: ids.length });
  } catch (err) {
    console.error('[captures.delete]', err);
    res.status(500).json({ error: 'delete failed' });
  }
});

// ---- re-run geocoding on existing captures (uses whatever provider is configured) ----
app.post('/api/regeocode', requireAuth, async (req, res) => {
  try {
    const onlyIds = Array.isArray(req.body && req.body.ids)
      ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger)
      : null;
    let rows;
    if (onlyIds && onlyIds.length) {
      ({ rows } = await pool.query(
        `SELECT id, latitude, longitude FROM captures WHERE id = ANY($1) AND latitude IS NOT NULL`, [onlyIds]));
    } else {
      ({ rows } = await pool.query(
        `SELECT id, latitude, longitude FROM captures WHERE latitude IS NOT NULL`));
    }
    let updated = 0;
    for (const c of rows) {
      const addr = await reverseGeocode(c.latitude, c.longitude);
      if (addr) { await pool.query(`UPDATE captures SET address = $1 WHERE id = $2`, [addr, c.id]); updated++; }
    }
    res.json({ ok: true, updated, total: rows.length });
  } catch (err) {
    console.error('[regeocode]', err);
    res.status(500).json({ error: 'regeocode failed' });
  }
});

// ---- edit a single capture (note, and optionally area/kind) ----
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
    const { rows } = await pool.query(
      `UPDATE captures SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[captures.update]', err);
    res.status(500).json({ error: 'update failed' });
  }
});

// ---- rotate a capture's photo 90 degrees (cw or ccw), rewriting the stored file ----
app.post('/api/captures/:id/rotate', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const dir = (req.body && req.body.dir) === 'ccw' ? 'ccw' : 'cw';
    const row = (await pool.query(`SELECT photo_path FROM captures WHERE id = $1`, [id])).rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    const p = localPhoto(row.photo_path);
    if (!p) return res.status(400).json({ error: 'no photo file to rotate' });
    const ext = path.extname(p).toLowerCase();
    const angle = dir === 'ccw' ? 270 : 90;
    const buf = fs.readFileSync(p);
    const oriented = await sharp(buf).rotate().toBuffer(); // bake in any EXIF orientation first
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

// ---- groups ----
async function addToGroup(groupId, captureIds) {
  const maxRow = await pool.query(`SELECT COALESCE(MAX(position), -1) AS m FROM group_items WHERE group_id = $1`, [groupId]);
  let pos = Number(maxRow.rows[0].m) + 1;
  for (const cid of captureIds) {
    await pool.query(
      `INSERT INTO group_items (group_id, capture_id, position) VALUES ($1,$2,$3)
       ON CONFLICT (group_id, capture_id) DO NOTHING`, [groupId, cid, pos]);
    pos++;
  }
}

app.get('/api/groups', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.*, COALESCE(cnt.n, 0)::int AS item_count
      FROM groups g
      LEFT JOIN (SELECT group_id, COUNT(*) n FROM group_items GROUP BY group_id) cnt ON cnt.group_id = g.id
      ORDER BY g.created_at DESC`);
    res.json(rows);
  } catch (err) { console.error('[groups.list]', err); res.status(500).json({ error: 'failed to list groups' }); }
});

app.post('/api/groups', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const title = (b.title != null && String(b.title).trim()) ? String(b.title).trim() : 'Untitled group';
    const description = b.description ? String(b.description) : null;
    const ids = Array.isArray(b.ids) ? b.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
    const { rows } = await pool.query(`INSERT INTO groups (title, description) VALUES ($1,$2) RETURNING *`, [title, description]);
    const group = rows[0];
    if (ids.length) await addToGroup(group.id, ids);
    res.json(group);
  } catch (err) { console.error('[groups.create]', err); res.status(500).json({ error: 'failed to create group' }); }
});

app.get('/api/groups/:id', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const g = (await pool.query(`SELECT * FROM groups WHERE id = $1`, [id])).rows[0];
    if (!g) return res.status(404).json({ error: 'not found' });
    const items = (await pool.query(`
      SELECT c.*, gi.position FROM group_items gi JOIN captures c ON c.id = gi.capture_id
      WHERE gi.group_id = $1 ORDER BY gi.position ASC, c.created_at ASC`, [id])).rows;
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
    const { rows } = await pool.query(`UPDATE groups SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) { console.error('[groups.update]', err); res.status(500).json({ error: 'update failed' }); }
});

app.post('/api/groups/:id/delete', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM groups WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) { console.error('[groups.delete]', err); res.status(500).json({ error: 'delete failed' }); }
});

app.post('/api/groups/:id/add', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: 'no ids' });
    await addToGroup(id, ids);
    res.json({ ok: true, added: ids.length });
  } catch (err) { console.error('[groups.add]', err); res.status(500).json({ error: 'add failed' }); }
});

app.post('/api/groups/:id/remove', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: 'no ids' });
    await pool.query(`DELETE FROM group_items WHERE group_id = $1 AND capture_id = ANY($2)`, [id, ids]);
    res.json({ ok: true });
  } catch (err) { console.error('[groups.remove]', err); res.status(500).json({ error: 'remove failed' }); }
});

app.post('/api/groups/:id/reorder', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const order = Array.isArray(req.body && req.body.order) ? req.body.order.map((n) => parseInt(n, 10)).filter(Number.isInteger) : [];
    if (!order.length) return res.status(400).json({ error: 'no order' });
    for (let i = 0; i < order.length; i++) {
      await pool.query(`UPDATE group_items SET position = $1 WHERE group_id = $2 AND capture_id = $3`, [i, id, order[i]]);
    }
    res.json({ ok: true });
  } catch (err) { console.error('[groups.reorder]', err); res.status(500).json({ error: 'reorder failed' }); }
});

// ---- exports ----
async function getCaptures({ area, ids, group }) {
  if (group) {
    return (await pool.query(`
      SELECT c.* FROM group_items gi JOIN captures c ON c.id = gi.capture_id
      WHERE gi.group_id = $1 ORDER BY gi.position ASC, c.created_at ASC`, [group])).rows;
  }
  if (ids && ids.length) {
    return (await pool.query(`SELECT * FROM captures WHERE id = ANY($1) ORDER BY created_at ASC`, [ids])).rows;
  }
  if (area) {
    return (await pool.query(`SELECT * FROM captures WHERE $1 = ANY(area_tags) ORDER BY created_at ASC`, [area])).rows;
  }
  return (await pool.query(`SELECT * FROM captures ORDER BY created_at ASC`)).rows;
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

// Resolve what to export: rows, heading, description, and filename base.
async function resolveExport(req) {
  const area = req.query.area || '';
  const ids = parseIds(req.query.ids);
  const groupId = req.query.group ? parseInt(req.query.group, 10) : null;
  const imgRes = req.query.res || 'standard';
  const imgFmt = req.query.fmt || 'jpeg';
  let heading = 'Photo Notes' + (area ? ' - ' + area : '');
  let desc = '';
  let fnameBase = 'photonotes' + suffix(area);
  if (groupId) {
    const g = (await pool.query(`SELECT * FROM groups WHERE id = $1`, [groupId])).rows[0];
    if (g) {
      heading = g.title || 'Photo Notes';
      desc = g.description || '';
      fnameBase = 'photonotes-' + (slug(g.title) || 'group');
    }
  }
  const rows = await getCaptures({ area, ids, group: groupId });
  return { imgRes, imgFmt, heading, desc, fnameBase, rows };
}

// ---- image resolution / format for export ----
// Originals are always kept full-resolution on disk; this only shapes what gets exported.
const RES_PRESETS = {
  full:     { maxEdge: null, quality: 95 },   // original dimensions
  print:    { maxEdge: 3000, quality: 92 },   // print use
  standard: { maxEdge: 2048, quality: 85 },   // recommended / good for Claude
  web:      { maxEdge: 1400, quality: 80 },   // small files
};
function resSpec(r) { return RES_PRESETS[r] || RES_PRESETS.standard; }

// General export renderer -> { buffer, ext, mime } or null. Used by the zip bundle.
async function renderImage(localPath, imgRes, imgFmt) {
  if (!localPath) return null;
  if (imgFmt === 'original') {
    const ext = (path.extname(localPath) || '.jpg').toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { buffer: fs.readFileSync(localPath), ext, mime };
  }
  const { maxEdge, quality } = resSpec(imgRes);
  let img = sharp(localPath).rotate(); // honor EXIF orientation
  if (maxEdge) img = img.resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });
  if (imgFmt === 'png') return { buffer: await img.png({ compressionLevel: 9 }).toBuffer(), ext: '.png', mime: 'image/png' };
  if (imgFmt === 'webp') return { buffer: await img.webp({ quality }).toBuffer(), ext: '.webp', mime: 'image/webp' };
  return { buffer: await img.jpeg({ quality }).toBuffer(), ext: '.jpg', mime: 'image/jpeg' };
}

// PDF and Word can only embed JPEG or PNG, so coerce webp/original down to those.
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

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

init()
  .then(() => app.listen(PORT, () => console.log(`[efc] listening on ${PORT}`)))
  .catch((err) => {
    console.error('[efc] failed to init db', err);
    // still serve the frontend so we can diagnose
    app.listen(PORT, () => console.log(`[efc] listening on ${PORT} (db init failed)`));
  });
