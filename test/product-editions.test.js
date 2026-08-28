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

test('Paving classification covers broader visible pavement failures',()=>{
  for(const defect of ['joint_failure','utility_cut_failure','surface_deformation','drainage_damage','base_failure'])assert.match(server,new RegExp(defect));
});
