// Paving Pro quality checks shared by the server and the app: daily yield and mix temperature.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoNotesPavingQuality = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Hot mix asphalt weighs about 110 lb per square yard for each inch of compacted thickness.
  const DEFAULT_UNIT_WEIGHT = 110;
  const DEFAULT_TOLERANCE_PCT = 5;
  // TxDOT suggested minimum placement temperatures (°F) for the mix measured behind the paver.
  // Project specifications can set a different minimum; the person can enter that instead.
  const BINDERS = [
    { id: 'PG64', label: 'PG 64-22 (or other PG 64)', minimum_f: 260 },
    { id: 'PG70', label: 'PG 70-22 (or other PG 70)', minimum_f: 270 },
    { id: 'PG76', label: 'PG 76-22 (or other PG 76)', minimum_f: 280 },
    { id: 'WMA', label: 'Warm mix asphalt', minimum_f: 215 },
    { id: 'other', label: 'Other or not known', minimum_f: null }
  ];
  const KINDS = [
    { id: 'mat', label: 'Mat behind the paver', checked: true },
    { id: 'load', label: 'Truck load at arrival', checked: true },
    { id: 'surface', label: 'Road surface before paving', checked: false },
    { id: 'air', label: 'Air temperature', checked: false }
  ];
  const num = v => { if (v === '' || v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
  const round = (v, d = 1) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;

  function toFahrenheit(value, unit) {
    const n = num(value); if (n == null) return null;
    return String(unit || 'F').trim().toUpperCase().startsWith('C') ? round(n * 9 / 5 + 32) : round(n);
  }
  function binderMinimum(binder) { const b = BINDERS.find(x => x.id === binder); return b ? b.minimum_f : null; }

  // The minimum used is the project minimum when one is entered, otherwise the suggested minimum for the binder.
  function temperatureCheck({ reading_f, kind, binder, minimum_f } = {}) {
    const reading = num(reading_f), entered = num(minimum_f), k = KINDS.find(x => x.id === kind) || KINDS[0];
    const minimum = entered != null ? entered : k.checked ? binderMinimum(binder) : null;
    const source = entered != null ? 'project' : minimum != null ? 'suggested' : null;
    if (reading == null) return { status: 'no_reading', minimum_f: minimum, source, message: 'No temperature entered.' };
    if (reading < -40 || reading > 500) return { status: 'check_reading', minimum_f: minimum, source, message: 'This reading is outside the range a paving thermometer shows. Check the photo and the reading.' };
    if (minimum == null) return { status: 'recorded', minimum_f: null, source, message: k.checked ? 'Recorded. Choose the binder or enter the project minimum to check it.' : 'Recorded.' };
    const diff = round(reading - minimum);
    if (diff < 0) return { status: 'low', minimum_f: minimum, source, below_by: -diff, message: `${round(-diff)}°F below the ${source === 'project' ? 'project' : 'suggested'} minimum of ${minimum}°F.` };
    return { status: 'ok', minimum_f: minimum, source, message: `Meets the ${source === 'project' ? 'project' : 'suggested'} minimum of ${minimum}°F.` };
  }

  // Yield compares the tons delivered with the tons the paved area and planned thickness should take.
  function yieldCheck({ tons, area_sy, thickness_in, unit_weight, tolerance_pct } = {}) {
    const t = num(tons), a = num(area_sy), th = num(thickness_in);
    const uw = num(unit_weight) || DEFAULT_UNIT_WEIGHT, tol = num(tolerance_pct) ?? DEFAULT_TOLERANCE_PCT;
    const base = { tons: t, area_sy: a, thickness_in: th, unit_weight: uw, tolerance_pct: tol };
    const missing = [];
    if (!(t > 0)) missing.push('tons'); if (!(a > 0)) missing.push('paved area'); if (!(th > 0)) missing.push('planned thickness');
    if (missing.length) return { ...base, status: 'incomplete', missing, message: 'Enter ' + missing.join(', ') + ' to check yield.' };
    const designTons = a * th * uw / 2000, actualLbSy = t * 2000 / a, designLbSy = th * uw;
    const yieldPct = t / designTons * 100, diff = yieldPct - 100, implied = actualLbSy / uw;
    const status = Math.abs(diff) <= tol ? 'on_target' : diff > 0 ? 'over' : 'under';
    const message = status === 'on_target'
      ? `On target: ${round(Math.abs(diff))}% ${diff >= 0 ? 'over' : 'under'} plan, within ${tol}%.`
      : status === 'over'
        ? `${round(diff)}% more mix than planned. The mat may be thicker than ${th} in, the area may be larger than entered, or a ticket may belong to another day or job.`
        : `${round(-diff)}% less mix than planned. The mat may be thinner than ${th} in (about ${round(implied, 2)} in), the area may be smaller than entered, or a ticket may be missing.`;
    return { ...base, status, design_tons: round(designTons, 2), actual_lb_sy: round(actualLbSy), design_lb_sy: round(designLbSy), yield_pct: round(yieldPct), difference_pct: round(diff), implied_thickness_in: round(implied, 2), message };
  }
  function areaToSquareYards(value, unit) {
    const n = num(value); if (n == null) return null;
    return unit === 'sy' ? n : unit === 'sqm' ? round(n * 1.19599, 2) : round(n / 9, 2);
  }
  return { DEFAULT_UNIT_WEIGHT, DEFAULT_TOLERANCE_PCT, BINDERS, KINDS, toFahrenheit, binderMinimum, temperatureCheck, yieldCheck, areaToSquareYards };
});
