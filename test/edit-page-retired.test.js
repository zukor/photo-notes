const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..','public',file),'utf8');
const app=read('app.js');

test('the old Edit page and its Delete All are retired',()=>{
  assert.doesNotMatch(app,/function renderEdit\b|renderEdit\(/);
  assert.doesNotMatch(app,/id="delall"|id="delbtn"|doDeleteSelected|Delete ALL saved captures/);
  assert.doesNotMatch(read('i18n.js'),/Delete ALL saved captures|'Back to Edit'|Back to Edit'/);
  assert.match(app,/if\(state\.view==='edit'&&!state\._libraryOpenId\)state\.view=isHoaClient\(\)\?'photo-library':'organize';/);
  assert.match(app,/else if \(state\.view === 'edit'\) renderLibraryPhoto\(\);/);
  assert.match(app,/tabEdit\.onclick = \(\) => \{ state\.view='hoa-assets'; renderApp\(\); \};/);
});

test('every former Edit page link opens the Library photo detail view',()=>{
  assert.match(app,/function openLibraryPhoto\(id\)\{state\._libraryOpenId=Number\(id\);[^}]*state\.view='edit';renderApp\(\);\}/);
  assert.equal((app.match(/openPhoto:id=>openLibraryPhoto\(id\)/g)||[]).length,2,'Photo Requests and Damage / Incident records');
  assert.match(read('photo-follow-ups.js'),/data-fu-photo[^;]*openLibraryPhoto\(b\.dataset\.fuPhoto\)/);
  assert.match(read('qr-codes.js'),/state\.view='edit';state\._libraryOpenId=Number\(d\.id\);/);
  assert.match(app,/id="dimsBack">‹ Back to PhotoNote<\/button>/);
  assert.match(read('concrete-footprints.js'),/concreteFootprintReturnView==='edit'\?'Back to PhotoNote':'Organize'/);
  assert.match(app,/const returnView = state\.view;\n  const backFromMarkUp = \(\) => \{ state\.view = returnView; renderApp\(\); \};/);
  for(const file of fs.readdirSync(path.join(__dirname,'..','public')).filter(f=>f.endsWith('.js'))){
    const text=read(file);
    // Any remaining navigation to the 'edit' view must name the photo to show.
    for(const m of text.matchAll(/state\.view\s*=\s*'edit'/g)){
      const around=text.slice(Math.max(0,m.index-160),m.index+160);
      assert.match(around,/_libraryOpenId|function openLibraryPhoto/,`${file} opens view 'edit' without a photo`);
    }
  }
});

test('batch annotation templates retire with the old Edit page; single-photo templates stay in Mark Up',()=>{
  assert.doesNotMatch(app,/id="batchTemplate"|applyBatchAnnotations|wireBatchAnnotations|batchAnnotationPanel/);
  assert.match(app,/<select id="singleTemplate">/);
  assert.match(app,/id="saveAnnotationTemplate">Save as New Template<\/button>/);
  assert.doesNotMatch(read('help-catalog.js'),/batchTemplate|applyBatchAnnotations|batchAnnotation/);
});

test('Library cards show a short date and address line under the title',()=>{
  assert.match(app,/<div class="photo-title">\$\{esc\(c\.photo_title\|\|'Untitled PhotoNote'\)\}<\/div>\n    \$\{libraryCardMetaHtml\(c\)\}/);
  assert.match(app,/new Date\(c\.captured_at\|\|c\.created_at\)/);
  assert.match(app,/toLocaleDateString\(uiLocale\(\),\{year:'numeric',month:'short',day:'numeric'\}\)/);
  const source=app.match(/function shortAddress\(address\)\{[\s\S]*?\n\}/)[0];
  const shortAddress=new Function(source+';return shortAddress;')();
  assert.equal(shortAddress('123 Main St, San Antonio, TX 78201'),'123 Main St, San Antonio');
  assert.equal(shortAddress('123, Main Street, San Antonio, Texas, 78201, United States'),'123 Main Street, San Antonio');
  assert.equal(shortAddress('Elm Creek Forest East'),'Elm Creek Forest East');
  assert.equal(shortAddress(''),'');
  assert.equal(shortAddress(null),'');
  const css=fs.readFileSync(path.join(__dirname,'..','public','styles.css'),'utf8');
  assert.match(css,/\.library-photo-card \.library-card-meta \{[^}]*white-space:nowrap;[^}]*overflow:hidden;[^}]*text-overflow:ellipsis;/);
});
