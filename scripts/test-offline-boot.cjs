// Offline cold start: with no connection, the app opens Capture with the last confirmed account,
// saves photos on the device, and signs in normally when the connection returns. A signed-out
// answer or signing out removes the saved account, so the app never opens from it afterwards.
const express=require('express'),assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright');
const ME={id:41,email:'offline@example.invalid',name:'Offline Tester',role:'user',plan:'pro',pro_type:'general',edition_access:['pro'],feature_access:{},is_tester:true,is_testing_manager:false,is_super_admin:false};
const KEY='pn-last-session-v1';
(async()=>{
 const app=express();app.use(express.static(path.join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const image=await require('sharp')({create:{width:900,height:650,channels:3,background:'#819d36'}}).jpeg().toBuffer();
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch();
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}),page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message+' '+(e.stack||'').split('\n').slice(0,4).join(' | ')));page.on('dialog',dialog=>dialog.accept());
   const queueLength=()=>page.evaluate(async()=>(await PhotoNotesQueue.list()).length);
   const waitForQueue=async n=>{for(let i=0;i<200;i++){if(await queueLength()===n)return;await page.waitForTimeout(50);}assert.equal(await queueLength(),n,'pending PhotoNotes');};
   let mode='online',uploads=0;
   await context.route('**/api/**',route=>{
    const request=route.request(),p=new URL(request.url()).pathname;
    if(mode==='offline')return route.abort('failed');
    if(mode==='signedout'&&p==='/api/me')return route.fulfill({status:401,json:{error:'not authenticated'}});
    if(p==='/api/captures'&&request.method()==='POST'){uploads++;return route.fulfill({json:{id:900+uploads}});}
    if(p==='/api/logout')return route.fulfill({json:{ok:true}});
    return route.fulfill({headers:{'X-Photo-Notes-Upload-Receipts':'1'},json:p==='/api/me'?ME:p==='/api/billing/config'?{}:[]});
   });
   await context.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_v1:'+encodeURIComponent('offline@example.invalid'),'done');});
   const closePending=async()=>{if(await page.locator('#pendingClose').isVisible().catch(()=>false))await page.locator('#pendingClose').click();};

   // A confirmed session is remembered with only what Capture needs.
   await page.goto(base);await page.waitForFunction(()=>state.me&&queueAccount);
   const saved=JSON.parse(await page.evaluate(key=>localStorage.getItem(key),KEY));
   assert.deepEqual(Object.keys(saved).sort(),['edition_access','email','feature_access','id','name','plan','pro_type']);
   assert.equal(saved.email,ME.email);

   // No connection at start: Capture opens with the saved account instead of the sign-in screen.
   mode='offline';await page.reload();
   await page.waitForFunction(()=>state.offlineSession===true&&document.getElementById('save'));
   assert.equal(await page.locator('#loginBtn').count(),0,engine.name()+' must not show sign-in while offline');
   assert.equal(await page.evaluate(()=>state.view),'capture');
   await closePending();
   await page.locator('#photoLib').setInputFiles({name:'offline.jpg',mimeType:'image/jpeg',buffer:image});
   await page.locator('#note').fill('Saved with no connection');
   await page.locator('#save').click();
   await waitForQueue(1);
   const queued=await page.evaluate(async()=>{const [row]=await PhotoNotesQueue.list();return {hasPhoto:row.hasPhoto,bytesInRow:'photoBytes' in row,note:row.payload.note,photo:(await PhotoNotesQueue.photo(row.id))?.size||0};});
   assert.equal(queued.hasPhoto,true);assert.equal(queued.bytesInRow,false);assert.equal(queued.note,'Saved with no connection');assert(queued.photo>1000,'the full photo is kept on the device');
   assert.equal(uploads,0);
   // The pending list shows a small preview, not the full photo.
   await closePending();
   await page.evaluate(()=>{state.view='photo-library';renderApp();});
   await page.locator('#pendingLibrary img').first().waitFor();
   await page.waitForFunction(()=>{const img=document.querySelector('#pendingLibrary img');return img&&img.naturalWidth>0;});
   assert(await page.evaluate(()=>document.querySelector('#pendingLibrary img').naturalWidth<=640),'pending list uses a preview');

   // The connection returns: the app signs in normally and uploads the saved photo once.
   mode='online';await page.evaluate(()=>window.dispatchEvent(new Event('online')));
   await page.waitForFunction(()=>state.offlineSession===false);
   await page.waitForFunction(()=>bgQueue.length===0&&!bgDraining);
   await waitForQueue(0);
   assert.equal(uploads,1);
   await closePending();

   // Signing out removes the saved account; afterwards no connection means the sign-in screen.
   mode='signedout';
   await page.evaluate(()=>{state.view='capture';renderApp();});
   await page.locator('#profileButton').click();await page.locator('#signout').click();
   await page.locator('#loginBtn').waitFor();
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),null,'sign out clears the saved account');
   mode='offline';await page.reload();await page.locator('#retryConnection').waitFor();
   assert.equal(await page.evaluate(()=>state.offlineSession||false),false);

   // A signed-out answer from the server also removes a saved account.
   mode='signedout';
   await page.evaluate(([key,me])=>localStorage.setItem(key,JSON.stringify(me)),[KEY,saved]);
   await page.reload();await page.locator('#loginBtn').waitFor();
   assert.equal(await page.evaluate(key=>localStorage.getItem(key),KEY),null,'a signed-out session is never reused');
   mode='offline';await page.reload();await page.locator('#retryConnection').waitFor();
   assert.deepEqual(errors,[],engine.name()+' page errors');
   await context.close();
   console.log('offline boot passed: '+engine.name());
  }finally{await browser.close();}
 }}finally{server.close();}
})().catch(error=>{console.error(error);process.exit(1);});
