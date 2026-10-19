#!/usr/bin/env node
/* Precision Measure accuracy check on synthetic photos.
   Renders a printed measuring card and a pothole of exactly known size on pavement, photographed by a
   simulated phone camera (main lens, 12 MP-class resolution) at different heights and angles, then measures
   them with the same engine the phone runs. Reports accuracy for length, width and area.
   This checks the geometry and image processing. It does not include a person's outline, lens
   distortion left after the phone's own correction, or printing errors; the field test covers those. */
'use strict';
const E = require('../public/precision-measure-engine.js');
const { AR } = require('js-aruco2/src/aruco.js');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// The card: a black square of side S (mm) carrying marker 7, inside a white quiet zone of S/8.
const dict = new AR.Dictionary(E.CARD_DICTIONARY);
const svg = dict.generateSVG(E.CARD_MARKER_ID);
const cells = []; // 10 x 10 units: 1 unit white border, 8 x 8 marker (outer ring black)
for (let i = 0; i < 10; i++) cells.push(new Array(10).fill(255));
for (const m of svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="(\w+)"\/>/g)) {
  const [x, y, w, h, fill] = [+m[1], +m[2], +m[3], +m[4], m[5]];
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) cells[yy][xx] = fill === 'black' ? 15 : 245;
}

function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function potholePolygon(cx, cy, rx, ry, rand) {
  const pts = [];
  for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2, r = 0.8 + 0.35 * rand(); pts.push({ x: cx + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r }); }
  return pts;
}
function planeColor(x, y, S, poly, texture) {
  const q = S / 8, u = (x + q) / (S + 2 * q) * 10, v = (y + q) / (S + 2 * q) * 10;
  if (u >= 0 && v >= 0 && u < 10 && v < 10) return cells[Math.floor(v)][Math.floor(u)];
  if (pointInPolygon(x, y, poly)) return 38;
  return 105 + texture(x, y);
}

// Camera looking down at the plane, tilted by `tilt` degrees about a horizontal axis at azimuth `az`.
function camera(W, Hh, hfov, heightMm, tilt, az, target) {
  const f = W / (2 * Math.tan(hfov * Math.PI / 360)), cx = W / 2, cy = Hh / 2;
  const t = tilt * Math.PI / 180, a = az * Math.PI / 180;
  // Camera axis: from the camera toward the target on the ground. Camera sits above, offset so it looks at the target.
  const dir = [Math.sin(t) * Math.cos(a), Math.sin(t) * Math.sin(a), -Math.cos(t)];
  // Card and pothole coordinates read like the printed page (y down); the world has y up, so y is flipped.
  const C = [target.x - dir[0] / -dir[2] * heightMm, -target.y - dir[1] / -dir[2] * heightMm, heightMm];
  const z = dir, up = [0, -1, 0];
  let x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  const nx = Math.hypot(...x); x = x.map(v => v / nx);
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const R = [x, y, z];                       // rows: world to camera
  const tvec = R.map(r => -(r[0] * C[0] + r[1] * C[1] + r[2] * C[2]));
  // Homography plane (X, Y, 0) to image: K [r1 r2 t]
  const M = [R[0][0], R[0][1], tvec[0], R[1][0], R[1][1], tvec[1], R[2][0], R[2][1], tvec[2]];
  const K = [f, 0, cx, 0, f, cy, 0, 0, 1];
  return { H: E.multiply(E.multiply(K, M), [1, 0, 0, 0, -1, 0, 0, 0, 1]), f, cx, cy };
}

function render(W, Hh, Hpi, S, poly, rand) {
  const Hip = E.invert(Hpi), rgba = new Uint8ClampedArray(W * Hh * 4);
  const texture = (x, y) => 18 * Math.sin(x * 0.11) * Math.cos(y * 0.07) + 10 * Math.sin((x + y) * 0.53);
  for (let py = 0; py < Hh; py++) for (let px = 0; px < W; px++) {
    let s = 0;
    for (const [ox, oy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) { const p = E.apply(Hip, px + ox - 0.5, py + oy - 0.5); s += planeColor(p.x, p.y, S, poly, texture); }
    const v = Math.max(0, Math.min(255, s / 4 + (rand() - 0.5) * 12)), o = (py * W + px) * 4;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255;
  }
  return rgba;
}

function trial({ W, Hh, hfov, height, tilt, az, S, seed, clickNoisePx }) {
  const rand = rng(seed);
  const poly = potholePolygon(S + 260 + rand() * 60, S / 2 + (rand() - 0.5) * 80, 230 + rand() * 120, 160 + rand() * 90, rand);
  const truth = E.measureOutline(poly);
  const target = { x: (S + poly.reduce((s, p) => s + p.x, 0) / poly.length) / 2, y: S / 2 };
  const cam = camera(W, Hh, hfov, height, tilt, az, target);
  const rgba = render(W, Hh, cam.H, S, poly, rand);
  const detector = new AR.Detector({ dictionaryName: E.CARD_DICTIONARY });
  const found = E.detectCard(detector, rgba, W, Hh);
  if (!found) return { detected: false };
  const gray = E.grayFrom(rgba, W, Hh), ref = E.refineCorners(gray, W, Hh, found);
  const homs = E.planeToImage(ref.corners, S);
  const estTilt = E.tiltDegrees(homs.planeToImage, cam.f, cam.cx, cam.cy);
  const plan = E.planRectify(homs.planeToImage, W, Hh, S, ref.corners);
  // A person outlines the true pothole edge on the overhead view, with up to clickNoisePx of hand error.
  const clicks = poly.map(p => {
    const img = E.apply(cam.H, p.x, p.y), plane = E.apply(homs.imageToPlane, img.x, img.y), o = E.planeToOverhead(plan, plane.x, plane.y);
    return E.overheadToPlane(plan, o.x + (rand() - 0.5) * 2 * clickNoisePx, o.y + (rand() - 0.5) * 2 * clickNoisePx);
  });
  const got = E.measureOutline(clicks);
  const acc = (a, b) => 100 - Math.abs(a - b) / b * 100;
  // Length and width are scored along the true rectangle's axes, so a round pothole with two nearly equal
  // bounding rectangles is not counted as an error.
  const along = (pts, ang) => { const c = Math.cos(ang), s = Math.sin(ang); const u = pts.map(p => p.x * c + p.y * s), v = pts.map(p => -p.x * s + p.y * c); const a = Math.max(...u) - Math.min(...u), b = Math.max(...v) - Math.min(...v); return { l: Math.max(a, b), w: Math.min(a, b) }; };
  const tAx = along(poly, truth.rectAngle), gAx = along(clicks, truth.rectAngle);
  got.lengthMm = gAx.l; got.widthMm = gAx.w; truth.lengthMm = tAx.l; truth.widthMm = tAx.w;
  const frame = E.assessFrame({ corners: ref.corners, width: W, height: Hh, tilt: estTilt, steady: true });
  return { detected: true, refined: ref.refined, tilt, estTilt, cardFraction: frame.cardFraction, coaching: frame.state,
    length: acc(got.lengthMm, truth.lengthMm), width: acc(got.widthMm, truth.widthMm), area: acc(got.areaMm2, truth.areaMm2) };
}

function main() {
  const quick = process.argv.includes('--quick');
  const W = quick ? 1600 : 2016, Hh = Math.round(W * 0.75), hfov = 69.4, S = 177.8; // 7-inch printed card
  const results = [];
  let seed = 11;
  for (const tilt of [0, 5, 10, 15]) for (const height of quick ? [1200, 1500] : [1000, 1200, 1500]) for (const az of quick ? [30] : [30, 160]) {
    const r = trial({ W, Hh, hfov, height, tilt, az, S, seed: seed++, clickNoisePx: 1.0 });
    results.push({ tilt, height, az, ...r });
    const fmt = v => v == null ? '-' : v.toFixed(2);
    console.log(`tilt ${String(tilt).padStart(2)}°  height ${height} mm  ${r.detected ? `est ${fmt(r.estTilt)}°  card ${(r.cardFraction * 100).toFixed(0)}%  ${r.coaching.padEnd(10)} length ${fmt(r.length)}%  width ${fmt(r.width)}%  area ${fmt(r.area)}%${r.refined ? '' : '  (not refined)'}` : 'CARD NOT FOUND'}`);
  }
  const ok = results.filter(r => r.detected), coached = ok.filter(r => r.coaching === 'ready' || r.coaching === 'tilt_ok');
  const summary = (rows, k) => rows.length ? { mean: rows.reduce((s, r) => s + r[k], 0) / rows.length, worst: Math.min(...rows.map(r => r[k])) } : null;
  const out = { trials: results.length, detected: ok.length, within_coaching_limits: coached.length,
    length: summary(coached, 'length'), width: summary(coached, 'width'), area: summary(coached, 'area'),
    tilt_estimate_error_deg: ok.length ? Math.max(...ok.map(r => Math.abs(r.estTilt - r.tilt))) : null };
  console.log(JSON.stringify(out, null, 2));
  if (process.argv.includes('--assert')) {
    if (ok.length !== results.length) throw Error('card not detected in every synthetic photo');
    if (out.length.worst < 98.5 || out.width.worst < 98.5 || out.area.worst < 97) throw Error('synthetic accuracy below target');
  }
  return out;
}
if (require.main === module) main();
module.exports = { trial, main, camera, render, potholePolygon, rng };
