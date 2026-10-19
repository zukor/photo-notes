'use strict';
// Concrete Pro photo fields. Capture creation and later edits use the same rules.
const ConcreteCapture = require('./public/concrete-capture');
const ELEMENTS = ['patio', 'slab', 'sidewalk', 'curb', 'driveway', 'foundation', 'wall', 'column', 'beam', 'steps', 'deck', 'other'];
const STAGES = ['existing_condition', 'pre_pour', 'formwork', 'reinforcement', 'placement', 'finishing', 'curing', 'completed', 'defect', 'repair', 'verification'];
const CONDITIONS = ['not_assessed', 'acceptable', 'monitor', 'repair_needed', 'unsafe'];
const SEVERITIES = ['none', 'minor', 'moderate', 'severe', 'critical'];
const KEYS = ['concrete_phase', 'concrete_purpose', 'concrete_stage', 'concrete_element', 'concrete_condition', 'concrete_severity', 'concrete_mix', 'concrete_location'];
const text = (value, max) => { if (value == null) return null; const s = String(value).trim(); return s ? s.slice(0, max) : null; };
const filled = v => v != null && String(v).trim() !== '';

// Returns the stored values and any problems with values the user supplied.
function concreteFields(b = {}) {
  const errors = [];
  const pick = (key, list, label) => { if (list.includes(b[key])) return b[key]; if (filled(b[key])) errors.push(label); return null; };
  const element = pick('concrete_element', ELEMENTS, 'Choose a valid project type.');
  const context = ConcreteCapture.normalize(b);
  if (filled(b.concrete_phase) && !context.concrete_phase) errors.push('Choose a valid project phase.');
  if (filled(b.concrete_purpose) && context.concrete_phase && !context.concrete_purpose) errors.push('Choose a photo purpose that belongs to the project phase.');
  const stage = context.concrete_stage || (!b.concrete_phase && STAGES.includes(b.concrete_stage) ? b.concrete_stage : null);
  const condition = pick('concrete_condition', CONDITIONS, 'Choose a valid condition.');
  const severity = pick('concrete_severity', SEVERITIES, 'Choose a valid severity.');
  return {
    fields: {
      concrete_element: element, concrete_stage: stage, concrete_condition: condition, concrete_severity: severity,
      concrete_mix: text(b.concrete_mix, 100), concrete_location: text(b.concrete_location, 300),
      concrete_phase: context.concrete_phase, concrete_purpose: context.concrete_purpose
    },
    errors
  };
}
const hasConcreteKeys = b => !!b && KEYS.some(k => Object.prototype.hasOwnProperty.call(b, k));

// Values for an edit: only the supplied keys change. Phase and purpose always change together with the stage.
function concreteEdit(b, existing = {}) {
  const merged = { ...existing };
  for (const k of KEYS) if (Object.prototype.hasOwnProperty.call(b, k)) merged[k] = b[k];
  const touchesContext = ['concrete_phase', 'concrete_purpose', 'concrete_stage'].some(k => Object.prototype.hasOwnProperty.call(b, k));
  const { fields, errors } = concreteFields(merged);
  const updates = {};
  for (const k of ['concrete_element', 'concrete_condition', 'concrete_severity', 'concrete_mix', 'concrete_location']) if (Object.prototype.hasOwnProperty.call(b, k)) updates[k] = fields[k];
  // A linked batch ticket photo keeps its reference stage.
  if (touchesContext && existing.concrete_stage !== 'batch_ticket') { updates.concrete_phase = fields.concrete_phase; updates.concrete_purpose = fields.concrete_purpose; updates.concrete_stage = fields.concrete_stage; }
  return { updates, errors };
}

module.exports = { concreteFields, concreteEdit, hasConcreteKeys, ELEMENTS, STAGES, CONDITIONS, SEVERITIES, KEYS };
