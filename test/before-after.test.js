const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('document detail returns and previews only complete before/after pairs', () => {
  assert.match(server, /before_id=ANY\(\$2\) AND after_id=ANY\(\$2\)/);
  assert.match(server, /res\.json\(\{ group: g, items, pairs, score, zones \}\)/);
  assert.match(app, /Before &amp; After Evidence/);
  assert.match(app, /Matched photos stay together in PDF, Word, and proposal exports/);
  assert.match(css, /\.before-after-preview/);
});

test('proposal treats a before/after pair as one location and retains both photos', () => {
  assert.match(server, /proposalUnits = buildRenderUnits\(items, proposalPairs\)/);
  assert.match(server, /unit\.pair \? unit\.pair\.after : unit\.single/);
  assert.match(server, /beforeByAfter/);
  assert.match(server, /Before: \$\{before\.note/);
  assert.match(server, /\['BEFORE', before\], \['AFTER', c\]/);
});
