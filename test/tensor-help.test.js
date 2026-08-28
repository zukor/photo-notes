const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('Tensor Man is Basic-only and limited to the five workflow pages', () => {
  assert.match(app, /if \(isProClient\(\) \|\| !TENSOR_HELP_TOPICS\[state\.view\]\) return/);
  for (const page of ['capture', 'organize', 'edit', 'create', 'send']) assert.match(app, new RegExp(`\\b${page}: \\[`));
  assert.doesNotMatch(app, /TENSOR_HELP_TOPICS\s*=\s*\{[\s\S]*?hoa-maintenance:/);
});

test('Tensor Man has accessible controls, secondary chat fallback, and per-page persistence', () => {
  assert.match(app, /aria-label="Help with this page"/);
  assert.match(app, /Need help with this page\?/);
  assert.match(app, /Ask Tensor Man something else/);
  assert.match(app, /Chat help is coming soon\./);
  assert.match(app, /pn_tensor_help_hidden_\$\{page\}/);
  assert.match(app, /Hide help on this page/);
  assert.match(app, /Not now/);
});

test('Tensor Man is hidden at phone and small-tablet widths and cannot cover controls', () => {
  assert.match(css, /\.tensor-help-slot \{ min-height:44px/);
  assert.match(css, /@media \(max-width: 899px\) \{\s*\.tensor-help-slot \{ display:none; \}/);
});

test('new app and style versions are cache-busted', () => {
  assert.match(index, /styles\.css\?v=81/);
  assert.match(index, /app\.js\?v=81/);
});
