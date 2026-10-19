// Concrete Pro estimating: measured-area geometry, quantity takeoff, pricing, options and bid versus actual.
// Shared by the server (proposals, exports) and the app (live totals).
(function (root, factory) {
  const geo = typeof module === 'object' && module.exports ? require('./geo-measure.js') : root.PhotoNotesGeoMeasure;
  const api = factory(geo);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoNotesConcreteEstimate = api;
})(typeof self !== 'undefined' ? self : this, function (GEO) {
  'use strict';
  const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  const r = (v, d = 2) => v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d;
  const up = v => Math.ceil(v - 1e-9);

  // ---------- Lengths ----------
  // Accepts 18.5, 18 ft 6 in, 18' 6", 18-6, 6 in, 222 in. Returns feet.
  function parseFeet(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
    const s = String(value == null ? '' : value).trim().toLowerCase().replace(/,/g, '');
    if (!s) return null;
    let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|foot|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|inches|inch|"|'')?)?$/);
    if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
    m = s.match(/^(\d+(?:\.\d+)?)\s*(?:in|inches|inch|"|'')$/);
    if (m) return Number(m[1]) / 12;
    m = s.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (m) return Number(m[1]) + Number(m[2]) / 12;
    m = s.match(/^\d+(?:\.\d+)?$/);
    return m ? Number(s) : null;
  }
  function formatFeet(ft) {
    if (ft == null || !Number.isFinite(ft)) return '';
    let whole = Math.floor(ft), inches = Math.round((ft - whole) * 12 * 4) / 4;
    if (inches >= 12) { whole += 1; inches -= 12; }
    return inches ? `${whole} ft ${inches} in` : `${whole} ft`;
  }

  // ---------- Measured areas ----------
  const SHAPES = [
    { id: 'rect', label: 'Rectangle', fields: [['length', 'Length'], ['width', 'Width']] },
    { id: 'l', label: 'L-shape', fields: [['length', 'Overall length'], ['width', 'Overall width'], ['notch_length', 'Missing corner length'], ['notch_width', 'Missing corner width']] },
    { id: 'circle', label: 'Circle', fields: [['diameter', 'Diameter']] },
    { id: 'custom', label: 'Other shape (enter area and edge length)', fields: [] }
  ];
  // How each area was measured sets its accuracy label and the contingency added to its quantities.
  const METHODS = [
    { id: 'laser', label: 'Laser measure', confidence: 'High', contingency_pct: 0 },
    { id: 'tape', label: 'Tape measure', confidence: 'High', contingency_pct: 0 },
    { id: 'card', label: 'Measuring card photo', confidence: 'Good', contingency_pct: 2 },
    { id: 'plans', label: 'From plans', confidence: 'Good', contingency_pct: 3 },
    { id: 'photo_ref', label: 'Photo with a known length', confidence: 'Fair', contingency_pct: 10 },
    { id: 'entered', label: 'Entered without measuring', confidence: 'Fair', contingency_pct: 5 },
    { id: 'map_checked', label: 'Satellite map, checked with a tape', confidence: 'Good', contingency_pct: 3 },
    { id: 'map', label: 'Satellite map outline', confidence: 'Rough', contingency_pct: 10 }
  ];
  function geometry(a = {}) {
    const d = a.dims || {}, f = k => parseFeet(d[k]);
    let area = null, perimeter = null, length = null, width = null;
    if (a.shape === 'rect') { length = f('length'); width = f('width'); if (length > 0 && width > 0) { area = length * width; perimeter = 2 * (length + width); } }
    else if (a.shape === 'l') {
      length = f('length'); width = f('width'); const nl = f('notch_length') || 0, nw = f('notch_width') || 0;
      if (length > 0 && width > 0 && nl < length && nw < width) { area = length * width - nl * nw; perimeter = 2 * (length + width); }
    } else if (a.shape === 'circle') { const dia = f('diameter'); if (dia > 0) { area = Math.PI * dia * dia / 4; perimeter = Math.PI * dia; length = width = dia; } }
    else { area = num(d.area_sqft); perimeter = num(d.perimeter_ft); }
    let cut = 0, cutPerimeter = 0;
    for (const c of Array.isArray(a.cutouts) ? a.cutouts : []) { const ca = num(c.area_sqft) || 0, cp = num(c.perimeter_ft) || 0; if (ca > 0) cut += ca; if (cp > 0) cutPerimeter += cp; }
    if (area != null) area = Math.max(0, area - cut);
    const ok = area != null && area > 0;
    return { ok, area_sqft: ok ? r(area, 1) : null, perimeter_ft: perimeter != null ? r(perimeter + cutPerimeter, 1) : null, length_ft: length, width_ft: width };
  }

  // ---------- City presets (driveway approaches in the right-of-way) ----------
  const CITY_PRESETS = [
    { id: 'none', label: 'No city preset' },
    { id: 'kyle', label: 'Kyle, TX (driveway approach)', spec: { thickness_in: 5, psi: 3000, reinforcement: { type: 'rebar', bar: '#3', spacing_in: 18 }, base_in: 2 },
      notes: ['City of Kyle driveway approach: 5 in minimum, 3,000 psi, #3 bars at 18 in on chairs at mid-depth, 2 in sand bedding.', 'Wire mesh and fiber are not allowed in the right-of-way.', 'A center joint is required on drives wider than 12 ft.', 'Right-of-way inspection before the pour.'], permit: true },
    { id: 'westu', label: 'West University Place, TX (driveway)', spec: { thickness_in: 6, reinforcement: { type: 'rebar', bar: '#4', spacing_in: 18 }, base_in: 2 },
      notes: ['West University Place: 6 in, #4 bars at 18 in maximum on 2 in chairs.', '2 in select base (PI 7 to 20) compacted to 95%.', '3/4 in redwood expansion joints every 20 ft maximum and at curbs and hydrants.', 'Maximum driveway grade 12%.'], permit: true },
    { id: 'sanantonio', label: 'San Antonio, TX (residential driveway)', spec: { thickness_in: 5, reinforcement: { type: 'rebar', bar: '#3', spacing_in: 12 }, base_in: 2 },
      notes: ['San Antonio residential driveway (city Concrete Driveway Standards, Item 503.1): 5 in Class A concrete, #3 bars 12 in apart both ways (or 6x6 W/D5 wire mesh), over 2 in minimum flexible or cement-treated base.', 'Residential driveway width 10 to 20 ft at the property line. Slope 14% maximum.', 'Dummy joints line up with the sidewalk joints; two smooth dowel bars (3/4 in by 18 in, 18 in apart) at each expansion joint.', 'A new or widened driveway needs a Development Services permit; a new or changed curb cut also needs a right-of-way permit. The city drawing is dated 2009, so confirm it is current.'], permit: true },
    { id: 'sanantonio_com', label: 'San Antonio, TX (commercial driveway)', spec: { thickness_in: 6, reinforcement: { type: 'rebar', bar: '#4', spacing_in: 12 }, base_in: 2 },
      notes: ['San Antonio commercial driveway (city Concrete Driveway Standards, Item 503.2): 6 in Class A concrete, #4 bars 12 in apart both ways (or 6x6 W/D10 wire mesh), over 2 in minimum base.', 'Width 12 to 20 ft one way, 24 to 30 ft two way. Slope 14% maximum.', 'Development Services and right-of-way permits required. The city drawing is dated 2009, so confirm it is current.'], permit: true }
  ];

  // ---------- Specification choices ----------
  const FINISHES = [
    { id: 'broom', label: 'Broom finish', price: 'labor_place_sf' },
    { id: 'exposed', label: 'Exposed aggregate', price: 'finish_exposed_sf' },
    { id: 'colored', label: 'Colored', price: 'finish_colored_sf' },
    { id: 'stamped', label: 'Stamped', price: 'finish_stamped_sf' }
  ];
  const REINFORCEMENT = [
    { id: 'none', label: 'None' }, { id: 'rebar', label: 'Rebar grid' }, { id: 'mesh', label: 'Wire mesh' }, { id: 'fiber', label: 'Fiber' }
  ];
  const PLACEMENT = [
    { id: 'chute', label: 'Chute from the truck' }, { id: 'buggy', label: 'Buggy or wheelbarrow' }, { id: 'line', label: 'Line pump' }, { id: 'boom', label: 'Boom pump' }
  ];
  // Price list items: key, label, unit. Prices are what the company charges, including its overhead and profit.
  const PRICE_ITEMS = [
    ['concrete_cy', 'Ready-mix concrete', 'per cubic yard'], ['short_load_cy', 'Short-load fee', 'per cubic yard short of a full truck'],
    ['rebar_lf', 'Rebar, supplied and placed', 'per linear foot'], ['chair_ea', 'Rebar chairs', 'each'], ['mesh_sheet', 'Wire mesh', 'per 5 x 10 ft sheet'], ['fiber_lb', 'Fiber', 'per pound'],
    ['forms_lf', 'Forms set and stripped', 'per linear foot'], ['base_cy', 'Base material placed and compacted', 'per cubic yard'], ['vapor_sf', 'Vapor barrier', 'per square foot'],
    ['labor_place_sf', 'Place and broom finish', 'per square foot'], ['finish_exposed_sf', 'Exposed aggregate (added to broom)', 'per square foot'], ['finish_colored_sf', 'Color (added to broom)', 'per square foot'], ['finish_stamped_sf', 'Stamping (added to broom)', 'per square foot'],
    ['crack_repair_lf', 'Crack repair (rout and seal)', 'per linear foot'], ['resurface_sf', 'Resurface existing concrete', 'per square foot'],
    ['sawcut_lf', 'Saw-cut control joints', 'per linear foot'], ['isolation_lf', 'Isolation or expansion joints', 'per linear foot'], ['sealer_sf', 'Cure and seal', 'per square foot'],
    ['demo_sf', 'Remove existing concrete, unreinforced', 'per square foot'], ['demo_reinforced_sf', 'Remove existing concrete, reinforced', 'per square foot'], ['haul_ton', 'Haul-off and disposal', 'per ton'],
    ['buggy_pour', 'Buggy placement', 'per pour'], ['pump_line_pour', 'Line pump', 'per pour (minimum charge)'], ['pump_boom_pour', 'Boom pump', 'per pour (minimum charge)'],
    ['mobilization_ea', 'Mobilization', 'per trip'], ['permit_ea', 'Permit and inspections', 'per job'], ['mileage_mi', 'Delivery mileage', 'per mile past the free distance'], ['weekend_cy', 'Weekend delivery', 'per cubic yard']
  ];
  // Example prices from public 2026 sources, only where a source was found. Every company must replace them with its own.
  const EXAMPLE_PRICES = { concrete_cy: 140, short_load_cy: 43, pump_line_pour: 500, pump_boom_pour: 900, demo_sf: 3, demo_reinforced_sf: 5, vapor_sf: 0.25, mileage_mi: 9.75, weekend_cy: 8 };
  const DEFAULT_SETTINGS = { concrete_waste_pct: 10, rebar_waste_pct: 25, round_up: true, short_load_cy: 10, free_miles: 20, markup_pct: 0, chair_spacing_ft: 3, base_tons_per_cy: 1.4, concrete_tons_per_cy: 2 };
  const BAR_LB_PER_FT = { '#3': 0.376, '#4': 0.668, '#5': 1.043 };

  // ---------- Takeoff ----------
  // spec: thickness_in, reinforcement {type, bar, spacing_in, fiber_lb_cy}, base_in, vapor, joints (true for saw-cut layout),
  // isolation_lf, formless_lf, demo {sqft, thickness_in, reinforced}, placement, pours, miles, weekend, sealer, permit, mobilizations.
  function controlJointSpacing(thickness) { return Math.min(15, Math.max(4, 2.5 * thickness)); }
  // The area's outline in feet for drawing and joint layout: from the satellite trace, or from the shape and its sizes.
  function planOutline(a = {}) {
    const g = a.geometry || {};
    if (Array.isArray(g.points) && g.points.length >= 3 && GEO) { const xy = GEO.toPlan(g.points), k = Number(g.scale) || 1; return xy ? xy.map(p => ({ x: p.x * k, y: p.y * k })) : null; }
    if (g.photo && a.repair_kind !== 'crack') { const pm = photoMeasure(g.photo); if (pm.ok && pm.outline_ft) return pm.outline_ft; }
    const d = a.dims || {}, f = k => parseFeet(d[k]);
    if (a.shape === 'rect') { const L = f('length'), W = f('width'); return L > 0 && W > 0 ? [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W }, { x: 0, y: W }] : null; }
    if (a.shape === 'l') { const L = f('length'), W = f('width'), nl = f('notch_length') || 0, nw = f('notch_width') || 0; return L > 0 && W > 0 ? [{ x: 0, y: 0 }, { x: L, y: 0 }, { x: L, y: W - nw }, { x: L - nl, y: W - nw }, { x: L - nl, y: W }, { x: 0, y: W }] : null; }
    if (a.shape === 'circle') { const D = f('diameter'); if (!(D > 0)) return null; return [...Array(48).keys()].map(i => ({ x: D / 2 + D / 2 * Math.cos(i * Math.PI / 24), y: D / 2 + D / 2 * Math.sin(i * Math.PI / 24) })); }
    return null;
  }
  // A repair traced on a photo. Points and the two scale points are fractions (0 to 1) of the photo's width and height;
  // image is the photo's size in pixels; ref_ft is the real length between the two scale points.
  // kind 'replace' or 'resurface' is an outline (area); 'crack' is a line (length).
  function photoMeasure(m = {}) {
    const W = Number(m.image && m.image.w), H = Number(m.image && m.image.h), refFt = Number(m.ref_ft);
    const px = list => (Array.isArray(list) ? list : []).map(p => ({ x: Number(p && p.x), y: Number(p && p.y) })).filter(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1).map(p => ({ x: p.x * W, y: p.y * H }));
    if (!(W > 0 && H > 0)) return { ok: false, error: 'The photo size is missing.' };
    const ref = px(m.ref);
    if (ref.length !== 2 || !(refFt > 0)) return { ok: false, error: 'Set the scale: tap both ends of something with a known length and enter that length.' };
    const refPx = Math.hypot(ref[1].x - ref[0].x, ref[1].y - ref[0].y);
    if (refPx < 20) return { ok: false, error: 'The two scale points are too close together. Use a longer known length.' };
    const k = refFt / refPx, pts = px(m.points), kind = ['replace', 'resurface', 'crack'].includes(m.kind) ? m.kind : 'replace';
    const ft = pts.map(p => ({ x: p.x * k, y: p.y * k }));
    if (kind === 'crack') {
      if (ft.length < 2) return { ok: false, error: 'Tap along the crack: at least two points.' };
      let L = 0; for (let i = 1; i < ft.length; i++) L += Math.hypot(ft[i].x - ft[i - 1].x, ft[i].y - ft[i - 1].y);
      return { ok: L > 0, kind, length_ft: r(L, 1), ft_per_px: k, outline_ft: ft };
    }
    if (ft.length < 3) return { ok: false, error: 'Tap at least three corners around the damaged area.' };
    let A = 0, P = 0; for (let i = 0; i < ft.length; i++) { const a = ft[i], b = ft[(i + 1) % ft.length]; A += a.x * b.y - b.x * a.y; P += Math.hypot(b.x - a.x, b.y - a.y); }
    A = Math.abs(A) / 2;
    return { ok: A > 0, kind, area_sqft: r(A, 1), perimeter_ft: r(P, 1), ft_per_px: k, outline_ft: ft };
  }
  function jointLayout(a, thickness) { const xy = planOutline(a); return xy && GEO ? GEO.jointLayoutXY(xy, controlJointSpacing(thickness)) : null; }
  // A plan drawing of one area with its control joints dashed, for the app and the proposal.
  function planSvg(a, thickness, size = 360) {
    const xy = planOutline(a); if (!xy) return null;
    const layout = GEO ? GEO.jointLayoutXY(xy, controlJointSpacing(thickness)) : { segments: [] };
    const minX = Math.min(...xy.map(p => p.x)), maxX = Math.max(...xy.map(p => p.x)), minY = Math.min(...xy.map(p => p.y)), maxY = Math.max(...xy.map(p => p.y));
    const w = maxX - minX || 1, h = maxY - minY || 1, pad = 40, sc = (size - 2 * pad) / Math.max(w, h), W = Math.max(size, Math.round(w * sc + 2 * pad)), H = Math.round(h * sc + 2 * pad + 28);
    const P = p => `${(pad + (p.x - minX) * sc).toFixed(1)},${(pad + (p.y - minY) * sc).toFixed(1)}`;
    const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    const sp = r(controlJointSpacing(thickness), 1);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(a.name || 'Area')} plan with control joints"><rect width="${W}" height="${H}" fill="#fff"/>`
      + `<polygon points="${xy.map(P).join(' ')}" fill="#e8e8e8" stroke="#000" stroke-width="3"/>`
      + layout.segments.map(([p, q]) => `<line x1="${P(p).split(',')[0]}" y1="${P(p).split(',')[1]}" x2="${P(q).split(',')[0]}" y2="${P(q).split(',')[1]}" stroke="#000" stroke-width="2" stroke-dasharray="8 6"/>`).join('')
      + `<text x="${(pad + w * sc / 2).toFixed(1)}" y="${pad - 12}" text-anchor="middle" font-family="Arial" font-size="15" fill="#000">${esc(formatFeet(w))}</text>`
      + `<text x="${pad - 10}" y="${(pad + h * sc / 2).toFixed(1)}" text-anchor="middle" font-family="Arial" font-size="15" fill="#000" transform="rotate(-90 ${pad - 10} ${(pad + h * sc / 2).toFixed(1)})">${esc(formatFeet(h))}</text>`
      + `<text x="${pad}" y="${H - 10}" font-family="Arial" font-size="14" fill="#000">${esc(a.name || 'Area')}: dashed lines are control joints, about ${sp} ft apart.</text></svg>`;
  }
  function jointLength(a, thickness) {
    const lay = jointLayout(a, thickness); if (lay) return lay.length_ft;
    const g = geometry(a); if (!g.ok) return 0;
    const sp = controlJointSpacing(thickness);
    if ((a.shape === 'rect') && g.length_ft && g.width_ft) {
      // Whole panels no longer than the spacing; panels kept close to square.
      const nl = Math.max(1, up(g.length_ft / sp)), nw = Math.max(1, up(g.width_ft / sp));
      return (nl - 1) * g.width_ft + (nw - 1) * g.length_ft;
    }
    return Math.max(0, 2 * g.area_sqft / sp - (g.perimeter_ft || 0) / 2);
  }
  function takeoff(areas = [], spec = {}, settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings }, lines = [], warnings = [];
    const reinf = spec.reinforcement || { type: 'none' };
    let area = 0, perimeter = 0, placed = 0, contingencyArea = 0, jointLf = 0, worst = null;
    const detail = [];
    let crackLf = 0, resurfaceSf = 0, replaceDemo = [];
    for (const a of areas) {
      if (a.repair_kind === 'crack') { const lf = num(a.repair_lf); if (lf > 0) { crackLf += lf; detail.push({ id: a.id, name: a.name, repair: 'crack', length_ft: lf, method: (METHODS.find(x => x.id === a.method) || {}).label || a.method }); } continue; }
      const g = geometry(a); if (!g.ok) { warnings.push(`${a.name || 'An area'} has no valid size and is left out.`); continue; }
      if (a.repair_kind === 'resurface') { resurfaceSf += g.area_sqft; detail.push({ id: a.id, name: a.name, repair: 'resurface', area_sqft: g.area_sqft, method: (METHODS.find(x => x.id === a.method) || {}).label || a.method }); continue; }
      if (a.repair_kind === 'replace') replaceDemo.push({ sqft: g.area_sqft, thickness: num(a.thickness_in) || num(spec.thickness_in) || 4 });
      const th = num(a.thickness_in) || num(spec.thickness_in) || 4;
      let cy = g.area_sqft * th / 324;
      const e = a.edge || {}, edgeDepth = num(e.depth_in), edgeWidth = num(e.width_in);
      if (edgeDepth > th && edgeWidth > 0) { const elen = num(e.length_ft) || g.perimeter_ft || 0; cy += elen * (edgeWidth / 12) * ((edgeDepth - th) / 12) / 27; }
      const m = METHODS.find(x => x.id === a.method) || METHODS.find(x => x.id === 'entered');
      if (!worst || m.contingency_pct > worst.contingency_pct) worst = m;
      const cont = m.contingency_pct / 100;
      // A replacement patch is saw-cut out of existing concrete, so its edges need no forms.
      area += g.area_sqft; if (a.repair_kind !== 'replace') perimeter += g.perimeter_ft || 0; placed += cy * (1 + cont); contingencyArea += g.area_sqft * cont;
      if (spec.joints !== false) jointLf += jointLength(a, th);
      detail.push({ id: a.id, name: a.name, repair: a.repair_kind === 'replace' ? 'replace' : undefined, area_sqft: g.area_sqft, perimeter_ft: g.perimeter_ft, thickness_in: th, cubic_yards: r(cy), method: m.label, confidence: m.confidence, contingency_pct: m.contingency_pct });
    }
    const add = (key, label, placedQty, unit, purchaseQty, note) => lines.push({ key, label, unit, placed: r(placedQty), purchase: r(purchaseQty == null ? placedQty : purchaseQty), note: note || null });
    if (!area && (crackLf || resurfaceSf)) {
      if (crackLf) add('crack_repair_lf', 'Crack repair (rout and seal)', crackLf, 'linear feet', s.round_up ? up(crackLf) : crackLf);
      if (resurfaceSf) add('resurface_sf', 'Resurface existing concrete', resurfaceSf, 'square feet', s.round_up ? up(resurfaceSf) : resurfaceSf);
      add('mobilization_ea', 'Mobilization', num(spec.mobilizations) || 1, 'trips');
      return { ok: true, area_sqft: r(resurfaceSf, 1), perimeter_ft: 0, placed_cy: 0, purchase_cy: 0, lines, warnings, areas: detail, settings: s, confidence: null };
    }
    if (!area) return { ok: false, area_sqft: 0, lines, warnings: warnings.concat('Add at least one measured area.'), areas: detail };
    const adjArea = area + contingencyArea;
    const cyPurchase = s.round_up ? up(placed * (1 + s.concrete_waste_pct / 100)) : r(placed * (1 + s.concrete_waste_pct / 100));
    add('concrete_cy', 'Concrete', placed, 'cubic yards', cyPurchase, `Placed volume plus ${s.concrete_waste_pct}% for waste and subgrade${s.round_up ? ', rounded up to the whole yard' : ''}.`);
    const pours = Math.max(1, up(num(spec.pours) || 1)), perPour = cyPurchase / pours;
    if (perPour < s.short_load_cy) add('short_load_cy', 'Short-load fee', 0, 'cubic yards short', up((s.short_load_cy - perPour) * pours), `Each pour is about ${r(perPour, 1)} cubic yards, under a full ${s.short_load_cy}-yard truck.`);
    if (reinf.type === 'rebar') {
      const spFt = (num(reinf.spacing_in) || 18) / 12, lf = 2 * adjArea / spFt + perimeter / 2; // bars both ways: 2 x area / spacing, plus one end bar per run
      const buy = lf * (1 + s.rebar_waste_pct / 100), pieces = up(buy / 20);
      add('rebar_lf', `Rebar ${reinf.bar || '#3'} at ${num(reinf.spacing_in) || 18} in each way`, lf, 'linear feet', s.round_up ? up(buy) : buy, `${pieces} twenty-foot bars to buy (${s.rebar_waste_pct}% extra for laps and waste); about ${r(lf * (BAR_LB_PER_FT[reinf.bar] || BAR_LB_PER_FT['#3']), 0)} lb placed.`);
      add('chair_ea', 'Rebar chairs', up(adjArea / (s.chair_spacing_ft * s.chair_spacing_ft)), 'each', null, `One every ${s.chair_spacing_ft} ft each way.`);
    } else if (reinf.type === 'mesh') add('mesh_sheet', 'Wire mesh sheets (5 x 10 ft)', adjArea / 50, 'sheets', up(adjArea * 1.1 / 50), 'Includes 10% for overlaps.');
    else if (reinf.type === 'fiber') { const dose = num(reinf.fiber_lb_cy) || 1.5; add('fiber_lb', 'Fiber', placed * dose, 'pounds', up(cyPurchase * dose), `${dose} lb per cubic yard.`); }
    const formless = Math.min(perimeter, num(spec.formless_lf) || 0);
    if (perimeter - formless > 0) add('forms_lf', 'Forms', perimeter - formless, 'linear feet', null, formless ? `Edges against existing concrete or the building (${r(formless, 0)} ft) need no forms.` : null);
    const base = num(spec.base_in);
    if (base > 0) { const bcy = adjArea * base / 324; add('base_cy', `Base, ${base} in`, bcy, 'cubic yards', s.round_up ? up(bcy) : bcy, `About ${r(bcy * s.base_tons_per_cy, 1)} tons.`); }
    if (spec.vapor) add('vapor_sf', 'Vapor barrier (10 mil minimum)', adjArea, 'square feet', up(adjArea * 1.1), 'Includes 10% for overlaps.');
    add('labor_place_sf', 'Place and broom finish', adjArea, 'square feet');
    const finish = FINISHES.find(f => f.id === spec.finish);
    if (finish && finish.id !== 'broom') add(finish.price, finish.label, adjArea, 'square feet');
    if (jointLf > 0) add('sawcut_lf', 'Saw-cut control joints', jointLf, 'linear feet', null, `Spacing about ${r(controlJointSpacing(num(spec.thickness_in) || 4), 1)} ft (2.5 times the thickness in inches, 15 ft maximum).`);
    if (num(spec.isolation_lf) > 0) add('isolation_lf', 'Isolation or expansion joints', num(spec.isolation_lf), 'linear feet', null, 'Where the slab meets the building, curbs, poles or other fixed objects.');
    if (spec.sealer) add('sealer_sf', 'Cure and seal', adjArea, 'square feet');
    if (crackLf) add('crack_repair_lf', 'Crack repair (rout and seal)', crackLf, 'linear feet', s.round_up ? up(crackLf) : crackLf);
    if (resurfaceSf) add('resurface_sf', 'Resurface existing concrete', resurfaceSf, 'square feet', s.round_up ? up(resurfaceSf) : resurfaceSf);
    // Areas marked "remove and replace" include removing the damaged concrete, at the area's thickness.
    for (const d of replaceDemo) {
      const tons = d.sqft * d.thickness / 324 * s.concrete_tons_per_cy;
      add('demo_sf', `Remove damaged concrete for replacement, ${d.thickness} in`, d.sqft, 'square feet', s.round_up ? up(d.sqft) : d.sqft);
      add('haul_ton', 'Haul-off and disposal', tons, 'tons', s.round_up ? up(tons) : tons);
    }
    const demo = spec.demo || {}, dsf = num(demo.sqft);
    if (dsf > 0) {
      const dth = num(demo.thickness_in) || 4, tons = dsf * dth / 324 * s.concrete_tons_per_cy;
      add(demo.reinforced ? 'demo_reinforced_sf' : 'demo_sf', `Remove existing concrete, ${dth} in${demo.reinforced ? ', reinforced' : ''}`, dsf, 'square feet', null, dth > 4 ? 'Thicker concrete costs more to break and haul.' : null);
      add('haul_ton', 'Haul-off and disposal', tons, 'tons', s.round_up ? up(tons) : tons);
    }
    if (spec.placement === 'buggy') add('buggy_pour', 'Buggy placement', pours, 'pours');
    if (spec.placement === 'line') add('pump_line_pour', 'Line pump', pours, 'pours');
    if (spec.placement === 'boom') add('pump_boom_pour', 'Boom pump', pours, 'pours');
    add('mobilization_ea', 'Mobilization', num(spec.mobilizations) || pours, 'trips');
    if (spec.permit) add('permit_ea', 'Permit and inspections', 1, 'job');
    const miles = num(spec.miles); if (miles > s.free_miles) add('mileage_mi', 'Delivery mileage', (miles - s.free_miles) * pours, 'miles');
    if (spec.weekend) add('weekend_cy', 'Weekend delivery', cyPurchase, 'cubic yards');
    if (worst && worst.contingency_pct) warnings.push(`Quantities include ${worst.contingency_pct}% or less for areas measured by ${worst.label.toLowerCase()}. Measure with a tape or laser to remove it.`);
    return { ok: true, area_sqft: r(area, 1), perimeter_ft: r(perimeter, 1), placed_cy: r(placed), purchase_cy: cyPurchase, lines, warnings, areas: detail, settings: s, confidence: worst ? worst.confidence : null };
  }

  // ---------- Pricing and options ----------
  function price(t, prices = {}, settings = {}) {
    const s = { ...DEFAULT_SETTINGS, ...settings }; let total = 0; const missing = [], priced = [];
    for (const l of t.lines || []) {
      const unit = num(prices[l.key]);
      if (unit == null) { missing.push(l.label); priced.push({ ...l, unit_price: null, amount: null }); continue; }
      const amount = r(unit * (l.purchase ?? l.placed ?? 0)); total += amount; priced.push({ ...l, unit_price: unit, amount });
    }
    const markup = r(total * (s.markup_pct || 0) / 100);
    const grand = r(total + markup);
    return { lines: priced, subtotal: r(total), markup, total: grand, per_sqft: t.area_sqft ? r(grand / t.area_sqft) : null, missing, complete: !missing.length };
  }
  // Good/better/best: each option changes the finish and, if chosen, the reinforcement.
  function priceOptions(areas, spec, options, prices, settings) {
    const list = Array.isArray(options) && options.length ? options : [{ name: 'Proposal', finish: spec.finish || 'broom' }];
    return list.map(o => {
      const s2 = { ...spec, finish: o.finish || spec.finish, reinforcement: o.reinforcement && o.reinforcement.type ? o.reinforcement : spec.reinforcement, sealer: o.sealer != null ? !!o.sealer : spec.sealer };
      const t = takeoff(areas, s2, settings), p = price(t, prices, settings);
      return { name: o.name || 'Option', description: describe(s2), takeoff: t, pricing: p };
    });
  }
  function describe(spec) {
    const re = spec.reinforcement || {}, f = FINISHES.find(x => x.id === spec.finish) || FINISHES[0];
    const reinf = re.type === 'rebar' ? `${re.bar || '#3'} rebar at ${num(re.spacing_in) || 18} in each way` : re.type === 'mesh' ? 'wire mesh' : re.type === 'fiber' ? 'fiber reinforcement' : 'no reinforcement';
    return [`${num(spec.thickness_in) || 4} in concrete${num(spec.psi) ? ', ' + num(spec.psi).toLocaleString('en-US') + ' psi' : ''}`, reinf, f.label.toLowerCase(), num(spec.base_in) ? `${num(spec.base_in)} in base` : null, spec.sealer ? 'cure and seal' : null].filter(Boolean).join(', ');
  }

  // ---------- Site-visit checklist ----------
  const CHECKLIST = [
    { key: 'access', label: 'Truck and pump access', hint: 'Driveway width, gates, overhead lines, weight limits. Photograph the route.', photo: true },
    { key: 'distance', label: 'Distance from the truck to the pour', hint: 'Decides chute, buggy or pump.', photo: false },
    { key: 'drainage', label: 'Slope and drainage', hint: 'Which way water runs now and after the pour. Water must not be sent toward neighbors.', photo: true },
    { key: 'existing', label: 'Existing concrete', hint: 'Thickness, reinforced or not, condition. Photograph cracks and damage to protect against later claims.', photo: true },
    { key: 'trees', label: 'Trees and roots', hint: 'Roots under or next to the slab.', photo: true },
    { key: 'utilities', label: 'Utilities and 811 locate', hint: 'Meters, cleanouts, sprinkler lines; call 811 before digging.', photo: true },
    { key: 'soil', label: 'Soil signs', hint: 'Clay cracking, standing water, soft spots or fill.', photo: true },
    { key: 'row', label: 'Curb cut or right-of-way work', hint: 'Work at the street needs a city permit.', photo: true },
    { key: 'staging', label: 'Staging, water and power', hint: 'Where materials go; hose bib and outlet available.', photo: false }
  ];
  function checklistStatus(checklist = {}) {
    const done = CHECKLIST.filter(i => checklist[i.key] && String(checklist[i.key].answer || '').trim()).length;
    const photosMissing = CHECKLIST.filter(i => i.photo && !(checklist[i.key] && (checklist[i.key].photos || []).length)).map(i => i.label);
    return { answered: done, total: CHECKLIST.length, photos_missing: photosMissing };
  }

  // ---------- Bid versus actual ----------
  function compareActual(estimatePlaced, estimatePurchase, actualYards) {
    const a = num(actualYards), p = num(estimatePlaced), b = num(estimatePurchase);
    if (!(a > 0) || !(p > 0)) return { status: 'no_data', message: 'No saved batch tickets for this job yet.' };
    const waste = (a / p - 1) * 100, vsBid = b > 0 ? (a / b - 1) * 100 : null;
    return { status: a > (b || p) ? 'over' : 'within', actual_cy: r(a), placed_cy: r(p), purchase_cy: r(b), actual_waste_pct: r(waste, 1), vs_bid_pct: r(vsBid, 1),
      message: `${r(a)} cubic yards delivered against ${r(p)} planned placed (${r(waste, 1)}% over placed)${b ? ` and ${r(b)} in the bid` : ''}.` };
  }
  function suggestedWaste(results = []) {
    const vals = results.map(x => num(x.actual_waste_pct)).filter(v => v != null && v > -20 && v < 60);
    if (vals.length < 3) return null;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return { jobs: vals.length, average_waste_pct: r(avg, 1), suggested_pct: Math.max(0, up(avg)) };
  }

  return { parseFeet, formatFeet, SHAPES, METHODS, geometry, photoMeasure, planOutline, jointLayout, planSvg, CITY_PRESETS, FINISHES, REINFORCEMENT, PLACEMENT, PRICE_ITEMS, EXAMPLE_PRICES, DEFAULT_SETTINGS, controlJointSpacing, jointLength, takeoff, price, priceOptions, describe, CHECKLIST, checklistStatus, compareActual, suggestedWaste };
});
