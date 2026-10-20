// The old Edit page is retired: its links open the Library photo detail view, Delete lives in Library
// (not Send), Payments opens from the account menu, and Library cards show a short date and address line.
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const fresh=()=>[{id:1,photo_title:'Front Gate With A Very Long Title For Phone Width Checks',note:'First',area_tags:['A'],photo_path:'/icon-192.png',created_at:'2026-03-05T15:30:00Z',address:'4521 Elm Creek Boulevard Northwest, San Antonio, TX 78230'},{id:2,photo_title:'Second',note:'Second',area_tags:['B'],photo_path:'/icon-192.png',created_at:'2026-04-10T12:00:00Z'}];
 let rows=fresh(),writes=[],checkouts=[],billing={checkout_enabled:true,offers:{inspection:{label:'Inspection Report',dba:'Zukor Marketing'}}};
 await page.route('**/api/**',async route=>{
  const url=new URL(route.request().url());let data=[];
  if(url.pathname==='/api/me')data={id:1,name:'Test',email:'test@example.invalid',plan:'pro',pro_type:'general',role:'user',edition_access:['basic','pro','hoa','property']};
  if(url.pathname==='/api/areas')data=['A','B'];
  if(['/api/captures','/api/captures/search'].includes(url.pathname))data=rows;
  if(url.pathname==='/api/billing/config')data=billing;
  if(url.pathname==='/api/billing/checkout'){checkouts.push(route.request().postDataJSON());return route.fulfill({status:500,json:{error:'fixture'}});}
  if(url.pathname==='/api/captures/delete'){const ids=route.request().postDataJSON().ids;writes.push(ids);rows=rows.filter(r=>!ids.includes(String(r.id)));data={ok:true,deleted:ids.length};}
  await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_v1:'+encodeURIComponent('test@example.invalid'),'done');});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>state.me&&document.getElementById('body'));
 for(const edition of ['general','contractor','paving','concrete','roofer','hoa','property']){
  rows=fresh();writes=[];
  const library=['hoa','property'].includes(edition)?'photo-library':'organize';
  // A view 'edit' request without a photo opens Library; no old Edit page or Delete All remains.
  await page.evaluate(edition=>{state.plan='pro';state.proType=edition;state.selectedIds.clear();state._libraryOpenId=null;state.view='edit';renderApp();},edition);
  await page.locator('.library-photo-card').first().waitFor();
  assert.equal(await page.evaluate(()=>state.view),library,edition+' edit without a photo opens Library');
  assert.equal(await page.locator('#delall,#delbtn,#selall,#selnone').count(),0,edition+' no old Edit controls');
  assert.equal(await page.locator('#tabEdit').count(),['hoa','property'].includes(edition)?1:0);
  // Library cards: one short date and address line under the title.
  const meta=page.locator('.library-photo-card[data-library-photo="1"] .library-card-meta');
  const expectedDate=await page.evaluate(()=>new Date('2026-03-05T15:30:00Z').toLocaleDateString(uiLocale(),{year:'numeric',month:'short',day:'numeric'}));
  assert.equal(await meta.textContent(),expectedDate+' · 4521 Elm Creek Boulevard Northwest, San Antonio');
  assert.equal(await page.locator('.library-photo-card[data-library-photo="2"] .library-card-meta').textContent(),await page.evaluate(()=>new Date('2026-04-10T12:00:00Z').toLocaleDateString(uiLocale(),{year:'numeric',month:'short',day:'numeric'})),'date only without an address');
  assert.equal(await meta.evaluate(n=>n.previousElementSibling.classList.contains('photo-title')),true,'meta sits under the title');
  assert.equal(await meta.evaluate(n=>getComputedStyle(n).color),'rgb(0, 0, 0)');
  const box=await meta.boundingBox(),card=await page.locator('.library-photo-card[data-library-photo="1"]').boundingBox();
  assert(box.height<=20,edition+' meta stays on one line');assert(box.x+box.width<=card.x+card.width+0.5,edition+' meta stays inside the card');
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),edition+' Library fits '+width);
  // Open a photo: the Library photo detail view keeps Delete.
  await page.locator('[data-library-open="1"]').click();await page.locator('#libraryBack').waitFor();
  assert.equal(await page.evaluate(()=>state.view+':'+state._libraryOpenId),'edit:1');
  assert.equal(await page.locator('#body .organize-delete-capture').textContent(),'Delete PhotoNote');
  page.once('dialog',d=>d.dismiss());await page.locator('#body .organize-delete-capture').click();assert.equal(writes.length,0,'dismissed delete keeps the PhotoNote');
  page.once('dialog',d=>d.accept());await page.locator('#body .organize-delete-capture').click();
  await page.waitForFunction(library=>state.view===library&&!state._libraryOpenId,library);assert.deepEqual(writes,[['1']]);
  // Former Edit page links now open the Library photo detail view.
  await page.evaluate(()=>openLibraryPhoto(2));await page.locator('#cards .organize-delete-capture').waitFor();assert.equal(await page.evaluate(()=>state.view+':'+state._libraryOpenId+':'+[...state.selectedIds]),'edit:2:2');
  await page.evaluate(()=>{const c=window._lastCards.find(x=>x.id===2);renderSavedDimsEditor(c);});assert.equal(await page.locator('#dimsBack').textContent(),'‹ Back to PhotoNote');await page.locator('#dimsBack').click();await page.locator('#libraryBack').waitFor();
  await page.evaluate(()=>renderStampEditor(window._lastCards.find(x=>x.id===2)));await page.locator('#stampBack').click();await page.locator('#libraryBack').waitFor();assert.equal(await page.evaluate(()=>state.view+':'+state._libraryOpenId),'edit:2','Mark Up returns to the photo');
  await page.locator('#libraryBack').click();await page.waitForFunction(library=>state.view===library,library);
  // Send lists photos without Delete.
  if(!['hoa','property'].includes(edition)){
   await page.evaluate(()=>{state.view='send';sendSource='photos';renderApp();});await page.locator('#sendPhotoSelection > summary').click();await page.locator('.send-capture-row').first().waitFor();
   assert.equal(await page.locator('.send-delete-capture,[data-delete-capture]').count(),0,edition+' Send has no Delete');
   assert.equal(await page.locator('#billingOffers,#paymentsHeading').count(),0,edition+' Payments left Send');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),edition+' Send fits '+width);
  }
 }
 // Payments opens from the account menu when checkout is configured.
 await page.evaluate(()=>{state.proType='general';state.view='organize';billingConfigLoad=null;renderApp();});
 await page.locator('#profileButton').click();const payments=page.locator('#menuPayments');await payments.waitFor();
 assert.equal(await payments.textContent(),'Payments');await payments.click();
 const dialog=page.locator('#paymentsDialog');await dialog.locator('.billing-checkout').waitFor();
 assert.equal(await dialog.locator('#paymentsHeading').textContent(),'Payments');assert.equal(await dialog.getByText('Inspection Report',{exact:true}).count(),1);assert.equal(await dialog.getByText('Provided by Zukor Marketing',{exact:true}).count(),1);
 assert(await page.evaluate(()=>{const r=document.getElementById('paymentsDialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}),'Payments dialog fits '+width);
 await dialog.locator('.billing-checkout').click();await page.waitForFunction(()=>document.querySelector('#paymentsDialog .billing-checkout')?.textContent==='Pay with Stripe');assert.deepEqual(checkouts,[{offer:'inspection',quantity:1}]);
 await page.locator('#closePayments').click();await dialog.waitFor({state:'detached'});
 // Hidden when checkout is not configured, and absent in Basic, as on Send before.
 billing={checkout_enabled:false,offers:{}};await page.evaluate(()=>{billingConfigLoad=null;renderApp();});await page.locator('#profileButton').click();await page.waitForTimeout(150);
 assert.equal(await page.locator('#menuPayments').isVisible(),false,'no checkout hides Payments');
 billing={checkout_enabled:true,offers:{inspection:{label:'Inspection Report',dba:'Zukor Marketing'}}};await page.evaluate(()=>{state.plan='free';state.proType='general';billingConfigLoad=null;renderApp();});
 assert.equal(await page.locator('#menuPayments').count(),0,'Basic has no Payments, as it has no Send');
 await page.evaluate(()=>{state.plan='pro';renderApp();});
 assert.deepEqual(errors,[]);
 await page.screenshot({path:`/tmp/pn-library-${engine.name()}-${width}.png`});
 await page.close();console.log(engine.name(),width,'Library delete, card date and address, retired Edit links, Send without Delete and Payments menu PASS');
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
