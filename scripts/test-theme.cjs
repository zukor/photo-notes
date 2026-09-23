const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.get('/vendor/html2canvas.min.js',(_,res)=>res.sendFile(require.resolve('html2canvas/dist/html2canvas.min.js')));app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [320,390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];if(path==='/api/me')data={id:999,name:'Theme Tester',email:'theme@example.invalid',role:'admin',plan:'pro',pro_type:'general',edition_access:['basic','pro','paving','concrete','hoa']};if(path==='/api/issues/attention')data={count:0};if(path==='/api/admin/usage')data={};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));
 await page.goto(base);await page.locator('[data-theme-choice="dark"]').waitFor();
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(255, 255, 255)');
 await page.locator('[data-theme-choice="dark"]').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(17, 24, 39)');
 const d=await page.locator('[data-theme-choice="dark"]').boundingBox(),en=await page.locator('[data-language="en"]').boundingBox();assert(d.x+d.width<=en.x,'theme appears left of EN');
 const logo=await page.locator('.zukor-corner-logo').boundingBox();assert(logo.x+logo.width<=d.x-20,'logo and theme do not overlap');
 for(const view of ['capture','organize','edit','create','send']){await page.evaluate(view=>{state.view=view;renderApp();},view);await page.locator('[data-theme-choice="dark"]').waitFor();assert.equal(await page.locator('[data-theme-choice="dark"]').getAttribute('aria-pressed'),'true');assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 await page.evaluate(()=>{state.view='capture';renderApp();});await page.screenshot({path:`/tmp/pn-theme-${engine.name()}-${width}.png`});
 await page.locator('[data-language="es"]').click();assert.equal(await page.locator('[data-theme-choice="dark"]').getAttribute('aria-label'),'Modo oscuro');
 await page.reload();await page.locator('[data-theme-choice="dark"]').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await page.goto(base+'/admin.html');await page.locator('[data-theme-choice="dark"]').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.screenshot({path:`/tmp/pn-theme-admin-${engine.name()}-${width}.png`});
 await page.goto(base+'/install.html');await page.locator('[data-theme-choice="light"]').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await page.goto(base);await page.locator('[data-theme-choice="light"]').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 assert.deepEqual(errors,[]);await page.close();console.log(engine.name(),width,'theme PASS');
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
