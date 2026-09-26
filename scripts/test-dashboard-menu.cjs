const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.get('/vendor/html2canvas.min.js',(_,res)=>res.sendFile(require.resolve('html2canvas/dist/html2canvas.min.js')));app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
 for(const role of ['super','admin','manager','tester','user']){
 const page=await browser.newPage({viewport:engine===webkit?{width:390,height:844}:{width:1440,height:1000},serviceWorkers:'block'});const errors=[];let sent=false,edition='pro';const editions=['pro','basic','contractor','roads','paving','hoa','concrete','roofer'];console.log('Starting',engine.name(),role);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];
 if(path==='/api/switch-edition')edition=route.request().postDataJSON().edition;
 if(path==='/api/me')data={id:1,name:'Test',role:['super','admin'].includes(role)?'admin':'user',is_super_admin:role==='super',is_testing_manager:role==='manager',is_tester:role==='tester',plan:['basic','roads'].includes(edition)?'free':'pro',pro_type:edition==='pro'?'general':edition,edition_access:editions};
 if(path==='/api/issues/attention')data={count:0,is_tester:role==='tester'};if(path==='/api/admin/usage')data={};
 if(path==='/api/admin/issues')data=Array.from({length:150},(_,n)=>({id:n+1,page_name:'Organize',description:'What happened: Test issue',management_status:'new',issue_type:'bug_problem',priority:'normal'}));
 if(path==='/api/issues'&&route.request().method()==='POST'){sent=true;data={id:999,email_status:'sent'};}
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('#issueFab').waitFor();
 for(const language of ['en','es']){
 await page.locator(`[data-language="${language}"]`).click();
 for(const next of editions){
 await page.locator('#profileButton').click();
 assert.equal(await page.locator('#profileMenu #editionSwitcher').count(),1);
 await page.locator('.version-picker > summary').click();
 const option=page.locator(`.version-choices button[data-edition="${next}"]`);
 assert.equal(await option.evaluate(b=>getComputedStyle(b).whiteSpace),'nowrap');
 assert(await option.evaluate(b=>b.scrollWidth<=b.clientWidth));
 await option.click();
 await page.waitForFunction(value=>document.querySelector('#editionSwitcher')?.value===value&&!document.querySelector('#editionSwitcher')?.disabled,next);
 await page.locator('#profileButton').click();
 const labels=(await page.locator('#profileMenu > a:visible, #profileMenu > button:visible').allTextContents()).map(s=>s.trim());
 assert.equal(labels.pop(),language==='es'?'Cerrar sesión':'Sign Out');
 assert.deepEqual(labels,[...labels].sort((a,b)=>a.localeCompare(b,language,{sensitivity:'base'})),`${role} ${next} ${language}`);
 assert.equal(await page.locator('#profileMenu a[href="/admin?view=super"]').count(),role==='super'?1:0);
 assert.equal(await page.locator('#profileMenu a[href="/admin?view=admin"]').count(),['super','admin'].includes(role)?1:0);
 assert.equal(await page.locator('#manageTesting').isVisible(),['super','admin','manager'].includes(role));
 assert.equal(await page.locator('#myAssignment').isVisible(),role!=='user');
 assert.equal(await page.locator('#myIssues').isVisible(),role!=='tester');
 if(role==='super'&&next==='basic'&&language==='en')await page.screenshot({path:`/tmp/pn-menu-${engine.name()}-basic.png`});
 await page.locator('#profileButton').click();
 }
 }
 // Opening the menu repairs ordering even when entries change after rendering.
 await page.evaluate(()=>{const menu=document.getElementById('profileMenu');menu.appendChild(document.getElementById('installHelp'));});
 await page.locator('#profileButton').click();
 const finalLabels=(await page.locator('#profileMenu > a:visible, #profileMenu > button:visible').allTextContents()).map(s=>s.trim());
 assert.equal(finalLabels.pop(),'Cerrar sesión');assert.deepEqual(finalLabels,[...finalLabels].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})));
 assert.deepEqual(errors,[]);
 await page.close();console.log(engine.name(),role,'dashboard menu PASS');
 }
 }finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
