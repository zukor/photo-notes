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
const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');
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

// ===================== Shared AI vision helper =====================
// One place for all vision calls. Resizes the photo to a 1568px longest edge
// JPEG (the app already depends on sharp), sends it base64 to the Anthropic
// Messages API with a prompt, expects JSON-only back, strips markdown fences,
// parses defensively, and returns null on ANY failure rather than throwing so
// callers stay offline-tolerant. The API key lives only on the server.
const VISION_MODEL = process.env.VISION_MODEL || 'claude-sonnet-4-6';
function parseJSONLoose(text) {
  if (text == null) return null;
  let t = String(text).trim();
  // strip a ```json ... ``` or ``` ... ``` fence if present
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // fall back to the first {...} block if there is surrounding prose
  if (t[0] !== '{') { const m = t.match(/\{[\s\S]*\}/); if (m) t = m[0]; }
  try { return JSON.parse(t); } catch { return null; }
}
async function visionJSON(localPath, prompt, opts = {}) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !localPath) return null;
  try {
    const jpeg = await sharp(localPath).rotate()
      .resize({ width: 1568, height: 1568, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 }).toBuffer();
    const b64 = jpeg.toString('base64');
    const body = {
      model: VISION_MODEL,
      max_tokens: opts.maxTokens || 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
          { type: 'text', text: prompt },
        ],
      }],
    };
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!r.ok) { console.error('[vision] http ' + r.status); return null; }
    const d = await r.json();
    const text = (d && d.content && d.content[0] && d.content[0].text) || '';
    return parseJSONLoose(text);
  } catch (e) { console.error('[vision]', e && e.message); return null; }
}

// ---- defect classification vocabulary + severity presentation ----
const DEFECT_TYPES = ['pothole', 'alligator_cracking', 'transverse_cracking', 'longitudinal_cracking', 'rutting', 'raveling', 'edge_cracking', 'other', 'none'];
const SEVERITIES = ['low', 'medium', 'high'];
const SEVERITY_COLOR = { low: '#1b7a3d', medium: '#b36b00', high: '#b3261e' };
function defectLabel(t) {
  const map = {
    pothole: 'Pothole', alligator_cracking: 'Alligator Cracking', transverse_cracking: 'Transverse Cracking',
    longitudinal_cracking: 'Longitudinal Cracking', rutting: 'Rutting', raveling: 'Raveling',
    edge_cracking: 'Edge Cracking', other: 'Other', none: 'No Defect',
  };
  return map[t] || 'Other';
}
// Export line for a classified defect, e.g. "Pothole, high severity". Empty when
// unclassified. 'none' still reports so a report can show "No Defect".
function fmtDefect(c) {
  if (!c || !c.defect_type) return '';
  if (c.defect_type === 'none') return 'No Defect';
  const sev = SEVERITIES.includes(c.defect_severity) ? `${c.defect_severity} severity` : '';
  return sev ? `${defectLabel(c.defect_type)}, ${sev}` : defectLabel(c.defect_type);
}

// ===================== Per-site condition score (Feature 2) =====================
// Deterministic (no AI). Tune these point deductions here. Each classified
// capture in a group deducts points from a starting 100 based on its defect
// type and severity. Unclassified captures deduct nothing but are counted for
// coverage. 'other' and 'none' deduct nothing.
const SCORE_DEDUCTIONS = {
  pothole:              { high: 12, medium: 8, low: 5 },
  alligator_cracking:   { high: 10, medium: 7, low: 4 },
  rutting:              { high: 8,  medium: 5, low: 3 },
  transverse_cracking:  { high: 5,  medium: 3, low: 2 },
  longitudinal_cracking:{ high: 5,  medium: 3, low: 2 },
  edge_cracking:        { high: 5,  medium: 3, low: 2 },
  raveling:             { high: 4,  medium: 3, low: 2 },
  other:                { high: 0,  medium: 0, low: 0 },
  none:                 { high: 0,  medium: 0, low: 0 },
};
function scoreBand(score) {
  if (score >= 86) return 'Good';
  if (score >= 71) return 'Satisfactory';
  if (score >= 56) return 'Fair';
  if (score >= 41) return 'Poor';
  if (score >= 26) return 'Very Poor';
  return 'Failed';
}
// Returns { score, band, classified, unclassified, total }. score/band are null
// when nothing in the group has been classified yet (so the UI shows no score
// rather than a misleading 100).
function scoreCaptures(caps) {
  const total = caps.length;
  let classified = 0, deduction = 0;
  for (const c of caps) {
    if (!c.defect_type) continue;
    classified++;
    const row = SCORE_DEDUCTIONS[c.defect_type];
    if (row && c.defect_severity && row[c.defect_severity] != null) deduction += row[c.defect_severity];
  }
  const unclassified = total - classified;
  if (classified === 0) return { score: null, band: null, classified: 0, unclassified, total };
  const score = Math.max(0, 100 - deduction);
  return { score, band: scoreBand(score), classified, unclassified, total };
}

// ===================== Proposal report (Feature 5) =====================
// Recommended fix rules (tune here). Everything not matched is "Review Required".
function recommendFix(type, sev) {
  if (!type || type === 'other' || type === 'none') return 'Review Required';
  const crack = ['transverse_cracking', 'longitudinal_cracking', 'edge_cracking'];
  if (crack.includes(type) && (sev === 'low' || sev === 'medium')) return 'Crack Seal';
  if (type === 'pothole') return 'Saw-Cut Patch';
  if (type === 'alligator_cracking' && (sev === 'low' || sev === 'medium')) return 'Saw-Cut Patch';
  if (type === 'alligator_cracking' && sev === 'high') return 'Mill and Overlay';
  if (type === 'rutting' && (sev === 'medium' || sev === 'high')) return 'Mill and Overlay';
  if (type === 'raveling' && sev === 'high') return 'Mill and Overlay';
  return 'Review Required';
}
// Material quantity for one capture under its recommended fix. Never fabricates
// numbers: missing dimensions yield "measure on site".
function fixQuantity(fix, c) {
  if (fix === 'Crack Seal') {
    if (c.dim_length_in == null) return { unit: 'lf', value: null, text: 'measure on site', measureOnSite: true };
    const lf = Number(c.dim_length_in) / 12;
    return { unit: 'lf', value: lf, text: `${lf.toFixed(1)} lf` };
  }
  if (fix === 'Saw-Cut Patch') {
    if (c.dim_area_sqft == null) return { unit: 'tons', value: null, text: 'measure on site', measureOnSite: true };
    const depthDefaulted = c.dim_depth_in == null;
    const depth = depthDefaulted ? 2 : Number(c.dim_depth_in);
    let tons = Number(c.dim_area_sqft) * depth * 145 / 12 / 2000 * 1.10;
    tons = Math.ceil(tons * 100) / 100;
    return { unit: 'tons', value: tons, text: `${tons.toFixed(2)} tons${depthDefaulted ? ' (2 in depth assumed)' : ''}` };
  }
  if (fix === 'Mill and Overlay') {
    if (c.dim_area_sqft == null) return { unit: 'sq ft', value: null, text: 'measure on site', measureOnSite: true };
    const a = Number(c.dim_area_sqft);
    return { unit: 'sq ft', value: a, text: `${a.toFixed(1)} sq ft (minimum, verify extent)` };
  }
  return { unit: '', value: null, text: 'review required' };
}
const PROPOSAL_DISCLAIMER = 'Recommendations and quantities are AI-assisted estimates prepared from field captures. An estimator must verify all items before this document is used in a bid or contract.';
// Build the per-defect sections + summary rows for a proposal.
function buildProposal(items) {
  const sections = items.map((c) => {
    const fix = recommendFix(c.defect_type, c.defect_severity);
    const qty = fixQuantity(fix, c);
    return { c, fix, qty };
  });
  const sumMap = {};
  for (const s of sections) {
    const k = s.fix;
    if (!sumMap[k]) sumMap[k] = { fix: k, count: 0, total: 0, unit: s.qty.unit || '', measureOnSite: 0 };
    sumMap[k].count++;
    if (s.qty.value != null) sumMap[k].total += s.qty.value;
    else sumMap[k].measureOnSite++;
    if (s.qty.unit) sumMap[k].unit = s.qty.unit;
  }
  const order = ['Crack Seal', 'Saw-Cut Patch', 'Mill and Overlay', 'Review Required'];
  const summary = Object.values(sumMap).sort((a, b) => order.indexOf(a.fix) - order.indexOf(b.fix));
  return { sections, summary };
}
function fmtQtyTotal(row) {
  if (row.fix === 'Review Required') return 'see notes';
  const num = row.unit === 'tons' ? row.total.toFixed(2) : row.total.toFixed(1);
  let t = `${num} ${row.unit}`.trim();
  if (row.measureOnSite) t += ` (+${row.measureOnSite} to measure on site)`;
  return t;
}

// ===================== Geometry helpers (no AI, no external services) =====================
// Great-circle distance between two lat/lng points, in meters, via haversine.
function haversineMeters(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => v == null || Number.isNaN(Number(v)))) return null;
  const R = 6371000; // earth radius in meters
  const toRad = (d) => Number(d) * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
function metersToFeet(m) { return m == null ? null : m * 3.28084; }

// Project lat/lng points to local planar meters using an equirectangular
// projection centered on the polygon centroid. Accurate to well under 1% at
// parcel/road scale.
function projectPlanar(points) {
  const n = points.length;
  let latSum = 0, lngSum = 0;
  for (const p of points) { latSum += Number(p.lat); lngSum += Number(p.lng); }
  const lat0 = latSum / n, lng0 = lngSum / n;
  const R = 6371000, toRad = (d) => d * Math.PI / 180;
  return points.map((p) => ({
    x: R * toRad(Number(p.lng) - lng0) * Math.cos(toRad(lat0)),
    y: R * toRad(Number(p.lat) - lat0),
  }));
}
// Shoelace area of a projected polygon, returned in square feet.
function polygonAreaSqft(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const pl = projectPlanar(points);
  let a = 0;
  for (let i = 0; i < pl.length; i++) {
    const j = (i + 1) % pl.length;
    a += pl[i].x * pl[j].y - pl[j].x * pl[i].y;
  }
  const sqMeters = Math.abs(a) / 2;
  return sqMeters * 10.7639; // m^2 -> ft^2
}
// Longest axis of a polygon (max distance between any two vertices), in feet.
// Reported as an approximate length.
function polygonLongestAxisFeet(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const m = haversineMeters(points[i].lat, points[i].lng, points[j].lat, points[j].lng);
      if (m != null && m > max) max = m;
    }
  }
  return metersToFeet(max);
}
// Sum of haversine distances along a centerline, in feet.
function spanLengthFeet(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  let m = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const d = haversineMeters(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
    if (d != null) m += d;
  }
  return metersToFeet(m);
}
// Segment intersection test (planar), used to reject self-intersecting polygons.
function segmentsIntersect(p1, p2, p3, p4) {
  const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
  return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
}
function polygonSelfIntersects(points) {
  if (!Array.isArray(points) || points.length < 4) return false;
  const pl = projectPlanar(points);
  const n = pl.length;
  for (let i = 0; i < n; i++) {
    const a1 = pl[i], a2 = pl[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // skip adjacent/shared-vertex segments
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      const b1 = pl[j], b2 = pl[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}
// Ray-casting point-in-polygon on projected coordinates.
function pointInPolygon(lat, lng, points) {
  if (!Array.isArray(points) || points.length < 3) return false;
  const projected = projectPlanar(points.concat([{ lat, lng }]));
  const pt = projected[projected.length - 1];
  const poly = projected.slice(0, projected.length - 1);
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
// Perpendicular distance (feet) from a point to the nearest segment of a
// centerline.
function distToCenterlineFeet(lat, lng, points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const projected = projectPlanar(points.concat([{ lat, lng }]));
  const pt = projected[projected.length - 1];
  const line = projected.slice(0, projected.length - 1);
  let min = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx, py = a.y + t * dy;
    const d = Math.hypot(pt.x - px, pt.y - py);
    if (d < min) min = d;
  }
  return min === Infinity ? null : min * 3.28084;
}
// Validate + compute a zone's length_ft and area_sqft from its points/width.
// Returns { ok, error, length_ft, area_sqft }.
function computeZone(zoneType, points, widthFt) {
  if (!Array.isArray(points)) return { ok: false, error: 'points required' };
  const pts = points.filter(p => p && p.lat != null && p.lng != null).map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  if (zoneType === 'polygon') {
    if (pts.length < 3) return { ok: false, error: 'a polygon needs at least 3 points' };
    if (polygonSelfIntersects(pts)) return { ok: false, error: 'the polygon crosses itself; redraw without crossing lines' };
    return { ok: true, length_ft: polygonLongestAxisFeet(pts), area_sqft: polygonAreaSqft(pts) };
  }
  if (zoneType === 'span') {
    if (pts.length < 2) return { ok: false, error: 'a span needs at least 2 points' };
    const w = Number(widthFt);
    if (!Number.isFinite(w) || w <= 0) return { ok: false, error: 'a span needs a positive width' };
    const len = spanLengthFeet(pts);
    return { ok: true, length_ft: len, area_sqft: len != null ? len * w : null };
  }
  return { ok: false, error: 'zone_type must be polygon or span' };
}
// Which of a user's captures fall inside a zone (computed live).
function capturesInZone(zone, caps) {
  const pts = zone.points || [];
  const out = [];
  for (const c of caps) {
    if (c.latitude == null || c.longitude == null) continue;
    if (zone.zone_type === 'polygon') {
      if (pointInPolygon(Number(c.latitude), Number(c.longitude), pts)) out.push(c.id);
    } else if (zone.zone_type === 'span') {
      const d = distToCenterlineFeet(Number(c.latitude), Number(c.longitude), pts);
      const tol = (Number(zone.width_ft) || 0) / 2 + 25; // GPS scatter tolerance
      if (d != null && d <= tol) out.push(c.id);
    }
  }
  return out;
}

// ===================== Extra Work Record vocabulary (Feature) =====================
const EWR_STATUSES = ['documented', 'sent_for_review', 'approved', 'declined', 'completed', 'closed_no_action'];
const EWR_REASONS = ['unforeseen_site_condition', 'failed_base_or_subbase', 'additional_damaged_area', 'drainage_or_water_issue', 'customer_requested_addition', 'additional_repair_or_patching', 'access_obstruction_or_site_prep', 'safety_issue', 'other'];
const EWR_METHODS = ['in_person', 'phone', 'text', 'email', 'other'];
function ewrStatusLabel(s) {
  return ({ documented: 'Documented', sent_for_review: 'Sent for review', approved: 'Approved', declined: 'Declined', completed: 'Completed', closed_no_action: 'Closed / no action' })[s] || 'Documented';
}
function ewrReasonLabel(r) {
  return ({
    unforeseen_site_condition: 'Unforeseen site condition', failed_base_or_subbase: 'Failed base or sub-base',
    additional_damaged_area: 'Additional damaged area found', drainage_or_water_issue: 'Drainage or water issue',
    customer_requested_addition: 'Customer-requested addition', additional_repair_or_patching: 'Additional repair or patching',
    access_obstruction_or_site_prep: 'Access, obstruction, or site-preparation issue', safety_issue: 'Safety issue', other: 'Other',
  })[r] || '';
}
function ewrMethodLabel(m) {
  return ({ in_person: 'In person', phone: 'Phone call', text: 'Text message', email: 'Email', other: 'Other' })[m] || '';
}
const EWR_DISCLAIMER = 'This record is job-site documentation intended to support the contractor’s existing communication and change-order process. It does not itself constitute a contract, estimate, invoice, or legally binding approval.';

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
    // zoom=18 asks Nominatim for building-level detail and addressdetails=1
    // guarantees the structured address object, so a house number is returned
    // whenever OpenStreetMap has one for that point (the default reverse call
    // often came back with only the street name).
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'PhotoNotes/1.0 (turcotte@zukor.com)' } });
    if (!r.ok) return null;
    const data = await r.json();
    const a = data.address || {};
    const houseNo = a.house_number || a.house_name || '';
    const line1 = [houseNo, a.road].filter(Boolean).join(' ');
    const city = a.city || a.town || a.village || a.hamlet || a.suburb || a.county || '';
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
    // Address geocoding is kept OFF the save path so the record commits
    // instantly. If the client already resolved the address (its live preview),
    // we store it now; otherwise we leave it null and fill it in the background
    // right after responding (see the fire-and-forget block below).
    let address = b.address || null;

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
    let dSource = null, dConf = null, dAi = null, dConfirmed = true;
    const isProUser = await currentPlan(req.user.id) === 'pro';
    if (isProUser) {
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

      // Measure-from-photo provenance (voice/manual leave these at defaults).
      if (b.dim_source === 'photo_ai' || b.dim_source === 'voice' || b.dim_source === 'manual') dSource = b.dim_source;
      if (['high', 'medium', 'low'].includes(b.dim_confidence)) dConf = b.dim_confidence;
      if (b.dim_ai) { try { dAi = typeof b.dim_ai === 'string' ? JSON.parse(b.dim_ai) : b.dim_ai; } catch { dAi = null; } }
      // Low-confidence photo estimates are excluded from exports until the user
      // confirms them. The client sends dim_confirmed=true once confirmed.
      if (dSource === 'photo_ai' && dConf === 'low') dConfirmed = String(b.dim_confirmed) === 'true';
      // Log the measurement for later accuracy tuning (metadata only, no note text).
      if (dSource === 'photo_ai') {
        logEvent(req.user.id, 'measure', {
          reference: b.measure_reference || null,
          ai: dAi || null,
          final: { length_in: dLenIn, width_in: dWidIn, depth_in: dDepthIn, area_sqft: dArea, shape: dShape },
          confidence: dConf, confirmed: dConfirmed,
        });
      }
    }

    const q = `INSERT INTO captures (user_id, captured_by, photo_path, photo_width, photo_height, note, latitude, longitude, address, area_tags, kind, status,
                 dim_length_in, dim_length_unit, dim_width_in, dim_width_unit, dim_depth_in, dim_shape, dim_area_sqft,
                 dim_source, dim_confidence, dim_ai, dim_confirmed)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`;
    const status = kind === 'task' ? 'open' : null;
    const vals = [req.user.id, req.user.name, photoPath, pw, ph, b.note || null, lat, lng, address, areas, kind, status,
      dLenIn, dLenUnit, dWidIn, dWidUnit, dDepthIn, dShape, dArea,
      dSource, dConf, dAi ? JSON.stringify(dAi) : null, dConfirmed];
    const { rows } = await pool.query(q, vals);
    const saved = rows[0];
    res.json(saved);

    // Background address fill: if we have coordinates but no address yet, geocode
    // AFTER responding and patch the row. The save is already committed and the
    // client already has its response, so this never delays the user. The client
    // picks up the address on its next Library refresh.
    if (!address && lat != null && lng != null) {
      reverseGeocode(lat, lng)
        .then(addr => {
          if (addr) return pool.query(
            `UPDATE captures SET address = $1 WHERE id = $2 AND (address IS NULL OR address = '')`,
            [addr, saved.id]);
        })
        .catch(e => console.error('[captures.bg-geocode]', e && e.message));
    }
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

// ---- client config: which map imagery to use ----
// Mapbox public tokens (pk....) are safe to expose to the browser, so we pass
// the token through. When absent, the client falls back to Esri World Imagery.
app.get('/api/config', requireAuth, (req, res) => {
  res.json({ mapbox_token: process.env.MAPBOX_TOKEN || null });
});

// ---- Measure from photo (Pro): estimate dimensions from a ruler reference ----
// Accepts either a temporary photo upload or the ID of a saved capture plus the
// reference object and its exact known length. Returns AI-estimated dimensions
// as JSON. Never throws to the client: a soft error lets the record save
// without measurements.
app.post('/api/measure', requireAuth, upload.single('photo'), async (req, res) => {
  const cleanup = () => { if (req.file && req.file.path) { try { fs.unlinkSync(req.file.path); } catch (e) {} } };
  try {
    if (await currentPlan(req.user.id) !== 'pro') { cleanup(); return res.status(403).json({ error: 'pro only' }); }
    let photoPath = req.file && req.file.path;
    if (!photoPath) {
      const captureId = parseInt((req.body && req.body.capture_id) || '', 10);
      if (Number.isInteger(captureId)) {
        const row = (await pool.query(`SELECT photo_path FROM captures WHERE id=$1 AND user_id=$2`, [captureId, req.user.id])).rows[0];
        photoPath = row && localPhoto(row.photo_path);
      }
    }
    if (!photoPath) return res.status(400).json({ error: 'photo required' });
    const refType = String((req.body && req.body.reference_type) || 'ruler_12in');
    const refLenIn = Number((req.body && req.body.reference_length_in)) || (refType === 'tape_25ft' ? 300 : refType === 'ruler_12in' ? 12 : 0);
    const refLabel = refType === 'ruler_12in' ? 'a standard 12-inch ruler'
      : refType === 'tape_25ft' ? 'a tape measure extended to a known length'
      : 'a reference object';
    const prompt =
`You are measuring a pavement defect for an asphalt contractor. The photo contains ${refLabel} placed in frame as a scale reference. Its exact real-world length is ${refLenIn} inches.
Locate the reference object, use its known length to establish the image scale, then estimate the primary defect's length, width, and (only if judgeable from shadow/relief) depth, all in inches. Also give the defect's overall shape.
Respond with ONLY a JSON object, no prose, no markdown, with exactly these keys:
{"length_in": number, "width_in": number, "depth_in": number or null, "shape": "rectangle"|"circle"|"irregular", "confidence": "high"|"medium"|"low", "warning": string or null}
Use "warning" to flag problems such as "no reference object found", "ruler appears angled", or "photo taken at an oblique angle". If you cannot find the reference object, set confidence to "low" and put "no reference object found" in warning.`;
    const ai = await visionJSON(photoPath, prompt, { maxTokens: 400 });
    cleanup();
    if (!ai) return res.status(200).json({ ok: false, error: 'measurement_unavailable' });
    // normalize
    const num = (v) => (v == null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
    const shape = ['rectangle', 'circle', 'irregular'].includes(ai.shape) ? ai.shape : 'irregular';
    const confidence = ['high', 'medium', 'low'].includes(ai.confidence) ? ai.confidence : 'low';
    const out = {
      ok: true,
      length_in: num(ai.length_in),
      width_in: num(ai.width_in),
      depth_in: num(ai.depth_in),
      shape,
      confidence,
      warning: (ai.warning == null || ai.warning === '') ? null : String(ai.warning),
      raw: ai,
    };
    const noRef = out.warning && /no reference/i.test(out.warning);
    if (noRef || (out.length_in == null && out.width_in == null)) {
      return res.json({ ok: true, no_reference: !!noRef, length_in: null, width_in: null, depth_in: null, shape, confidence: 'low', warning: out.warning || 'No reference object found. Re-shoot with the ruler in frame.', raw: ai });
    }
    res.json(out);
  } catch (err) {
    cleanup();
    console.error('[measure]', err);
    res.status(200).json({ ok: false, error: 'measurement_unavailable' });
  }
});

// ---- AI defect classification (Pro): classify one saved capture ----
async function classifyCapture(userId, id) {
  const row = (await pool.query(`SELECT * FROM captures WHERE id = $1 AND user_id = $2`, [id, userId])).rows[0];
  if (!row) return { error: 'not_found' };
  const local = localPhoto(row.photo_path);
  if (!local) return { error: 'no_photo' };
  const prompt =
`You are analyzing a pavement photo for an asphalt contractor. Classify the primary defect as one of: pothole, alligator_cracking, transverse_cracking, longitudinal_cracking, rutting, raveling, edge_cracking, other, none.
Rate severity as low, medium, or high using visible width, depth, and extent cues.
Respond with ONLY a JSON object, no prose, no markdown, with exactly these keys:
{"defect_type": one of the list above, "severity": "low"|"medium"|"high", "confidence": "high"|"medium"|"low", "rationale": "one sentence"}`;
  const ai = await visionJSON(local, prompt, { maxTokens: 300 });
  if (!ai) return { error: 'classify_unavailable' };
  const defect_type = DEFECT_TYPES.includes(ai.defect_type) ? ai.defect_type : 'other';
  const severity = SEVERITIES.includes(ai.severity) ? ai.severity : (defect_type === 'none' ? null : 'low');
  const confidence = ['high', 'medium', 'low'].includes(ai.confidence) ? ai.confidence : 'low';
  const upd = (await pool.query(
    `UPDATE captures SET defect_type=$1, defect_severity=$2, defect_confidence=$3, defect_ai=$4, defect_user_confirmed=false
     WHERE id=$5 AND user_id=$6 RETURNING *`,
    [defect_type, severity, confidence, JSON.stringify(ai), id, userId])).rows[0];
  logEvent(userId, 'classify', { defect_type, severity });
  return { capture: upd };
}

app.post('/api/captures/:id/classify', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const r = await classifyCapture(req.user.id, id);
    if (r.error) return res.status(r.error === 'not_found' ? 404 : 200).json({ ok: false, error: r.error });
    res.json({ ok: true, capture: r.capture });
  } catch (err) { console.error('[classify]', err); res.status(200).json({ ok: false, error: 'classify_unavailable' }); }
});

app.post('/api/captures/classify-batch', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isInteger) : [];
    if (!ids.length) return res.status(400).json({ error: 'no ids' });
    const results = [];
    // sequential (not parallel) per spec so we never hammer the vision API
    for (const id of ids) {
      const r = await classifyCapture(req.user.id, id);
      results.push({ id, ok: !r.error, error: r.error || null, capture: r.capture || null });
    }
    res.json({ ok: true, results });
  } catch (err) { console.error('[classify-batch]', err); res.status(500).json({ error: 'batch failed' }); }
});

// Manual override of a classification. Sets defect_user_confirmed and never
// touches defect_ai (the AI's original answer is kept for accuracy analysis).
app.post('/api/captures/:id/classify-set', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const b = req.body || {};
    const defect_type = DEFECT_TYPES.includes(b.defect_type) ? b.defect_type : null;
    if (!defect_type) return res.status(400).json({ error: 'bad defect_type' });
    const severity = defect_type === 'none' ? null : (SEVERITIES.includes(b.severity) ? b.severity : 'low');
    const upd = (await pool.query(
      `UPDATE captures SET defect_type=$1, defect_severity=$2, defect_user_confirmed=true
       WHERE id=$3 AND user_id=$4 RETURNING *`, [defect_type, severity, id, req.user.id])).rows[0];
    if (!upd) return res.status(404).json({ error: 'not found' });
    logEvent(req.user.id, 'classify_override', { defect_type, severity });
    res.json({ ok: true, capture: upd });
  } catch (err) { console.error('[classify-set]', err); res.status(500).json({ error: 'override failed' }); }
});

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
    if (b.overlays !== undefined) {
      const ov = Array.isArray(b.overlays) ? b.overlays.slice(0, 20) : null; // cap to keep JSON small
      vals.push(ov ? JSON.stringify(ov) : null); sets.push(`overlays = $${vals.length}`);
    }
    const hasDims = ['dim_length','dim_length_unit','dim_width','dim_width_unit','dim_depth','dim_shape','dim_area_sqft','dim_source'].some(k => Object.prototype.hasOwnProperty.call(b, k));
    if (hasDims) {
      if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
      const lenUnit = b.dim_length_unit === 'in' ? 'in' : 'ft';
      const widUnit = b.dim_width_unit === 'in' ? 'in' : 'ft';
      const lenIn = toInches(b.dim_length, lenUnit);
      const widIn = toInches(b.dim_width, widUnit);
      const depth = b.dim_depth !== '' && b.dim_depth != null && Number.isFinite(Number(b.dim_depth)) ? Number(b.dim_depth) : null;
      const shape = ['rectangle','circle','irregular'].includes(b.dim_shape) ? b.dim_shape : 'rectangle';
      const override = b.dim_area_sqft !== '' && b.dim_area_sqft != null && Number.isFinite(Number(b.dim_area_sqft)) ? Number(b.dim_area_sqft) : null;
      const area = override != null ? override : computeAreaSqft(lenIn, widIn, shape);
      const source = ['photo_ai','voice','manual'].includes(b.dim_source) ? b.dim_source : 'manual';
      const confidence = ['high','medium','low'].includes(b.dim_confidence) ? b.dim_confidence : null;
      let ai = null; if (b.dim_ai) { try { ai = typeof b.dim_ai === 'string' ? JSON.parse(b.dim_ai) : b.dim_ai; } catch (e) {} }
      const confirmed = source === 'photo_ai' && confidence === 'low' ? b.dim_confirmed === true || String(b.dim_confirmed) === 'true' : true;
      for (const [column, value] of [
        ['dim_length_in',lenIn], ['dim_length_unit',lenIn == null ? null : lenUnit],
        ['dim_width_in',widIn], ['dim_width_unit',widIn == null ? null : widUnit],
        ['dim_depth_in',depth], ['dim_shape',(lenIn != null || widIn != null || area != null) ? shape : null],
        ['dim_area_sqft',area], ['dim_source',source], ['dim_confidence',confidence],
        ['dim_ai',ai ? JSON.stringify(ai) : null], ['dim_confirmed',confirmed],
      ]) { vals.push(value); sets.push(`${column} = $${vals.length}`); }
      logEvent(req.user.id, source === 'photo_ai' ? 'measure' : 'dimensions_edit', { capture_id:id, source, confidence, confirmed });
    }
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

// ---- flattened stamped copy (overlays burned into a downloadable JPEG) ----
app.get('/api/captures/:id/stamped', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const c = (await pool.query(`SELECT * FROM captures WHERE id = $1 AND user_id = $2`, [id, req.user.id])).rows[0];
    if (!c) return res.status(404).json({ error: 'not found' });
    const local = localPhoto(c.photo_path);
    if (!local) return res.status(400).json({ error: 'no photo' });
    const r = await renderImage(local, req.query.res || 'print', 'jpeg');
    let buf = r.buffer;
    if (Array.isArray(c.overlays) && c.overlays.length) {
      const m = await sharp(buf).metadata();
      buf = await burnOverlays(buf, m.width, m.height, c.overlays, c);
    }
    logEvent(req.user.id, 'stamp_export', { items: (c.overlays || []).length });
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `attachment; filename="photo-${id}-stamped.jpg"`);
    res.send(buf);
  } catch (err) { console.error('[stamped]', err); if (!res.headersSent) res.status(500).json({ error: 'stamp failed' }); }
});

// ---- rotate a capture's photo (own only) ----
app.post('/api/captures/:id/rotate', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const requested = req.body && req.body.dir;
    const dir = requested === 'ccw' ? 'ccw' : requested === 'flip' ? 'flip' : 'cw';
    const row = (await pool.query(`SELECT photo_path FROM captures WHERE id = $1 AND user_id = $2`, [id, req.user.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    const p = localPhoto(row.photo_path);
    if (!p) return res.status(400).json({ error: 'no photo file to rotate' });
    const ext = path.extname(p).toLowerCase();
    const angle = dir === 'ccw' ? 270 : 90;
    const buf = fs.readFileSync(p);
    const oriented = await sharp(buf).rotate().toBuffer();
    const s = dir === 'flip' ? sharp(oriented).flop() : sharp(oriented).rotate(angle);
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

// ---- crop a capture's photo, keeping the original (own only) ----
// Body: { x, y, w, h } as percentages (0-100) of the CURRENTLY displayed image.
// The pristine pre-crop image is backed up to photo_original_path the first time
// a photo is cropped, so it can always be restored.
app.post('/api/captures/:id/crop', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const b = req.body || {};
    const x = Number(b.x), y = Number(b.y), w = Number(b.w), h = Number(b.h);
    if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return res.status(400).json({ error: 'bad crop rect' });
    const row = (await pool.query(`SELECT photo_path, photo_original_path FROM captures WHERE id = $1 AND user_id = $2`, [id, req.user.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    const p = localPhoto(row.photo_path);
    if (!p) return res.status(400).json({ error: 'no photo file to crop' });
    const ext = path.extname(p).toLowerCase();

    // Back up the pristine original the first time this photo is cropped.
    let originalPath = row.photo_original_path;
    if (!originalPath) {
      const base = path.basename(p, ext);
      const backupName = `${base}-orig${ext}`;
      fs.copyFileSync(p, path.join(UPLOAD_DIR, backupName));
      originalPath = `/uploads/${backupName}`;
    }

    // Bake EXIF orientation first so the crop rect matches what the user saw.
    const oriented = await sharp(fs.readFileSync(p)).rotate().toBuffer();
    const meta = await sharp(oriented).metadata();
    const W = meta.width, H = meta.height;
    let left = Math.round(x / 100 * W);
    let top = Math.round(y / 100 * H);
    let cw = Math.round(w / 100 * W);
    let ch = Math.round(h / 100 * H);
    left = Math.max(0, Math.min(W - 1, left));
    top = Math.max(0, Math.min(H - 1, top));
    cw = Math.max(1, Math.min(W - left, cw));
    ch = Math.max(1, Math.min(H - top, ch));

    const s = sharp(oriented).extract({ left, top, width: cw, height: ch });
    let out;
    if (ext === '.png') out = await s.png().toBuffer();
    else if (ext === '.webp') out = await s.webp().toBuffer();
    else out = await s.jpeg({ quality: 92 }).toBuffer();
    fs.writeFileSync(p, out);

    const d = await imageDims(p);
    await pool.query(
      `UPDATE captures SET photo_original_path = $1, photo_width = $2, photo_height = $3 WHERE id = $4 AND user_id = $5`,
      [originalPath, d ? d.w : null, d ? d.h : null, id, req.user.id]);
    logEvent(req.user.id, 'crop', {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[captures.crop]', err);
    res.status(500).json({ error: 'crop failed' });
  }
});

// ---- restore a capture's original (pre-crop) photo (own only) ----
app.post('/api/captures/:id/restore-original', requireAuth, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const row = (await pool.query(`SELECT photo_path, photo_original_path FROM captures WHERE id = $1 AND user_id = $2`, [id, req.user.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    if (!row.photo_original_path) return res.status(400).json({ error: 'no original to restore' });
    const orig = localPhoto(row.photo_original_path);
    const cur = localPhoto(row.photo_path);
    if (!orig || !cur) return res.status(400).json({ error: 'original file missing' });
    fs.copyFileSync(orig, cur);              // put the original back in place
    try { fs.unlinkSync(orig); } catch (e) {} // drop the backup; photo_path is now the original
    const d = await imageDims(cur);
    await pool.query(
      `UPDATE captures SET photo_original_path = NULL, photo_width = $1, photo_height = $2 WHERE id = $3 AND user_id = $4`,
      [d ? d.w : null, d ? d.h : null, id, req.user.id]);
    logEvent(req.user.id, 'restore_original', {});
    res.json({ ok: true });
  } catch (err) {
    console.error('[captures.restore]', err);
    res.status(500).json({ error: 'restore failed' });
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
    // Attach a condition score per group (defect data only; one extra query).
    const defs = (await pool.query(`
      SELECT gi.group_id, c.defect_type, c.defect_severity
      FROM group_items gi JOIN captures c ON c.id = gi.capture_id
      WHERE c.user_id = $1`, [req.user.id])).rows;
    const byGroup = {};
    for (const d of defs) { (byGroup[d.group_id] = byGroup[d.group_id] || []).push(d); }
    for (const g of rows) { const s = scoreCaptures(byGroup[g.id] || []); g.score = s.score; g.band = s.band; }
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
    const score = scoreCaptures(items);
    let zones = null;
    if (await currentPlan(req.user.id) === 'pro') zones = await groupZoneSummary(req.user.id, id);
    res.json({ group: g, items, score, zones });
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

// ---- before/after pairing (Pro) ----
async function ownsCaptures(userId, ids) {
  const owned = (await pool.query(`SELECT id FROM captures WHERE id = ANY($1) AND user_id = $2`, [ids, userId])).rows.map(r => r.id);
  return ids.every(id => owned.includes(id));
}
// Map of capture_id -> pair record, for the user. Used to render combined cards.
async function pairsForUser(userId) {
  return (await pool.query(`SELECT * FROM capture_pairs WHERE user_id = $1`, [userId])).rows;
}

app.get('/api/pairs', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.json([]);
    const rows = await pairsForUser(req.user.id);
    res.json(rows);
  } catch (err) { console.error('[pairs.list]', err); res.status(500).json({ error: 'failed' }); }
});

app.post('/api/pairs', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const b = req.body || {};
    const beforeId = parseInt(b.before_id, 10), afterId = parseInt(b.after_id, 10);
    if (!Number.isInteger(beforeId) || !Number.isInteger(afterId) || beforeId === afterId) return res.status(400).json({ error: 'two distinct captures required' });
    if (!(await ownsCaptures(req.user.id, [beforeId, afterId]))) return res.status(403).json({ error: 'not your captures' });
    // reject if either is already in a pair
    const existing = (await pool.query(
      `SELECT 1 FROM capture_pairs WHERE user_id=$1 AND (before_id IN ($2,$3) OR after_id IN ($2,$3)) LIMIT 1`,
      [req.user.id, beforeId, afterId])).rows;
    if (existing.length) return res.status(409).json({ error: 'one of these is already paired' });
    const row = (await pool.query(
      `INSERT INTO capture_pairs (user_id, before_id, after_id) VALUES ($1,$2,$3) RETURNING *`,
      [req.user.id, beforeId, afterId])).rows[0];
    logEvent(req.user.id, 'pair_create', {});
    res.json({ ok: true, pair: row });
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'already paired' });
    console.error('[pairs.create]', err); res.status(500).json({ error: 'pair failed' });
  }
});

app.post('/api/pairs/unpair', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const b = req.body || {};
    if (b.id != null) {
      await pool.query(`DELETE FROM capture_pairs WHERE id=$1 AND user_id=$2`, [parseInt(b.id, 10), req.user.id]);
    } else {
      const cid = parseInt(b.capture_id, 10);
      if (!Number.isInteger(cid)) return res.status(400).json({ error: 'id or capture_id required' });
      await pool.query(`DELETE FROM capture_pairs WHERE user_id=$1 AND (before_id=$2 OR after_id=$2)`, [req.user.id, cid]);
    }
    logEvent(req.user.id, 'unpair', {});
    res.json({ ok: true });
  } catch (err) { console.error('[pairs.unpair]', err); res.status(500).json({ error: 'unpair failed' }); }
});

// Proximity suggestions: unpaired captures of the user within 15 m of each other.
app.get('/api/pairs/suggestions', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.json([]);
    const caps = (await pool.query(
      `SELECT id, latitude, longitude, created_at FROM captures WHERE user_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY created_at ASC`,
      [req.user.id])).rows;
    const pairs = await pairsForUser(req.user.id);
    const paired = new Set();
    pairs.forEach(p => { paired.add(p.before_id); paired.add(p.after_id); });
    const free = caps.filter(c => !paired.has(c.id));
    const out = [];
    const used = new Set();
    for (let i = 0; i < free.length; i++) {
      if (used.has(free[i].id)) continue;
      for (let j = i + 1; j < free.length; j++) {
        if (used.has(free[j].id)) continue;
        const m = haversineMeters(free[i].latitude, free[i].longitude, free[j].latitude, free[j].longitude);
        if (m != null && m <= 15) {
          out.push({ before_id: free[i].id, after_id: free[j].id, meters: Math.round(m * 10) / 10 });
          used.add(free[i].id); used.add(free[j].id);
          break;
        }
      }
    }
    res.json(out);
  } catch (err) { console.error('[pairs.suggestions]', err); res.status(500).json({ error: 'failed' }); }
});

// ---- measurement zones (Pro) ----
app.get('/api/zones', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.json([]);
    const groupId = req.query.group ? parseInt(req.query.group, 10) : null;
    let rows;
    if (Number.isInteger(groupId)) rows = (await pool.query(`SELECT * FROM measure_zones WHERE user_id=$1 AND group_id=$2 ORDER BY created_at DESC`, [req.user.id, groupId])).rows;
    else rows = (await pool.query(`SELECT * FROM measure_zones WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id])).rows;
    res.json(rows);
  } catch (err) { console.error('[zones.list]', err); res.status(500).json({ error: 'failed' }); }
});

app.post('/api/zones', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const b = req.body || {};
    const name = b.name ? String(b.name).trim() : '';
    const zoneType = b.zone_type === 'span' ? 'span' : (b.zone_type === 'polygon' ? 'polygon' : null);
    if (!name) return res.status(400).json({ error: 'name required' });
    if (!zoneType) return res.status(400).json({ error: 'zone_type must be polygon or span' });
    const points = Array.isArray(b.points) ? b.points : null;
    if (!points) return res.status(400).json({ error: 'points required' });
    const widthFt = b.width_ft != null ? Number(b.width_ft) : null;
    const comp = computeZone(zoneType, points, widthFt);
    if (!comp.ok) return res.status(400).json({ error: comp.error });
    let groupId = b.group_id != null && b.group_id !== '' ? parseInt(b.group_id, 10) : null;
    if (groupId != null && !(await ownsGroup(groupId, req.user.id))) groupId = null;
    const row = (await pool.query(
      `INSERT INTO measure_zones (user_id, group_id, name, zone_type, points, width_ft, length_ft, area_sqft)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, groupId, name, zoneType, JSON.stringify(points), zoneType === 'span' ? widthFt : null, comp.length_ft, comp.area_sqft])).rows[0];
    logEvent(req.user.id, 'zone_create', { zone_type: zoneType, area_sqft: comp.area_sqft != null ? Math.round(comp.area_sqft) : null });
    res.json({ ok: true, zone: row });
  } catch (err) { console.error('[zones.create]', err); res.status(500).json({ error: 'create failed' }); }
});

app.post('/api/zones/:id', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' });
    const z = (await pool.query(`SELECT * FROM measure_zones WHERE id=$1 AND user_id=$2`, [id, req.user.id])).rows[0];
    if (!z) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim() : z.name;
    const points = Array.isArray(b.points) ? b.points : z.points;
    const widthFt = b.width_ft != null && b.width_ft !== '' ? Number(b.width_ft) : z.width_ft;
    const comp = computeZone(z.zone_type, points, widthFt);
    if (!comp.ok) return res.status(400).json({ error: comp.error });
    let groupId = z.group_id;
    if (b.group_id !== undefined) { groupId = (b.group_id === null || b.group_id === '') ? null : parseInt(b.group_id, 10); if (groupId != null && !(await ownsGroup(groupId, req.user.id))) groupId = null; }
    const row = (await pool.query(
      `UPDATE measure_zones SET name=$1, points=$2, width_ft=$3, length_ft=$4, area_sqft=$5, group_id=$6 WHERE id=$7 AND user_id=$8 RETURNING *`,
      [name, JSON.stringify(points), z.zone_type === 'span' ? widthFt : null, comp.length_ft, comp.area_sqft, groupId, id, req.user.id])).rows[0];
    logEvent(req.user.id, 'zone_edit', { zone_type: z.zone_type, area_sqft: comp.area_sqft != null ? Math.round(comp.area_sqft) : null });
    res.json({ ok: true, zone: row });
  } catch (err) { console.error('[zones.edit]', err); res.status(500).json({ error: 'edit failed' }); }
});

app.post('/api/zones/:id/delete', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const id = parseInt(req.params.id, 10);
    await pool.query(`DELETE FROM measure_zones WHERE id=$1 AND user_id=$2`, [id, req.user.id]);
    logEvent(req.user.id, 'zone_delete', {});
    res.json({ ok: true });
  } catch (err) { console.error('[zones.delete]', err); res.status(500).json({ error: 'delete failed' }); }
});

app.get('/api/zones/:id/defects', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const id = parseInt(req.params.id, 10);
    const z = (await pool.query(`SELECT * FROM measure_zones WHERE id=$1 AND user_id=$2`, [id, req.user.id])).rows[0];
    if (!z) return res.status(404).json({ error: 'not found' });
    const caps = (await pool.query(`SELECT id, latitude, longitude FROM captures WHERE user_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL`, [req.user.id])).rows;
    const ids = capturesInZone(z, caps);
    res.json({ ids, count: ids.length });
  } catch (err) { console.error('[zones.defects]', err); res.status(500).json({ error: 'failed' }); }
});

// Zone summary for a group: total length, area, and matched defect count.
async function groupZoneSummary(userId, groupId) {
  const zones = (await pool.query(`SELECT * FROM measure_zones WHERE user_id=$1 AND group_id=$2`, [userId, groupId])).rows;
  if (!zones.length) return { zones: 0, length_ft: 0, area_sqft: 0, defects: 0 };
  const caps = (await pool.query(`SELECT id, latitude, longitude FROM captures WHERE user_id=$1 AND latitude IS NOT NULL AND longitude IS NOT NULL`, [userId])).rows;
  let length = 0, area = 0; const matched = new Set();
  for (const z of zones) {
    if (z.length_ft) length += Number(z.length_ft);
    if (z.area_sqft) area += Number(z.area_sqft);
    capturesInZone(z, caps).forEach(id => matched.add(id));
  }
  return { zones: zones.length, length_ft: length, area_sqft: area, defects: matched.size };
}

// ---- Extra Work Record (Pro): job-site documentation of out-of-scope work ----
async function ewrProGuard(req, res) {
  if (await currentPlan(req.user.id) !== 'pro') { res.status(403).json({ error: 'pro only' }); return false; }
  return true;
}
function ewrPhotoCount(ewrId) {
  return pool.query(`SELECT COUNT(*)::int AS n FROM ewr_photos WHERE ewr_id=$1`, [ewrId]).then(r => r.rows[0].n);
}

app.post('/api/ewr', requireAuth, async (req, res) => {
  try {
    if (!(await ewrProGuard(req, res))) return;
    const b = req.body || {};
    const reason = EWR_REASONS.includes(b.reason_category) ? b.reason_category : null;
    if (!reason) return res.status(400).json({ error: 'reason_category required' });
    if (reason === 'other' && !(b.reason_other_text && String(b.reason_other_text).trim())) return res.status(400).json({ error: 'describe the "other" reason' });
    let groupId = b.group_id != null && b.group_id !== '' ? parseInt(b.group_id, 10) : null;
    if (groupId != null && !(await ownsGroup(groupId, req.user.id))) groupId = null;
    const lat = b.latitude != null && b.latitude !== '' ? parseFloat(b.latitude) : null;
    const lng = b.longitude != null && b.longitude !== '' ? parseFloat(b.longitude) : null;
    let address = b.address || null;
    if (!address && lat != null && lng != null) address = await reverseGeocode(lat, lng);
    const method = EWR_METHODS.includes(b.notification_method) ? b.notification_method : null;
    const notifiedAt = b.notified_at ? new Date(b.notified_at) : null;
    const row = (await pool.query(
      `INSERT INTO extra_work_records
        (user_id, group_id, created_by, customer, status, reason_category, reason_other_text, description_text,
         latitude, longitude, address, notified_person_name, notified_person_company, notification_method, notified_at, notification_notes)
       VALUES ($1,$2,$3,$4,'documented',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.user.id, groupId, req.user.name, b.customer || null, reason, b.reason_other_text || null, b.description_text || null,
       lat, lng, address, b.notified_person_name || null, b.notified_person_company || null, method, notifiedAt, b.notification_notes || null])).rows[0];
    logEvent(req.user.id, 'ewr_create', { reason, group: groupId });
    res.json({ ok: true, record: row });
  } catch (err) { console.error('[ewr.create]', err); res.status(500).json({ error: 'create failed' }); }
});

app.get('/api/ewr', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.json([]);
    const groupId = req.query.group ? parseInt(req.query.group, 10) : null;
    const params = [req.user.id];
    let where = 'e.user_id = $1';
    if (Number.isInteger(groupId)) { params.push(groupId); where += ` AND e.group_id = $2`; }
    const rows = (await pool.query(`
      SELECT e.*, COALESCE(p.n, 0)::int AS photo_count
      FROM extra_work_records e
      LEFT JOIN (SELECT ewr_id, COUNT(*) n FROM ewr_photos GROUP BY ewr_id) p ON p.ewr_id = e.id
      WHERE ${where} ORDER BY e.created_at DESC`, params)).rows;
    res.json(rows);
  } catch (err) { console.error('[ewr.list]', err); res.status(500).json({ error: 'failed' }); }
});

app.get('/api/ewr/:id', requireAuth, async (req, res) => {
  try {
    if (!(await ewrProGuard(req, res))) return;
    const id = parseInt(req.params.id, 10);
    const e = (await pool.query(`SELECT * FROM extra_work_records WHERE id=$1 AND user_id=$2`, [id, req.user.id])).rows[0];
    if (!e) return res.status(404).json({ error: 'not found' });
    const photos = (await pool.query(`SELECT * FROM ewr_photos WHERE ewr_id=$1 ORDER BY created_at ASC`, [id])).rows;
    let group = null;
    if (e.group_id) group = (await pool.query(`SELECT id, title, description FROM groups WHERE id=$1 AND user_id=$2`, [e.group_id, req.user.id])).rows[0] || null;
    res.json({ record: e, photos, group });
  } catch (err) { console.error('[ewr.get]', err); res.status(500).json({ error: 'failed' }); }
});

app.post('/api/ewr/:id', requireAuth, async (req, res) => {
  try {
    if (!(await ewrProGuard(req, res))) return;
    const id = parseInt(req.params.id, 10);
    const e = (await pool.query(`SELECT * FROM extra_work_records WHERE id=$1 AND user_id=$2`, [id, req.user.id])).rows[0];
    if (!e) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const sets = [], vals = [];
    const add = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };
    if (typeof b.customer === 'string') add('customer', b.customer.trim() || null);
    if (b.status !== undefined && EWR_STATUSES.includes(b.status)) add('status', b.status);
    if (b.reason_category !== undefined && EWR_REASONS.includes(b.reason_category)) add('reason_category', b.reason_category);
    if (typeof b.reason_other_text === 'string') add('reason_other_text', b.reason_other_text);
    if (typeof b.description_text === 'string') add('description_text', b.description_text);
    if (typeof b.notified_person_name === 'string') add('notified_person_name', b.notified_person_name.trim() || null);
    if (typeof b.notified_person_company === 'string') add('notified_person_company', b.notified_person_company.trim() || null);
    if (b.notification_method !== undefined) add('notification_method', EWR_METHODS.includes(b.notification_method) ? b.notification_method : null);
    if (b.notified_at !== undefined) add('notified_at', b.notified_at ? new Date(b.notified_at) : null);
    if (typeof b.notification_notes === 'string') add('notification_notes', b.notification_notes);
    if (b.group_id !== undefined) { let gid = (b.group_id === null || b.group_id === '') ? null : parseInt(b.group_id, 10); if (gid != null && !(await ownsGroup(gid, req.user.id))) gid = null; add('group_id', gid); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });
    vals.push(id); vals.push(req.user.id);
    const row = (await pool.query(`UPDATE extra_work_records SET ${sets.join(', ')}, updated_at = now() WHERE id = $${vals.length - 1} AND user_id = $${vals.length} RETURNING *`, vals)).rows[0];
    logEvent(req.user.id, 'ewr_update', { status: row.status });
    res.json({ ok: true, record: row });
  } catch (err) { console.error('[ewr.update]', err); res.status(500).json({ error: 'update failed' }); }
});

app.post('/api/ewr/:id/photo', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') { if (req.file) { try { fs.unlinkSync(req.file.path); } catch (e) {} } return res.status(403).json({ error: 'pro only' }); }
    const id = parseInt(req.params.id, 10);
    const e = (await pool.query(`SELECT id FROM extra_work_records WHERE id=$1 AND user_id=$2`, [id, req.user.id])).rows[0];
    if (!e) { if (req.file) { try { fs.unlinkSync(req.file.path); } catch (er) {} } return res.status(404).json({ error: 'not found' }); }
    if (!req.file) return res.status(400).json({ error: 'photo required' });
    const b = req.body || {};
    const lat = b.latitude != null && b.latitude !== '' ? parseFloat(b.latitude) : null;
    const lng = b.longitude != null && b.longitude !== '' ? parseFloat(b.longitude) : null;
    let pw = null, ph = null; const d = await imageDims(req.file.path); if (d) { pw = d.w; ph = d.h; }
    const row = (await pool.query(
      `INSERT INTO ewr_photos (ewr_id, user_id, photo_path, photo_width, photo_height, caption, latitude, longitude)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, req.user.id, `/uploads/${req.file.filename}`, pw, ph, b.caption || null, lat, lng])).rows[0];
    await pool.query(`UPDATE extra_work_records SET updated_at = now() WHERE id=$1`, [id]);
    logEvent(req.user.id, 'ewr_photo', {});
    res.json({ ok: true, photo: row });
  } catch (err) { console.error('[ewr.photo]', err); res.status(500).json({ error: 'photo upload failed' }); }
});

app.post('/api/ewr/:id/photo/:pid/caption', requireAuth, async (req, res) => {
  try {
    if (!(await ewrProGuard(req, res))) return;
    const id = parseInt(req.params.id, 10), pid = parseInt(req.params.pid, 10);
    const cap = (req.body && typeof req.body.caption === 'string') ? req.body.caption : '';
    const { rowCount } = await pool.query(`UPDATE ewr_photos SET caption=$1 WHERE id=$2 AND ewr_id=$3 AND user_id=$4`, [cap || null, pid, id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) { console.error('[ewr.photo.caption]', err); res.status(500).json({ error: 'caption failed' }); }
});

app.post('/api/ewr/:id/photo/:pid/delete', requireAuth, async (req, res) => {
  try {
    if (!(await ewrProGuard(req, res))) return;
    const id = parseInt(req.params.id, 10), pid = parseInt(req.params.pid, 10);
    const row = (await pool.query(`SELECT photo_path FROM ewr_photos WHERE id=$1 AND ewr_id=$2 AND user_id=$3`, [pid, id, req.user.id])).rows[0];
    if (!row) return res.status(404).json({ error: 'not found' });
    await pool.query(`DELETE FROM ewr_photos WHERE id=$1 AND user_id=$2`, [pid, req.user.id]);
    const p = localPhoto(row.photo_path); if (p) { try { fs.unlinkSync(p); } catch (e) {} }
    res.json({ ok: true });
  } catch (err) { console.error('[ewr.photo.delete]', err); res.status(500).json({ error: 'delete failed' }); }
});

app.post('/api/ewr/:id/delete', requireAuth, async (req, res) => {
  try {
    if (!(await ewrProGuard(req, res))) return;
    const id = parseInt(req.params.id, 10);
    const photos = (await pool.query(`SELECT photo_path FROM ewr_photos WHERE ewr_id=$1 AND user_id=$2`, [id, req.user.id])).rows;
    await pool.query(`DELETE FROM extra_work_records WHERE id=$1 AND user_id=$2`, [id, req.user.id]);
    for (const p of photos) { const lp = localPhoto(p.photo_path); if (lp) { try { fs.unlinkSync(lp); } catch (e) {} } }
    logEvent(req.user.id, 'ewr_delete', {});
    res.json({ ok: true });
  } catch (err) { console.error('[ewr.delete]', err); res.status(500).json({ error: 'delete failed' }); }
});

// Professional PDF report for an Extra Work Record.
app.get('/api/ewr/:id/export', requireAuth, async (req, res) => {
  try {
    if (!(await ewrProGuard(req, res))) return;
    const id = parseInt(req.params.id, 10);
    const e = (await pool.query(`SELECT * FROM extra_work_records WHERE id=$1 AND user_id=$2`, [id, req.user.id])).rows[0];
    if (!e) return res.status(404).json({ error: 'not found' });
    const photos = (await pool.query(`SELECT * FROM ewr_photos WHERE ewr_id=$1 ORDER BY created_at ASC`, [id])).rows;
    let group = null;
    if (e.group_id) group = (await pool.query(`SELECT title, description FROM groups WHERE id=$1`, [e.group_id])).rows[0] || null;
    const imgRes = req.query.res || 'standard';
    const imgFmt = req.query.fmt || 'jpeg';
    logEvent(req.user.id, 'ewr_export', { photos: photos.length, status: e.status });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="extra-work-record-${id}.pdf"`);
    const pdf = new PDFDocument({ size: 'LETTER', margin: 48 });
    pdf.pipe(res);
    pdf.fontSize(11).fillColor('#000').text('Photo Notes — Asphalt Pro');
    pdf.moveDown(0.2);
    pdf.fontSize(20).fillColor('#000').text('Extra Work Record', { align: 'left' });
    pdf.fontSize(11).fillColor('#000').text(`Record No: EWR-${String(id).padStart(4, '0')}`);
    pdf.moveDown(0.5);
    const line = (label, val) => { if (val == null || val === '') return; pdf.fontSize(12).fillColor('#000').text(`${label}: ${val}`); };
    line('Job', group ? (group.title || '') : '');
    line('Customer / client', e.customer);
    line('Job address', e.address);
    line('Created', fmtWhen(e.created_at));
    line('Created by', e.created_by);
    line('Status', ewrStatusLabel(e.status));
    line('Reason', ewrReasonLabel(e.reason_category) + (e.reason_category === 'other' && e.reason_other_text ? `: ${e.reason_other_text}` : ''));
    if (e.latitude != null && e.longitude != null) line('GPS', `${Number(e.latitude).toFixed(5)}, ${Number(e.longitude).toFixed(5)}`);
    pdf.moveDown(0.5);
    pdf.fontSize(13).fillColor('#000').text('Description of condition / added work');
    pdf.fontSize(12).fillColor('#000').text(e.description_text || '(none provided)');
    if (e.notified_person_name || e.notification_method || e.notification_notes) {
      pdf.moveDown(0.5);
      pdf.fontSize(13).fillColor('#000').text('Notification');
      line('Notified', [e.notified_person_name, e.notified_person_company].filter(Boolean).join(', '));
      line('Method', ewrMethodLabel(e.notification_method));
      if (e.notified_at) line('When', fmtWhen(e.notified_at));
      line('Notes', e.notification_notes);
    }
    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      pdf.addPage();
      const img = localPhoto(p.photo_path);
      if (img) { const r = await renderForEmbed(img, imgRes, imgFmt); if (r) { try { pdf.image(r.buffer, { fit: [480, 340], align: 'center' }); pdf.moveDown(0.4); } catch (er) {} } }
      pdf.fontSize(12).fillColor('#000').text(`Photo ${i + 1}${p.caption ? ': ' + p.caption : ''}`);
      pdf.fontSize(10).fillColor('#000').text(fmtWhen(p.created_at) + (p.latitude != null ? `   GPS ${Number(p.latitude).toFixed(5)}, ${Number(p.longitude).toFixed(5)}` : ''));
    }
    pdf.moveDown(1);
    pdf.fontSize(9).fillColor('#000').text(EWR_DISCLAIMER, 48, pdf.y, { width: 515 });
    pdf.end();
  } catch (err) { console.error('[ewr.export]', err); if (!res.headersSent) res.status(500).json({ error: 'export failed' }); }
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
// Dimensions for exports: shown unless they are a low-confidence photo estimate
// the user has not yet confirmed (dim_confirmed = false).
function exportDims(c) { if (c && c.dim_confirmed === false) return ''; return fmtDims(c); }

// Group export rows into render units: a single capture, or a before/after pair
// when both members are present in the row set. Order follows the row order.
function buildRenderUnits(rows, pairs) {
  const byId = {}; rows.forEach(r => { byId[r.id] = r; });
  const beforeOf = {}, afterOf = {};
  (pairs || []).forEach(p => { beforeOf[p.before_id] = p; afterOf[p.after_id] = p; });
  const consumed = new Set();
  const units = [];
  for (const r of rows) {
    if (consumed.has(r.id)) continue;
    const asBefore = beforeOf[r.id];
    if (asBefore && byId[asBefore.after_id] && !consumed.has(asBefore.after_id)) {
      units.push({ pair: { before: r, after: byId[asBefore.after_id] } });
      consumed.add(r.id); consumed.add(asBefore.after_id); continue;
    }
    const asAfter = afterOf[r.id];
    if (asAfter && byId[asAfter.before_id] && !consumed.has(asAfter.before_id)) {
      units.push({ pair: { before: byId[asAfter.before_id], after: r } });
      consumed.add(r.id); consumed.add(asAfter.before_id); continue;
    }
    units.push({ single: r });
    consumed.add(r.id);
  }
  return units;
}
async function userPairs(userId) {
  try { return (await pool.query(`SELECT * FROM capture_pairs WHERE user_id = $1`, [userId])).rows; }
  catch (e) { return []; }
}

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

// ===================== Photo overlays / stamps =====================
function escXml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
const OVERLAY_FONTS = {
  sans: 'Liberation Sans, Arial, Helvetica, sans-serif',
  serif: 'Liberation Serif, Georgia, Times New Roman, serif',
  mono: 'Liberation Mono, Courier New, monospace',
  heavy: 'Liberation Sans, Arial Black, sans-serif',
};
// Resolve the text for one overlay item from the capture's live data.
function overlayItemText(item, c) {
  switch (item.t) {
    case 'datetime': return fmtWhen(c.created_at);
    case 'address': return c.address || '';
    case 'gps': return (c.latitude != null && c.longitude != null) ? `${Number(c.latitude).toFixed(5)}, ${Number(c.longitude).toFixed(5)}` : '';
    case 'topic': return (c.area_tags || []).join(', ');
    case 'dims': return fmtDims(c);
    case 'defect': return fmtDefect(c);
    case 'copyright': return item.text || `© ${new Date().getFullYear()}`;
    default: return item.text || '';
  }
}
// Burn overlays onto an image buffer of known pixel size via an SVG composite.
async function burnOverlays(buffer, width, height, overlays, c) {
  if (!Array.isArray(overlays) || !overlays.length || !width || !height) return buffer;
  const parts = [];
  for (const it of overlays) {
    // Rectangle / box annotation: stroked outline, no fill. Geometry and line
    // thickness are stored as percentages so they map 1:1 to the editor preview.
    if (it.t === 'rect') {
      const rx = Math.round((Number(it.x) || 0) / 100 * width);
      const ry = Math.round((Number(it.y) || 0) / 100 * height);
      const rw = Math.max(1, Math.round((Number(it.w) || 10) / 100 * width));
      const rh = Math.max(1, Math.round((Number(it.h) || 10) / 100 * height));
      const rcol = /^#[0-9a-fA-F]{3,8}$/.test(it.color || '') ? it.color : '#ff0000';
      const sw = Math.max(1, Math.round((Number(it.thickness) || 0.6) / 100 * width));
      parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="${rcol}" stroke-width="${sw}"/>`);
      continue;
    }
    const text = overlayItemText(it, c);
    if (!text) continue;
    const fs = Math.max(9, Math.round((Number(it.size) || 4) / 100 * height)); // size = % of height
    const x = Math.round((Number(it.x) || 3) / 100 * width);
    const y = Math.round((Number(it.y) || 90) / 100 * height) + fs; // y% is the item top; add fs for baseline
    const fill = /^#[0-9a-fA-F]{3,8}$/.test(it.color || '') ? it.color : '#ffffff';
    const font = OVERLAY_FONTS[it.font] || OVERLAY_FONTS.sans;
    const weight = it.font === 'heavy' ? '800' : 'normal';
    const stroke = it.outline ? ` stroke="#000000" stroke-width="${Math.max(1, Math.round(fs * 0.09))}" paint-order="stroke"` : '';
    parts.push(`<text x="${x}" y="${y}" font-family="${font}" font-size="${fs}" font-weight="${weight}" fill="${fill}"${stroke} xml:space="preserve">${escXml(text)}</text>`);
  }
  if (!parts.length) return buffer;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join('')}</svg>`;
  try { return await sharp(buffer).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toBuffer(); }
  catch (e) { console.error('[overlays]', e && e.message); return buffer; }
}
// Render an export image and burn the capture's overlays into it (if any).
async function renderForEmbedStamped(localPath, imgRes, imgFmt, c) {
  const r = await renderForEmbed(localPath, imgRes, imgFmt);
  if (!r || !c || !Array.isArray(c.overlays) || !c.overlays.length) return r;
  try { const m = await sharp(r.buffer).metadata(); r.buffer = await burnOverlays(r.buffer, m.width, m.height, c.overlays, c); } catch (e) {}
  return r;
}
async function renderImageStamped(localPath, imgRes, imgFmt, c) {
  const r = await renderImage(localPath, imgRes, imgFmt);
  if (!r || !c || !Array.isArray(c.overlays) || !c.overlays.length) return r;
  try { const m = await sharp(r.buffer).metadata(); r.buffer = await burnOverlays(r.buffer, m.width, m.height, c.overlays, c); } catch (e) {}
  return r;
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
    const pairs = pro ? await userPairs(req.user.id) : [];
    const units = buildRenderUnits(rows, pairs);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (i > 0) doc.addPage();
      if (u.pair) {
        const { before, after } = u.pair;
        doc.fontSize(13).fillColor('#000').text(before.address || after.address || 'No location');
        doc.moveDown(0.3);
        const top = doc.y;
        doc.fontSize(11).fillColor('#000').text('BEFORE', 48, top, { width: 240 });
        doc.fontSize(11).fillColor('#000').text('AFTER', 310, top, { width: 240 });
        const imgTop = top + 16;
        const bImg = localPhoto(before.photo_path), aImg = localPhoto(after.photo_path);
        if (bImg) { const r = await renderForEmbedStamped(bImg, imgRes, imgFmt, before); if (r) { try { doc.image(r.buffer, 48, imgTop, { fit: [240, 180] }); } catch (e) {} } }
        if (aImg) { const r = await renderForEmbedStamped(aImg, imgRes, imgFmt, after); if (r) { try { doc.image(r.buffer, 310, imgTop, { fit: [240, 180] }); } catch (e) {} } }
        doc.y = imgTop + 190; doc.x = 48;
        for (const [lbl, c] of [['Before', before], ['After', after]]) {
          const df = pro ? fmtDefect(c) : ''; const dm = pro ? exportDims(c) : '';
          doc.fontSize(10).fillColor('#000').text(`${lbl}: ${(df ? df + '. ' : '')}${(dm ? dm + '. ' : '')}${c.note || '(no note)'}`, 48, doc.y, { width: 500 });
        }
        continue;
      }
      const c = u.single;
      const img = localPhoto(c.photo_path);
      if (img) {
        const r = await renderForEmbedStamped(img, imgRes, imgFmt, c);
        if (r) { try { doc.image(r.buffer, { fit: [480, 340], align: 'center' }); doc.moveDown(0.6); } catch (e) {} }
      }
      doc.fontSize(13).fillColor('#000').text((c.address || 'No location') + (c.kind === 'task' ? '   [TASK]' : ''));
      if (c.area_tags && c.area_tags.length) doc.fontSize(10).fillColor('#000').text('Area: ' + c.area_tags.join(', '));
      if (pro) { const df = fmtDefect(c); if (df) doc.fontSize(10).fillColor('#000').text('Defect: ' + df); }
      if (pro) { const dm = exportDims(c); if (dm) doc.fontSize(10).fillColor('#000').text('Dimensions: ' + dm); }
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
    const pairsD = pro ? await userPairs(req.user.id) : [];
    const unitsD = buildRenderUnits(rows, pairsD);
    const arialCell = (runs) => new TableCell({ children: runs });
    for (const u of unitsD) {
      if (u.pair) {
        const { before, after } = u.pair;
        children.push(new Paragraph({ spacing: { before: 160 }, children: [new TextRun({ text: before.address || after.address || 'No location', bold: true, color: '000000', font: 'Arial' })] }));
        const cellFor = async (lbl, c) => {
          const kids = [new Paragraph({ children: [new TextRun({ text: lbl, bold: true, color: '000000', font: 'Arial' })] })];
          const img = localPhoto(c.photo_path);
          if (img) { const r = await renderForEmbedStamped(img, imgRes, imgFmt, c); if (r) { try { kids.push(new Paragraph({ children: [new ImageRun({ type: r.ext === '.png' ? 'png' : 'jpg', data: r.buffer, transformation: { width: 250, height: 188 } })] })); } catch (e) {} } }
          const df = pro ? fmtDefect(c) : ''; const dm = pro ? exportDims(c) : '';
          if (df) kids.push(new Paragraph({ children: [new TextRun({ text: 'Defect: ' + df, color: '000000', font: 'Arial' })] }));
          if (dm) kids.push(new Paragraph({ children: [new TextRun({ text: 'Dimensions: ' + dm, color: '000000', font: 'Arial' })] }));
          kids.push(new Paragraph({ children: [new TextRun({ text: c.note || '(no note)', color: '000000', font: 'Arial' })] }));
          return arialCell(kids);
        };
        const row = new TableRow({ children: [await cellFor('BEFORE', before), await cellFor('AFTER', after)] });
        children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row] }));
        children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
        continue;
      }
      const c = u.single;
      const img = localPhoto(c.photo_path);
      if (img) {
        const r = await renderForEmbedStamped(img, imgRes, imgFmt, c);
        if (r) { try { children.push(new Paragraph({ children: [new ImageRun({ type: r.ext === '.png' ? 'png' : 'jpg', data: r.buffer, transformation: { width: 420, height: 315 } })] })); } catch (e) {} }
      }
      children.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: (c.address || 'No location') + (c.kind === 'task' ? '   [TASK]' : ''), bold: true, color: '000000', font: 'Arial' })] }));
      if (c.area_tags && c.area_tags.length) children.push(new Paragraph({ children: [new TextRun({ text: 'Area: ' + c.area_tags.join(', '), color: '000000', font: 'Arial' })] }));
      if (pro) { const df = fmtDefect(c); if (df) children.push(new Paragraph({ children: [new TextRun({ text: 'Defect: ' + df, color: '000000', font: 'Arial' })] })); }
      if (pro) { const dm = exportDims(c); if (dm) children.push(new Paragraph({ children: [new TextRun({ text: 'Dimensions: ' + dm, color: '000000', font: 'Arial' })] })); }
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
        const r = await renderImageStamped(img, imgRes, imgFmt, c);
        if (r) {
          const base = path.basename(img).replace(/\.[a-zA-Z0-9]+$/, '');
          const name = `photos/${n}_${base}${r.ext}`;
          archive.append(r.buffer, { name });
          imgRef = name;
        }
      }
      md += `## ${i + 1}. ${c.address || 'No location'}${c.kind === 'task' ? ' [TASK]' : ''}\n`;
      if (c.area_tags && c.area_tags.length) md += `Area: ${c.area_tags.join(', ')}  \n`;
      if (pro) { const df = fmtDefect(c); if (df) md += `Defect: ${df}  \n`; }
      if (pro) { const dm = exportDims(c); if (dm) md += `Dimensions: ${dm}  \n`; }
      md += `Captured: ${fmtWhen(c.created_at)}\n\n`;
      if (imgRef) md += `![photo](${imgRef})\n\n`;
      md += `${c.note || '(no note)'}\n\n`;
    }
    archive.append(md, { name: 'photonotes.md' });
    archive.finalize();
  } catch (err) { console.error('[export.bundle]', err); if (!res.headersSent) res.status(500).json({ error: 'bundle export failed' }); }
});

// ---- Proposal report (Pro, group only): PDF or Word ----
app.get('/api/export/proposal', requireAuth, async (req, res) => {
  try {
    if (await currentPlan(req.user.id) !== 'pro') return res.status(403).json({ error: 'pro only' });
    const groupId = req.query.group ? parseInt(req.query.group, 10) : null;
    if (!Number.isInteger(groupId)) return res.status(400).json({ error: 'group required' });
    const g = (await pool.query(`SELECT * FROM groups WHERE id = $1 AND user_id = $2`, [groupId, req.user.id])).rows[0];
    if (!g) return res.status(404).json({ error: 'not found' });
    const items = (await pool.query(`
      SELECT c.* FROM group_items gi JOIN captures c ON c.id = gi.capture_id
      WHERE gi.group_id = $1 AND c.user_id = $2 ORDER BY gi.position ASC, c.created_at ASC`, [groupId, req.user.id])).rows;
    const score = scoreCaptures(items);
    const { sections, summary } = buildProposal(items);
    const zones = await groupZoneSummary(req.user.id, groupId);
    const doc = (req.query.doc === 'docx') ? 'docx' : 'pdf';
    const imgRes = req.query.res || 'standard';
    const imgFmt = req.query.fmt || 'jpeg';
    const title = g.title || 'Pavement Proposal';
    const fnameBase = 'proposal-' + (slug(g.title) || 'group');
    const dateStr = new Date().toLocaleDateString();
    const scoreLine = score.score == null
      ? 'Site Condition Score: not yet scored (classify captures to generate a score)'
      : `Site Condition Score: ${score.score} (${score.band}), based on ${score.classified} of ${score.total} captures classified`;
    const coverZoneLine = (zones && zones.zones > 0)
      ? `${Math.round(zones.length_ft).toLocaleString()} ft of pavement, ${Math.round(zones.area_sqft).toLocaleString()} sq ft, ${zones.defects} documented defects.`
      : '';
    // Mill and Overlay: prefer measured zone area, else summed defect area.
    const millRow = summary.find(s => s.fix === 'Mill and Overlay');
    let millInfo = null;
    if (millRow) {
      let sqft, source;
      if (zones && zones.area_sqft > 0) { sqft = zones.area_sqft; source = 'measured from aerial'; }
      else { sqft = millRow.total; source = 'minimum, verify extent'; }
      const tons = Math.ceil(sqft * 1.5 * 145 / 12 / 2000 * 1.10 * 100) / 100;
      millInfo = { sqft, source, tons };
    }
    // Total-quantity text for a summary row, with the zone-aware mill override.
    const summaryTotalText = (row) => {
      if (row.fix === 'Mill and Overlay' && millInfo) {
        return `${millInfo.sqft.toFixed(0)} sq ft (${millInfo.source}); ${millInfo.tons.toFixed(2)} tons (1.5 in overlay assumed)`;
      }
      return fmtQtyTotal(row);
    };
    logEvent(req.user.id, 'proposal', { doc, count: items.length, scored: score.score, zones: zones ? zones.zones : 0 });

    if (doc === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fnameBase}.pdf"`);
      const pdf = new PDFDocument({ size: 'LETTER', margin: 48 });
      pdf.pipe(res);
      // cover block
      pdf.fontSize(20).fillColor('#000').text(title, { align: 'center' });
      if (g.description) { pdf.moveDown(0.3); pdf.fontSize(12).fillColor('#000').text(g.description, { align: 'center' }); }
      pdf.moveDown(0.5);
      pdf.fontSize(12).fillColor('#000').text(scoreLine, { align: 'center' });
      if (coverZoneLine) pdf.fontSize(12).fillColor('#000').text(coverZoneLine, { align: 'center' });
      pdf.fontSize(12).fillColor('#000').text('Date: ' + dateStr, { align: 'center' });
      pdf.fontSize(12).fillColor('#000').text('Prepared with Photo Notes', { align: 'center' });
      pdf.moveDown(1);
      for (let i = 0; i < sections.length; i++) {
        const { c, fix, qty } = sections[i];
        pdf.addPage();
        const img = localPhoto(c.photo_path);
        if (img) { const r = await renderForEmbedStamped(img, imgRes, imgFmt, c); if (r) { try { pdf.image(r.buffer, { fit: [480, 320], align: 'center' }); pdf.moveDown(0.5); } catch (e) {} } }
        pdf.fontSize(13).fillColor('#000').text(`${i + 1}. ${c.address || 'No location'}`);
        const df = fmtDefect(c); if (df) pdf.fontSize(12).fillColor('#000').text('Defect: ' + df);
        const dm = exportDims(c); if (dm) pdf.fontSize(12).fillColor('#000').text('Dimensions: ' + dm);
        pdf.fontSize(12).fillColor('#000').text('Recommended fix: ' + fix);
        pdf.fontSize(12).fillColor('#000').text('Estimated quantity: ' + qty.text);
      }
      // summary table
      pdf.addPage();
      pdf.fontSize(15).fillColor('#000').text('Summary of Work', { underline: false });
      pdf.moveDown(0.5);
      const cols = ['Fix Type', 'Locations', 'Total Quantity', 'Unit Price', 'Total'];
      const colX = [48, 200, 290, 420, 500];
      pdf.fontSize(11).fillColor('#000');
      cols.forEach((h, ci) => pdf.text(h, colX[ci], pdf.y, { continued: ci < cols.length - 1, width: (colX[ci + 1] || 560) - colX[ci] - 4 }));
      pdf.moveDown(0.3);
      for (const row of summary) {
        const y = pdf.y;
        pdf.text(row.fix, colX[0], y, { width: colX[1] - colX[0] - 4 });
        pdf.text(String(row.count), colX[1], y, { width: colX[2] - colX[1] - 4 });
        pdf.text(summaryTotalText(row), colX[2], y, { width: colX[3] - colX[2] - 4 });
        pdf.text('', colX[3], y, { width: colX[4] - colX[3] - 4 });
        pdf.text('', colX[4], y);
        pdf.moveDown(0.2);
      }
      pdf.moveDown(1);
      pdf.fontSize(11).fillColor('#000').text(PROPOSAL_DISCLAIMER, 48, pdf.y, { width: 515 });
      pdf.end();
      return;
    }

    // Word (docx)
    const children = [];
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: title, bold: true, color: '000000', font: 'Arial' })] }));
    if (g.description) children.push(new Paragraph({ children: [new TextRun({ text: g.description, color: '000000', font: 'Arial' })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: scoreLine, color: '000000', font: 'Arial' })] }));
    if (coverZoneLine) children.push(new Paragraph({ children: [new TextRun({ text: coverZoneLine, color: '000000', font: 'Arial' })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'Date: ' + dateStr, color: '000000', font: 'Arial' })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'Prepared with Photo Notes', color: '000000', font: 'Arial' })] }));
    children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
    for (let i = 0; i < sections.length; i++) {
      const { c, fix, qty } = sections[i];
      const img = localPhoto(c.photo_path);
      if (img) { const r = await renderForEmbedStamped(img, imgRes, imgFmt, c); if (r) { try { children.push(new Paragraph({ children: [new ImageRun({ type: r.ext === '.png' ? 'png' : 'jpg', data: r.buffer, transformation: { width: 400, height: 300 } })] })); } catch (e) {} } }
      children.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `${i + 1}. ${c.address || 'No location'}`, bold: true, color: '000000', font: 'Arial' })] }));
      const df = fmtDefect(c); if (df) children.push(new Paragraph({ children: [new TextRun({ text: 'Defect: ' + df, color: '000000', font: 'Arial' })] }));
      const dm = exportDims(c); if (dm) children.push(new Paragraph({ children: [new TextRun({ text: 'Dimensions: ' + dm, color: '000000', font: 'Arial' })] }));
      children.push(new Paragraph({ children: [new TextRun({ text: 'Recommended fix: ' + fix, color: '000000', font: 'Arial' })] }));
      children.push(new Paragraph({ children: [new TextRun({ text: 'Estimated quantity: ' + qty.text, color: '000000', font: 'Arial' })] }));
    }
    children.push(new Paragraph({ spacing: { before: 200 }, heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: 'Summary of Work', bold: true, color: '000000', font: 'Arial' })] }));
    const cell = (text, bold) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: !!bold, color: '000000', font: 'Arial' })] })] });
    const headRow = new TableRow({ children: ['Fix Type', 'Locations', 'Total Quantity', 'Unit Price', 'Total'].map(h => cell(h, true)) });
    const bodyRows = summary.map(row => new TableRow({ children: [cell(row.fix), cell(row.count), cell(summaryTotalText(row)), cell(''), cell('')] }));
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headRow, ...bodyRows] }));
    children.push(new Paragraph({ spacing: { before: 200 }, children: [new TextRun({ text: PROPOSAL_DISCLAIMER, color: '000000', font: 'Arial' })] }));
    const docx = new Document({ sections: [{ children }] });
    const buf = await Packer.toBuffer(docx);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fnameBase}.docx"`);
    res.send(buf);
  } catch (err) { console.error('[export.proposal]', err); if (!res.headersSent) res.status(500).json({ error: 'proposal export failed' }); }
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
