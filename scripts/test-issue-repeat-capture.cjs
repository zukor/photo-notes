const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.get('/vendor/html2canvas.min.js',(_,res)=>res.sendFile(require.resolve('html2canvas/dist/html2canvas.min.js')));app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
 for(const role of ['user']){
 const page=await browser.newPage({viewport:{width:1261,height:781},serviceWorkers:'block'});const errors=[];let sent=false;console.log('Starting',engine.name(),role);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];
 if(path==='/api/me')data={id:1,name:'Test',role:role==='user'?'user':'admin',is_super_admin:role==='super',plan:'pro',edition_access:['basic','pro']};
 if(path==='/api/issues/attention')data={count:0};if(path==='/api/admin/usage')data={};
 if(path==='/api/admin/issues')data=Array.from({length:150},(_,n)=>({id:n+1,page_name:'Organize',description:'What happened: Test issue',management_status:'new',issue_type:'bug_problem',priority:'normal'}));
 if(path==='/api/issues'&&route.request().method()==='POST'){sent=true;data={id:999,email_status:'sent'};}
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/${role==='user'?'':'admin.html'}`);await page.locator('#issueFab').waitFor();
 await page.evaluate(()=>{const original=captureIssueScreenshot;captureIssueScreenshot=async(...args)=>{try{return await original(...args);}catch(e){console.log('CAPTURE',e.message);throw e;}};});
 page.on('console',m=>{if(m.type()==='error')console.log(m.text());});
 for(const view of ['organize','edit','send']){
 await page.evaluate(view=>{state.view=view;renderApp();},view);
 for(let n=1;n<=6;n++){
 await page.locator('#issueFab').dispatchEvent('click');
 await page.waitForFunction(()=>document.querySelector('#issueShotStatus').textContent!=='Capturing this page...');
 assert.equal(await page.locator('#issueShotStatus').textContent(),'');
 await page.locator('#issueMarkupCanvas').waitFor();await page.evaluate(()=>issueMarkupEditor.ready);
 assert(await page.evaluate(()=>issueScreenshotBlob?.size>1000));
 await page.locator('#issueClose').click();console.log(engine.name(),view,n,'PASS');
 }
 }
 // A failed renderer may leave its hidden frame behind. Retrying must recover.
 await page.evaluate(()=>{window.actualRenderer=window.html2canvas;let calls=0;window.html2canvas=(...args)=>{if(++calls%2){const frame=document.createElement('iframe');frame.className='html2canvas-container';document.body.append(frame);return Promise.reject(Error('Synthetic intermittent renderer failure'));}return window.actualRenderer(...args);};});
 for(let n=0;n<5;n++){
 await page.locator('#issueFab').dispatchEvent('click');await page.waitForFunction(()=>!!issueScreenshotBlob,{},{timeout:20000});await page.evaluate(()=>issueMarkupEditor.ready);assert.equal(await page.locator('iframe.html2canvas-container').count(),0);await page.locator('#issueClose').click();
 }
 // Close during an unfinished clone, then immediately reopen with a working renderer.
 await page.evaluate(()=>{window.html2canvas=()=>{const frame=document.createElement('iframe');frame.className='html2canvas-container';document.body.append(frame);return new Promise(()=>{});};});
 await page.locator('#issueFab').dispatchEvent('click');await page.waitForFunction(()=>document.querySelector('iframe.html2canvas-container'));
 await page.locator('#issueClose').click();await page.waitForFunction(()=>!document.querySelector('iframe.html2canvas-container'));
 await page.evaluate(()=>{window.html2canvas=window.actualRenderer;});await page.locator('#issueFab').dispatchEvent('click');await page.waitForFunction(()=>!!issueScreenshotBlob);await page.locator('#issueClose').click();
 assert.deepEqual(errors,[]);
 await page.close();console.log(engine.name(),role,'desktop speed PASS');
 }
 }finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
