// Real shared Capture screens with simulated speech events, no provider calls.
const express=require('express'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',userAgent:'Mozilla/5.0 (iPhone)'});
 await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','1');Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.top.speechNeedsReset=false;window.top.directCapture=true;return {getTracks:()=>[{stop(){window.top.directCapture=false;}}]};}}});const root=window.top;root.speechSessions||=[];root.speechPhrase||='';root.speechOwner||=null;window.SpeechRecognition=class{constructor(){this.documentIdentity=window;root.speechSessions.push(this);}start(){if(root.speechOwner||root.directCapture)throw Error('Microphone still owned');if(root.speechNeedsReset)throw Error('Shared audio session needs reset');root.speechOwner=this;this.onstart?.();}stop(){root.speechNeedsReset=true;setTimeout(()=>{this.onresult?.({results:[[{transcript:root.speechPhrase}]]});if(root.speechOwner===this)root.speechOwner=null;this.onend?.();},30);}abort(){if(root.speechOwner===this)root.speechOwner=null;}};});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path==='/api/me'?{id:1,name:'Test',plan:'pro',pro_type:'general',role:'user',edition_access:['pro']}:path==='/api/customer-feedback/access'?{enabled:true}:path==='/api/billing/config'?{checkout_enabled:false}:path==='/api/hoa/context'?{communities:[],members:[]}:[]});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me);
 for(const edition of ['basic','general','contractor','paving','asphalt','concrete','roofer','hoa','property','issue']){
 await page.evaluate(edition=>{stopCaptureDictation();state.plan=['basic','roads','issue'].includes(edition)?'free':'pro';state.proType=edition;state.view='capture';renderApp();},edition);
 if(!await page.locator('#dictate').count()){console.log(edition,await page.locator('#body').innerText());throw Error('Capture note missing: '+edition);}
 const instancesBefore=await page.evaluate(()=>speechSessions.length);for(let cycle=1;cycle<=10;cycle++){await page.evaluate(cycle=>{window.speechPhrase='Recording'+cycle;},cycle);await page.locator('#dictate').click();await page.waitForFunction(()=>!dictationPending);await page.locator('#dictate').click();await page.waitForFunction(()=>!dictationPending);await page.waitForFunction(()=>document.getElementById('dictate').textContent==='Record Notes');assert.equal(await page.locator('#note').inputValue(),Array.from({length:cycle},(_,i)=>'Recording'+(i+1)).join(' '),edition+' cycle '+cycle); }
 assert.equal(await page.evaluate(()=>speechSessions.length),instancesBefore+10,'iPhone creates a fresh recognizer on each new recording tap');
 assert.equal(await page.evaluate(start=>new Set(speechSessions.slice(start).map(s=>s.documentIdentity)).size,instancesBefore),10,'each recording uses a distinct speech document');
 assert(await page.locator('#dictate').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),`${edition} button fits`);
 for(let cycle=1;cycle<=3;cycle++){await page.locator('#dictate').click();await page.waitForFunction(()=>!dictationPending);await page.evaluate(cycle=>{const current=speechSessions.at(-1);current.onresult({results:[[{transcript:'Natural'+cycle}]]});if(speechOwner===current)speechOwner=null;current.onend();},cycle);await page.locator('#dictationInterruptedDialog').waitFor({state:'visible'});await page.locator('#dictationStop').click();await page.waitForFunction(()=>document.getElementById('dictate').textContent==='Record Notes'&&!document.getElementById('dictate').disabled);assert((await page.locator('#note').inputValue()).endsWith(Array.from({length:cycle},(_,i)=>'Natural'+(i+1)).join(' ')));}
 await page.evaluate(()=>{state._note='';});
 }
 // Alternate Capture and Feedback in the same page after explicit Stops.
 await page.evaluate(()=>{state.plan='pro';state.proType='general';state.view='capture';renderApp();});
 for(let cycle=0;cycle<3;cycle++){
  await page.evaluate(()=>window.speechPhrase='Capture cross flow');
  await page.locator('#dictate').click();await page.waitForFunction(()=>!dictationPending);
  await page.locator('#dictate').click();await page.waitForFunction(()=>document.getElementById('dictate').textContent==='Record Notes');
  await page.locator('#feedbackFab').click();await page.evaluate(()=>window.speechPhrase='Feedback cross flow');
  await page.locator('#feedbackDictate').click();await page.waitForFunction(()=>document.getElementById('feedbackStatus').textContent!=='Starting microphone...');
  assert(await page.evaluate(()=>speechSessions.at(-1)===speechOwner));
  await page.locator('#feedbackDictate').click();await page.waitForFunction(()=>document.getElementById('feedbackDictate').textContent==='Dictate feedback'&&!document.getElementById('feedbackDictate').disabled);
  assert.equal(await page.locator('#feedbackDescription').inputValue(),'Feedback cross flow');
  await page.locator('#feedbackCancel').click();
 }
 console.log(`${engine.name()} ${width}: 10 edition Capture screens, 10 repeated Stop/Start cycles each PASS`);await page.close();
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
