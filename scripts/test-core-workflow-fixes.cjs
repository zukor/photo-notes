// Browser checks for Photo Notes Basic and general Pro workflow fixes: Library photo detail stays open while
// editing, documents can add photos and be deleted, document branding and copyright, New Project details,
// New Document cleanup, failed downloads, urgency labels and Basic Pending Photos.
const express=require('express'),assert=require('node:assert/strict'),path=require('node:path');const{chromium,webkit}=require('playwright');
const year=new Date().getFullYear();
(async()=>{const app=express();app.use(express.static(path.join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
const page=await browser.newPage({viewport:{width,height:950},serviceWorkers:'block'});
const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
const posts=[];let groupItems=[{id:1}];
const photos=()=>[
 {id:1,photo_title:'Detail photo',note:'First note',photo_path:'/icon-192.png',area_tags:['Retired topic'],urgency:'urgent',created_at:'2026-10-01T12:00:00Z'},
 {id:2,photo_title:'Second photo',note:'Second note',photo_path:'/icon-192.png',area_tags:['Site'],urgency:'standard',created_at:'2026-10-02T12:00:00Z'}];
await page.route('**/api/**',r=>{const u=new URL(r.request().url()),p=u.pathname,m=r.request().method();
 if(m==='POST')posts.push([p,r.request().postData()]);
 if(p==='/api/me')return r.fulfill({json:{id:1,name:'Fixture User',email:'fixture@example.invalid',role:'user',plan:'pro',pro_type:'general',edition_access:['pro']}});
 if(p==='/api/captures'&&m==='GET')return r.fulfill({json:photos()});
 if(p==='/api/document-settings'&&m==='GET')return r.fulfill({json:{branding:{company_name:'Account Co',header_text:'Account header',footer_text:'Account footer'}}});
 if(p==='/api/document-settings/template')return r.fulfill({status:500,json:{error:'template failed'}});
 if(p==='/api/groups/5'&&m==='GET')return r.fulfill({json:{group:{id:5,title:'Roof Report',layout:{company_name:'Doc Co',header_text:'Doc Header',header:true}},items:photos().filter(c=>groupItems.some(i=>i.id===c.id)),pairs:[]}});
 if(p==='/api/groups/5/add')return r.fulfill({json:{ok:true,added:1}});
 if(p==='/api/groups'&&m==='POST')return r.fulfill({json:{id:9,title:'New'}});
 if(p==='/api/jobs'&&m==='POST')return r.fulfill({json:{id:3,name:'Harbor'}});
 return r.fulfill({json:m==='POST'?{ok:true}:[]});});
await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_v1:fixture%40example.invalid','done');});
await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>state.me&&document.getElementById('body'));
await page.evaluate(()=>{window.toasts=[];const original=toast;toast=(m,d)=>{toasts.push(m);original(m,d);};});
const cards=()=>page.locator('#body .card').count(),detail=async label=>{assert.equal(await page.locator('#body.library-photo-detail').count(),1,label+': detail view kept');assert.equal(await cards(),1,label+': only the open photo');assert.equal(await page.locator('#libraryBack').count(),1,label);};

// 1, 2, 8, 9: Library photo detail.
await page.evaluate(()=>{state.plan='pro';state.proType='general';state.areas=['Site'];state._libraryOpenId=1;state.view='edit';renderApp();});
await page.locator('#body .card .editnote').waitFor();await detail('open');
assert.equal(await page.locator('#body .card .badge.urgent').textContent(),'Urgent');
await page.locator('.editnote').click();await page.locator('.cancelnote').click();await page.locator('#body .card .editnote').waitFor();await detail('Edit Note Cancel');
await page.locator('.editnote').click();await page.locator('.editarea').fill('Changed note');await page.locator('.savenote').click();await page.locator('#body .card .editnote').waitFor();assert.equal(await page.locator('.editarea').count(),0,'Save closes the note editor');await detail('Edit Note Save');
assert.ok(posts.some(([p,b])=>p==='/api/captures/1'&&JSON.parse(b).note==='Changed note'));
await page.locator('.rotcw').click();for(let i=0;i<50&&!posts.some(([p])=>p==='/api/captures/1/rotate');i++)await page.waitForTimeout(50);assert.ok(posts.some(([p])=>p==='/api/captures/1/rotate'));await page.waitForTimeout(400);await page.locator('#body .card .editnote').waitFor();await detail('rotate');
await page.evaluate(()=>loadCards(''));await page.waitForTimeout(300);await detail('background upload refresh');
await page.locator('.edittopics').click();assert.equal(await page.locator('.topic-editor input[value="Retired topic"]').isChecked(),true,'removed topic stays checked');assert.equal(await page.locator('.topic-editor input[value="Site"]').isChecked(),false);
await page.locator('.savetopics').click();await page.waitForFunction(()=>document.querySelector('#body .card .edittopics')&&!document.querySelector('.topic-editor'));await detail('Change Topics');
assert.deepEqual(JSON.parse(posts.filter(([p])=>p==='/api/captures/1').pop()[1]).area_tags,['Retired topic']);

// 6: Mark Up copyright names the company from branding.
await page.evaluate(()=>{state._copyrightName=null;renderStampEditor(window._lastCards[0]);});await page.waitForFunction(()=>state._copyrightName==='Account Co');
assert.equal((await page.locator('#stampBack').textContent()).trim(),'‹ Back');
await page.locator('[data-add="copyright"]').click();const marked=await page.locator('#stampStage').innerText();assert.ok(marked.includes(`© ${year} Account Co. All Rights Reserved.`),marked);assert.ok(!marked.includes('Zukor AI'));
await page.locator('#singleTemplate').selectOption('copyright');await page.locator('#applySingleTemplate').click();assert.ok(!(await page.locator('#stampStage').innerText()).includes('Zukor AI'));

// 9: Library cards show Urgent.
await page.evaluate(()=>{state._libraryOpenId=null;state.view='organize';renderApp();});await page.locator('[data-library-photo="1"]').waitFor();
assert.equal(await page.locator('[data-library-photo="1"] .badge.urgent').textContent(),'Urgent');assert.equal(await page.locator('[data-library-photo="2"] .badge.urgent').count(),0);
assert.equal(await page.locator('#librarySavedSearches').textContent(),'Saved Views');

// 11: New Project captures number, customer and address.
await page.locator('#createJobBtn').click();await page.locator('#libraryNewProjectName').fill('Harbor');await page.locator('#newJobNumber').fill('H-12');await page.locator('#newJobCustomer').fill('Port Authority');await page.locator('#newJobAddress').fill('1 Pier Rd');
await page.locator('#libraryCreateProjectConfirm').click();await page.waitForFunction(()=>!document.querySelector('.library-simple-dialog'));
assert.deepEqual(JSON.parse(posts.filter(([p])=>p==='/api/jobs').pop()[1]),{name:'Harbor',job_number:'H-12',customer:'Port Authority',address:'1 Pier Rd'});

// 3 and 5: document page adds photos, uses the document's branding, and deletes with a second tap.
await page.evaluate(()=>{state.view='create';state.groupId=5;renderApp();});await page.locator('#gaddphotos').waitFor();
assert.equal(await page.locator('#documentCompanyName').inputValue(),'Doc Co');assert.equal(await page.locator('#documentFooterText').inputValue(),'Account footer');
assert.ok((await page.locator('#documentPreview').innerText()).includes('Doc Header'));
await page.locator('#gaddphotos').click();await page.locator('#addDocumentPhotosSave').waitFor();
assert.equal(await page.locator('.create-heading h1').textContent(),'Add Photos to Document');await page.locator('[data-document-source-photo="2"]').waitFor();
assert.deepEqual(await page.locator('[data-document-source-photo]').evaluateAll(n=>n.map(x=>x.dataset.documentSourcePhoto)),['2'],'photos already in the document are not offered');
assert.equal(await page.locator('#addDocumentPhotosSave').isDisabled(),true);
await page.locator('[data-document-source-photo="2"]').check();groupItems=[{id:1},{id:2}];await page.locator('#addDocumentPhotosSave').click();await page.locator('#gaddphotos').waitFor();
assert.deepEqual(JSON.parse(posts.filter(([p])=>p==='/api/groups/5/add').pop()[1]),{ids:[2]});
assert.equal(await page.locator('#gitems .card').count(),2);
await page.locator('#gaddphotos').click();await page.locator('#backToDocument').click();await page.locator('#gdelete').waitFor();
const deletes=()=>posts.filter(([p])=>p==='/api/groups/5/delete').length;
await page.locator('#gdelete').click();assert.equal(await page.locator('#gdelete').textContent(),'Tap Again to Delete Document');assert.equal(deletes(),0,'first tap only asks');
await page.locator('#gdelete').click();await page.locator('#newDocument').waitFor();assert.equal(deletes(),1);

// 13: New Document Cancel clears earlier picks; a failed Word template upload is reported.
await page.evaluate(()=>{state.selectedIds=new Set();});await page.locator('#newDocument').click();await page.locator('#gtitle').fill('Cancel test');await page.locator('#useDocumentSettings').click();
await page.locator('[data-document-source-photo="1"]').waitFor();await page.locator('[data-document-source-photo="1"]').check();await page.locator('#backDocumentSetup').click();await page.locator('#cancelNewDocument').click();await page.locator('#newDocument').waitFor();
assert.equal(await page.evaluate(()=>newDocumentPhotoIds.size),0,'Cancel clears photo picks');
await page.locator('#newDocument').click();await page.locator('#gtitle').fill('Template test');await page.evaluate(()=>{newDocumentSetup.template=new File(['x'],'company.docx');});await page.locator('#useDocumentSettings').click();
await page.locator('[data-document-source-photo="1"]').waitFor();await page.locator('[data-document-source-photo="1"]').check();await page.locator('#gcreate').click();await page.waitForFunction(()=>toasts.some(m=>/Word template could not be uploaded/.test(m)));
assert.ok(!(await page.evaluate(()=>toasts)).includes('New document saved.'));

// 13: a failed download stays on this screen and explains the failure.
await page.evaluate(()=>{document.cookie='pn_download_failed=1; Path=/';watchDownloadFailure();});await page.waitForFunction(()=>toasts.some(m=>/download could not be created/.test(m)));
assert.equal(await page.evaluate(()=>/pn_download_failed=1/.test(document.cookie)),false,'the failure marker is cleared');

// 13: Basic has no Pending Photos and no Library button.
await page.evaluate(()=>{state.plan='free';state.proType='general';state.view='capture';renderApp();});
assert.equal(await page.locator('#pendingPhotos').count(),0,'Basic has no Pending Photos');
await page.evaluate(()=>{state.plan='pro';state.proType='general';state.view='capture';renderApp();});
assert.equal(await page.locator('#pendingPhotos').count(),1,'Pro keeps Pending Photos');assert.equal(await page.locator('#captureSaveToJob').textContent(),'Save to Project');
assert.deepEqual(dialogs,[],'no browser dialogs');
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
assert.deepEqual(await page.evaluate(()=>PhotoNotesHelp.inspect().filter(i=>!i.authored).map(i=>i.key)),[]);
console.log(engine.name(),width,'Library detail stays open, topics kept, urgency shown, copyright and document branding, document add/delete, New Project details, New Document cleanup, failed download message, Basic pending hidden PASS');
await page.close();}}finally{await browser.close();}}}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
