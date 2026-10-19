// Concrete Pro quality checks shared by the server and the app: batch tickets, concrete temperature and daily yield.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhotoNotesConcreteQuality = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // ASTM C94: discharge should be complete within 90 minutes of batching unless the purchaser waives it.
  const MAX_MINUTES = 90;
  // ACI 305.1 maximum concrete temperature at discharge unless a higher limit is accepted.
  const MAX_TEMP_F = 95;
  // ACI 306 suggested minimum concrete temperature as placed, by the least dimension of the section.
  const SECTIONS = [
    { id: 'thin', label: 'Less than 12 in thick (slabs, walks, paving)', minimum_f: 55 },
    { id: 'medium', label: '12 to 36 in', minimum_f: 50 },
    { id: 'thick', label: '36 to 72 in', minimum_f: 45 },
    { id: 'mass', label: 'More than 72 in', minimum_f: 40 }
  ];
  const KINDS = [
    { id: 'delivery', label: 'Concrete at delivery (from the chute)', checked: true },
    { id: 'placed', label: 'Concrete in place', checked: true },
    { id: 'air', label: 'Air temperature', checked: false },
    { id: 'subgrade', label: 'Subgrade or form surface', checked: false }
  ];
  const YD3_PER_M3 = 1.30795;
  const num = v => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; };
  const round = (v, d = 1) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
  const toFahrenheit = (value, unit) => { const n = num(value); if (n == null) return null; return String(unit || 'F').trim().toUpperCase().startsWith('C') ? round(n * 9 / 5 + 32) : round(n); };
  const toCubicYards = (value, unit) => { const n = num(value); if (n == null) return null; return /m/i.test(String(unit || '')) && !/yd|yard|cy/i.test(String(unit || '')) ? round(n * YD3_PER_M3, 2) : round(n, 2); };

  // "14:05", "2:05 PM", "1405" become minutes after midnight.
  function clockMinutes(value) {
    const s = String(value == null ? '' : value).trim().toUpperCase(); if (!s) return null;
    const m = s.match(/(\d{1,2})[:.h]?(\d{2})(?::\d{2})?\s*(AM|PM|A|P)?/); if (!m) return null;
    let h = Number(m[1]); const min = Number(m[2]); if (h > 23 || min > 59) return null;
    if (m[3]) { if (h > 12) return null; if (m[3].startsWith('P') && h < 12) h += 12; if (m[3].startsWith('A') && h === 12) h = 0; }
    return h * 60 + min;
  }
  function minutesBetween(start, end) {
    const a = clockMinutes(start), b = clockMinutes(end); if (a == null || b == null) return null;
    let d = b - a; if (d < 0) d += 1440; // past midnight
    return d > 600 ? null : d; // more than ten hours apart is a misread, not a delivery
  }

  // Ticket checks: time from batching to discharge, and water added against the water allowed.
  function ticketChecks(t = {}) {
    const flags = [];
    const end = t.discharge_end ? ['discharge_end', 'end of discharge'] : t.discharge_start ? ['discharge_start', 'start of discharge'] : t.arrival_time ? ['arrival_time', 'arrival'] : null;
    const minutes = end ? minutesBetween(t.batch_time, t[end[0]]) : null;
    if (minutes != null && minutes > MAX_MINUTES) flags.push({ key: 'time', message: `${minutes} minutes from batching to ${end[1]}, over the ${MAX_MINUTES}-minute limit.` });
    const allowed = num(t.water_allowed_gal), added = num(t.water_added_gal);
    if (added != null && allowed != null && added > allowed) flags.push({ key: 'water', message: `${added} gal of water added, more than the ${allowed} gal allowed on the ticket.` });
    const temp = num(t.concrete_temp_f);
    if (temp != null && temp > MAX_TEMP_F) flags.push({ key: 'temperature', message: `Ticket temperature ${temp}°F is over ${MAX_TEMP_F}°F.` });
    return { minutes, measured_to: end ? end[1] : null, flags, status: flags.length ? 'flagged' : minutes == null ? 'incomplete' : 'ok' };
  }

  function temperatureCheck({ reading_f, kind, section, minimum_f, maximum_f } = {}) {
    const reading = num(reading_f), k = KINDS.find(x => x.id === kind) || KINDS[0];
    const enteredMin = num(minimum_f), enteredMax = num(maximum_f);
    const sec = SECTIONS.find(s => s.id === section);
    const min = enteredMin != null ? enteredMin : k.checked && sec ? sec.minimum_f : null;
    const max = enteredMax != null ? enteredMax : k.checked ? MAX_TEMP_F : null;
    const out = { minimum_f: min, maximum_f: max };
    if (reading == null) return { ...out, status: 'no_reading', message: 'No temperature entered.' };
    if (reading < -40 || reading > 200) return { ...out, status: 'check_reading', message: 'This reading is outside the range for concrete or air. Check the photo and the reading.' };
    if (min != null && reading < min) return { ...out, status: 'low', message: `${round(min - reading)}°F below the ${enteredMin != null ? 'project' : 'suggested'} minimum of ${min}°F.` };
    if (max != null && reading > max) return { ...out, status: 'high', message: `${round(reading - max)}°F above the ${enteredMax != null ? 'project maximum' : 'maximum'} of ${max}°F.` };
    if (min == null && max == null) return { ...out, status: 'recorded', message: 'Recorded.' };
    return { ...out, status: 'ok', message: `Within ${min != null ? min + '°F' : 'the minimum'} to ${max}°F.` + (min == null && k.checked ? ' Choose the section thickness to check the minimum.' : '') };
  }

  // Yield: yards delivered against area times thickness. Some overage is normal; less than planned means a thin slab or a missing ticket.
  function yieldCheck({ yards, area_sqft, thickness_in, waste_pct, under_pct } = {}) {
    const y = num(yards), a = num(area_sqft), th = num(thickness_in), waste = num(waste_pct) ?? 10, under = num(under_pct) ?? 2;
    const base = { yards: y, area_sqft: a, thickness_in: th, waste_pct: waste };
    const missing = [];
    if (!(y > 0)) missing.push('yards'); if (!(a > 0)) missing.push('placed area'); if (!(th > 0)) missing.push('planned thickness');
    if (missing.length) return { ...base, status: 'incomplete', missing, message: 'Enter ' + missing.join(', ') + ' to check yield.' };
    const design = a * th / 324, diff = (y / design - 1) * 100, implied = y * 324 / a;
    const status = diff < -under ? 'under' : diff > waste ? 'over' : 'on_target';
    const message = status === 'on_target'
      ? `On target: ${round(diff)}% ${diff >= 0 ? 'over' : 'under'} the planned volume, within the ${waste}% allowed for waste and subgrade.`
      : status === 'under'
        ? `${round(-diff)}% less concrete than the planned volume. The slab may be thinner than ${th} in (about ${round(implied, 2)} in average), the area may be smaller than entered, or a ticket may be missing.`
        : `${round(diff)}% more concrete than planned, beyond the ${waste}% allowance. Check for low subgrade, thicker sections, waste or returned concrete, or a ticket from another pour.`;
    return { ...base, status, design_yards: round(design, 2), difference_pct: round(diff), implied_thickness_in: round(implied, 2), message };
  }
  return { MAX_MINUTES, MAX_TEMP_F, SECTIONS, KINDS, toFahrenheit, toCubicYards, clockMinutes, minutesBetween, ticketChecks, temperatureCheck, yieldCheck };
});
