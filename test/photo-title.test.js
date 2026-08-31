const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const db = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

test('photo titles persist on captures and remain owner-scoped', () => {
  assert.match(db, /photo_title\s+TEXT/);
  assert.match(db, /ALTER TABLE captures ADD COLUMN IF NOT EXISTS photo_title TEXT/);
  assert.match(server, /photo_title = \$\$\{vals\.length\}/);
  assert.match(server, /WHERE id = \$\$\{vals\.length - 1\} AND user_id = \$\$\{vals\.length\}/);
  assert.match(server, /COALESCE\(c\.photo_title,''\) ILIKE/);
});

test('Organize can add missing titles and Edit can add or change titles', () => {
  assert.match(app, /state\.view==='organize'&&!c\.photo_title\?'Add Photo Title'/);
  assert.match(app, /state\.view==='edit'\?\(c\.photo_title\?'Change Photo Title':'Add Photo Title'\)/);
  assert.match(app, /class="phototitlewrap" data-id=/);
  assert.match(app, /class="phototitlewrap"[\s\S]*class="photo-title"[\s\S]*<img src="\$\{photoSrc\(c\.photo_path\)\}" alt="capture"/);
  assert.match(app, /function startEditPhotoTitle\(id, rows\)/);
  assert.match(app, /JSON\.stringify\(\{photo_title:value\}\)/);
});

test('Capture remains free of a photo-title field', () => {
  const capture = app.slice(app.indexOf('function renderCapture()'), app.indexOf('function renderCameraTools'));
  assert.doesNotMatch(capture, /photo_title|Photo Title/);
});
