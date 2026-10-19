// Measure from Satellite: address search, satellite pictures of traced areas, Concrete measured areas from the map,
// and Paving satellite takeoff (parking lots, streets, curbs) by job.
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const G = require('./public/geo-measure.js');

const text = (v, max = 200) => { if (v == null) return null; const s = String(v).trim(); return s ? s.slice(0, max) : null; };
const num = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const SOURCES = { esri: 'Esri World Imagery', mapbox: 'Mapbox Satellite' };
const ATTRIBUTION = { esri: 'Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community', mapbox: 'Imagery: Mapbox, Maxar' };
// A map trace is a rough measurement until one side is checked with a tape.
const CONTINGENCY = { checked: 3, unchecked: 10 };

// Clean shapes from the browser. Measurements are always recalculated here, never taken from the client.
function cleanShapes(list, allowed) {
  if (!Array.isArray(list) || !list.length) throw Object.assign(Error('Trace at least one shape.'), { status: 400 });
  if (list.length > 100) throw Object.assign(Error('Save up to 100 shapes at a time.'), { status: 400 });
  return list.map((s, i) => {
    const type = allowed.includes(s && s.type) ? s.type : null;
    if (!type) throw Object.assign(Error(`Shape ${i + 1} is not supported here.`), { status: 400 });
    const points = G.clean(s.points).slice(0, 400), cutouts = type === 'area' ? (Array.isArray(s.cutouts) ? s.cutouts : []).slice(0, 20).map(c => G.clean(c).slice(0, 200)).filter(c => c.length >= 3) : [];
    const scale = num(s.scale) || 1;
    if (scale < 0.8 || scale > 1.25) throw Object.assign(Error('The tape check is too far from the map. Check it again.'), { status: 400 });
    const shape = { type, name: text(s.name, 120) || `${type === 'street' ? 'Street' : type === 'line' ? 'Line' : 'Area'} ${i + 1}`, points, cutouts, width_ft: type === 'street' ? num(s.width_ft) : null, scale, checked: !!s.checked };
    const m = G.measure(shape);
    if (!m.ok) throw Object.assign(Error(`${shape.name}: ${m.error || 'check the shape.'}`), { status: 400 });
    const b = G.bounds([shape]);
    if (b.north - b.south > 0.2 || b.east - b.west > 0.2) throw Object.assign(Error(`${shape.name} is larger than one project area.`), { status: 400 });
    return { ...shape, measured: m };
  });
}

// Web Mercator tile math for a satellite picture of the traced shapes.
const lon2x = (lng, z) => (lng + 180) / 360 * 256 * 2 ** z;
const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * 2 ** z; };
function tileUrl(source, z, x, y, token) {
  if (source === 'mapbox' && token) return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/${z}/${x}/${y}?access_token=${encodeURIComponent(token)}`;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
}
async function snapshot({ shapes, source = 'esri', token, fetchTile, sharp, maxPx = 1200 }) {
  const b = G.bounds(shapes); if (!b) throw Error('no shapes');
  // Choose the drawing zoom so the shapes fill most of the picture; imagery comes from the sharpest level the source
  // provides and is enlarged when the shapes are small.
  let zr = 21;
  for (; zr > 12; zr--) { const w = lon2x(b.east, zr) - lon2x(b.west, zr), h = lat2y(b.south, zr) - lat2y(b.north, zr); if (w <= maxPx * 0.7 && h <= maxPx * 0.55) break; }
  const zf = Math.min(zr, source === 'mapbox' ? 20 : 19), up = 2 ** (zr - zf);
  const sw = lon2x(b.east, zr) - lon2x(b.west, zr), sh = lat2y(b.south, zr) - lat2y(b.north, zr);
  const padX = Math.max(60, sw * 0.15, (900 - sw) / 2), padY = Math.max(60, sh * 0.15, (600 - sh) / 2);
  const X0 = lon2x(b.west, zr) - padX, Y0 = lat2y(b.north, zr) - padY, X1 = lon2x(b.east, zr) + padX, Y1 = lat2y(b.south, zr) + padY;
  const x0 = Math.floor(X0 / up), y0 = Math.floor(Y0 / up), x1 = Math.ceil(X1 / up), y1 = Math.ceil(Y1 / up);
  const tx0 = Math.floor(x0 / 256), ty0 = Math.floor(y0 / 256), tx1 = Math.floor(x1 / 256), ty1 = Math.floor(y1 / 256);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 64) throw Error('area too large for one picture');
  const composites = [];
  await Promise.all([...Array(ty1 - ty0 + 1).keys()].flatMap(j => [...Array(tx1 - tx0 + 1).keys()].map(async i => {
    const buf = await fetchTile(tileUrl(source, zf, tx0 + i, ty0 + j, token));
    if (buf) composites.push({ input: await sharp(buf).resize(256, 256).png().toBuffer(), left: i * 256, top: j * 256 });
  })));
  if (!composites.length) throw Error('imagery unavailable');
  const mosaic = await sharp({ create: { width: (tx1 - tx0 + 1) * 256, height: (ty1 - ty0 + 1) * 256, channels: 3, background: '#808080' } }).composite(composites).png().toBuffer();
  const cropW = x1 - x0, cropH = y1 - y0, W = Math.round(cropW * up), H = Math.round(cropH * up);
  let base = await sharp(mosaic).extract({ left: x0 - tx0 * 256, top: y0 - ty0 * 256, width: cropW, height: cropH }).png().toBuffer();
  if (up > 1) base = await sharp(base).resize(W, H, { kernel: 'lanczos3' }).png().toBuffer();
  const px = p => [lon2x(p.lng, zr) - x0 * up, lat2y(p.lat, zr) - y0 * up];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const path = (pts, close) => pts.map(px).map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + (close ? ' Z' : '');
  const legend = shapes.map((s, i) => { const m = s.measured; return `${i + 1}. ${s.name}: ${m.area_sqft != null ? Math.round(m.area_sqft).toLocaleString('en-US') + ' sq ft' : ''}${m.area_sqft != null && m.length_ft != null ? ', ' : ''}${m.length_ft != null ? Math.round(m.length_ft).toLocaleString('en-US') + ' ft long' : ''}${s.type === 'street' ? `, ${s.width_ft} ft wide` : ''}${s.checked ? ' (checked with a tape)' : ''}`; });
  const credit = [`${ATTRIBUTION[source] || ATTRIBUTION.esri}.`, 'Measurements from satellite imagery are approximate. Check on site.'];
  const footH = 16 + (legend.length + credit.length) * 24;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + footH}">`;
  shapes.forEach((s, i) => {
    const color = ['#ffdf00', '#00e5ff', '#ff4fd8', '#7CFC00', '#ff8c00'][i % 5];
    const mpp = 156543.03392 * Math.cos(s.points[0].lat * Math.PI / 180) / 2 ** zr;
    if (s.type === 'area') svg += `<path d="${path(s.points, true)} ${(s.cutouts || []).map(c => path(c, true)).join(' ')}" fill="${color}" fill-opacity="0.25" fill-rule="evenodd" stroke="${color}" stroke-width="4"/>`;
    else if (s.type === 'street') svg += `<path d="${path(s.points)}" fill="none" stroke="${color}" stroke-opacity="0.45" stroke-width="${Math.max(4, s.width_ft / 3.2808 / mpp).toFixed(1)}" stroke-linejoin="round"/><path d="${path(s.points)}" fill="none" stroke="#000" stroke-width="2" stroke-dasharray="8 6"/>`;
    else svg += `<path d="${path(s.points)}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
    const c = s.points.reduce((a, p) => ({ lat: a.lat + p.lat / s.points.length, lng: a.lng + p.lng / s.points.length }), { lat: 0, lng: 0 }), [cx, cy] = px(c);
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="15" fill="#fff" stroke="#000" stroke-width="2"/><text x="${cx.toFixed(1)}" y="${(cy + 6).toFixed(1)}" text-anchor="middle" font-family="Arial" font-size="17" font-weight="bold" fill="#000">${i + 1}</text>`;
  });
  svg += `<rect x="0" y="${H}" width="${W}" height="${footH}" fill="#fff"/>`;
  [...legend, ...credit].forEach((t, k) => { svg += `<text x="12" y="${H + 28 + k * 24}" font-family="Arial" font-size="${k < legend.length ? 18 : 15}" font-weight="${k < legend.length ? 'bold' : 'normal'}" fill="#000">${esc(t)}</text>`; });
  svg += '</svg>';
  const full = await sharp(base).extend({ bottom: footH, background: '#ffffff' }).png().toBuffer();
  return { buffer: await sharp(full).composite([{ input: Buffer.from(svg), left: 0, top: 0 }]).jpeg({ quality: 88 }).toBuffer(), zoom: zr, imagery_zoom: zf, width: W, height: H + footH };
}

function register(app, { pool, requireAuth, currentProduct, featureAllowed, logEvent, ownedJobId, recordCaptureHistory, sharp, uploadDir, fetchTile }) {
  const mapboxToken = () => process.env.MAPBOX_TOKEN || '';
  const getTile = fetchTile || (async url => { try { const c = new AbortController(), t = setTimeout(() => c.abort(), 8000); const r = await fetch(url, { signal: c.signal }); clearTimeout(t); return r.ok ? Buffer.from(await r.arrayBuffer()) : null; } catch { return null; } });
  const fail = (res, e, tag, msg) => { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[' + tag + ']', e); res.status(500).json({ error: msg }); };
  const edition = async userId => { const p = await currentProduct(userId); if (p === 'concrete') return 'concrete'; if (p === 'paving' && await featureAllowed(userId, 'measurements')) return 'paving'; return null; };
  const allowed = async (req, res, next) => { const e = await edition(req.user.id); if (!e) return res.status(403).json({ error: 'Measure from Satellite is part of Concrete Pro and Paving Pro.' }); req.edition = e; next(); };
  const jobOrThrow = async (userId, v) => { const id = await ownedJobId(userId, v); if (!id) throw Object.assign(Error('Choose a job.'), { status: 400 }); return id; };

  async function savePicture(req, jobId, shapes, source, title) {
    const shot = await snapshot({ shapes, source: source === 'mapbox' && mapboxToken() ? 'mapbox' : 'esri', token: mapboxToken(), fetchTile: getTile, sharp });
    const file = `sat-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(uploadDir, file), shot.buffer);
    const c = G.bounds(shapes), lat = (c.north + c.south) / 2, lng = (c.east + c.west) / 2;
    const note = `Measured from satellite: ${shapes.map(s => `${s.name} ${s.measured.area_sqft != null ? Math.round(s.measured.area_sqft).toLocaleString('en-US') + ' sq ft' : Math.round(s.measured.length_ft).toLocaleString('en-US') + ' ft'}`).join('; ')}. ${SOURCES[source] || SOURCES.esri}. Check on site.`.slice(0, 2000);
    const concrete = req.edition === 'concrete';
    const row = (await pool.query(`INSERT INTO captures (user_id,captured_by,photo_path,photo_width,photo_height,photo_title,note,kind,job_id,latitude,longitude,concrete_phase,concrete_purpose,concrete_stage,concrete_condition,concrete_severity,paving_photo_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'note',$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id, photo_path`,
      [req.user.id, req.user.name, '/uploads/' + file, shot.width, shot.height, text(title, 120) || 'Satellite Measurement', note, jobId, lat, lng,
        concrete ? 'proposal' : null, concrete ? 'proposed_area' : null, concrete ? 'existing_condition' : null, concrete ? 'not_assessed' : null, concrete ? 'none' : null, concrete ? null : 'proposal'])).rows[0];
    await recordCaptureHistory(req.user.id, row.id, 'captured', { photo: true, satellite: true, shapes: shapes.length });
    return row;
  }

  // Address search for the satellite map.
  app.get('/api/satellite/search', requireAuth, allowed, async (req, res) => {
    try {
      const q = text(req.query.q, 200); if (!q || q.length < 3) return res.json({ results: [] });
      const near = num(req.query.lat) != null && num(req.query.lng) != null ? { lat: num(req.query.lat), lng: num(req.query.lng) } : null;
      let results = [];
      if (mapboxToken()) {
        const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${encodeURIComponent(mapboxToken())}&country=us&limit=5${near ? `&proximity=${near.lng},${near.lat}` : ''}`).catch(() => null);
        if (r && r.ok) results = ((await r.json()).features || []).map(f => ({ label: f.place_name, lat: f.center[1], lng: f.center[0] }));
      }
      if (!results.length) {
        const r = await fetch(`https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=5&countryCode=USA&SingleLine=${encodeURIComponent(q)}${near ? `&location=${near.lng},${near.lat}` : ''}`).catch(() => null);
        if (r && r.ok) results = ((await r.json()).candidates || []).map(c => ({ label: c.address, lat: c.location.y, lng: c.location.x }));
      }
      res.json({ results: results.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng)).slice(0, 5) });
    } catch (e) { fail(res, e, 'satellite.search', 'Address search is unavailable. Move the map by hand.'); }
  });
  app.get('/api/satellite/config', requireAuth, allowed, (req, res) => res.json({ sources: [{ id: 'esri', label: SOURCES.esri }, ...(mapboxToken() ? [{ id: 'mapbox', label: SOURCES.mapbox }] : [])], edition: req.edition, mapbox_token: mapboxToken() || null }));

  // ---- Concrete: traced areas become measured areas ----
  app.post('/api/concrete/areas/satellite', requireAuth, allowed, async (req, res) => {
    try {
      if (req.edition !== 'concrete') return res.status(403).json({ error: 'Concrete Pro required' });
      const b = req.body || {}, job = await jobOrThrow(req.user.id, b.job_id), shapes = cleanShapes(b.shapes, ['area']);
      let picture = null;
      if (b.picture) { try { picture = await savePicture(req, job, shapes, b.source, b.picture_title); } catch (e) { console.error('[satellite.picture]', e.message); } }
      const saved = [];
      for (const s of shapes) {
        const method = s.checked ? 'map_checked' : 'map';
        const geometry = { points: s.points, cutouts: s.cutouts, scale: s.scale, source: SOURCES[b.source] ? b.source : 'esri' };
        saved.push((await pool.query(`INSERT INTO concrete_areas (user_id,job_id,capture_id,name,shape,dims,method,area_sqft,perimeter_ft,geometry) VALUES ($1,$2,$3,$4,'custom',$5,$6,$7,$8,$9) RETURNING *`,
          [req.user.id, job, picture && picture.id, s.name, JSON.stringify({ area_sqft: String(s.measured.area_sqft), perimeter_ft: String(s.measured.perimeter_ft) }), method, s.measured.area_sqft, s.measured.perimeter_ft, JSON.stringify(geometry)])).rows[0]);
      }
      logEvent(req.user.id, 'satellite_measure_save', { edition: 'concrete', shapes: shapes.length, checked: shapes.some(s => s.checked), picture: !!picture });
      res.json({ ok: true, areas: saved, picture, picture_failed: !!b.picture && !picture });
    } catch (e) { fail(res, e, 'satellite.concrete', 'The traced areas could not be saved.'); }
  });

  // ---- Paving: satellite takeoff by job ----
  async function pavingItems(userId, jobId) {
    return (await pool.query(`SELECT * FROM paving_takeoff_items WHERE user_id=$1 AND job_id=$2 AND status='saved' ORDER BY id`, [userId, jobId])).rows;
  }
  function pavingTotals(items, q) {
    const thick = num(q.thickness_in) || 2, uw = num(q.lb_sy_in) || 110, waste = num(q.waste_pct) ?? 5;
    let area = 0, adjArea = 0, lines = 0, streets = 0;
    for (const i of items) {
      const cont = (i.checked ? CONTINGENCY.checked : CONTINGENCY.unchecked) / 100;
      if (i.area_sqft) { area += Number(i.area_sqft); adjArea += Number(i.area_sqft) * (1 + cont); }
      if (i.kind === 'street') streets += Number(i.length_ft) || 0;
      if (i.kind === 'line') lines += Number(i.length_ft) || 0;
    }
    const sy = adjArea / 9, tons = sy * thick * uw / 2000;
    return { area_sqft: Math.round(area), area_sy: Math.round(area / 9), adjusted_sy: Math.ceil(sy), street_ft: Math.round(streets), line_ft: Math.round(lines), thickness_in: thick, lb_sy_in: uw, waste_pct: waste, tons: Math.ceil(tons * (1 + waste / 100)), tons_placed: Math.round(tons * 10) / 10, checked: items.length > 0 && items.every(i => i.checked) };
  }
  const pavingOnly = (req, res, next) => req.edition === 'paving' ? next() : res.status(403).json({ error: 'Paving Pro required' });
  app.get('/api/paving/takeoff', requireAuth, allowed, pavingOnly, async (req, res) => {
    try { const job = await jobOrThrow(req.user.id, req.query.job_id), items = await pavingItems(req.user.id, job); res.json({ items, totals: pavingTotals(items, req.query) }); } catch (e) { fail(res, e, 'paving.takeoff.list', 'The takeoff could not be loaded.'); }
  });
  app.post('/api/paving/takeoff', requireAuth, allowed, pavingOnly, async (req, res) => {
    try {
      const b = req.body || {}, job = await jobOrThrow(req.user.id, b.job_id), shapes = cleanShapes(b.shapes, ['area', 'street', 'line']);
      let picture = null;
      if (b.picture) { try { picture = await savePicture(req, job, shapes, b.source, b.picture_title); } catch (e) { console.error('[satellite.picture]', e.message); } }
      for (const s of shapes) {
        const m = s.measured;
        await pool.query(`INSERT INTO paving_takeoff_items (user_id,job_id,capture_id,name,kind,points,cutouts,width_ft,scale,checked,source,area_sqft,length_ft,perimeter_ft) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [req.user.id, job, picture && picture.id, s.name, s.type, JSON.stringify(s.points), JSON.stringify(s.cutouts), s.width_ft, s.scale, s.checked, SOURCES[b.source] ? b.source : 'esri', m.area_sqft ?? null, m.length_ft ?? null, m.perimeter_ft ?? null]);
      }
      logEvent(req.user.id, 'satellite_measure_save', { edition: 'paving', shapes: shapes.length, checked: shapes.some(s => s.checked), picture: !!picture });
      const items = await pavingItems(req.user.id, job);
      res.json({ ok: true, items, totals: pavingTotals(items, b), picture, picture_failed: !!b.picture && !picture });
    } catch (e) { fail(res, e, 'paving.takeoff.save', 'The takeoff could not be saved.'); }
  });
  // Removing an item keeps the record; it no longer counts in the takeoff.
  app.delete('/api/paving/takeoff/:id', requireAuth, allowed, pavingOnly, async (req, res) => {
    try { const r = await pool.query(`UPDATE paving_takeoff_items SET status='removed' WHERE id=$1 AND user_id=$2 AND status='saved' RETURNING id`, [Number(req.params.id), req.user.id]); if (!r.rowCount) return res.status(404).json({ error: 'not found' }); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: 'remove failed' }); }
  });
  app.get('/api/paving/takeoff.csv', requireAuth, allowed, pavingOnly, async (req, res) => {
    try {
      const job = await jobOrThrow(req.user.id, req.query.job_id), items = await pavingItems(req.user.id, job), t = pavingTotals(items, req.query);
      const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const rows = [['Name', 'Type', 'Square feet', 'Square yards', 'Length (ft)', 'Width (ft)', 'Checked with tape', 'Imagery']];
      for (const i of items) rows.push([i.name, i.kind, i.area_sqft, i.area_sqft ? Math.round(i.area_sqft / 9) : '', i.length_ft, i.width_ft, i.checked ? 'Yes' : 'No', SOURCES[i.source] || i.source]);
      rows.push([], ['Total paved area', '', t.area_sqft, t.area_sy], ['Area with measurement allowance (sq yd)', '', '', t.adjusted_sy], [`Asphalt at ${t.thickness_in} in, ${t.lb_sy_in} lb/sy/in, plus ${t.waste_pct}% (tons to order)`, '', '', '', t.tons], ['Curb, edge or striping lines (ft)', '', '', '', t.line_ft], ['Street centerline (ft)', '', '', '', t.street_ft]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="paving-takeoff-job-${job}.csv"`);
      res.send(rows.map(r => r.map(cell).join(',')).join('\r\n'));
    } catch (e) { fail(res, e, 'paving.takeoff.csv', 'The takeoff could not be exported.'); }
  });
}

module.exports = { register, cleanShapes, snapshot, CONTINGENCY };
