const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');

test('every reusable photo card shows labeled GPS above its address',()=>{
  assert.match(app,/function photoLocationHtml\(c,addressFallback='No address'\)/);
  assert.match(app,/photo-location-label">GPS<\/div>[\s\S]*photo-location-label">Address<\/div>/);
  assert.match(app,/function captureCardHtml\(c\)[\s\S]*\$\{photoLocationHtml\(c\)\}/);
  assert.match(app,/function pairCardHtml\(before, after\)[\s\S]*\$\{photoLocationHtml\(c\)\}/);
});

test('missing coordinates are stated instead of being confused with the address',()=>{
  assert.match(app,/latitude!=null&&c\.longitude!=null/);
  assert.match(app,/:\s*'Not available'/);
});
