const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const base=process.env.PN_HELP_BASE_URL||`http://127.0.0.1:${server.address().port}`;
 try { for(const engine of [chromium,webkit]) {
 const browser=await engine.launch();
 try {
 const page=await browser.newPage({viewport:{width:1440,height:960},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let body=[];
 if(path==='/api/me')body={id:99,email:'help-test@example.invalid',name:'Help test',plan:'free',pro_type:'general',edition_access:['basic','pro','contractor','roads','paving','hoa','concrete','roofer']};
 if(path==='/api/issues/attention')body={count:0};
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});});
 await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('.help-fab').waitFor();
 assert.equal(await page.locator('.tensor-help-slot').count(),0);
 await page.locator('.help-fab').click();await page.locator('#helpSearch').fill('offline');assert(await page.locator('.help-article').count()>0);
 await page.locator('.help-article').first().locator('summary').click();assert(await page.locator('.help-article[open] p').isVisible());
 await page.locator('#helpSearch').fill('zzzz-no-match');assert((await page.locator('#helpResults').textContent()).includes('No matching'));
 await page.locator('#helpClear').click();assert(!(await page.locator('#helpCategory').textContent()).includes('Edit'));
 await page.keyboard.press('Escape');assert.equal(await page.locator('.help-fab').getAttribute('aria-expanded'),'false');assert(await page.locator('.help-fab').evaluate(e=>e===document.activeElement));
 await page.locator('.help-fab').click();
 for(const [edition,type,view] of [['pro','general','capture'],['contractor','contractor','capture'],['roads','roads','road-report'],['paving','paving','capture'],['hoa','hoa','capture'],['concrete','concrete','capture'],['roofer','roofer','capture']]) {
 await page.evaluate(({edition,type,view})=>{state.plan=edition==='roads'?'free':'pro';state.proType=type;state.view=view;renderApp();},{edition,type,view});
 assert.equal(await page.locator('.help-fab').getAttribute('aria-expanded'),'true');
 await page.locator('[data-help-scope="page"]').click();assert(await page.locator('.help-article').count()>0);
 await page.locator('[data-help-scope="all"]').click();
 const cats=await page.locator('#helpCategory').textContent();assert.equal(cats.includes('Paving tools'),edition==='paving');assert.equal(cats.includes('HOA workflows'),edition==='hoa');assert.equal(cats.includes('Concrete tools'),edition==='concrete');
 }
 for(const width of [1440,1100]) {await page.setViewportSize({width,height:960});await page.waitForTimeout(260);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const box=await page.locator('.wrap').boundingBox();assert(box.x+box.width<=width-380+1);}
 await page.screenshot({path:'/tmp/pn-help-'+engine.name()+'.png',fullPage:true});
 await page.setViewportSize({width:1099,height:900});await page.waitForTimeout(100);assert.equal(await page.locator('#desktopHelp').count(),0);assert.equal(await page.evaluate(()=>document.body.classList.contains('desktop-help-open')),false);
 await page.setViewportSize({width:1440,height:960});await page.locator('.help-fab').waitFor();assert.equal(await page.locator('.help-fab').getAttribute('aria-expanded'),'false');
 await page.evaluate(()=>renderLogin());assert.equal(await page.locator('#desktopHelp').count(),0);
 assert.deepEqual(errors,[]);
 for(const width of [390,844,1200]) {
 const mobile=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',serviceWorkers:'block'});
 await mobile.route('**/api/**',r=>r.fulfill({status:401,contentType:'application/json',body:'{}'}));
 await mobile.goto(base,{waitUntil:'domcontentloaded'});await mobile.evaluate(()=>PhotoNotesHelp.mount({edition:'basic',page:'capture',name:'Basic'}));assert.equal(await mobile.locator('#desktopHelp').count(),0);await mobile.close();
 }
 console.log(engine.name()+': help search, filtering, eight editions, keyboard close/focus, workspace reflow, resize, sign-out, and phone exclusion passed');
 } finally {await browser.close();}
 }} finally {server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
