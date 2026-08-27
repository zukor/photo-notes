const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const db = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

test('Concrete Pro data stays attached to photo captures', () => {
  for (const field of ['concrete_element', 'concrete_stage', 'concrete_condition', 'concrete_severity', 'concrete_mix', 'concrete_location']) {
    assert.match(db, new RegExp(`ALTER TABLE captures ADD COLUMN IF NOT EXISTS ${field} TEXT`));
  }
  assert.doesNotMatch(db, /CREATE TABLE IF NOT EXISTS concrete_projects/);
});

test('Concrete Pro report is product protected and photo backed', () => {
  assert.match(server, /async function requireConcrete/);
  assert.match(server, /app\.get\('\/api\/concrete\/report',requireAuth,requireConcrete/);
  assert.match(server, /'c\.photo_path IS NOT NULL'/);
});

test('Concrete Pro has photo context capture and evidence reporting UI', () => {
  assert.match(app, /Concrete Photo Evidence/);
  assert.match(app, /Concrete Photo Evidence Report/);
  assert.match(app, /isConcreteClient\(\).*concrete-report/);
});
