const test = require('node:test'), assert = require('node:assert/strict');
const E = require('../public/concrete-estimate-rules.js'), S = require('../concrete-estimates.js');

test('feet and inches are read the way contractors write them', () => {
  for (const v of ['18.5', '18 ft 6 in', "18' 6\"", '18-6', '18ft 6in']) assert.equal(E.parseFeet(v), 18.5, v);
  assert.equal(E.parseFeet('6 in'), 0.5); assert.equal(E.parseFeet('abc'), null); assert.equal(E.formatFeet(18.5), '18 ft 6 in');
});

test('shapes: rectangle, L-shape, circle and cut-outs', () => {
  assert.deepEqual([E.geometry({ shape: 'rect', dims: { length: '20', width: '12' } }).area_sqft, E.geometry({ shape: 'rect', dims: { length: '20', width: '12' } }).perimeter_ft], [240, 64]);
  const l = E.geometry({ shape: 'l', dims: { length: '30', width: '20', notch_length: '10', notch_width: '8' } });
  assert.equal(l.area_sqft, 520); assert.equal(l.perimeter_ft, 100);
  assert.equal(E.geometry({ shape: 'circle', dims: { diameter: '10' } }).area_sqft, 78.5);
  assert.equal(E.geometry({ shape: 'rect', dims: { length: '20', width: '12' }, cutouts: [{ area_sqft: 16, perimeter_ft: 16 }] }).area_sqft, 224);
  assert.equal(E.geometry({ shape: 'rect', dims: { length: '20' } }).ok, false);
});

test('a 20 x 12 ft, 4 in patio with #3 at 18 in', () => {
  const t = E.takeoff([{ name: 'Patio', shape: 'rect', dims: { length: '20', width: '12' }, method: 'tape' }], { thickness_in: 4, reinforcement: { type: 'rebar', bar: '#3', spacing_in: 18 }, placement: 'chute' });
  const line = k => t.lines.find(l => l.key === k);
  assert.equal(t.placed_cy, 2.96); assert.equal(t.purchase_cy, 4, '2.96 + 10% = 3.26, rounded up to 4');
  assert.equal(line('short_load_cy').purchase, 6, 'one 4-yard pour is 6 yards short of a 10-yard truck');
  assert.equal(line('rebar_lf').placed, 352); assert.equal(line('rebar_lf').purchase, 440, 'plus 25%');
  assert.equal(line('forms_lf').placed, 64); assert.equal(line('sawcut_lf').placed, 32, '10 ft spacing: one joint each way');
  assert.equal(line('chair_ea').placed, 27);
});

test('measurement method adds contingency; thickened edges add volume; demolition and pumps are added', () => {
  const base = { name: 'Drive', shape: 'rect', dims: { length: '40', width: '20' } };
  const tape = E.takeoff([{ ...base, method: 'tape' }], { thickness_in: 5 }), map = E.takeoff([{ ...base, method: 'map' }], { thickness_in: 5 });
  assert.ok(Math.abs(map.placed_cy - tape.placed_cy * 1.1) < 0.02); assert.match(map.warnings.join(' '), /10%/);
  const edge = E.takeoff([{ ...base, method: 'tape', edge: { depth_in: 10, width_in: 12 } }], { thickness_in: 5 });
  assert.ok(edge.placed_cy > tape.placed_cy + 1.8 && edge.placed_cy < tape.placed_cy + 1.9, 'about 1.85 yd³ for 120 ft of 12 x 5 in extra edge');
  const full = E.takeoff([{ ...base, method: 'tape' }], { thickness_in: 5, demo: { sqft: 800, thickness_in: 6, reinforced: true }, placement: 'boom', permit: true, miles: 30, pours: 1 });
  const k = full.lines.map(l => l.key);
  for (const key of ['demo_reinforced_sf', 'haul_ton', 'pump_boom_pour', 'permit_ea', 'mileage_mi']) assert.ok(k.includes(key), key);
  assert.equal(full.lines.find(l => l.key === 'haul_ton').purchase, 30, '800 sq ft x 6 in = 14.8 yd³ x 2 tons, rounded up');
  assert.equal(full.lines.find(l => l.key === 'mileage_mi').placed, 10);
});

test('pricing flags missing prices; options price each finish', () => {
  const areas = [{ name: 'Patio', shape: 'rect', dims: { length: '20', width: '12' }, method: 'tape' }];
  const prices = { concrete_cy: 140, short_load_cy: 43, labor_place_sf: 4, forms_lf: 2, sawcut_lf: 1, mobilization_ea: 150, finish_stamped_sf: 6 };
  const opts = E.priceOptions(areas, { thickness_in: 4 }, [{ name: 'Good', finish: 'broom' }, { name: 'Best', finish: 'stamped' }], prices, {});
  assert.equal(opts[0].pricing.complete, true);
  assert.equal(opts[0].pricing.total, 4 * 140 + 6 * 43 + 240 * 4 + 64 * 2 + 32 * 1 + 150);
  assert.equal(opts[1].pricing.total - opts[0].pricing.total, 240 * 6);
  const missing = E.priceOptions(areas, { thickness_in: 4, reinforcement: { type: 'rebar' } }, [], prices, {});
  assert.equal(missing[0].pricing.complete, false); assert.ok(missing[0].pricing.missing.some(m => /Rebar/.test(m)));
  assert.equal(E.price(E.takeoff(areas, { thickness_in: 4 }), prices, { markup_pct: 10 }).markup, Math.round((4 * 140 + 6 * 43 + 960 + 128 + 32 + 150) * 10) / 100);
});

test('city presets, checklist status and bid versus actual', () => {
  assert.equal(E.CITY_PRESETS.find(c => c.id === 'kyle').spec.thickness_in, 5);
  assert.equal(E.CITY_PRESETS.find(c => c.id === 'sanantonio').spec.thickness_in, 5, 'San Antonio residential is 5 in per the city drawing');
  assert.equal(E.CITY_PRESETS.find(c => c.id === 'sanantonio_com').spec.reinforcement.bar, '#4');
  assert.equal(E.checklistStatus({ access: { answer: 'Gate 10 ft', photos: [1] } }).answered, 1);
  const c = E.compareActual(10, 11, 11.5); assert.equal(c.actual_waste_pct, 15); assert.equal(c.status, 'over');
  assert.deepEqual(E.suggestedWaste([{ actual_waste_pct: 6 }, { actual_waste_pct: 8 }, { actual_waste_pct: 7.5 }]), { jobs: 3, average_waste_pct: 7.2, suggested_pct: 8 });
  assert.equal(E.suggestedWaste([{ actual_waste_pct: 6 }]), null, 'needs three jobs');
});

test('server cleaning: areas need sizes, specs and options are limited, CSV is parsed', () => {
  assert.throws(() => S.cleanArea({ name: 'X', shape: 'rect', dims: { length: '10' } }), /measurements/);
  assert.equal(S.cleanArea({ name: 'Slab', shape: 'rect', dims: { length: '10', width: '10' }, method: 'laser' }).area_sqft, 100);
  assert.equal(S.cleanSpec({ finish: 'gold' }).finish, 'broom'); assert.equal(S.cleanOptions([1, 2, 3, 4, 5].map(() => ({}))).length, 3);
  assert.deepEqual(S.parseCsv('name,sqft\n"Bay 1, north",1200,140,6'), [['name', 'sqft'], ['Bay 1, north', '1200', '140', '6']]);
  assert.ok(Math.abs(S.outlinePerimeterFt([{ lat: 29.4, lng: -98.5 }, { lat: 29.4001, lng: -98.5 }, { lat: 29.4001, lng: -98.4999 }, { lat: 29.4, lng: -98.4999 }]) - 136.7) < 1);
});

test('control joints are laid out inside the outline and drawn as a plan', () => {
  const G = require('../public/geo-measure.js');
  const rect = G.jointLayoutXY([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 12 }, { x: 0, y: 12 }], 10);
  assert.equal(rect.length_ft, 32, 'one joint across 12 ft and one across 20 ft');
  const L = G.jointLayoutXY([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 20 }, { x: 0, y: 20 }], 10);
  assert.ok(L.segments.every(([a, b]) => !(a.x > 15.5 && a.y > 10.5) && !(b.x > 15.5 && b.y > 10.5)), 'no joint in the notch');
  const svg = E.planSvg({ name: 'Patio', shape: 'rect', dims: { length: '20', width: '12' } }, 4);
  assert.match(svg, /<svg/); assert.match(svg, /stroke-dasharray/); assert.match(svg, /control joints, about 10 ft apart/);
  assert.equal(E.jointLength({ name: 'P', shape: 'rect', dims: { length: '20', width: '12' } }, 4), 32);
});

test('a repair traced on a photo gives an area or a crack length from the known length', () => {
  const base = { image: { w: 1000, h: 800 }, ref: [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }], ref_ft: 2 }; // 200 px = 2 ft
  const area = E.photoMeasure({ ...base, kind: 'replace', points: [{ x: 0.4, y: 0.25 }, { x: 0.8, y: 0.25 }, { x: 0.8, y: 0.5 }, { x: 0.4, y: 0.5 }] });
  assert.equal(area.area_sqft, 8); assert.equal(area.perimeter_ft, 12); // 4 ft by 2 ft
  const crack = E.photoMeasure({ ...base, kind: 'crack', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.6 }] });
  assert.equal(crack.length_ft, 8);
  assert.equal(E.photoMeasure({ ...base, ref_ft: 0, kind: 'replace', points: [] }).ok, false);
  assert.equal(E.photoMeasure({ ...base, ref: [{ x: 0.1, y: 0.1 }, { x: 0.101, y: 0.1 }], kind: 'crack', points: [] }).ok, false, 'scale points too close');
});

test('repairs flow into the takeoff: removal and haul-off, resurfacing and crack repair', () => {
  const photo = { image: { w: 1000, h: 800 }, ref: [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }], ref_ft: 2, kind: 'replace', points: [{ x: 0.4, y: 0.25 }, { x: 0.8, y: 0.25 }, { x: 0.8, y: 0.5 }, { x: 0.4, y: 0.5 }] };
  const areas = [
    { id: 1, name: 'Broken panel', shape: 'custom', dims: { area_sqft: '8', perimeter_ft: '12.8' }, method: 'photo_ref', repair_kind: 'replace', thickness_in: 4, geometry: { photo } },
    { id: 2, name: 'Worn walk', shape: 'custom', dims: { area_sqft: '40', perimeter_ft: '28' }, method: 'photo_ref', repair_kind: 'resurface' },
    { id: 3, name: 'Crack', shape: 'custom', dims: {}, method: 'photo_ref', repair_kind: 'crack', repair_lf: 12 }
  ];
  const t = E.takeoff(areas, { thickness_in: 4, reinforcement: { type: 'none' }, joints: true });
  const line = k => t.lines.find(l => l.key === k);
  assert.ok(line('demo_sf') && line('demo_sf').purchase >= 8, 'removal of the replaced area');
  assert.ok(line('haul_ton'), 'haul-off');
  assert.equal(line('crack_repair_lf').purchase, 12);
  assert.equal(line('resurface_sf').purchase, 40);
  assert.ok(!line('forms_lf') || line('forms_lf').purchase === 0, 'a saw-cut patch needs no forms');
  assert.equal(t.areas.find(a => a.id === 1).repair, 'replace');
  assert.ok(E.planOutline(areas[0]).length === 4, 'the photo outline is used for the plan');
});
