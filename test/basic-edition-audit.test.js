const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('core editions keep help and issue reporting while industry camera tools stay gated', () => {
  assert.match(app, /!isIndustryProClient\(\) \? `<button class="issue-fab \$\{isRoadIssuesClient\(\)\?'road-issue-fab':''\}"/);
  assert.match(app, /if \(isIndustryProClient\(\) \|\| isRoadIssuesClient\(\) \|\| !TENSOR_HELP_TOPICS\[state\.view\]\) return/);
  assert.match(app, /isIndustryProClient\(\) && \['ticket_scanner','camera_readers','before_after'\]\.some\(featureOn\)/);
  assert.match(server, /currentPlan\(req\.user\.id\) === 'pro' && await currentProduct\(req\.user\.id\) !== 'general'/);
});

test('Pro-only analytics and reports require a Pro plan on the server', () => {
  const guards = server.match(/if \(await currentPlan\(req\.user\.id\) !== 'pro'\) return res\.status\(403\)\.json\(\{ error: 'pro only' \}\);/g) || [];
  assert.ok(guards.length >= 1, 'expected server-side Pro plan guards');
  assert.match(app, /isIndustryProClient\(\) && c\.defect_type/);
  assert.match(server, /app\.get\('\/api\/export\/proposal', requireAuth,[\s\S]*?currentPlan\(req\.user\.id\) !== 'pro'/);
});

test('edition switching is never exposed to ordinary Basic testers', () => {
  assert.match(app, /state\.me&&state\.me\.role==='admin'\?`<label class="edition-switcher"/);
  assert.match(server, /app\.post\('\/api\/admin\/switch-edition', requireAdmin/);
});

test('Basic paints only the SVG wordmark, without duplicate live title text', () => {
  assert.match(styles, /\.brand:not\(\.pro-edition-brand\) \.product-suite-name,[\s\S]*\.product-edition-name \{ display:none; \}/);
  assert.match(styles, /background-image: url\('\/photo-notes-ai-basic-animated\.svg\?v=118'\)/);
  assert.match(styles, /aspect-ratio: 940 \/ 214/);
  assert.match(styles, /background-position: center top/);
  assert.match(styles, /background-size: 100% auto/);
  const suppliedLogo=fs.readFileSync(path.join(root,'public','photo-notes-ai-basic-animated.svg'),'utf8');
  assert.match(suppliedLogo,/aria-label="Photo Notes AI Basic logo"/);
  assert.match(suppliedLogo,/<rect x="818\.5" y="24" width="61" height="61" rx="10" fill="#e8231a"\/>/);
});

test('admin issue center can compare tester and device reports', () => {
  assert.match(admin, /id="issueTesterFilter"/);
  assert.match(admin, /id="issueDeviceFilter"/);
  assert.match(admin, /function issueDevice\(i\)/);
  assert.match(admin, /Tester and device comparison/);
});
