'use strict';
// Measure From Photo limits. An AI estimate outside these is treated as a misread, not a size.
const MAX_LENGTH_IN = 1200, MAX_DEPTH_IN = 48;

// Known reference objects have a default length. Anything else needs a positive length from the user.
function referenceLength(type, given) {
  const n = Number(given);
  if (given != null && given !== '' && Number.isFinite(n)) return n > 0 ? n : null;
  if (type === 'tape_25ft') return 300;
  if (type === 'ruler_12in') return 12;
  return null;
}

function checkMeasurement(out) {
  const warnings = [];
  const limit = (key, label, max) => {
    const v = out[key];
    if (v == null) return;
    if (!Number.isFinite(v) || v <= 0 || v > max) { warnings.push(`The ${label} reading of ${v} in is not possible, so it was left blank. Measure it by hand.`); out[key] = null; }
  };
  limit('length_in', 'length', MAX_LENGTH_IN);
  limit('width_in', 'width', MAX_LENGTH_IN);
  limit('depth_in', 'depth', MAX_DEPTH_IN);
  if (warnings.length) { out.confidence = 'low'; out.warning = [out.warning, ...warnings].filter(Boolean).join(' '); }
  return out;
}

module.exports = { referenceLength, checkMeasurement, MAX_LENGTH_IN, MAX_DEPTH_IN };
