const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('testing assignments are persisted and seeded for four named testers', () => {
  const db = read('db.js');
  assert.match(db, /CREATE TABLE IF NOT EXISTS testing_assignments/);
  for (const name of ['Jose', 'Rolando', 'Hassan', 'Gabby']) assert.match(db, new RegExp(`name:'${name}'`));
  assert.match(db, /completed_step_ids/);
  assert.match(read('server.js'), /testing_assignment_submitted/);
});

test('tester checklist and completion APIs are authenticated', () => {
  const server = read('server.js');
  assert.match(server, /\/api\/testing\/assignments\/mine', requireAuth/);
  assert.match(server, /\/api\/testing\/assignments\/:id\/progress', requireAuth/);
  assert.match(server, /\/api\/testing\/assignments\/:id\/submit', requireAuth/);
  assert.match(server, /complete every checklist item before submitting/);
  assert.match(server, /\/api\/admin\/testing-assignments', requireAdmin/);
});

test('general Pro account menu exposes assignment UI and admin shows live progress', () => {
  const app = read('public/app.js');
  const admin = read('public/admin.html');
  assert.match(app, /My Testing Assignment/);
  assert.match(app, /Submit Assignment Complete/);
  assert.match(app, /data-assignment-check/);
  assert.match(admin, /Testing Assignments/);
  assert.match(admin, /Checklist progress/);
});
