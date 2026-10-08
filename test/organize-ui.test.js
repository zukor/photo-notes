const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = require('./helpers/light-palette')(fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8'));

test('Library presents search, projects, selection, and saved PhotoNotes', () => {
  for (const heading of ['Library', 'Projects', 'Search', 'Selected PhotoNotes', 'Saved PhotoNotes']) {
    assert.match(app, new RegExp(heading));
  }
  assert.match(app, /class="organize-library-heading"/);
  assert.match(app, /data-library-open/);
  assert.match(app, />Open<\/button>/);
});

test('Organize hierarchy remains distinct and collapses to one column on phones', () => {
  assert.match(css, /\.organize-context-section \{ border-top:5px solid #1254a3/);
  assert.match(css, /\.organize-search-section \{ border-top:5px solid #2f76c6/);
  assert.match(css, /\.organize-actions-section \{ border-top:5px solid #17324f/);
  assert.match(css, /\.organize-batch-grid \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.organize-search-grid, \.organize-batch-grid \{ grid-template-columns:1fr; \}/);
});

test('Opened Library PhotoNotes allow an individually confirmed deletion', () => {
  assert.match(app, /state\._libraryOpenId[\s\S]*Delete PhotoNote/);
  assert.match(app, /querySelectorAll\('\[data-delete-organize\]'\)/);
  assert.match(app, /async function deleteOrganizePhotoNote\(id, button\)/);
  assert.match(app, /Delete this Photo Note\? This can't be undone\./);
  assert.match(app, /deleteOrganizePhotoNote[\s\S]*JSON\.stringify\(\{ ids: \[id\] \}\)[\s\S]*runSmartSearch\(\)/);
  assert.match(css, /\.organize-delete-capture \{[^}]*border-color:#b3261e;[^}]*color:#b3261e/);
});
