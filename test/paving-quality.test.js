const test = require('node:test'), assert = require('node:assert/strict');
const Q = require('../public/paving-quality-rules.js');
const { temperatureRow } = require('../paving-quality.js');

test('yield on target, over and under plan', () => {
  // 1000 sq yd at 2 in and 110 lb/sy/in plans 110 tons.
  const on = Q.yieldCheck({ tons: 112, area_sy: 1000, thickness_in: 2 });
  assert.equal(on.design_tons, 110); assert.equal(on.status, 'on_target'); assert.equal(on.actual_lb_sy, 224); assert.equal(on.design_lb_sy, 220);
  const under = Q.yieldCheck({ tons: 99, area_sy: 1000, thickness_in: 2 });
  assert.equal(under.status, 'under'); assert.equal(under.yield_pct, 90); assert.equal(under.implied_thickness_in, 1.8);
  assert.match(under.message, /less mix than planned/);
  const over = Q.yieldCheck({ tons: 121, area_sy: 1000, thickness_in: 2, tolerance_pct: 5 });
  assert.equal(over.status, 'over'); assert.equal(over.difference_pct, 10);
  assert.equal(Q.yieldCheck({ tons: 99, area_sy: 1000, thickness_in: 2, tolerance_pct: 12 }).status, 'on_target', 'tolerance is adjustable');
  assert.equal(Q.yieldCheck({ tons: 100, area_sy: 1000, thickness_in: 2, unit_weight: 100 }).status, 'on_target', 'mix weight is adjustable');
});

test('yield refuses to guess when an input is missing', () => {
  const r = Q.yieldCheck({ tons: 0, area_sy: 1000, thickness_in: null });
  assert.equal(r.status, 'incomplete'); assert.deepEqual(r.missing, ['tons', 'planned thickness']);
});

test('area converts to square yards', () => {
  assert.equal(Q.areaToSquareYards(900, 'sqft'), 100);
  assert.equal(Q.areaToSquareYards(100, 'sy'), 100);
  assert.equal(Q.areaToSquareYards(100, 'sqm'), 119.6);
});

test('mat temperature is checked against the binder minimum or the project minimum', () => {
  assert.equal(Q.temperatureCheck({ reading_f: 275, kind: 'mat', binder: 'PG64' }).status, 'ok');
  const low = Q.temperatureCheck({ reading_f: 268, kind: 'mat', binder: 'PG76' });
  assert.equal(low.status, 'low'); assert.equal(low.minimum_f, 280); assert.equal(low.below_by, 12);
  assert.equal(Q.temperatureCheck({ reading_f: 230, kind: 'load', binder: 'WMA' }).status, 'ok');
  const project = Q.temperatureCheck({ reading_f: 275, kind: 'mat', binder: 'PG64', minimum_f: 285 });
  assert.equal(project.status, 'low'); assert.equal(project.source, 'project');
  assert.equal(Q.temperatureCheck({ reading_f: 275, kind: 'mat', binder: 'other' }).status, 'recorded');
  assert.equal(Q.temperatureCheck({ reading_f: 55, kind: 'air', binder: 'PG64' }).status, 'recorded', 'air has no default minimum');
  assert.equal(Q.temperatureCheck({ reading_f: 900, kind: 'mat' }).status, 'check_reading');
});

test('a Celsius thermometer reading is stored in Fahrenheit and checked', () => {
  assert.equal(Q.toFahrenheit(140, 'C'), 284);
  const r = temperatureRow({ reading: 120, unit: 'C', kind: 'mat', binder: 'PG64' });
  assert.equal(r.reading, 248); assert.equal(r.check.status, 'low'); assert.equal(r.minimum, 260);
  assert.equal(temperatureRow({ reading_f: 300, kind: 'nonsense' }).kind, 'mat', 'an unknown kind falls back to the mat');
});
