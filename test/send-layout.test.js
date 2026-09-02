const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public','styles.css'),'utf8');
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
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

test('Send selection supports select all and clear all actions',()=>{
  assert.match(app,/id="selectAllSendCaptures"[^>]*>Select All<\/button>/);
  assert.match(app,/id="clearSendSelection"[^>]*>Clear All<\/button>/);
  assert.match(app,/function selectAllSendCaptures\(\) \{[\s\S]*?window\._sendCaptures[\s\S]*?state\.selectedIds\.add/);
  assert.match(app,/function clearSendSelection\(\) \{[\s\S]*?state\.selectedIds\.clear\(\);[\s\S]*?querySelectorAll\('\.sendchk'\)/);
  assert.match(css,/\.send-selection-bar \{/);
  assert.match(css,/\.send-selection-bar \{[^}]*flex-wrap:wrap/);
  assert.match(css,/\.send-selection-actions \{[^}]*max-width:100%/);
});

test('Send cards use identifiable previews and allow a confirmed Photo Note deletion',()=>{
  assert.match(app,/class="send-capture-details"/);
  assert.match(app,/c\.photo_title \|\| 'Untitled Photo'/);
  assert.match(app,/data-delete-capture="\$\{c\.id\}"[^>]*>Delete Photo Note<\/button>/);
  assert.match(app,/async function deleteSendCapture\(id, button\)/);
  assert.match(app,/Delete this Photo Note\? This can't be undone\./);
  assert.match(app,/JSON\.stringify\(\{ ids: \[id\] \}\)/);
  assert.match(css,/\.send-capture-row \{[^}]*minmax\(120px,150px\)/);
  assert.match(css,/\.send-capture-row img, \.send-no-photo \{[^}]*aspect-ratio:4\/3/);
});

test('photo sharing is sized, bounded, visible, and recoverable',()=>{
  assert.match(app,/id="shareActionStatus" role="status" aria-live="polite"/);
  assert.match(app,/photoRows\.length > 20/);
  assert.match(app,/Preparing \$\{complete\} of \$\{photoRows\.length\} share-sized photos/);
  assert.match(app,/preparedPhotoShare\.signature === signature/);
  assert.match(app,/Tap Share Photos again to open the share menu/);
  assert.match(app,/api\/captures\/\$\{c\.id\}\/share-photo/);
  assert.match(css,/\.share-action-status\.error/);
  assert.match(server,/app\.get\('\/api\/captures\/:id\/share-photo', requireAuth/);
  assert.match(server,/WHERE id=\$1 AND user_id=\$2 AND photo_path IS NOT NULL/);
  assert.match(server,/renderImageStamped\(local, 'web', 'jpeg', capture\)/);
});
