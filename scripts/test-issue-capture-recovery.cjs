const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.get('/vendor/html2canvas.min.js',(_,res)=>res.sendFile(require.resolve('html2canvas/dist/html2canvas.min.js')));app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
 for(const role of ['super','admin','user']){
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});const errors=[];let sent=false;console.log('Starting',engine.name(),role);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];
 if(path==='/api/me')data={id:1,name:'Test',role:role==='user'?'user':'admin',is_super_admin:role==='super',plan:'pro',edition_access:['basic','pro']};
 if(path==='/api/issues/attention')data={count:0};if(path==='/api/admin/usage')data={};
 if(path==='/api/admin/issues')data=Array.from({length:150},(_,n)=>({id:n+1,page_name:'Organize',description:'What happened: Test issue',management_status:'new',issue_type:'bug_problem',priority:'normal'}));
 if(path==='/api/issues'&&route.request().method()==='POST'){sent=true;data={id:999,email_status:'sent'};}
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/${role==='user'?'':'admin.html'}`);await page.locator('#issueFab').waitFor();
 if(role==='super'){await page.locator('[data-admin-tool="issues"] > summary').click();await page.locator('.issue-admin-card').first().waitFor();}
 // Real capture remains available on both admin roles and the app.
 await page.locator('#issueFab').dispatchEvent('click');await page.locator('#issueModal').waitFor({timeout:2000}).catch(async e=>{console.log(await page.evaluate(()=>({modals:[...document.querySelectorAll('#issueModal')].map(m=>({hidden:m.hidden,rect:m.getBoundingClientRect().toJSON(),display:getComputedStyle(m).display})),text:document.querySelector('#issueShotStatus')?.textContent})));await page.screenshot({path:'/tmp/pn-capture-failure.png'});throw e;});await page.locator('#issueMarkupCanvas').waitFor({timeout:20000});await page.locator('#issueClose').click();
 // Unresponsive capture must not block typing, closing, reopening, or submitting.
 await page.evaluate(()=>{window.realCapture=window.html2canvas;window.html2canvas=()=>new Promise(resolve=>{window.finishOldCapture=resolve;});});
 await page.locator('#issueFab').dispatchEvent('click');await page.locator('#issueModal').waitFor({timeout:2000}).catch(async e=>{console.log(await page.evaluate(()=>({modals:[...document.querySelectorAll('#issueModal')].map(m=>({hidden:m.hidden,rect:m.getBoundingClientRect().toJSON(),display:getComputedStyle(m).display})),text:document.querySelector('#issueShotStatus')?.textContent})));await page.screenshot({path:'/tmp/pn-capture-failure.png'});throw e;});await page.locator('#issueDescription').fill('Report while capture is stalled');
 await page.locator('#issueClose').click();await page.locator('#issueModal').waitFor({state:'hidden'});
 await page.evaluate(()=>{window.html2canvas=()=>new Promise(()=>{});});await page.locator('#issueFab').dispatchEvent('click');await page.locator('#issueDescription').fill('Current report');
 await page.evaluate(()=>{const c=document.createElement('canvas');c.width=10;c.height=10;window.finishOldCapture(c);});
 await page.waitForFunction(()=>document.querySelector('#issueShotStatus').textContent.includes('Screenshot unavailable'),{},{timeout:20000});
 assert.equal(await page.locator('#issueDescription').inputValue(),'Current report');assert.equal(await page.locator('#issueMarkupCanvas').isVisible(),false);
 await page.locator('#issueSend').click();await page.waitForFunction(()=>document.querySelector('#issueStatus').textContent.includes('sent'));assert(sent);assert.deepEqual(errors,[]);
 await page.close();console.log(engine.name(),role,'capture recovery PASS');
 }
 }finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
