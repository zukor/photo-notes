const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const app=read('public/app.js'),server=read('server.js'),db=read('db.js'),admin=read('public/admin.html'),styles=read('public/styles.css');
test('Basic is capture-only while general Pro owns the complete workflow',()=>{
  assert.match(app,/function isGeneralProClient\(\)/);
  assert.match(app,/isRoadIssuesClient\(\)\|\|isBasicClient\(\)\?'':`<nav class="tabs workflow-tabs/);
  assert.match(app,/else if \(isBasicClient\(\)\) \{ state\.view='capture'; renderCapture\(\); \}/);
  assert.match(app,/button\.dataset\.edition==='basic'\?'capture'/);
  assert.match(server,/pro:\{plan:'pro',pro_type:'general'\}/);
});
test('general Pro retains the former Basic help, issue, and assignment workflows',()=>{
  assert.match(app,/!isIndustryProClient\(\) \? `<button class="issue-fab/);
  assert.match(app,/isGeneralProClient\(\)\?'<button type="button" id="myAssignment"/);
  assert.match(app,/if \(isIndustryProClient\(\) \|\| isRoadIssuesClient\(\)/);
  assert.match(server,/currentProduct\(req\.user\.id\) !== 'general'/);
});
test('administrators can create, assign, and switch to general Pro',()=>{
  assert.match(admin,/<option value="general"[^>]*>Photo Notes Pro<\/option>/);
  assert.match(admin,/\{plan,pro_type:'general'\}/);
  assert.match(server,/\['roads','general','paving','hoa','concrete','roofer'\]/);
  assert.match(db,/SET plan='pro',pro_type='general' FROM testing_assignments/);
});
test('temporary Pro branding is explicit and replaceable by the supplied final SVG',()=>{
  assert.match(styles,/general-pro-brand/);
  assert.match(styles,/content:"PRO"/);
  assert.match(app,/>PRO<\/button>/);
});
