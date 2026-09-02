const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const manifest=fs.readFileSync(path.join(root,'public','manifest.json'),'utf8');

test('app shell and installed-app launch background use pure white',()=>{
  assert.match(css,/body \{[\s\S]*?background: #fff;/);
  assert.equal(JSON.parse(manifest).background_color,'#ffffff');
  assert.match(app,/backgroundColor:'#ffffff'/);
});

test('Send actions distinguish original-photo sharing from document downloads',()=>{
  assert.match(app,/id="sharephotos">Share Photos<\/button>/);
  assert.match(app,/id="sendformat"[^>]*><option value="pdf">PDF<\/option><option value="docx">Word<\/option><option value="bundle">Markdown \+ Photos<\/option>/);
  assert.match(app,/id="senddocument">Download<\/button>/);
  assert.doesNotMatch(app,/Send as PDF|Send as Word/);
  assert.match(app,/deliverExport\(document\.getElementById\('sendformat'\)\.value, null, false\)/);
  assert.match(css,/\.delivery-actions \{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(92px,\.75fr\) minmax\(0,1fr\)/);
});

test('Send selection can be cleared in one action',()=>{
  assert.match(app,/id="clearSendSelection"[^>]*>Clear All<\/button>/);
  assert.match(app,/function clearSendSelection\(\) \{[\s\S]*?state\.selectedIds\.clear\(\);[\s\S]*?querySelectorAll\('\.sendchk'\)/);
  assert.match(css,/\.send-selection-bar \{/);
});
