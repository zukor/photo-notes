// Shared Capture with synthetic Android speech events; no microphone/provider/customer writes.
const express=require('express'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',userAgent:'Mozilla/5.0 (Linux; Android 10) Chrome/152.0.0.0 Mobile Safari/537.36'});
  await page.addInitScript(()=>{
   localStorage.setItem('pn_install_prompt_dismissed_v1','1');window.speechSessions=[];
   Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
   window.SpeechRecognition=class{constructor(){speechSessions.push(this);}start(){this.onstart?.();}stop(){this.onend?.();}abort(){}};
  });
  await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path==='/api/me'?{id:1,name:'Synthetic',plan:'pro',pro_type:'general',role:'user',edition_access:['pro']}:path==='/api/billing/config'?{checkout_enabled:false}:path==='/api/hoa/context'?{communities:[],members:[]}:[]});});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me);
  const lead='this rules can change with aquifer levels so residents should check so.org for the current stage if you see Water waste you can report it by calling to ';
  for(const edition of ['basic','general','contractor','paving','asphalt','concrete','roofer','hoa','property','issue']){
   await page.evaluate(edition=>{stopCaptureDictation();state._note='Typed starting note.';state.photoFile=null;state.plan=['basic','issue'].includes(edition)?'free':'pro';state.proType=edition;state.view='capture';renderApp();},edition);
   const before=await page.evaluate(()=>speechSessions.length);await page.locator('#dictate').click();await page.waitForFunction(count=>speechSessions.length>count,before);
   for(const number of ['10','10-','10-70','10-704','10-704-7']){
    await page.evaluate(text=>speechSessions.at(-1).onresult({results:[[{transcript:text}]]}),lead+number);
    assert.equal(await page.locator('#note').inputValue(),'Typed starting note. '+lead+number,edition+' numeric snapshot');
    const count=await page.evaluate(()=>speechSessions.length);
    await page.evaluate(()=>speechSessions.at(-1).onend());await page.waitForFunction(count=>speechSessions.length===count+1,count);
   }
   const final=lead+'10-704-7283 come down the street is not allowed at any time of year.';
   await page.evaluate(text=>speechSessions.at(-1).onresult({results:[[{transcript:text}]]}),final);
   await page.locator('#dictate').click();await page.waitForFunction(()=>document.getElementById('dictate').textContent==='Record Notes');
   assert.equal(await page.locator('#note').inputValue(),'Typed starting note. '+final,edition+' Stop retains one passage');
   assert.equal(await page.evaluate(()=>state._note),'Typed starting note. '+final,edition+' saved draft source');
   const stoppedCount=await page.evaluate(()=>speechSessions.length);await page.locator('#dictate').click();await page.waitForFunction(count=>speechSessions.length>count,stoppedCount);await page.evaluate(text=>speechSessions.at(-1).onresult({results:[[{transcript:text}]]}),lead+'10-704-7284');await page.locator('#dictate').click();
   assert.equal(await page.locator('#note').inputValue(),'Typed starting note. '+final+' '+lead+'10-704-7284',edition+' separate recording keeps changed digits');

   const beforeSpelling=await page.locator('#note').inputValue(),beforeCount=await page.evaluate(()=>speechSessions.length);
   await page.locator('#dictate').click();await page.waitForFunction(count=>speechSessions.length>count,beforeCount);
   const first='rules can change with aquifer levels so residents should check s a w s. or for the current';
   const next='rules can change with aquifer levels so residents should check as a w s. or for the current stage';
   await page.evaluate(({first,next})=>speechSessions.at(-1).onresult({results:[[{transcript:first}],[{transcript:next}]]}),{first,next});
   await page.locator('#dictate').click();
   assert.equal(await page.locator('#note').inputValue(),beforeSpelling+' '+next,edition+' revised spelled-address snapshot appears once');
   assert.equal(await page.evaluate(()=>state._note),beforeSpelling+' '+next,edition+' spelled-address draft source');

   const beforeDomain=await page.locator('#note').inputValue();
   const website='this is the web page s a w s';
   let domainCount=await page.evaluate(()=>speechSessions.length);
   await page.locator('#dictate').click();await page.waitForFunction(count=>speechSessions.length>count,domainCount);
   await page.evaluate(first=>speechSessions.at(-1).onresult({results:[[{transcript:first}],[{transcript:first+'.org'}]]}),website);
   await page.locator('#dictate').click();
   const indexedDomain=beforeDomain+' '+website+'.org';
   assert.equal(await page.locator('#note').inputValue(),indexedDomain,edition+' dot-org indexed snapshot');
   const continuedWebsite='this is the next web page s a w s';
   domainCount=await page.evaluate(()=>speechSessions.length);
   await page.locator('#dictate').click();await page.waitForFunction(count=>speechSessions.length>count,domainCount);
   await page.evaluate(first=>speechSessions.at(-1).onresult({results:[[{transcript:first}]]}),continuedWebsite);
   domainCount=await page.evaluate(()=>speechSessions.length);
   await page.evaluate(()=>speechSessions.at(-1).onend());await page.waitForFunction(count=>speechSessions.length===count+1,domainCount);
   await page.evaluate(first=>speechSessions.at(-1).onresult({results:[[{transcript:first+'.org'}]]}),continuedWebsite);
   await page.locator('#dictate').click();
   const continuedDomain=indexedDomain+' '+continuedWebsite+'.org';
   assert.equal(await page.locator('#note').inputValue(),continuedDomain,edition+' dot-org automatic continuation and separate recording');
   assert.equal(await page.evaluate(()=>state._note),continuedDomain,edition+' dot-org draft source');
   domainCount=await page.evaluate(()=>speechSessions.length);
   await page.locator('#dictate').click();await page.waitForFunction(count=>speechSessions.length>count,domainCount);
   await page.evaluate(first=>speechSessions.at(-1).onresult({results:[[{transcript:first+'.com'}]]}),continuedWebsite);
   await page.locator('#dictate').click();
   assert.equal(await page.locator('#note').inputValue(),continuedDomain+' '+continuedWebsite+'.com',edition+' manual recording keeps a different domain');
   assert(await page.locator('#dictate').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),edition+' button fits');
  }
  console.log(`${engine.name()} ${width}: Android continuation/Stop/manual restart and spelled-address snapshots, ten editions PASS`);await page.close();
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
