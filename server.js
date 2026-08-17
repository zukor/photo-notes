const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
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
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const r = await fetch(url, {
      headers: { 'User-Agent': 'ElmCreekFieldCapture/0.1 (turcotte@zukor.com)' },
    });
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

// ---- exports ----
async function getCaptures({ area, ids }) {
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
function suffix(area) { return area ? '-' + area.toLowerCase().replace(/[^a-z0-9]+/g, '-') : ''; }
function fmtWhen(d) { try { return new Date(d).toLocaleString(); } catch { return ''; } }

app.get('/api/export/pdf', requireAuth, async (req, res) => {
  try {
    const area = req.query.area || '';
    const ids = parseIds(req.query.ids);
    const rows = await getCaptures({ area, ids });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="photonotes${suffix(area)}.pdf"`);
    const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
    doc.pipe(res);
    doc.fontSize(20).fillColor('#000').text('Photo Notes' + (area ? ' — ' + area : ''), { align: 'center' });
    doc.moveDown(1);
    rows.forEach((c, i) => {
      if (i > 0) doc.addPage();
      const img = localPhoto(c.photo_path);
      if (img) { try { doc.image(img, { fit: [480, 340], align: 'center' }); doc.moveDown(0.6); } catch (e) {} }
      doc.fontSize(13).fillColor('#000').text((c.address || 'No location') + (c.kind === 'task' ? '   [TASK]' : ''));
      if (c.area_tags && c.area_tags.length) doc.fontSize(10).fillColor('#000').text('Area: ' + c.area_tags.join(', '));
      doc.fontSize(9).fillColor('#000').text(fmtWhen(c.created_at));
      doc.moveDown(0.4);
      doc.fontSize(12).fillColor('#000').text(c.note || '(no note)');
    });
    if (!rows.length) doc.fontSize(12).fillColor('#000').text('No captures yet.');
    doc.end();
  } catch (err) { console.error('[export.pdf]', err); if (!res.headersSent) res.status(500).json({ error: 'pdf export failed' }); }
});

app.get('/api/export/docx', requireAuth, async (req, res) => {
  try {
    const area = req.query.area || '';
    const ids = parseIds(req.query.ids);
    const rows = await getCaptures({ area, ids });
    const children = [new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'Photo Notes' + (area ? ' — ' + area : ''), bold: true, color: '000000', font: 'Arial' })] })];
    for (const c of rows) {
      const img = localPhoto(c.photo_path);
      if (img) {
        try { children.push(new Paragraph({ children: [new ImageRun({ type: 'jpg', data: fs.readFileSync(img), transformation: { width: 420, height: 315 } })] })); } catch (e) {}
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
    res.setHeader('Content-Disposition', `attachment; filename="photonotes${suffix(area)}.docx"`);
    res.send(buf);
  } catch (err) { console.error('[export.docx]', err); if (!res.headersSent) res.status(500).json({ error: 'docx export failed' }); }
});

app.get('/api/export/bundle', requireAuth, async (req, res) => {
  try {
    const area = req.query.area || '';
    const ids = parseIds(req.query.ids);
    const rows = await getCaptures({ area, ids });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="photonotes-bundle${suffix(area)}.zip"`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (e) => { console.error('[export.bundle]', e); try { res.status(500).end(); } catch {} });
    archive.pipe(res);
    let md = `# Photo Notes${area ? ' — ' + area : ''}\n\nSource captures for reports. Each item has its photo, address, area, and note.\n\n`;
    rows.forEach((c, i) => {
      const n = String(i + 1).padStart(2, '0');
      const img = localPhoto(c.photo_path);
      let imgRef = '';
      if (img) { const name = `photos/${n}_${path.basename(img)}`; archive.file(img, { name }); imgRef = name; }
      md += `## ${i + 1}. ${c.address || 'No location'}${c.kind === 'task' ? ' [TASK]' : ''}\n`;
      if (c.area_tags && c.area_tags.length) md += `Area: ${c.area_tags.join(', ')}  \n`;
      md += `Captured: ${fmtWhen(c.created_at)}\n\n`;
      if (imgRef) md += `![photo](${imgRef})\n\n`;
      md += `${c.note || '(no note)'}\n\n`;
    });
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
