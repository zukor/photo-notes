const test = require('node:test'), assert = require('node:assert/strict'), sharp = require('sharp');
const G = require('../public/geo-measure.js'), S = require('../satellite-measure.js');
const lat = 29.42, lng = -98.49, dy = ft => ft / 3.280839895 / 111320, dx = ft => ft / 3.280839895 / 111320 / Math.cos(lat * Math.PI / 180);
const rect = (w, h, x0 = 0, y0 = 0) => [{ lat: lat + dy(y0), lng: lng + dx(x0) }, { lat: lat + dy(y0 + h), lng: lng + dx(x0) }, { lat: lat + dy(y0 + h), lng: lng + dx(x0 + w) }, { lat: lat + dy(y0), lng: lng + dx(x0 + w) }];

test('areas, cut-outs, streets and lines are measured in feet', () => {
  const m = G.measure({ type: 'area', points: rect(20, 40), cutouts: [rect(4, 4, 8, 18)] });
  assert.equal(m.area_sqft, 784); assert.equal(m.cutout_sqft, 16); assert.deepEqual(m.sides_ft, [40, 20, 40, 20]);
  assert.equal(G.measure({ type: 'street', points: rect(0, 500).slice(0, 2), width_ft: 28 }).area_sqft, 14000);
  assert.equal(G.measure({ type: 'line', points: rect(0, 120).slice(0, 2) }).length_ft, 120);
  assert.equal(G.measure({ type: 'street', points: rect(0, 500).slice(0, 2) }).ok, false, 'a street needs a width');
  const bow = rect(20, 20); [bow[1], bow[2]] = [bow[2], bow[1]];
  assert.match(G.measure({ type: 'area', points: bow }).error, /crosses itself/);
});

test('Square Corners makes a hand-traced rectangle and L-shape square', () => {
  const sloppy = rect(20, 40).map((p, i) => ({ lat: p.lat + dy([0.6, -0.4, 0.5, -0.7][i]), lng: p.lng + dx([-0.5, 0.6, -0.4, 0.3][i]) }));
  const fixed = G.measure({ type: 'area', points: G.squareCorners(sloppy) });
  assert.ok(Math.abs(fixed.sides_ft[0] - fixed.sides_ft[2]) < 0.05 && Math.abs(fixed.sides_ft[1] - fixed.sides_ft[3]) < 0.05, 'opposite sides equal');
  const d = Math.hypot(fixed.sides_ft[0], fixed.sides_ft[1]);
  const p = G.squareCorners(sloppy), diag = G.measure({ type: 'line', points: [p[0], p[2]] }).length_ft;
  assert.ok(Math.abs(diag - d) < 0.1, 'right angles');
  const L = [{ x: 0, y: 0 }, { x: 0, y: 30 }, { x: 10, y: 30 }, { x: 10, y: 12 }, { x: 25, y: 12 }, { x: 25, y: 0 }].map(q => ({ lat: lat + dy(q.y + (q.x % 7) * 0.05), lng: lng + dx(q.x) }));
  assert.ok(Math.abs(G.measure({ type: 'area', points: G.squareCorners(L) }).area_sqft - 480) < 3);
});

test('a tape check scales every measurement and refuses an obviously different edge', () => {
  const r = G.scaleFromTape({ type: 'area', points: rect(20, 40) }, 0, 41);
  assert.equal(r.scale, 1.025); assert.equal(G.measure({ type: 'area', points: rect(20, 40), scale: r.scale }).area_sqft, 840.5);
  assert.equal(G.scaleFromTape({ type: 'area', points: rect(20, 40) }, 0, 20).ok, false);
});

test('shapes from the browser are re-measured and limited', () => {
  const s = S.cleanShapes([{ type: 'area', name: 'Lot', points: rect(100, 200), area_sqft: 1 }], ['area']);
  assert.ok(Math.abs(s[0].measured.area_sqft - 20000) < 1, 'the client area is ignored');
  assert.throws(() => S.cleanShapes([{ type: 'street', points: rect(0, 50).slice(0, 2), width_ft: 20 }], ['area']), /not supported/);
  assert.throws(() => S.cleanShapes([{ type: 'area', points: rect(10, 10), scale: 2 }], ['area']), /tape check/);
  assert.throws(() => S.cleanShapes([], ['area']), /at least one/);
});

test('the satellite picture is drawn from map tiles with the shapes and imagery credit', async () => {
  const tile = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#3a5f3a' } }).png().toBuffer();
  const urls = [];
  const shapes = S.cleanShapes([{ type: 'area', name: 'Patio', points: rect(20, 40) }, { type: 'street', name: 'Main', points: rect(0, 200, 60).slice(0, 2), width_ft: 28 }], ['area', 'street']);
  const shot = await S.snapshot({ shapes, source: 'esri', fetchTile: async u => { urls.push(u); return tile; }, sharp });
  assert.ok(shot.imagery_zoom <= 19, 'Esri imagery level ' + shot.imagery_zoom); assert.ok(urls.every(u => u.startsWith('https://server.arcgisonline.com/')));
  const meta = await sharp(shot.buffer).metadata(); assert.equal(meta.format, 'jpeg'); assert.ok(meta.width > 200);
  await assert.rejects(S.snapshot({ shapes, fetchTile: async () => null, sharp }), /imagery unavailable/);
});
