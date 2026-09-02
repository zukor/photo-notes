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
