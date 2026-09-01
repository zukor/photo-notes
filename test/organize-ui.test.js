const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('Organize presents its controls as a clear task sequence before the library', () => {
  for (const heading of ['Choose a job', 'Find Photo Notes', 'Work with selected Photo Notes', 'Current Photo Notes']) {
    assert.match(app, new RegExp(heading));
  }
  const choose = app.indexOf('Choose a job');
  const find = app.indexOf('Find Photo Notes');
  const work = app.indexOf('Work with selected Photo Notes');
  const library = app.indexOf('Current Photo Notes');
  assert.ok(choose < find && find < work && work < library);
  assert.match(app, /class="organize-library-heading"/);
});

test('Organize hierarchy remains distinct and collapses to one column on phones', () => {
  assert.match(css, /\.organize-context-section \{ border-top:5px solid #1254a3/);
  assert.match(css, /\.organize-search-section \{ border-top:5px solid #2f76c6/);
  assert.match(css, /\.organize-actions-section \{ border-top:5px solid #17324f/);
  assert.match(css, /\.organize-batch-grid \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.organize-search-grid, \.organize-batch-grid \{ grid-template-columns:1fr; \}/);
});
