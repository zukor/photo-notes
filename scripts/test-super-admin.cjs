const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const owner of [false,true]){
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;requests.push(path);let data=[];
  if(path==='/api/me')data={name:'Admin Tester',role:'admin',is_super_admin:owner,plan:'pro'};
  if(path==='/api/admin/users')data=[{id:1,name:'Owner Account',email:'owner@example.invalid',role:'admin',is_super_admin:true,active:true,edition_access:['basic']},{id:2,name:'Regular User',email:'user@example.invalid',role:'user',active:true,edition_access:['basic','paving']}];
  if(path==='/api/issues/attention')data={count:0};
  if(path==='/api/admin/usage')data=[];
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
 await page.locator('#usersHeading').waitFor();
 assert.equal(await page.locator('h1').textContent(),owner?'Super Admin':'Admin');
 const labels=await page.locator('[data-admin-tool] > summary').allTextContents();
 assert(labels.includes('Users'));assert.deepEqual(labels,[...labels].sort((a,b)=>a.localeCompare(b,'en')));
 assert(await page.locator('.admin-tools-heading').evaluate(heading=>[...document.querySelectorAll('[data-admin-tool]')].every(tool=>!!(heading.compareDocumentPosition(tool)&Node.DOCUMENT_POSITION_FOLLOWING))));
 for(const tool of ['health','billing','activity','issues','system-status'])assert.equal(await page.locator(`[data-admin-tool="${tool}"]`).count(),owner?1:0);
 assert.equal(await page.locator('.issue-diagnostics').count(),0);
 assert.equal(await page.locator('#addUser').count(),owner?1:0);
 assert.equal(await page.locator('[data-admin-tool="summary"]').count(),0);
 assert.equal(await page.locator('#userTotals').count(),owner?1:0);
 if(owner)assert.equal(await page.locator('#usersSection #userTotals').count(),1);
 assert.equal(await page.locator('#createUserPanel').count(),owner?1:0);
 if(owner){await page.locator('[data-admin-tool="issues"] > summary').click();await page.locator('#issues .helper').waitFor();assert(await page.getByRole('heading',{name:'How issue reports are handled'}).isVisible());assert.equal(await page.locator('[data-admin-tool="issues"] [data-admin-tool="system-status"]').count(),0);assert(!requests.includes('/api/admin/repair-status'));await page.locator('[data-admin-tool="system-status"] > summary').click();await page.waitForFunction(()=>document.querySelector('#repairWorkerStatus dl'));}
 if(!owner)assert(!requests.some(path=>/\/(issues|health|activity|repair-status|cloud-worker)$/.test(path)||path.includes('/billing/')));
 await page.locator('#usersHeading').click();
 if(owner){await page.locator('#userTotals > summary').click();assert(await page.locator('#summary .card').isVisible());}
 await page.locator('[data-open-user="1"]').click();
 assert.equal(await page.locator('[data-reset]').count(),owner?1:0);
 assert.equal(await page.locator('[data-edit-user]').count(),owner?1:0);
 await page.locator('#backToUsers').click();await page.locator('[data-open-user="2"]').click();
 for(const selector of ['[data-reset]','[data-edit-user]','[data-delete-user]','[data-active]','[data-save-tester]','[data-save-features]'])assert.equal(await page.locator(selector).count(),owner?1:0,selector);
 assert.equal(await page.locator('[data-save-versions]').count(),1);
 assert.deepEqual(errors,[]);await page.screenshot({path:`/tmp/pn-super-${engine.name()}-${owner}.png`});
 console.log(engine.name(),owner?'super admin':'regular admin','PASS');await page.close();
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
