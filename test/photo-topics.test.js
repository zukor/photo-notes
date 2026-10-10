const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const db=fs.readFileSync(path.join(root,'db.js'),'utf8');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');

test('accounts have no seeded topics',()=>{
  assert.doesNotMatch(db,/DEFAULT_AREAS|seedUserAreas|SELECT id, 'Fences & Walls'/);
  assert.ok(db.includes("require('./topic-reset').SQL"));
});

test('Capture does not silently assign the first topic',()=>{
  assert.doesNotMatch(app,/state\.area = state\.areas\[0\]/);
  assert.match(app,/data-area="">No Topic/);
  assert.match(app,/state\.area\?\[state\.area\]:\[\]/);
});

test('Opened Library PhotoNotes can replace photo topics',()=>{
  assert.match(app,/\['organize','edit'\]\.includes\(state\.view\)/);
  assert.match(app,/Change Topics/);
  assert.match(app,/function startEditTopics\(id, rows\)/);
  assert.match(app,/JSON\.stringify\(\{area_tags\}\)/);
  assert.match(app,/Save Topics/);
});
