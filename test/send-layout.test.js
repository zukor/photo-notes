const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8')+fs.readFileSync(path.join(__dirname,'..','public','issue-reporter.js'),'utf8');
const css=require('./helpers/light-palette')(fs.readFileSync(path.join(root,'public','styles.css'),'utf8'));
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const manifest=fs.readFileSync(path.join(root,'public','manifest.json'),'utf8');

test('app shell and installed-app launch background use pure white',()=>{
  assert.match(css,/body \{[\s\S]*?background: #fff;/);
  assert.equal(JSON.parse(manifest).background_color,'#ffffff');
  assert.match(app,/backgroundColor:'#ffffff'/);
});

test('Send is three steps: Format, Settings and Send It, with one main button',()=>{
  const send=app.slice(app.indexOf('// ---- Send: deliver individual captures'),app.indexOf('// Payments lives in the account menu'));
  assert.match(send,/<h2 id="sendStepFormat">Format<\/h2>/);
  assert.match(send,/<h2 id="sendStepSettings">Settings<\/h2>/);
  assert.match(send,/<h2 id="sendStepAction">Send It<\/h2>/);
  assert.match(send,/const SEND_FORMATS=\[\['pdf','PDF'\],\['docx','Word'\],\['bundle','Photos'\],\['originals','Original Photos'\]\];/);
  assert.match(send,/bundle:'Photos plus their notes, in one ZIP file\.'/);
  assert.match(send,/const SEND_ACTIONS=\[\['share','Share'\],\['download','Download'\],\['print','Print'\]\];/);
  assert.match(send,/Original photos are sent exactly as taken\. No layout settings apply\./);
  assert.match(send,/<span class="send-shortcuts-label" id="sendShortcutsLabel">Or use a Shortcut<\/span>/);
  assert.match(send,/id="sendshortcuts" type="button">Manage Shortcuts<\/button>/);
  assert.match(send,/<button class="btn" id="sendGo" type="button">Share<\/button>/);
  assert.match(send,/id="sendChange" type="button"[^>]*>Change<\/button>/);
  assert.match(send,/return deliverExport\(sendFormat\(\),sendGroupId\(\),sendAction\(\)\);/);
  assert.match(send,/if\(sendFormat\(\)==='originals'\)return shareSelectedPhotos\(go\);/);
  // Old duplicate controls are gone.
  assert.doesNotMatch(app,/id="sendformat"|id="sharephotos"|id="senddocument"|id="shareOriginalPhotos"|data-send-options|data-document-action/);
  assert.doesNotMatch(app,/Send as PDF|Send as Word/);
  // Remembered choices are wrapped so blocked storage never breaks Send.
  assert.match(send,/try\{saved=JSON\.parse\(localStorage\.getItem\(sendChoiceKey\(\)\)\|\|'null'\);\}catch/);
  assert.match(send,/function saveSendChoice\(\)\{try\{localStorage\.setItem/);
  assert.match(css,/\.btn\.send-choice \{[^}]*min-height:48px/);
  assert.match(css,/\.btn\.send-choice\[aria-pressed="true"\] \{[^}]*background:var\(--accent\)/);
});

test('Print is offered only for documents as PDF, and Original Photos only shares',()=>{
  assert.match(app,/if\(action==='print'\)format='pdf'/);
  assert.match(app,/if\(f==='originals'&&action!=='share'\)return 'Original Photos can only be shared\./);
  assert.match(app,/if\(action==='print'&&sendSource!=='documents'\)return 'Print is available for documents\./);
  assert.match(app,/if\(action==='print'&&f!=='pdf'\)return 'Print is available for PDF\./);
  assert.match(app,/function sendFormatList\(\)\{return SEND_FORMATS\.filter\(\(\[v\]\)=>sendSource==='photos'\|\|v!=='originals'\);\}/);
  assert.match(app,/data-use-document="\$\{g\.id\}"[^>]*>Use This Document<\/button>/);
  assert.match(app,/data-edit-document="\$\{g\.id\}">Edit Draft<\/button>/);
  assert.doesNotMatch(app,/Share PDF|Save PDF|Save Word|>AI ZIP</);
});

test('Send selection supports select all and clear all actions',()=>{
  assert.match(app,/id="selectAllSendCaptures"[^>]*>Select All Matching<\/button>/);
  assert.match(app,/id="clearSendSelection"[^>]*>Clear All<\/button>/);
  assert.match(app,/function selectAllSendCaptures\(\) \{[\s\S]*?window\._sendMatchedCaptures[\s\S]*?state\.selectedIds\.add/);
  assert.match(app,/function clearSendSelection\(\) \{[\s\S]*?state\.selectedIds\.clear\(\);[\s\S]*?querySelectorAll\('\.sendchk'\)/);
  assert.match(css,/\.send-selection-bar \{/);
  assert.match(css,/\.send-selection-bar \{[^}]*flex-wrap:wrap/);
  assert.match(css,/\.send-selection-actions \{[^}]*flex:1 1 100%;[^}]*width:100%;[^}]*max-width:100%/);
  assert.match(css,/\.send-selection-actions \.btn \{[^}]*flex:1 1 0;[^}]*min-width:0/);
});

test('Customer approval and Stripe payment actions are grouped and compact',()=>{
  assert.match(app,/class="send-feature-panel" aria-labelledby="customerApprovalHeading"/);
  assert.match(app,/class="send-feature-heading" id="customerApprovalHeading">Customer Approval Package/);
  assert.match(app,/class="btn slim send-feature-action" id="createApproval">Create Customer Review Link/);
  assert.match(app,/aria-labelledby="paymentsHeading"/);
  assert.match(app,/class="btn slim billing-checkout"[^>]*>Pay with Stripe/);
  assert.doesNotMatch(app,/id="billingOffers"><\/div>`/);
  assert.match(css,/\.send-feature-panel \{[^}]*border:2px solid #2455d9/);
  assert.match(css,/\.send-feature-panel \.send-feature-action, \.send-feature-panel \.billing-checkout \{[^}]*width:auto/);
});

test('Send cards use identifiable previews and leave deletion to Library',()=>{
  assert.match(app,/class="send-capture-details"/);
  assert.match(app,/c\.photo_title \|\| 'Untitled Photo'/);
  assert.doesNotMatch(app,/data-delete-capture|send-delete-capture|deleteSendCapture|Delete Photo Note<\/button>/);
  assert.match(app,/data-delete-organize="\$\{c\.id\}"[^>]*>Delete PhotoNote<\/button>/);
  assert.match(css,/\.send-capture-row \{[^}]*minmax\(120px,150px\)/);
  assert.match(css,/\.send-capture-row \{[^}]*grid-template-areas:"check photo details";/);
  assert.match(css,/\.send-capture-row img, \.send-no-photo \{[^}]*aspect-ratio:4\/3/);
});

test('Payments opens from the account menu, not Send',()=>{
  const send=app.slice(app.indexOf('async function renderSend('),app.indexOf('// Payments lives in the account menu'));
  assert.doesNotMatch(send,/billingOffers|loadBillingOffers\(\)/);
  assert.match(app,/paymentsAvailable\(\)\?'<button type="button" id="menuPayments" hidden>Payments<\/button>':''/);
  assert.match(app,/function paymentsAvailable\(\)\{return !!state\.me&&!isBasicClient\(\)&&!isRoadIssuesClient\(\);\}/);
  assert.match(app,/item\.hidden=!\(d&&d\.checkout_enabled&&Object\.keys\(d\.offers\|\|\{\}\)\.length\)/);
  assert.match(app,/function showPayments\(\)\{[\s\S]*?className='web-help-dialog payments-dialog'[\s\S]*?id="closePayments"[\s\S]*?showModal\(\)/);
});

test('photo sharing is sized, bounded, visible, and recoverable',()=>{
  assert.match(app,/id="shareActionStatus" role="status" aria-live="polite"/);
  assert.match(app,/photoRows\.length > 20/);
  assert.match(app,/Preparing \$\{complete\} of \$\{photoRows\.length\} share-sized photos/);
  assert.match(app,/preparedPhotoShare\.signature === signature/);
  assert.match(app,/Tap Share again to open the share menu/);
  assert.match(app,/Select 20 or fewer, or choose Photos and Download\./);
  assert.match(app,/api\/captures\/\$\{c\.id\}\/share-photo/);
  assert.match(css,/\.share-action-status\.error/);
  assert.match(server,/app\.get\('\/api\/captures\/:id\/share-photo', requireAuth/);
  assert.match(server,/WHERE id=\$1 AND user_id=\$2 AND photo_path IS NOT NULL/);
  assert.match(server,/renderImageStamped\(local, 'web', 'jpeg', capture\)/);
});
