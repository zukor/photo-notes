// Local UI parity check. APIs are mocked; no production data is read or changed.
const express=require('express');
const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 try{for(const engine of [chromium,webkit]){
  const browser=await engine.launch();
  try{for(const width of [390,1440]){
   const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});
   await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    const data=path==='/api/me'?{id:1,name:'Test',plan:'pro',pro_type:'general',role:'user',edition_access:['pro']}:
     path==='/api/billing/config'?{checkout_enabled:false}:path==='/api/hoa/context'?{communities:[],members:[]}:[];
    return route.fulfill({json:data});
   });
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   await page.waitForFunction(()=>state.me&&document.getElementById('body'));
   for(const section of ['organize','edit','create','send']){
    let reference;
    for(const edition of ['general','contractor','paving','concrete','roofer']){
     await page.evaluate(({edition,section})=>{state.plan='pro';state.proType=edition;state.view=section;state.groupId=null;state.ewrId=null;state.me.ramo_intake_access=true;renderApp();},{edition,section});
     await page.locator(section==='organize'?'#photoSearch':section==='edit'?'#delbtn':section==='create'?'#gcreate':'#sharephotos').waitFor();
     const controls=await page.locator('#body button[id],#body input[id],#body select[id],#body textarea[id]').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return {id:n.id,label:n.tagName==='BUTTON'?n.textContent.trim():n.getAttribute('placeholder'),font:s.fontFamily,size:s.fontSize,color:s.color,background:s.backgroundColor,radius:s.borderRadius};}));
     if(!reference)reference=controls;
     else for(const expected of reference)assert.deepEqual(controls.find(c=>c.id===expected.id),expected,`${edition} ${section} ${expected.id} matches Pro`);
     if(edition==='paving'&&section==='organize')assert.equal(await page.locator('#pavingJobPdf').count(),1);
     if(edition==='concrete'&&section==='organize')assert.equal(await page.locator('#ramoIntakeSend').count(),1);
     if(edition==='concrete'&&section==='send'){assert.equal(await page.locator('#sendshortcuts').count(),1);assert.equal(await page.locator('#sendToRamo').count(),1);}
     assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${edition} ${section} fits ${width}`);
    }
   }
   await page.evaluate(()=>{state.proType='hoa';state.view='capture';renderApp();});
   assert.deepEqual(await page.locator('.workflow-tabs button').allTextContents(),['Capture','Organize','Assets','Inspections','Records']);
   await page.close();console.log(`${engine.name()} ${width}: shared workflow parity and specialist actions PASS`);
  }}finally{await browser.close();}
 }}finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
