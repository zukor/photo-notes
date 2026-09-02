const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('Create Document uses a compact content-width button', () => {
  assert.match(app, /class="btn slim" id="gcreate">Create Document<\/button>/);
  assert.match(css, /\.workflow-create #gcreate \{[^}]*width:max-content;[^}]*max-width:100%;[^}]*padding-left:20px;[^}]*padding-right:20px/);
});

test('Create edits document contents while downloads and sharing stay on Send', () => {
  const detail = app.slice(app.indexOf('async function renderGroupDetail'), app.indexOf('async function loadEwrList'));
  assert.match(detail, /Build Your Document/);
  assert.match(detail, /Document Details/);
  assert.match(detail, /Document Contents/);
  assert.match(detail, /Edit captions, change their order, or remove anything you do not want included/);
  assert.doesNotMatch(detail, /Download Finished Document/);
  assert.doesNotMatch(detail, /Download Selected Formats/);
  assert.doesNotMatch(detail, /More Sharing Options/);
  assert.doesNotMatch(detail, /id="gfmts"|id="gexport"|id="continueSend"/);
});
