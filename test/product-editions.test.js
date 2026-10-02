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

test('every edition uses Organize for the shared workflow tab',()=>{
  assert.match(app,/id="tabOrganize"[^>]*>Organize<\/button>/);
  assert.doesNotMatch(app,/id="tabOrganize"[^>]*>\$\{isHoaClient\(\)\?'Visits':isConcreteClient\(\)\?'Projects':'Organize'\}<\/button>/);
});

test('Concrete keeps Create as the flexible document-building workflow',()=>{
  assert.match(app,/id="tabCreate"[^>]*>\$\{isHoaClient\(\)\?'Inspections':'Create'\}<\/button>/);
  assert.match(app,/state\.view=isHoaClient\(\)\?'hoa-inspections':'create'/);
  assert.doesNotMatch(app,/id="tabCreate"[^>]*>\$\{isHoaClient\(\)\?'Inspections':isConcreteClient\(\)\?'Reports':'Create'\}<\/button>/);
});

test('every edition uses the final outlined logo with separate tier text',()=>{
 const crypto=require('node:crypto');
 for(const [variant,hash] of [['static','b2dc498dd862b4136546f0ae40b915e7a7532af89390365874774bdb13813897'],['animated','5ea4e71f21182ea232426a7bbaecd4c657d5e78840103f06007d97f1ace60556']]){
  const file=fs.readFileSync(path.join(root,'public',`photonotes-ai-logo-${variant}.svg`));assert.equal(crypto.createHash('sha256').update(file).digest('hex'),hash);assert.doesNotMatch(file.toString(),/<script|<text/);
 }
 assert.match(app,/class="brand photonotes-lockup"/);assert.match(app,/class="photonotes-tier"/);assert.match(app,/photonotes-ai-logo-static\.svg/);assert.match(app,/photonotes-ai-logo-animated\.svg/);
 const animated=fs.readFileSync(path.join(root,'public','photonotes-ai-logo-animated.svg'),'utf8');assert.match(animated,/dur="3\.5s"/);
});

test('Paving classification covers broader visible pavement failures',()=>{
  for(const defect of ['joint_failure','utility_cut_failure','surface_deformation','drainage_damage','base_failure'])assert.match(server,new RegExp(defect));
});
