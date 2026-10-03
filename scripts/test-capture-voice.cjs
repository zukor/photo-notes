// Real shared Capture screens with simulated speech events, no provider calls.
const express=require('express'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',userAgent:'Mozilla/5.0 (iPhone)'});
 await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','1');window.speechSessions=[];window.SpeechRecognition=class{constructor(){speechSessions.push(this);}start(){this.onstart?.();}stop(){setTimeout(()=>{this.onresult?.({results:[[{transcript:'Delayed final words'}]]});this.onend?.();},30);}abort(){}};});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;return route.fulfill({json:path==='/api/me'?{id:1,name:'Test',plan:'pro',pro_type:'general',role:'user',edition_access:['pro']}:path==='/api/billing/config'?{checkout_enabled:false}:path==='/api/hoa/context'?{communities:[],members:[]}:[]});});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me);
 for(const edition of ['basic','general','contractor','paving','asphalt','concrete','roofer','hoa']){
 await page.evaluate(edition=>{stopCaptureDictation();state.plan=['basic','roads'].includes(edition)?'free':'pro';state.proType=edition;state.view='capture';renderApp();},edition);
 if(!await page.locator('#dictate').count()){console.log(edition,await page.locator('#body').innerText());throw Error('Capture note missing: '+edition);}
 await page.locator('#dictate').click();await page.locator('#dictate').click();await page.waitForFunction(()=>document.getElementById('dictate').textContent==='Record Notes');assert.equal(await page.locator('#note').inputValue(),'Delayed final words');
 assert(await page.locator('#dictate').evaluate(el=>el.getBoundingClientRect().right<=innerWidth),`${edition} button fits`);
 await page.evaluate(()=>{state._note='';});
 }
 console.log(`${engine.name()} ${width}: 8 edition Capture screens, delayed Stop results PASS`);await page.close();
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
