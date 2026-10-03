// Responsive shared UI fixtures. No production records are changed.
const express=require('express'),assert=require('node:assert/strict'),path=require('path'),QRCode=require('qrcode');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(path.join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const token='a'.repeat(43),png=await QRCode.toBuffer(base+'/qr/'+token);
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));let active=false,actions=[];
  await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_dismissed_v1','1');});
  await page.route('**/api/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname;let data=[];
   if(p==='/api/me')data={id:1,name:'QR Tester',role:'user',plan:'pro',pro_type:'general',edition_access:['pro']};
   else if(p==='/api/billing/config')data={checkout_enabled:false};
   else if(p==='/api/qr/resolve/'+token)data={type:'asset',id:7,name:'Gate 7',property:'Test Property'};
   else if(p.startsWith('/api/qr/')){if(p.endsWith('/image'))return route.fulfill({body:png,contentType:'image/png'});if(req.method()==='POST'){const action=req.postDataJSON().action;actions.push(action);active=action!=='disable';}data={active,name:'Gate 7',property:'Test Property',url:active?base+'/qr/'+token:null};}
   else if(p==='/api/hoa/assets/7')data={asset:{id:7,name:'Gate 7',community_name:'Test Property',asset_type:'Gate',condition:'good'},photos:[{id:1,photo_path:'/logo.svg',photo_type:'condition',note:'Existing asset history',created_at:new Date().toISOString()}]};
   else if(p==='/api/hoa/company')data={id:1,name:'Test Company'};
   return route.fulfill({json:data});
  });
  await page.goto(base);await page.waitForFunction(()=>state.me&&document.getElementById('body'));
  for(const edition of ['general','property','hoa','concrete','paving','contractor','roofer']){
   active=false;
   await page.evaluate(edition=>{state.plan='pro';state.proType=edition;state.view='edit';document.getElementById('body').innerHTML=captureCardHtml({id:1,photo_title:'Gate 7',note:'Saved context',created_at:new Date().toISOString(),area_tags:[]});wireCards(document.getElementById('body'),[{id:1}]);},edition);
   await page.locator('[data-qr-target="note"]').click();await page.locator('#qrCreate').click();await page.locator('.pn-qr-dialog canvas').waitFor();
   await page.locator('#qrLabel').fill('Exterior Gate 7');await page.locator('#qrProperty').fill('');
   assert.equal(await page.locator('.pn-qr-dialog p').first().evaluate(n=>getComputedStyle(n).color),'rgb(0, 0, 0)');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,edition+' overflow');
   const download=page.waitForEvent('download');await page.locator('#qrDownload').click();assert.equal((await download).suggestedFilename(),'Photo-Notes-QR-Label.png');
   const popupPromise=page.waitForEvent('popup');await page.locator('#qrPrint').click();const popup=await popupPromise;await popup.locator('img').waitFor();assert.match(await popup.locator('img').getAttribute('src'),/^data:image\/png/);await popup.close();
   page.once('dialog',d=>d.accept());await page.locator('#qrReissue').click();await page.locator('.pn-qr-dialog canvas').waitFor();
   page.once('dialog',d=>d.accept());await page.locator('#qrDisable').click();await page.locator('#qrCreate').waitFor();assert.equal(await page.locator('.pn-qr-dialog canvas').count(),0);
   await page.locator('#qrClose').click();
  }
  for(const edition of ['general','issue','roads']){await page.evaluate(edition=>{state.plan='free';state.proType=edition;document.getElementById('body').innerHTML=PhotoNotesQR.button('note',1,selectedEdition());},edition);assert.equal(await page.locator('[data-qr-target]').count(),0);}
  for(const edition of ['property','hoa']){active=false;await page.evaluate(edition=>{state.plan='pro';state.proType=edition;history.replaceState(null,'','/?qr='+ 'a'.repeat(43));renderApp();},edition);await page.locator('#hapAdd').waitFor();await page.locator('[data-qr-target="asset"]').waitFor();assert(await page.locator('#body').innerText().then(t=>t.includes('Existing asset history')));assert.equal(await page.locator('#hapPhoto').getAttribute('capture'),'environment');const chooser=page.waitForEvent('filechooser');await page.locator('#qrAssetPhoto').click();assert.equal((await chooser).isMultiple(),false);await page.locator('[data-qr-target="asset"]').click();await page.locator('#qrCreate').click();await page.locator('.pn-qr-dialog canvas').waitFor();await page.screenshot({path:`/tmp/qr-${engine.name()}-${edition}-${width}.png`,fullPage:true});await page.locator('#qrClose').click();}
  assert.deepEqual(errors,[]);assert(actions.includes('reissue')&&actions.includes('disable'));await page.close();
 }}finally{await browser.close();}}
 console.log('QR browser checks passed: Chromium/WebKit, phone/desktop, all seven enabled editions, excluded editions, asset scan/history/Add Photo, download, print, reissue and disable.');
 }finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
