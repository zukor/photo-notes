'use strict';
// Uploaded files are private. A file is served to a signed-in user who can see a record that uses it,
// or to anyone holding a signed link that has not expired (pages for people without an account).
const crypto = require('crypto');

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
// Every column that stores an /uploads path, grouped by the access rule the API already applies.
const SOURCES = [
  ['captures', 'photo_path', 'capture'], ['captures', 'photo_original_path', 'capture'],
  ['ewr_photos', 'photo_path', 'owned'], ['asphalt_tickets', 'photo_path', 'owned'], ['camera_readings', 'photo_path', 'owned'],
  ['paving_temperatures', 'photo_path', 'owned'], ['concrete_tickets', 'photo_path', 'owned'], ['concrete_temperatures', 'photo_path', 'owned'],
  ['road_issue_reports', 'photo_path', 'owned'], ['groups', 'word_template_path', 'owned'],
  ['users', 'document_logo_path', 'self'], ['users', 'word_template_path', 'self'], ['users', 'default_template_path', 'self'],
  ['issue_reports', 'screenshot_path', 'issue'], ['issue_reports', 'result_screenshot_path', 'issue'], ['issue_reports', 'voice_path', 'issue'],
  ['property_floor_plans', 'photo_path', 'company'],
];
const SCHEMA = SOURCES.map(([table, column]) => `CREATE INDEX IF NOT EXISTS ${table}_${column}_lookup_idx ON ${table} (${column}) WHERE ${column} IS NOT NULL;`).join('\n') + `
CREATE INDEX IF NOT EXISTS hoa_item_photos_capture_lookup_idx ON hoa_item_photos (capture_id);
CREATE INDEX IF NOT EXISTS hoa_asset_photos_capture_lookup_idx ON hoa_asset_photos (capture_id);
CREATE INDEX IF NOT EXISTS hoa_assets_primary_capture_lookup_idx ON hoa_assets (primary_capture_id) WHERE primary_capture_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hoa_visit_stops_capture_ids_lookup_idx ON hoa_visit_stops USING gin (capture_ids);`;

// A photo is visible to company teammates when a company record uses it (the same relationships
// the HOA and Property Manager screens use to show teammates' photos), and to the people on a
// scheduled photo follow-up that uses it as the reference or result photo.
const COMPANY_CAPTURE = `SELECT 1 FROM captures c WHERE c.id = ANY($1::int[]) AND (EXISTS (
  SELECT 1 FROM photo_follow_up_schedules s WHERE (s.user_id = $2 OR s.assigned_user_id = $2)
    AND (s.reference_capture_id = c.id OR EXISTS (SELECT 1 FROM photo_follow_up_occurrences o WHERE o.schedule_id = s.id AND o.result_capture_id = c.id))
  ) OR EXISTS (
  SELECT 1 FROM hoa_company_members m WHERE m.user_id = $2 AND m.company_id IN (
    SELECT company_id FROM hoa_communities WHERE id = c.property_community_id
    UNION SELECT i.company_id FROM hoa_item_photos p JOIN hoa_maintenance_items i ON i.id = p.item_id WHERE p.capture_id = c.id
    UNION SELECT company_id FROM hoa_maintenance_items WHERE capture_id = c.id
    UNION SELECT a.company_id FROM hoa_asset_photos p JOIN hoa_assets a ON a.id = p.asset_id WHERE p.capture_id = c.id
    UNION SELECT company_id FROM hoa_assets WHERE primary_capture_id = c.id
    UNION SELECT v.company_id FROM hoa_visit_stops s JOIN hoa_property_visits v ON v.id = s.visit_id WHERE s.capture_ids @> ARRAY[c.id]
    UNION SELECT i.company_id FROM property_incident_photos p JOIN property_incidents i ON i.id = p.incident_id WHERE p.capture_id = c.id AND i.deleted_at IS NULL
  ))) LIMIT 1`;

function fileName(value) {
  const name = typeof value === 'string' && value.startsWith('/uploads/') ? value.slice(9) : String(value || '');
  return NAME.test(name) ? name : null;
}
// The signature covers the stored file name and expiry, so one link works for the photo and its thumbnail.
function signature(secret, name, exp) { return crypto.createHmac('sha256', secret).update(`upload\n${name}\n${exp}`).digest('hex'); }
function signedUrl(secret, photoPath, expires) {
  const name = fileName(photoPath); if (!name) return null;
  const exp = Math.floor((expires instanceof Date ? expires.getTime() : Number(expires)) / 1000);
  if (!Number.isFinite(exp)) return null;
  return `/uploads/${encodeURIComponent(name)}?exp=${exp}&sig=${signature(secret, name, exp)}`;
}
function validSignature(secret, name, exp, sig, now = Date.now()) {
  if (!/^\d{1,12}$/.test(String(exp || '')) || !/^[0-9a-f]{64}$/.test(String(sig || ''))) return false;
  if (Number(exp) * 1000 < now) return false;
  const expected = Buffer.from(signature(secret, name, String(exp)), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(String(sig), 'hex'));
}

function createUploadAccess({ pool, secret, cacheMs = 60000, maxCache = 20000, logger = console }) {
  let lookup = null;
  const cache = new Map();
  // Built once from the columns that exist, so a partial schema never breaks the lookup.
  async function lookupSql() {
    if (lookup) return lookup;
    const existing = new Set((await pool.query(`SELECT table_name||'.'||column_name AS c FROM information_schema.columns WHERE table_schema=current_schema()`)).rows.map(r => r.c));
    const parts = SOURCES.filter(([t, c]) => existing.has(`${t}.${c}`)).map(([t, c, rule]) =>
      `(SELECT '${rule}'::text AS rule, id, ${t === 'users' ? 'id' : t === 'property_floor_plans' ? 'company_id' : 'user_id'} AS ref FROM ${t} WHERE ${c} = $1 LIMIT 20)`);
    lookup = parts.join(' UNION ALL ');
    return lookup;
  }
  async function decide(user, name) {
    const sql = await lookupSql(); if (!sql) return false;
    const rows = (await pool.query(sql, ['/uploads/' + name])).rows;
    const uid = Number(user.id);
    if (rows.some(r => ['capture', 'owned', 'self', 'issue'].includes(r.rule) && Number(r.ref) === uid)) return true;
    // Super Admins and testing managers review every reported issue, including screenshots and voice notes.
    if ((require('./super-admin').isSuperAdmin(user) || user.is_testing_manager === true) && rows.some(r => r.rule === 'issue')) return true;
    const companies = rows.filter(r => r.rule === 'company').map(r => Number(r.ref));
    if (companies.length && (await pool.query('SELECT 1 FROM hoa_company_members WHERE user_id=$1 AND company_id=ANY($2::int[]) LIMIT 1', [uid, companies])).rowCount) return true;
    const captures = rows.filter(r => r.rule === 'capture').map(r => Number(r.id));
    return !!(captures.length && (await pool.query(COMPANY_CAPTURE, [captures, uid])).rowCount);
  }
  async function canAccess(user, name, now = Date.now()) {
    if (!user || !user.id || !NAME.test(String(name || ''))) return false;
    const key = user.id + ':' + name, hit = cache.get(key);
    if (hit && hit > now) return true;
    let allowed = false;
    try { allowed = await decide(user, name); } catch (e) { logger.error('[uploads.access]', e && e.message); return false; }
    if (allowed) {
      if (cache.size >= maxCache) { for (const [k, until] of cache) if (until <= now) cache.delete(k); if (cache.size >= maxCache) cache.clear(); }
      cache.set(key, now + cacheMs);
    }
    return allowed;
  }
  // Express middleware for /uploads and /thumbs. Signed links first, then the signed-in user's access.
  function middleware(requireAuth) {
    return (req, res, next) => {
      let name;
      try { name = decodeURIComponent(req.path.replace(/^\//, '')); } catch { return res.status(400).end(); }
      if (!NAME.test(name)) return res.status(404).end();
      if (req.query && req.query.sig !== undefined && validSignature(secret, name, req.query.exp, req.query.sig)) {
        res.setHeader('Cache-Control', 'private, no-cache');
        return next();
      }
      requireAuth(req, res, async () => {
        try {
          if (!(await canAccess(req.user, name))) return res.status(404).end();
          res.setHeader('Cache-Control', 'private, no-cache');
          next();
        } catch { res.status(404).end(); }
      });
    };
  }
  return { canAccess, middleware, signedUrl: (photoPath, expires) => signedUrl(secret, photoPath, expires), clearCache: () => cache.clear() };
}

module.exports = { SCHEMA, SOURCES, createUploadAccess, signedUrl, validSignature, fileName };
