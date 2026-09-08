// Automated browser checks against scripts/web-test-server.cjs only.
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {chromium,webkit}=require('playwright');
const base='http://localhost:33088';
(async()=>{
 await fs.mkdir('/tmp/pn-web-browser',{recursive:true});
 const image=await require('sharp')({create:{width:900,height:650,channels:3,background:'#819d36'}}).jpeg().toBuffer();
 const results=[];
 for(const [name,engine,options] of [
  ['iphone-webkit',webkit,{viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}],
  ['android-chromium',chromium,{viewport:{width:412,height:915},isMobile:true,hasTouch:true}],
  ['mac-webkit',webkit,{viewport:{width:1365,height:900}}],
  ['windows-chromium',chromium,{viewport:{width:1440,height:900}}]
 ].filter(x=>!process.env.PN_WEB_TEST_SINGLE||x[0]===process.env.PN_WEB_TEST_SINGLE)){
  const browser=await engine.launch({headless:true}),context=await browser.newContext({...options,acceptDownloads:true,serviceWorkers:engine===webkit?'block':'allow'});
  const page=await context.newPage(),errors=[],messages=[];page.on('console',m=>{messages.push(m.text());});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  try{
   await page.goto(base,{waitUntil:'domcontentloaded'});
   await page.locator('#email').fill('ios-integration@example.invalid');await page.locator('#pw').fill('local-test-only');await page.locator('#loginBtn').click();
   await page.locator('#profileButton').waitFor();
   await page.evaluate(()=>{const original=queueStore;queueStore=async(...args)=>{try{return await original(...args);}catch(e){console.error('Local save:',e.name,e.message);throw e;}};});
   await page.evaluate(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');document.getElementById('installPrompt')?.remove();});
   if(await page.locator('#tabCapture').isVisible())await page.locator('#tabCapture').click();
   await page.locator('#photoLib').setInputFiles({name:'acceptance.jpg',mimeType:'image/jpeg',buffer:image});
   await page.locator('#note').fill('Web acceptance '+name+' '+Date.now());
   await page.locator('#preview').waitFor({state:'visible'});
   const save=page.waitForResponse(r=>r.url()===base+'/api/captures'&&r.request().method()==='POST');
   await page.locator('#save').click();const response=await save;assert.equal(response.status(),200);assert((await response.json()).id);
   await page.waitForFunction(()=>bgQueue.length===0);
   // Save offline, restart through the cached shell, and reconnect using the same browser storage.
   if(engine===chromium)await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
   if(await page.locator('#tabCapture').isVisible())await page.locator('#tabCapture').click();
   if(engine===webkit)await context.route('**/api/**',route=>route.abort('internetdisconnected'));else await context.setOffline(true);
   await page.locator('#photoLib').setInputFiles({name:'offline.jpg',mimeType:'image/jpeg',buffer:image});
   const offlineNote='Offline recovery '+name+' '+Date.now();await page.locator('#note').fill(offlineNote);await page.locator('#save').click();
   await page.waitForFunction(()=>bgQueue.length===1);await page.reload({waitUntil:'domcontentloaded'});await page.locator('#loginErr').waitFor();
   assert((await page.locator('#loginErr').textContent()).includes('Reconnect'));
   if(engine===webkit)await context.unroute('**/api/**');else await context.setOffline(false);await page.reload({waitUntil:'domcontentloaded'});await page.locator('#profileButton').waitFor();await page.waitForFunction(()=>bgQueue.length===0);
   const captures=await (await context.request.get(base+'/api/captures')).json();assert.equal(captures.filter(x=>x.note===offlineNote).length,1);
   // Lose the response after the server commits, then retry the exact same capture identity.
   if(await page.locator('#tabCapture').isVisible())await page.locator('#tabCapture').click();
   await page.evaluate(()=>{const original=window.fetch;window.__restoreAcceptanceFetch=()=>window.fetch=original;let dropped=false;window.fetch=async(input,options)=>{const response=await original(input,options);if(!dropped&&String(input)==='/api/captures'&&options?.method==='POST'){dropped=true;throw new TypeError('Simulated response lost after server commit');}return response;};});
   await page.locator('#photoLib').setInputFiles({name:'retry.jpg',mimeType:'image/jpeg',buffer:image});const retryNote='Lost response '+name+' '+Date.now();await page.locator('#note').fill(retryNote);await page.locator('#save').click();
   await page.waitForFunction(()=>bgQueue.length===1&&bgQueue[0].tries>0);await page.evaluate(()=>window.__restoreAcceptanceFetch());await page.evaluate(()=>restoreOfflineQueue());await page.waitForFunction(()=>bgQueue.length===0);
   const retried=await (await context.request.get(base+'/api/captures')).json();assert.equal(retried.filter(x=>x.note===retryNote).length,1);
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('#profileButton').waitFor();
   await page.locator('#profileButton').click();await page.locator('#installHelp').click();await page.locator('#installHelpDialog').waitFor({state:'visible'});
   for(const device of ['iphone','android','mac','windows']){await page.locator('#installDevice').selectOption(device);assert(await page.locator('#installDeviceGuide li').count()>0);}
   await page.locator('#closeInstallHelp').click();
   if(await page.locator('#tabCapture').isVisible())await page.locator('#tabCapture').click();
   await page.locator('#photoLib').setInputFiles({name:'share.jpg',mimeType:'image/jpeg',buffer:image});await page.locator('#note').fill('Share preview '+name);await page.locator('#send').click();await page.locator('#captureShareTitle').waitFor({state:'visible'});await page.locator('.export-share-modal [data-close]').click();await page.waitForFunction(()=>bgQueue.length===0);
   if(name==='windows-chromium'){for(const format of ['pdf','docx']){const exported=await context.request.get(base+'/api/export/'+format+'?ids='+retried[0].id);assert.equal(exported.status(),200);const bytes=await exported.body();assert(bytes.length>1000);assert.equal(bytes.subarray(0,format==='pdf'?4:2).toString(),format==='pdf'?'%PDF':'PK');}}
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert(!overflow,'horizontal page overflow');
   await page.locator('#issueFab').click();await page.locator('#issueModal').waitFor({state:'visible'});
   await page.locator('#issueDescription').fill('Local automated web acceptance, '+name);
   await page.locator('#issueMarkupCanvas').waitFor({state:'visible'});await page.evaluate(()=>issueMarkupEditor.ready);
   await page.locator('[data-issue-tool="arrow"]').click();const canvas=await page.locator('#issueMarkupCanvas').boundingBox();await page.mouse.move(canvas.x+canvas.width*.25,canvas.y+canvas.height*.25);await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.65,canvas.y+canvas.height*.4);await page.mouse.up();assert(await page.evaluate(()=>issueMarkupEditor.hasMarks()));
   const issue=page.waitForResponse(r=>r.url()===base+'/api/issues'&&r.request().method()==='POST');await page.locator('#issueSend').click();const report=await issue;assert.equal(report.status(),200);const issueId=(await report.json()).id;assert(issueId);const tracked=await (await context.request.get(base+'/api/issues/mine')).json();assert(tracked.some(x=>x.id===issueId&&x.screenshot_path));
   await page.screenshot({path:'/tmp/pn-web-browser/'+name+'.png',fullPage:true});
   assert.deepEqual(errors,[]);results.push({name,status:'passed',checks:['login','photo upload',engine===webkit?'API outage and restart recovery':'offline save and restart recovery','lost response retry without duplicates','restart login','four device guides','share preview and cancel','no page overflow','screenshot arrow markup, issue submission and tracking']});
  }catch(error){await page.screenshot({path:'/tmp/pn-web-browser/'+name+'-failure.png',fullPage:true});const diagnostic=await page.evaluate(async()=>({queue:typeof bgQueue==='undefined'?null:bgQueue.map(x=>({id:x.id,blocked:x.blocked,tries:x.tries})),account:typeof queueAccount==='undefined'?null:!!queueAccount,cryptoUUID:typeof crypto.randomUUID,photoQueue:typeof PhotoNotesQueue,toast:document.querySelector('.toast')?.textContent,markup:document.querySelector('#issueScreenshot')?.outerHTML,workers:await navigator.serviceWorker.getRegistrations().then(x=>x.map(r=>({active:r.active?.state,installing:r.installing?.state}))),caches:await caches.keys()}));results.push({name,status:'failed',error:error.message,errors,messages,diagnostic});console.log(name,error.message,JSON.stringify(diagnostic));}
  finally{await browser.close();}
 }
 if(!process.env.PN_WEB_TEST_SINGLE){
  const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  try{await page.goto(base);await page.locator('#email').fill('ios-integration@example.invalid');await page.locator('#pw').fill('local-test-only');await page.locator('#loginBtn').click();await page.locator('#profileButton').waitFor();await page.evaluate(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));
   const editions=['basic','pro','concrete','contractor','hoa','paving','roads','roofer'];assert.equal(await page.locator('#editionSwitcher option').count(),8);
   for(const edition of editions){await page.locator('#editionSwitcher').selectOption(edition);await page.waitForFunction(value=>selectedEdition()===value&&document.getElementById('editionSwitcher')?.disabled===false,edition);if(await page.locator('#tabCapture').isVisible())await page.locator('#tabCapture').click();await page.locator('#takephoto').waitFor({state:'visible'});assert(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),edition+' overflow');await page.screenshot({path:'/tmp/pn-web-browser/edition-'+edition+'.png',fullPage:true});}
   await page.locator('#editionSwitcher').selectOption('basic');await page.waitForFunction(()=>selectedEdition()==='basic');assert.deepEqual(errors,[]);results.push({name:'eight-authorized-editions',status:'passed',checks:['version switching','Capture rendering','phone width without horizontal overflow']});
  }catch(error){results.push({name:'eight-authorized-editions',status:'failed',error:error.message,errors});}finally{await browser.close();}
 }
 await fs.writeFile('/tmp/pn-web-browser/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>r.status==='failed'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
