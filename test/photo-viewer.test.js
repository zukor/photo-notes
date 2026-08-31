const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/styles.css'),'utf8');

test('photo viewer is explicitly view-only with zoom movement and reset controls',()=>{
  assert.match(app,/function openPhotoViewer\(src,title='Photo'\)/);
  assert.match(app,/Viewing only\. Drag the photo/);
  for(const label of ['Zoom In','Zoom Out','Move Left','Move Right','Move Up','Move Down','Reset Photo'])assert.match(app,new RegExp(label));
  assert.match(app,/scale=Math\.max\(1,Math\.min\(5/);
  assert.match(app,/const reset=\(\)=>\{scale=1;x=0;y=0;paint\(\);\}/);
});

test('all rendered card photos receive a discoverable viewer without changing files',()=>{
  assert.match(app,/function installPhotoViewerButtons\(root=document\)/);
  assert.match(app,/root\.querySelectorAll\('\.card img'\)/);
  assert.match(app,/button\.textContent='View & Zoom'/);
  assert.match(app,/new MutationObserver/);
  assert.doesNotMatch(app,/photoViewer[\s\S]{0,500}api\(/);
  assert.match(css,/\.photo-viewer-viewport \{[\s\S]*touch-action:none/);
});
