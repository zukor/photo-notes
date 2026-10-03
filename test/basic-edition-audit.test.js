const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'public', 'admin.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

test('core editions keep help and issue reporting while shared camera readers retain Pro gating', () => {
  assert.match(app, /<button class="issue-fab \$\{isRoadIssuesClient\(\)\?'road-issue-fab':''\}"/);
  assert.match(app, /window\.PhotoNotesHelp\.mount/);
  assert.match(app, /\(featureOn\('camera_readers'\) \|\| beforeAfterOn\(\)\) && !isPavingClient\(\)/);
  assert.doesNotMatch(server, /error:'core Photo Notes editions only'/);
});

test('Pro-only analytics and reports require a Pro plan on the server', () => {
  const guards = server.match(/if \(await currentPlan\(req\.user\.id\) !== 'pro'\) return res\.status\(403\)\.json\(\{ error: 'pro only' \}\);/g) || [];
  assert.ok(guards.length >= 1, 'expected server-side Pro plan guards');
  assert.match(app, /isIndustryProClient\(\) && c\.defect_type/);
  assert.match(server, /app\.get\('\/api\/export\/proposal', requireAuth,[\s\S]*?currentPlan\(req\.user\.id\) !== 'pro'/);
});

test('a single assigned version does not show an unnecessary switcher', () => {
  assert.match(app, /state.me.edition_access.length>1/);
});

test('Basic uses the final static header logo and a separate tier label',()=>{
 assert.match(app,/photonotes-ai-logo-static\.svg/);assert.match(app,/photonotes-tier/);
 assert.match(styles,/font-family:Inter,Helvetica,Arial,sans-serif/);
});

test('admin issue center can filter reports by tester and device', () => {
  assert.match(admin, /id="issueTesterFilter"/);
  assert.match(admin, /id="issueDeviceFilter"/);
  assert.match(admin, /function issueDevice\(i\)/);
});
