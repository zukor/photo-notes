const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root=path.join(__dirname,'..');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8')+fs.readFileSync(path.join(root,'editions.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

test('version management is admin-only while switching follows saved access',()=>{
  assert.match(server,/app.post\('\/api\/admin\/users\/:id\/versions',requireAdmin/);
  assert.match(server,/editionAccess\(user\).includes\(key\)/);
});
test('accounts with multiple assigned versions see the compact switcher',()=>{
  assert.match(app,/state.me.edition_access.length>1/);
  assert.match(app,/editionSwitcherOptions\(\)/);
  assert.match(app,/<select id="editionSwitcher" aria-label="Switch Photo Notes version">/);
  assert.doesNotMatch(app,/<span>Version<\/span>/);
  assert.match(app,/editionSwitcher.onchange=async/);
});

test('shared editions use Library while property editions retain specialist Organize and Assets',()=>{
  assert.match(app,/id="tabOrganize"[^>]*>\$\{isHoaClient\(\)\?'Organize':'Library'\}<\/button>/);
  assert.match(app,/isHoaClient\(\)\?`<button[^`]+id="tabEdit"[^`]+>Assets<\/button>`:''/);
});

test('Concrete keeps Create as the flexible document-building workflow',()=>{
  assert.match(app,/id="tabCreate"[^>]*>\$\{isHoaClient\(\)\?'Inspections':'Create'\}<\/button>/);
  assert.match(app,/state\.view=isHoaClient\(\)\?'hoa-inspections':'create'/);
  assert.doesNotMatch(app,/id="tabCreate"[^>]*>\$\{isHoaClient\(\)\?'Inspections':isConcreteClient\(\)\?'Reports':'Create'\}<\/button>/);
});

test('every edition uses the final outlined logo with separate tier text',()=>{
 const crypto=require('node:crypto');
 for(const [variant,hash] of [['static','040b41dd67fb193b4cb37fadcc69bcfad19ad8b5ce05ed2be15b44d1253ec5d2'],['animated','7de36b971255649edf9447a13d4c91b39a23ed0b7bc57efdf763685c8bf2023c']]){
  const file=fs.readFileSync(path.join(root,'public',`photonotes-ai-logo-${variant}.svg`));assert.equal(crypto.createHash('sha256').update(file).digest('hex'),hash);assert.doesNotMatch(file.toString(),/<script|<text/);
 }
 assert.match(app,/class="brand photonotes-lockup"/);assert.match(app,/class="photonotes-tier"/);assert.match(app,/photonotes-ai-logo-static\.svg/);assert.match(app,/photonotes-ai-logo-animated\.svg/);
 const animated=fs.readFileSync(path.join(root,'public','photonotes-ai-logo-animated.svg'),'utf8');assert.match(animated,/dur="3\.5s"/);
});

test('Paving classification covers broader visible pavement failures',()=>{
  for(const defect of ['joint_failure','utility_cut_failure','surface_deformation','drainage_damage','base_failure'])assert.match(server,new RegExp(defect));
});
