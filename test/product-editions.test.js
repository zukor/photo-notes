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
  for(const label of ['PNAI','RIR','PP','HMP','CP','RP'])assert.match(app,new RegExp(`>${label}<`));
});

test('every edition uses Organize for the shared workflow tab',()=>{
  assert.match(app,/id="tabOrganize">Organize<\/div>/);
  assert.doesNotMatch(app,/id="tabOrganize">\$\{isHoaClient\(\)\?'Visits':isConcreteClient\(\)\?'Projects':'Organize'\}<\/div>/);
});

test('Concrete keeps Create as the flexible document-building workflow',()=>{
  assert.match(app,/id="tabCreate">\$\{isHoaClient\(\)\?'Inspections':'Create'\}<\/div>/);
  assert.match(app,/state\.view=isHoaClient\(\)\?'hoa-inspections':'create'/);
  assert.doesNotMatch(app,/id="tabCreate">\$\{isHoaClient\(\)\?'Inspections':isConcreteClient\(\)\?'Reports':'Create'\}<\/div>/);
});

test('HOA Maintenance Pro uses its edition logo',()=>{
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
  const logo=fs.readFileSync(path.join(root,'public','photo-notes-ai-hoa-maintenance-pro-animated.svg'),'utf8');
  assert.match(css,/hoa-pro-brand[\s\S]*photo-notes-ai-hoa-maintenance-pro-animated\.svg/);
  assert.match(logo,/aria-label="Photo Notes AI Hoa Maintenance Pro logo"/);
  assert.doesNotMatch(logo,/<image href=/);
  assert.ok(logo.length > 30000, 'expected the complete supplied self-contained HOA SVG');
});

test('branded headers render only their supplied edition logos',()=>{
  assert.match(app,/isProClient\(\)\|\|isRoadIssuesClient\(\)\?'':'<span class="product-suite-name">Photo Notes<\/span>'/);
  assert.doesNotMatch(app,/isProClient\(\)\|\|isRoadIssuesClient\(\)\?esc\(productName\(\)\)/);
});

test('new supplied Basic, Paving, Road Issue Reporter, and Roofer artwork is wired directly',()=>{
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
  const expected=[
    ['basic','Photo Notes AI Basic logo','bbee2a2aeff21bed6da6d812c7ab6e7de31bf02be7f1fb90bda205745fe3140a'],
    ['paving-pro','Photo Notes AI Paving Pro logo','497870ea1e8ef55828cede46d6c44136762b9ab251e9b79abebd5ea6cdac548e'],
    ['road-issue-reporter','Photo Notes AI Road Issue Reporter logo','dc09e5d402ae87f8b1a36192d4f46a64ba84e94bfc738178d53d6ef15f7cb6e1'],
    ['roofer-pro','Photo Notes AI Roofer Pro logo','115ff0d049ba5c590cc8326060cff9cad2d4382b845a8a0f046989e9e9817b5f'],
  ];
  const crypto=require('node:crypto');
  for(const [name,label,hash] of expected){const file=fs.readFileSync(path.join(root,'public',`photo-notes-ai-${name}-animated.svg`));assert.match(file.toString(),new RegExp(`aria-label="${label}"`));assert.equal(crypto.createHash('sha256').update(file).digest('hex'),hash);assert.match(css,new RegExp(`photo-notes-ai-${name}-animated\\.svg\\?v=118`));}
  assert.match(server,/roofer:\{plan:'pro',pro_type:'roofer'\}/);
  assert.match(app,/data-edition="roofer"[\s\S]*>RP<\/button>/);
});

test('Concrete Pro uses the supplied blue subtitle trial logo',()=>{
  const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
  const logo=fs.readFileSync(path.join(root,'public','photo-notes-ai-concrete-pro-animated.svg'),'utf8');
  assert.match(css,/concrete-pro-brand[\s\S]*photo-notes-ai-concrete-pro-animated\.svg\?v=78/);
  assert.match(logo,/aria-label="Photo Notes AI Concrete Pro logo, animated, blue subtitle trial"/);
  assert.match(logo,/fill="#1d4ed8"/);
});

test('Paving classification covers broader visible pavement failures',()=>{
  for(const defect of ['joint_failure','utility_cut_failure','surface_deformation','drainage_damage','base_failure'])assert.match(server,new RegExp(defect));
});
