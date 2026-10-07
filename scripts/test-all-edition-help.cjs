// Local browser checks with mocked APIs. No production or paid services.
const express=require('express'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
 for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block',...(width<500?{hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'}:{})});
  await page.route('**/api/**',r=>{const path=new URL(r.request().url()).pathname;return r.fulfill({json:path==='/api/me'?{id:1,name:'Test',role:'user',plan:'pro',pro_type:'general',edition_access:['pro']} :path==='/api/billing/config'?{checkout_enabled:false}:[]});});
  await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_v1:'+encodeURIComponent(''),'done');});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me&&document.getElementById('body'));
  for(const edition of ['basic','issue','roads','general','contractor','paving','hoa','property','concrete','roofer']){
   for(const view of ['basic','issue','roads'].includes(edition)?['capture']:['capture','organize','edit','create','send']){
    await page.evaluate(({edition,view})=>{state.plan=['basic','issue','roads'].includes(edition)?'free':'pro';state.proType=edition==='basic'?'general':edition;state.view=view;state.groupId=null;state.ewrId=null;renderApp();},{edition,view});
    const help=page.locator('.pn-help-fab'),issue=page.locator('#issueFab');assert(await help.isVisible());assert(await issue.isVisible());
    const h=await help.boundingBox(),i=await issue.boundingBox();assert.equal(h.width,i.height,edition+' Help diameter matches Report Issue height');assert.equal(h.height,i.height);assert(Math.abs(h.y+h.height/2-i.y-i.height/2)<0.5,edition+' floating controls share horizontal centerline');assert.equal(await help.locator('span').evaluate(n=>getComputedStyle(n).fontSize),'28px');assert(i.x<width/2&&h.x>width/2);assert(i.x+i.width<h.x);assert(h.y>700&&i.y>700);
    await help.click();await page.locator('#pnHelpSearch').fill('photo');assert(await page.locator('.pn-help-article').count()>0);
    await page.waitForFunction(()=>{const r=document.querySelector('.pn-help-drawer').getBoundingClientRect();return r.x>=-1&&r.right<=innerWidth+1;});
    const drawer=await page.locator('.pn-help-drawer').boundingBox();assert(drawer.x>=-1&&drawer.x+drawer.width<=width+1);
    assert.equal(await page.locator('#pnHelpSearch').evaluate(n=>getComputedStyle(n).color),'rgb(0, 0, 0)');
    await page.locator('#pnHelpClose').click();assert.equal(await help.getAttribute('aria-expanded'),'false');
   }
  }
  await page.screenshot({path:`/tmp/photonotes-help-${engine.name()}-${width}.png`});
  await page.close();console.log(`${engine.name()} ${width}: all editions and shared sections PASS`);
 }
 }finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
