'use strict';
// Property Manager Pro indoor locations: floor plan images per property (a photo of the posted fire escape map, an
// uploaded image or the first page of a PDF), and on each photo: building, floor, suite, room and a pin on a floor plan.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), { execFile } = require('child_process');
const sharp = require('sharp');
const SCHEMA = `
CREATE TABLE IF NOT EXISTS property_floor_plans (
 id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES hoa_management_companies(id) ON DELETE CASCADE,
 community_id INTEGER NOT NULL REFERENCES hoa_communities(id) ON DELETE CASCADE,
 building TEXT, floor TEXT NOT NULL, photo_path TEXT NOT NULL, width INTEGER, height INTEGER, source TEXT NOT NULL DEFAULT 'image',
 active BOOLEAN NOT NULL DEFAULT true, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS property_floor_plans_idx ON property_floor_plans(company_id,community_id,active);
CREATE INDEX IF NOT EXISTS property_floor_plans_photo_path_idx ON property_floor_plans(photo_path);
ALTER TABLE captures ADD COLUMN IF NOT EXISTS indoor_building TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS indoor_floor TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS indoor_suite TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS indoor_room TEXT;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS floor_plan_id INTEGER REFERENCES property_floor_plans(id) ON DELETE SET NULL;
ALTER TABLE captures ADD COLUMN IF NOT EXISTS floor_plan_x NUMERIC(6,5);
ALTER TABLE captures ADD COLUMN IF NOT EXISTS floor_plan_y NUMERIC(6,5);
`;
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const text = (v, max) => { const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : ''; return s || null; };
const FIELDS = ['indoor_building', 'indoor_floor', 'indoor_suite', 'indoor_room'];
// "Building B, Floor 2, Suite 210, Mechanical Room" from whichever parts are filled in.
function indoorText(c = {}) {
  const parts = [];
  if (c.indoor_building) parts.push(/building/i.test(c.indoor_building) ? c.indoor_building : 'Building ' + c.indoor_building);
  if (c.indoor_floor) parts.push(/floor|level|basement|roof/i.test(c.indoor_floor) ? c.indoor_floor : 'Floor ' + c.indoor_floor);
  if (c.indoor_suite) parts.push(/suite|unit|space/i.test(c.indoor_suite) ? c.indoor_suite : 'Suite ' + c.indoor_suite);
  if (c.indoor_room) parts.push(c.indoor_room);
  return parts.join(', ');
}
const planLabel = p => [p.building ? (/building/i.test(p.building) ? p.building : 'Building ' + p.building) : null, /floor|level|basement|roof/i.test(p.floor) ? p.floor : 'Floor ' + p.floor].filter(Boolean).join(', ');
// Clean an indoor location from a request body. Pin coordinates are fractions (0 to 1) of the floor plan image.
function cleanIndoor(b = {}) {
  const out = {}; for (const k of FIELDS) out[k] = text(b[k], 120);
  const id = b.floor_plan_id === '' || b.floor_plan_id == null ? null : Number(b.floor_plan_id);
  if (id != null && (!Number.isSafeInteger(id) || id < 1)) throw bad('Invalid floor plan');
  const x = Number(b.floor_plan_x), y = Number(b.floor_plan_y), pin = id != null && b.floor_plan_x !== '' && b.floor_plan_x != null && Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
  if (id != null && b.floor_plan_x != null && b.floor_plan_x !== '' && !pin) throw bad('Invalid floor plan pin');
  return { ...out, floor_plan_id: id, floor_plan_x: pin ? Math.round(x * 100000) / 100000 : null, floor_plan_y: pin ? Math.round(y * 100000) / 100000 : null };
}
const hasIndoor = b => FIELDS.some(k => b[k] != null && String(b[k]).trim() !== '') || (b.floor_plan_id != null && b.floor_plan_id !== '');
async function checkPlan(db, companyId, planId, communityId) {
  if (planId == null) return null;
  const p = (await db.query('SELECT * FROM property_floor_plans WHERE id=$1 AND company_id=$2', [planId, companyId])).rows[0];
  if (!p || (communityId && Number(p.community_id) !== Number(communityId))) throw bad('Choose a floor plan for this property');
  return p;
}
// Called from the capture save: applies an indoor location sent with a new Property Manager Pro photo.
async function applyFromCapture(db, { companyId, captureId, communityId, body }) {
  if (!companyId || !hasIndoor(body || {})) return null;
  const v = cleanIndoor(body); await checkPlan(db, companyId, v.floor_plan_id, communityId);
  return (await db.query('UPDATE captures SET indoor_building=$1,indoor_floor=$2,indoor_suite=$3,indoor_room=$4,floor_plan_id=$5,floor_plan_x=$6,floor_plan_y=$7 WHERE id=$8 RETURNING *', [v.indoor_building, v.indoor_floor, v.indoor_suite, v.indoor_room, v.floor_plan_id, v.floor_plan_x, v.floor_plan_y, captureId])).rows[0];
}
// A PDF floor plan becomes an image of the chosen page (pdftoppm from poppler-utils).
function pdfPage(file, page, outPrefix) {
  return new Promise((resolve, reject) => execFile('pdftoppm', ['-r', '120', '-f', String(page), '-l', String(page), '-png', '-singlefile', file, outPrefix], { timeout: 45000 }, err => err ? reject(err) : resolve(outPrefix + '.png')));
}
function register(app, { pool, requireAuth, requireHoa, currentProduct, upload, uploadDir }) {
  const gate = async (req, res, next) => { try { if (await currentProduct(req.user.id) !== 'property') return res.status(403).json({ error: 'Property Manager Pro required' }); next(); } catch (e) { next(e); } };
  const run = fn => async (req, res) => { try { await fn(req, res); } catch (e) { if (!e.status) console.error('[floor-plans]', e.message); if (!res.headersSent) res.status(e.status || 500).json({ error: e.status ? e.message : 'Floor plan operation failed' }); } };
  const guard = [requireAuth, requireHoa, gate];
  const out = p => ({ ...p, label: planLabel(p) });
  app.get('/api/property/floor-plans', ...guard, run(async (req, res) => {
    const vals = [req.hoaCompany.id, req.query.archived !== '1'], where = ['p.company_id=$1', 'p.active=$2'];
    if (req.query.community_id) { const c = Number(req.query.community_id); if (!Number.isSafeInteger(c) || c < 1) throw bad('Invalid Property'); vals.push(c); where.push('p.community_id=$3'); }
    res.json((await pool.query(`SELECT p.*,c.name community_name FROM property_floor_plans p JOIN hoa_communities c ON c.id=p.community_id WHERE ${where.join(' AND ')} ORDER BY c.name,p.building NULLS FIRST,p.floor`, vals)).rows.map(out));
  }));
  app.post('/api/property/floor-plans', ...guard, upload.single('file'), run(async (req, res) => {
    const tmp = [];
    try {
      const b = req.body || {}, f = req.file; if (f) tmp.push(f.path);
      if (!f) throw bad('Choose a floor plan photo, image or PDF');
      const community = (await pool.query('SELECT id FROM hoa_communities WHERE id=$1 AND company_id=$2 AND active=true', [Number(b.community_id), req.hoaCompany.id])).rows[0];
      if (!community) throw bad('Property not found', 404);
      const floor = text(b.floor, 60); if (!floor) throw bad('Enter the floor, for example 1, 2 or Basement');
      let src = f.path, source = 'image';
      const head = fs.readFileSync(f.path).subarray(0, 5).toString('latin1');
      if (head === '%PDF-') {
        const page = Math.min(500, Math.max(1, parseInt(b.pdf_page, 10) || 1)), prefix = path.join(uploadDir, 'fp-' + crypto.randomBytes(8).toString('hex'));
        try { src = await pdfPage(f.path, page, prefix); tmp.push(src); } catch (e) { throw bad('That PDF page could not be turned into a floor plan. Check the page number, or upload a screenshot of the plan instead.'); }
        source = 'pdf';
      }
      let buf;
      try { buf = await sharp(src, { limitInputPixels: 80000000 }).rotate().flatten({ background: '#ffffff' }).resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer(); }
      catch (e) { throw bad('Use a photo, an image (JPEG, PNG, WebP or HEIC) or a PDF.'); }
      const meta = await sharp(buf).metadata(), name = crypto.randomBytes(20).toString('hex') + '.jpg';
      fs.writeFileSync(path.join(uploadDir, name), buf);
      const row = (await pool.query('INSERT INTO property_floor_plans(company_id,community_id,building,floor,photo_path,width,height,source,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [req.hoaCompany.id, community.id, text(b.building, 60), floor, '/uploads/' + name, meta.width, meta.height, b.source === 'photo' && source === 'image' ? 'photo' : source, req.user.id])).rows[0];
      res.json(out(row));
    } finally { for (const p of tmp) fs.promises.unlink(p).catch(() => {}); }
  }));
  app.post('/api/property/floor-plans/:id', ...guard, run(async (req, res) => {
    const b = req.body || {}, p = await checkPlan(pool, req.hoaCompany.id, Number(req.params.id)); if (!p) throw bad('Floor plan not found', 404);
    const floor = b.floor !== undefined ? text(b.floor, 60) : p.floor; if (!floor) throw bad('Enter the floor');
    const row = (await pool.query('UPDATE property_floor_plans SET building=$1,floor=$2,active=$3 WHERE id=$4 AND company_id=$5 RETURNING *', [b.building !== undefined ? text(b.building, 60) : p.building, floor, typeof b.active === 'boolean' ? b.active : p.active, p.id, req.hoaCompany.id])).rows[0];
    res.json(out(row));
  }));
  // A photo's indoor location: the person who took it, or anyone in the company when the photo belongs to a company
  // property, maintenance record, asset or incident.
  const access = async (userId, companyId, id) => (await pool.query(`SELECT c.* FROM captures c WHERE c.id=$1 AND (c.user_id=$2
    OR c.property_community_id IN (SELECT id FROM hoa_communities WHERE company_id=$3)
    OR EXISTS(SELECT 1 FROM hoa_item_photos p JOIN hoa_maintenance_items i ON i.id=p.item_id WHERE p.capture_id=c.id AND i.company_id=$3)
    OR EXISTS(SELECT 1 FROM hoa_maintenance_items i WHERE i.capture_id=c.id AND i.company_id=$3)
    OR EXISTS(SELECT 1 FROM hoa_asset_photos p JOIN hoa_assets a ON a.id=p.asset_id WHERE p.capture_id=c.id AND a.company_id=$3))`, [id, userId, companyId])).rows[0];
  const indoorOf = async c => { const plan = c.floor_plan_id ? (await pool.query('SELECT * FROM property_floor_plans WHERE id=$1', [c.floor_plan_id])).rows[0] : null; return { capture_id: c.id, property_community_id: c.property_community_id, indoor_building: c.indoor_building, indoor_floor: c.indoor_floor, indoor_suite: c.indoor_suite, indoor_room: c.indoor_room, floor_plan_id: c.floor_plan_id, floor_plan_x: c.floor_plan_x == null ? null : Number(c.floor_plan_x), floor_plan_y: c.floor_plan_y == null ? null : Number(c.floor_plan_y), text: indoorText(c), plan: plan ? out(plan) : null }; };
  app.get('/api/captures/:id/indoor', ...guard, run(async (req, res) => { const c = await access(req.user.id, req.hoaCompany.id, Number(req.params.id)); if (!c) throw bad('Photo not found', 404); res.json(await indoorOf(c)); }));
  app.post('/api/captures/:id/indoor', ...guard, run(async (req, res) => {
    const c = await access(req.user.id, req.hoaCompany.id, Number(req.params.id)); if (!c) throw bad('Photo not found', 404);
    const v = cleanIndoor(req.body || {}), plan = await checkPlan(pool, req.hoaCompany.id, v.floor_plan_id);
    if (plan && c.property_community_id && Number(plan.community_id) !== Number(c.property_community_id)) throw bad('Choose a floor plan for this photo\'s property');
    const row = (await pool.query('UPDATE captures SET indoor_building=$1,indoor_floor=$2,indoor_suite=$3,indoor_room=$4,floor_plan_id=$5,floor_plan_x=$6,floor_plan_y=$7 WHERE id=$8 RETURNING *', [v.indoor_building, v.indoor_floor, v.indoor_suite, v.indoor_room, v.floor_plan_id, v.floor_plan_x, v.floor_plan_y, c.id])).rows[0];
    await pool.query(`INSERT INTO capture_history(capture_id,user_id,action,detail) VALUES($1,$2,'indoor_location_updated',$3)`, [c.id, c.user_id, JSON.stringify({ actor_id: req.user.id, after: v })]).catch(() => {});
    res.json(await indoorOf(row));
  }));
}
module.exports = { SCHEMA, FIELDS, indoorText, planLabel, cleanIndoor, hasIndoor, applyFromCapture, register };
