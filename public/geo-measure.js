// Measurements on a satellite map: areas, edge lengths, line lengths and street areas from latitude and longitude points.
// Points are projected onto a flat local grid in feet, which is accurate at job-site and neighborhood scale.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoNotesGeoMeasure = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const FT_PER_M = 3.280839895, M_PER_DEG = 111320;
  const valid = p => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && Math.abs(p.lat) <= 85 && Math.abs(p.lng) <= 180;
  const clean = pts => (Array.isArray(pts) ? pts : []).filter(valid).map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  function origin(pts) { const o = { lat: 0, lng: 0 }; for (const p of pts) { o.lat += p.lat; o.lng += p.lng; } o.lat /= pts.length || 1; o.lng /= pts.length || 1; return o; }
  function toFeet(pts, o) { const k = Math.cos(o.lat * Math.PI / 180); return pts.map(p => ({ x: (p.lng - o.lng) * M_PER_DEG * k * FT_PER_M, y: (p.lat - o.lat) * M_PER_DEG * FT_PER_M })); }
  function fromFeet(xy, o) { const k = Math.cos(o.lat * Math.PI / 180); return xy.map(p => ({ lat: o.lat + p.y / FT_PER_M / M_PER_DEG, lng: o.lng + p.x / FT_PER_M / M_PER_DEG / k })); }
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  function shoelace(xy) { let s = 0; for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length]; s += a.x * b.y - b.x * a.y; } return Math.abs(s) / 2; }
  function segmentsCross(a, b, c, d) {
    const o = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
    return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b) && o(a, b, c) !== 0 && o(c, d, a) !== 0;
  }
  function selfCrosses(xy) {
    const n = xy.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n])) return true;
    }
    return false;
  }
  // A shape: { type: 'area'|'line'|'street', points, cutouts: [[points]], width_ft (street), scale (from a tape check) }.
  function measure(shape = {}) {
    const pts = clean(shape.points), scale = Number(shape.scale) > 0 ? Number(shape.scale) : 1;
    const type = ['area', 'line', 'street'].includes(shape.type) ? shape.type : 'area';
    if (type === 'area' && pts.length < 3) return { ok: false, error: 'Tap at least three corners.' };
    if (type !== 'area' && pts.length < 2) return { ok: false, error: 'Tap at least two points.' };
    const o = origin(pts), xy = toFeet(pts, o);
    const sides = []; const closed = type === 'area';
    for (let i = 0; i < xy.length - (closed ? 0 : 1); i++) sides.push(dist(xy[i], xy[(i + 1) % xy.length]) * scale);
    const length = sides.reduce((a, b) => a + b, 0);
    if (type === 'area') {
      if (selfCrosses(xy)) return { ok: false, error: 'The outline crosses itself. Move a corner so the edges do not cross.' };
      let area = shoelace(xy) * scale * scale, cutArea = 0, cutEdge = 0;
      for (const c of Array.isArray(shape.cutouts) ? shape.cutouts : []) {
        const cp = clean(c); if (cp.length < 3) continue;
        const cxy = toFeet(cp, o); cutArea += shoelace(cxy) * scale * scale;
        for (let i = 0; i < cxy.length; i++) cutEdge += dist(cxy[i], cxy[(i + 1) % cxy.length]) * scale;
      }
      area = Math.max(0, area - cutArea);
      return { ok: area > 0, type, area_sqft: round(area, 1), perimeter_ft: round(length + cutEdge, 1), sides_ft: sides.map(s => round(s, 2)), cutout_sqft: round(cutArea, 1) };
    }
    if (type === 'street') {
      const w = Number(shape.width_ft);
      if (!(w > 0)) return { ok: false, error: 'Enter the street width.' };
      return { ok: true, type, length_ft: round(length, 1), width_ft: w, area_sqft: round(length * w, 1), sides_ft: sides.map(s => round(s, 2)) };
    }
    return { ok: true, type, length_ft: round(length, 1), sides_ft: sides.map(s => round(s, 2)) };
  }
  function round(v, d) { return Math.round(v * 10 ** d) / 10 ** d; }
  // Square Corners: lines up each edge with the shape's main direction when it is within 15 degrees, so drawn
  // rectangles and L-shapes get true right angles. Edges at other angles are left alone.
  function squareCorners(points) {
    const pts = clean(points); if (pts.length < 3) return pts;
    const o = origin(pts); let xy = toFeet(pts, o);
    let best = 0, angle = 0;
    for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length], d = dist(a, b); if (d > best) { best = d; angle = Math.atan2(b.y - a.y, b.x - a.x); } }
    const c = Math.cos(-angle), s = Math.sin(-angle);
    let r = xy.map(p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
    const tol = Math.tan(15 * Math.PI / 180);
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length], dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dy) <= Math.abs(dx) * tol) { const m = (a.y + b.y) / 2; a.y = m; b.y = m; }
        else if (Math.abs(dx) <= Math.abs(dy) * tol) { const m = (a.x + b.x) / 2; a.x = m; b.x = m; }
      }
    }
    const c2 = Math.cos(angle), s2 = Math.sin(angle);
    xy = r.map(p => ({ x: p.x * c2 - p.y * s2, y: p.x * s2 + p.y * c2 }));
    return fromFeet(xy, o);
  }
  // A tape-measured side sets the scale for every shape traced on the same imagery.
  function scaleFromTape(shape, sideIndex, tapeFeet) {
    const m = measure({ ...shape, scale: 1 });
    const side = m.sides_ft && m.sides_ft[sideIndex], t = Number(tapeFeet);
    if (!(side > 0) || !(t > 0)) return { ok: false, error: 'Choose a side and enter the tape length.' };
    const k = t / side;
    if (k < 0.8 || k > 1.25) return { ok: false, scale: k, error: `The tape length is ${Math.round(Math.abs(k - 1) * 100)}% different from the map. Check that you measured the same edge.` };
    return { ok: true, scale: Math.round(k * 10000) / 10000, difference_pct: round((k - 1) * 100, 1) };
  }
  function bounds(shapes) {
    const all = []; for (const s of shapes || []) { all.push(...clean(s.points)); for (const c of s.cutouts || []) all.push(...clean(c)); }
    if (!all.length) return null;
    return { south: Math.min(...all.map(p => p.lat)), north: Math.max(...all.map(p => p.lat)), west: Math.min(...all.map(p => p.lng)), east: Math.max(...all.map(p => p.lng)) };
  }
  // Control-joint layout inside any outline given in feet. Joints run both ways, lined up with the longest edge,
  // in equal panels no wider than the spacing. Returns the joint segments and their total length.
  function jointLayoutXY(xy, spacing) {
    if (!Array.isArray(xy) || xy.length < 3 || !(spacing > 0)) return { segments: [], length_ft: 0 };
    let best = 0, angle = 0;
    for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length], d = dist(a, b); if (d > best) { best = d; angle = Math.atan2(b.y - a.y, b.x - a.x); } }
    const c = Math.cos(-angle), s = Math.sin(-angle), r = xy.map(p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c }));
    const minX = Math.min(...r.map(p => p.x)), maxX = Math.max(...r.map(p => p.x)), minY = Math.min(...r.map(p => p.y)), maxY = Math.max(...r.map(p => p.y));
    const segs = [];
    const cut = (horizontal, at) => {
      const hits = [];
      for (let i = 0; i < r.length; i++) {
        const a = r[i], b = r[(i + 1) % r.length], ka = horizontal ? a.y : a.x, kb = horizontal ? b.y : b.x;
        if ((ka <= at && kb > at) || (kb <= at && ka > at)) { const t = (at - ka) / (kb - ka); hits.push(horizontal ? a.x + t * (b.x - a.x) : a.y + t * (b.y - a.y)); }
      }
      hits.sort((p, q) => p - q);
      for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i + 1] - hits[i] > 0.5) segs.push(horizontal ? [{ x: hits[i], y: at }, { x: hits[i + 1], y: at }] : [{ x: at, y: hits[i] }, { x: at, y: hits[i + 1] }]);
    };
    const nx = Math.max(1, Math.ceil((maxX - minX) / spacing - 1e-9)), ny = Math.max(1, Math.ceil((maxY - minY) / spacing - 1e-9));
    for (let k = 1; k < nx; k++) cut(false, minX + k * (maxX - minX) / nx);
    for (let k = 1; k < ny; k++) cut(true, minY + k * (maxY - minY) / ny);
    const c2 = Math.cos(angle), s2 = Math.sin(angle), back = p => ({ x: p.x * c2 - p.y * s2, y: p.x * s2 + p.y * c2 });
    const segments = segs.map(([a, b]) => [back(a), back(b)]);
    return { segments, length_ft: round(segments.reduce((t, [a, b]) => t + dist(a, b), 0), 1), panel_ft: [round((maxX - minX) / nx, 1), round((maxY - minY) / ny, 1)] };
  }
  // Satellite outline to feet, so it can be drawn as a plan and given a joint layout.
  function toPlan(points) { const pts = clean(points); if (pts.length < 3) return null; const o = origin(pts); return toFeet(pts, o).map(p => ({ x: p.x, y: -p.y })); }
  return { measure, squareCorners, scaleFromTape, bounds, clean, jointLayoutXY, toPlan, shoelace };
});
