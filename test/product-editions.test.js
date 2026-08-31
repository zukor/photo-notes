const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

test('edition switching is restricted to administrators',()=>{
  assert.match(server,/app\.post\('\/api\/admin\/switch-edition', requireAdmin/);
  assert.match(server,/WHERE id=\$3 AND role='admin'/);
});

test('only administrators see the compact edition switcher',()=>{
  assert.match(app,/state\.me&&state\.me\.role==='admin'/);
  for(const label of ['PNAI','PP','HMP','CP'])assert.match(app,new RegExp(`>${label}<`));
});

test('HOA Maintenance Pro uses its edition logo',()=>{
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
  const logo=fs.readFileSync(path.join(root,'public','photo-notes-ai-hoa-maintenance-pro-animated.svg'),'utf8');
  assert.match(css,/hoa-pro-brand[\s\S]*photo-notes-ai-hoa-maintenance-pro-animated\.svg/);
  assert.match(logo,/HOA MAINTENANCE PRO/);
  assert.match(logo,/aria-label="Photo Notes AI HOA Maintenance Pro logo"/);
});

test('Pro headers render only their supplied edition logos',()=>{
  assert.match(app,/isRoadIssuesClient\(\)\?'<span class="road-issues-logo"[\s\S]*':isProClient\(\)\?'':'<span class="product-suite-name">Photo Notes<\/span>'/);
  assert.doesNotMatch(app,/isProClient\(\)\|\|isRoadIssuesClient\(\)\?esc\(productName\(\)\)/);
});

test('Paving classification covers broader visible pavement failures',()=>{
  for(const defect of ['joint_failure','utility_cut_failure','surface_deformation','drainage_damage','base_failure'])assert.match(server,new RegExp(defect));
});
