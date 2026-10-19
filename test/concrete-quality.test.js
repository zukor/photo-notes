const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const Q = require('../public/concrete-quality-rules.js'), C = require('../concrete-quality.js'), L = require('../public/photo-location.js');

test('clock times read in 24-hour and AM/PM forms, across midnight', () => {
  assert.equal(Q.clockMinutes('14:05'), 845); assert.equal(Q.clockMinutes('2:05 PM'), 845); assert.equal(Q.clockMinutes('12:10 AM'), 10); assert.equal(Q.clockMinutes('1405'), 845);
  assert.equal(Q.minutesBetween('23:30', '00:45'), 75); assert.equal(Q.clockMinutes('25:00'), null);
});

test('a load over 90 minutes, with extra water, or too hot is flagged', () => {
  assert.equal(Q.ticketChecks({ batch_time: '7:00', discharge_end: '8:15' }).status, 'ok');
  const late = Q.ticketChecks({ batch_time: '7:00 AM', arrival_time: '8:10 AM', discharge_end: '8:42 AM' });
  assert.equal(late.minutes, 102); assert.equal(late.measured_to, 'end of discharge'); assert.match(late.flags[0].message, /over the 90-minute limit/);
  assert.equal(Q.ticketChecks({ batch_time: '7:00', arrival_time: '7:50' }).measured_to, 'arrival', 'arrival is used when discharge is not recorded');
  assert.equal(Q.ticketChecks({ water_allowed_gal: 10, water_added_gal: 15 }).flags[0].key, 'water');
  assert.equal(Q.ticketChecks({ concrete_temp_f: 98 }).flags[0].key, 'temperature');
  assert.equal(Q.ticketChecks({}).status, 'incomplete');
});

test('concrete temperature uses ACI 306 minimums by thickness and a 95°F maximum', () => {
  assert.equal(Q.temperatureCheck({ reading_f: 52, kind: 'delivery', section: 'thin' }).status, 'low');
  assert.equal(Q.temperatureCheck({ reading_f: 52, kind: 'delivery', section: 'medium' }).status, 'ok');
  assert.equal(Q.temperatureCheck({ reading_f: 97, kind: 'placed', section: 'thin' }).status, 'high');
  assert.equal(Q.temperatureCheck({ reading_f: 92, kind: 'placed', maximum_f: 90 }).status, 'high', 'a project maximum takes priority');
  assert.equal(Q.temperatureCheck({ reading_f: 38, kind: 'air' }).status, 'recorded');
  assert.equal(Q.temperatureCheck({ reading_f: 28, kind: 'delivery', section: 'thin' }).status, 'low');
  assert.equal(Q.toFahrenheit(30, 'C'), 86);
});

test('concrete yield: thin slab is under, normal waste is on target, excess is over', () => {
  // 1000 sq ft at 4 in plans 12.35 yd³.
  const on = Q.yieldCheck({ yards: 13, area_sqft: 1000, thickness_in: 4 });
  assert.equal(on.design_yards, 12.35); assert.equal(on.status, 'on_target');
  const thin = Q.yieldCheck({ yards: 11.5, area_sqft: 1000, thickness_in: 4 });
  assert.equal(thin.status, 'under'); assert.equal(thin.implied_thickness_in, 3.73);
  assert.equal(Q.yieldCheck({ yards: 14, area_sqft: 1000, thickness_in: 4 }).status, 'over');
  assert.equal(Q.yieldCheck({ yards: 14, area_sqft: 1000, thickness_in: 4, waste_pct: 15 }).status, 'on_target');
  assert.equal(Q.yieldCheck({ yards: 0, area_sqft: 1000, thickness_in: 4 }).status, 'incomplete');
});

test('ticket fields convert metric loads and Celsius, and implausible loads are low confidence', () => {
  const f = C.ticketFields({ load_quantity: 7.6, load_unit: 'm3', concrete_temp: 30, temp_unit: 'C', ticket_date: '10/18/2026', strength_psi: '4,000' }, true);
  assert.equal(f.load_yd3, 9.94); assert.equal(f.concrete_temp_f, 86); assert.equal(f.ticket_date, '2026-10-18'); assert.equal(f.strength_psi, 4000);
  assert.equal(C.scanConfidence({ confidence: 'high', load_quantity: 10, load_unit: 'yd3' }, { load_yd3: 10 }), 'high');
  assert.equal(C.scanConfidence({ confidence: 'high', load_quantity: 120, load_unit: 'yd3' }, { load_yd3: 120 }), 'low', 'an order total read as one load');
  assert.equal(C.scanConfidence({ confidence: 'high', load_quantity: 10 }, { load_yd3: 10 }), 'low', 'no unit printed');
});

test('the location saved inside a photo is read; a photo without one gives none', () => {
  assert.deepEqual(L.parse(fs.readFileSync(path.join(__dirname, 'fixtures/gps-photo.jpg'))), { lat: 29.425, lng: -98.486667 });
  assert.equal(L.parse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
});

test('a library photo never takes the phone location', () => {
  const app = fs.readFileSync('public/app.js', 'utf8');
  assert.match(app, /onPhotoChosen\(e\.target\.files\[0\],'library'\)/);
  assert.match(app, /if \(fromLibrary\) \{\s*const stored = await/);
  assert.match(app, /function photoLocation\(file,camera\)\{return camera\?getLocationOnce\(\):/);
  assert.match(app, /const loc = await photoLocation\(file, takenNow\)/);
  assert.match(app, /photoLocation\(file,alignmentAfterCamera\)/);
});
