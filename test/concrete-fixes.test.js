'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const server = read('server.js');
const slice = (source, start, end) => { const i = source.indexOf(start); assert.ok(i >= 0, start); const j = source.indexOf(end, i); return source.slice(i, j); };

test('concrete fields: creation and edits share one set of rules', () => {
  const F = require('../concrete-fields');
  const ok = F.concreteFields({ concrete_phase: 'work', concrete_purpose: 'placement', concrete_element: 'slab', concrete_condition: 'monitor', concrete_severity: 'minor', concrete_mix: ' 4000 psi ', concrete_location: ' Back patio ' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.fields.concrete_stage, 'placement', 'stage comes from the purpose');
  assert.equal(ok.fields.concrete_mix, '4000 psi'); assert.equal(ok.fields.concrete_location, 'Back patio');
  const bad = F.concreteFields({ concrete_element: 'roof', concrete_condition: 'broken', concrete_severity: 'high', concrete_phase: 'work', concrete_purpose: 'handoff' });
  assert.equal(bad.errors.length, 4); assert.equal(bad.fields.concrete_element, null); assert.equal(bad.fields.concrete_purpose, null);
  // Edit: only supplied keys change, phase and purpose change the derived stage.
  const existing = { concrete_phase: 'work', concrete_purpose: 'placement', concrete_stage: 'placement', concrete_element: 'slab', concrete_condition: 'not_assessed', concrete_severity: 'none', concrete_mix: null, concrete_location: 'Front' };
  const e = F.concreteEdit({ concrete_phase: 'follow_up', concrete_purpose: 'repair', concrete_location: 'Rear walk' }, existing);
  assert.deepEqual(e.errors, []);
  assert.deepEqual(e.updates, { concrete_location: 'Rear walk', concrete_phase: 'follow_up', concrete_purpose: 'repair', concrete_stage: 'repair' });
  assert.deepEqual(F.concreteEdit({ concrete_element: 'driveway' }, existing).updates, { concrete_element: 'driveway' });
  assert.ok(F.concreteEdit({ concrete_severity: 'catastrophic' }, existing).errors.length);
  const ticket = F.concreteEdit({ concrete_phase: 'work', concrete_purpose: 'placement' }, { concrete_stage: 'batch_ticket' });
  assert.equal(ticket.updates.concrete_stage, undefined, 'a linked batch ticket keeps its stage');
  // A legacy photo without a phase keeps its stage when it is sent back.
  assert.equal(F.concreteEdit({ concrete_phase: '', concrete_purpose: '', concrete_stage: 'defect' }, { concrete_stage: 'defect' }).updates.concrete_stage, 'defect');
  assert.equal(F.hasConcreteKeys({ note: 'x' }), false); assert.equal(F.hasConcreteKeys({ concrete_mix: '' }), true);
});

test('server: capture creation and the photo edit route use the shared concrete rules, Concrete Pro only, with history', () => {
  assert.match(server, /const concreteValues=concreteProduct\?ConcreteFields\.concreteFields\(b\)\.fields:\{\}/);
  const edit = slice(server, "app.post('/api/captures/:id', requireAuth", "res.json(rows[0]);");
  assert.match(edit, /ConcreteFields\.hasConcreteKeys\(b\)/);
  assert.match(edit, /currentProduct\(req\.user\.id\)\) !== 'concrete'\) return res\.status\(403\)/);
  assert.match(edit, /ConcreteFields\.concreteEdit\(b, old\)/);
  assert.match(edit, /errors\.length\) return res\.status\(400\)/);
  assert.match(edit, /recordCaptureHistory\(req\.user\.id,id,'details_updated',concreteChange\?\{fields:changed,concrete:concreteChange\}/);
  const app = read('public/app.js');
  assert.match(app, /function openConcreteDetailsEditor\(c\)/);
  for (const id of ['cdePhase', 'cdePurpose', 'cdeElement', 'cdeCondition', 'cdeSeverity', 'cdeMix', 'cdeLocation', 'cdeSave']) assert.match(app, new RegExp(`id="${id}"`));
  assert.match(app, /class="btn secondary slim editconcrete"/);
});

test('Measure From Photo: impossible values are cleared and a positive reference length is required', () => {
  const M = require('../measure-check');
  assert.equal(M.referenceLength('ruler_12in'), 12); assert.equal(M.referenceLength('tape_25ft', ''), 300);
  assert.equal(M.referenceLength('custom', ''), null); assert.equal(M.referenceLength('custom', '0'), null); assert.equal(M.referenceLength('custom', '-4'), null);
  assert.equal(M.referenceLength('custom', '8.5'), 8.5);
  const out = M.checkMeasurement({ length_in: -3, width_in: 1500, depth_in: 60, confidence: 'high', warning: null });
  assert.equal(out.length_in, null); assert.equal(out.width_in, null); assert.equal(out.depth_in, null); assert.equal(out.confidence, 'low');
  assert.match(out.warning, /length reading of -3 in is not possible/); assert.match(out.warning, /depth/);
  const zero = M.checkMeasurement({ length_in: 0, width_in: 6, depth_in: null, confidence: 'medium', warning: 'ruler appears angled' });
  assert.equal(zero.length_in, null); assert.equal(zero.width_in, 6); assert.match(zero.warning, /^ruler appears angled /);
  const fine = M.checkMeasurement({ length_in: 1200, width_in: 4, depth_in: 48, confidence: 'high', warning: null });
  assert.equal(fine.confidence, 'high'); assert.equal(fine.warning, null);
  const route = slice(server, "app.post('/api/measure'", "MeasureCheck.checkMeasurement(out)");
  assert.match(route, /if \(!refLenIn\) \{ cleanup\(\); return res\.status\(400\)\.json\(\{ error: 'reference length required' \}\); \}/);
});

test('Concrete report: readiness counts a saved scanned ticket, and photo lines include size and reviewed findings', () => {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(slice(server, 'function evidenceChecklist(checks)', "\nrequire('./photo-requests')"), ctx);
  const rows = [{ concrete_stage: 'placement' }];
  assert.equal(ctx.concreteEvidenceChecklist(rows, [], 0).checks.find(c => c.key === 'ticket').complete, false);
  assert.equal(ctx.concreteEvidenceChecklist(rows, [], 1).checks.find(c => c.key === 'ticket').complete, true);
  assert.equal(ctx.concreteEvidenceChecklist(rows, [{}], 0).checks.find(c => c.key === 'ticket').complete, true);
  ctx.exportDims = c => c.dim_length_in ? '10 ft x 4 ft' : ''; ctx.footprintSummary = () => 'Area'; ctx.require = require.bind(null);
  ctx.require = name => name === './custom-fields' ? { lines: () => '' } : require(name);
  const lines = ctx.concretePhotoDetails({ concrete_location: 'Back patio', dim_length_in: 120, concrete_reviewed_observation: 'Crack.', concrete_reviewed_findings: [{ type: 'chipped_edge', observation: 'Edge loss at the joint.' }] });
  assert.ok(lines.includes('Size: 10 ft x 4 ft'));
  assert.ok(lines.includes('User Reviewed findings: chipped edge: Edge loss at the joint.'));
  assert.match(server, /concretePhotoDetails\(capture\)\.join\(' \| '\)/); assert.match(server, /concretePhotoDetails\(row\)\.join\(' \| '\)/);
  assert.match(server, /SELECT count\(\*\)::int n FROM concrete_tickets WHERE user_id=\$1 AND status='saved' AND job_id=ANY\(\$2::int\[\]\)/);
  assert.match(server, /ConcreteQuality\.reportLines\(pool,req\.user\.id,job&&job\.id,req\.query\.tz\)/);
});

test('batch ticket attached to a placement photo is read into a linked draft; only batch tickets are read', async () => {
  const Q = require('../concrete-quality');
  let insert;
  const pool = { query: async (sql, args) => { insert = { sql, args }; return { rows: [{ id: 77, job_id: args[4], placement_capture_id: args[5] }] }; } };
  const visionJSON = async (file, prompt) => { assert.equal(prompt, Q.TICKET_PROMPT); return { data: { ticket_number: 'A1', load_quantity: 9, load_unit: 'yd3', confidence: 'high' } }; };
  const out = await Q.readTicketDraft({ pool, visionJSON, userId: 3, filePath: '/tmp/x.jpg', photoPath: '/uploads/x.jpg', jobId: 12, placementCaptureId: 40 });
  assert.equal(out.row.id, 77); assert.equal(out.confidence, 'high');
  assert.match(insert.sql, /INSERT INTO concrete_tickets \(user_id, photo_path, confidence, raw_ai, job_id, placement_capture_id,/);
  assert.deepEqual(insert.args.slice(0, 2), [3, '/uploads/x.jpg']); assert.equal(insert.args[4], 12); assert.equal(insert.args[5], 40);
  const attach = slice(server, "app.post('/api/concrete/captures/:id/ticket'", "\nfunction evidenceChecklist");
  assert.match(attach, /if\(referenceType==='batch_ticket'\)\{try\{const read=await ConcreteQuality\.readTicketDraft\(/);
  assert.match(attach, /ticket_draft_id:draft\?draft\.id:null/);
  assert.match(read('db.js'), /ALTER TABLE concrete_tickets ADD COLUMN IF NOT EXISTS placement_capture_id INTEGER REFERENCES captures\(id\) ON DELETE SET NULL/);
  const app = read('public/app.js');
  assert.match(app, /fd\.append\('reference_type',referenceType\)/);
  assert.match(app, /state\._concreteTicketDraftId=draftId;state\.view='concrete-ticket'/);
  assert.match(read('public/concrete-quality-ui.js'), /if \(ctx\.ticketDraftId\) openDraft\(mount, ctx, ctx\.ticketDraftId\)/);
});

test('Concrete report times use the time zone the app sends', async () => {
  const Q = require('../concrete-quality');
  const pool = { query: async sql => ({ rows: /FROM concrete_temperatures/.test(sql) ? [{ kind: 'delivery', reading_f: 70, check_status: 'ok', taken_at: new Date('2026-07-01T18:00:00Z') }] : [] }) };
  const ny = await Q.reportLines(pool, 1, 2, 'America/New_York'), la = await Q.reportLines(pool, 1, 2, 'America/Los_Angeles'), bad = await Q.reportLines(pool, 1, 2, 'Mars/Base');
  assert.match(ny.temperatures[0], /2:00\s?PM/); assert.match(la.temperatures[0], /11:00\s?AM/);
  assert.match(bad.temperatures[0], /1:00\s?PM/, 'an invalid zone falls back to Central time');
  const app = read('public/app.js');
  assert.match(app, /new URLSearchParams\(\{doc:format,tz:concreteReportZone\(\)\}\)/);
  assert.match(app, /'\/api\/concrete\/report\?'\+new URLSearchParams\(\{\.\.\.\(job\?\{job_id:job\}:\{\}\),tz:concreteReportZone\(\)\}\)/);
});

test('Concrete Temperature Log remembers thickness and project limits per job', () => {
  const data = {}, localStorage = { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
  const ctx = { window: {}, localStorage, Intl, Date }; vm.createContext(ctx);
  vm.runInContext(read('public/concrete-quality-ui.js'), ctx);
  const ui = ctx.window.PhotoNotesConcreteQualityUI;
  assert.notEqual(ui.limitsKey(4), ui.limitsKey(5)); assert.match(ui.limitsKey(4), /4$/);
  data[ui.limitsKey(4)] = JSON.stringify({ section: 'thin', minimum: '50', maximum: '90' });
  assert.deepEqual({ ...ui.jobLimits(4) }, { section: 'thin', minimum: '50', maximum: '90' });
  assert.deepEqual({ ...ui.jobLimits(5) }, { section: '', minimum: '', maximum: '' }, 'another job starts blank');
  const src = read('public/concrete-quality-ui.js');
  assert.match(src, /\$\('ctpJob'\)\.onchange = \(\) => \{ if \(!limitsTouched\) \{ const v = jobLimits\(\$\('ctpJob'\)\.value\)/);
  assert.match(src, /saveJobLimits\(body\.job_id,/);
  assert.doesNotMatch(src, /pn_concrete_temp_min_v1/);
});

test('Send to Ramo Optimizer: captions carry the concrete details within the length limit', () => {
  const R = require('../ramo-intake');
  const c = { photo_title: 'Pour 2', note: 'North bay', concrete_element: 'slab', concrete_phase: 'work', concrete_purpose: 'placement', concrete_condition: 'monitor', concrete_severity: 'minor', concrete_mix: '4000 psi', concrete_location: 'Grid B-3', latitude: 29.42, longitude: -98.49 };
  const caption = R.previewCaption(c, () => '10 ft x 4 ft, 40.0 sq ft');
  for (const part of ['Pour 2', 'Concrete element: Slab', 'Photo purpose: Concrete placement', 'Condition: monitor', 'Severity: minor', 'Mix or specification: 4000 psi', 'Location on site: Grid B-3', 'Confirmed size: 10 ft x 4 ft, 40.0 sq ft', 'GPS: 29.420000, -98.490000']) assert.ok(caption.includes(part), part);
  const plain = R.concreteDetails({ concrete_condition: 'not_assessed', concrete_severity: 'none' });
  assert.deepEqual(plain, [], 'unassessed condition and severity are left out');
  assert.equal(R.previewCaption({ note: 'x'.repeat(25000), concrete_element: 'slab' }).length, 20000);
  assert.match(server, /registerRamoIntake\(app,\{pool,requireAuth,requireConcrete,uploadDir:UPLOAD_DIR,formatDims:exportDims\}\)/);
});

test('templates and Duplicate for New Photo carry concrete location and mix', () => {
  const { sanitize } = require('../capture-templates');
  const t = sanitize('concrete', { concretePhase: 'work', concreteLocation: ' Front walk ', concreteMix: '4000 psi' });
  assert.equal(t.concreteLocation, 'Front walk'); assert.equal(t.concreteMix, '4000 psi');
  assert.equal(sanitize('paving', { concreteLocation: 'x' }).concreteLocation, undefined);
  assert.equal(sanitize('concrete', { concreteMix: 'm'.repeat(300) }).concreteMix.length, 100);
  const { context } = require('../public/duplicate-context');
  const d = context({ id: 1, concrete_location: 'Rear patio', concrete_mix: '3500 psi', concrete_element: 'patio' }, 'concrete');
  assert.equal(d.concrete.location, 'Rear patio'); assert.equal(d.concrete.mix, '3500 psi');
  assert.match(read('public/capture-templates.js'), /'concreteElement','concreteLocation','concreteMix'\]/);
});

test('Concrete follow-up photos keep the original element and location', () => {
  const s = read('photo-follow-ups.js');
  assert.match(s, /concrete_element=COALESCE\(c\.concrete_element,\(SELECT r\.concrete_element FROM captures r WHERE r\.id=\$2 AND r\.user_id=\$3\)\)/);
  assert.match(s, /concrete_location=COALESCE\(c\.concrete_location,\(SELECT r\.concrete_location FROM captures r WHERE r\.id=\$2 AND r\.user_id=\$3\)\)/);
  assert.match(s, /concrete_phase=COALESCE\(c\.concrete_phase,'follow_up'\)/);
  const client = read('public/photo-follow-ups.js');
  assert.match(client, /state\._concreteCapture=\{phase:'follow_up',purpose:'routine_review',jobId:state\.jobId,element,location/);
});

test('Analyze Photo: reviewer can add and remove findings, findings are kept on the photo, dialog uses the app photo URL', () => {
  const src = read('public/visual-analysis.js');
  assert.match(src, /id="vaAddFinding"/); assert.match(src, /data-va-remove=/);
  assert.doesNotMatch(src, /src="\$\{escape\(history\.photo\.photo_path\)\}"/);
  const ctx = { window: {}, document: {}, capturePhotoSrc: c => '/api/captures/' + c.id + '/stamped' }; vm.createContext(ctx);
  vm.runInContext(src, ctx);
  assert.equal(ctx.window.PhotoNotesVisualAnalysis.photoUrl({ id: 5, photo_path: '/uploads/a.jpg' }), '/api/captures/5/stamped');
  const ctx2 = { window: {}, document: {}, photoSrc: p => p + '?v=3' }; vm.createContext(ctx2); vm.runInContext(src, ctx2);
  assert.equal(ctx2.window.PhotoNotesVisualAnalysis.photoUrl({ id: 5, photo_path: '/uploads/a.jpg' }), '/uploads/a.jpg?v=3');
  assert.match(read('visual-analysis.js'), /ADD COLUMN IF NOT EXISTS concrete_reviewed_findings JSONB/);
  assert.match(read('concrete-analyzer.js'), /concrete_reviewed_findings=\$7/);
});

test('help: map zones and classification are Paving only; new controls have Help', () => {
  const help = read('public/help-catalog.js');
  assert.doesNotMatch(help, /Measurements, map and classification apply to Paving and Concrete/);
  assert.match(help, /Map zones and classification apply only to Paving Pro\. Concrete Pro has measurements, Precision Measure and Patio and Foundation Areas\./);
  const { inventory } = require('../scripts/help-coverage.cjs');
  assert.deepEqual(inventory().filter(r => !r.covered).map(r => r.id || r.label), []);
});

test('no em dashes in the text this change adds', () => {
  for (const f of ['concrete-fields.js', 'measure-check.js']) assert.doesNotMatch(read(f), /\u2014/);
  for (const marker of ['openConcreteDetailsEditor', 'showConcreteTicketDraftNotice']) assert.doesNotMatch(slice(read('public/app.js'), 'function ' + marker, '\n}\n'), /\u2014/);
});
