const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.get('/vendor/html2canvas.min.js',(_,res)=>res.sendFile(require.resolve('html2canvas/dist/html2canvas.min.js')));app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
 for(const role of ['super','admin','user']){
 const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});const errors=[];let sent=false;console.log('Starting',engine.name(),role);page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];
 if(path==='/api/me')data={id:1,name:'Test',role:role==='user'?'user':'admin',is_super_admin:role==='super',plan:'pro',edition_access:['basic','pro']};
 if(path==='/api/issues/attention')data={count:0};if(path==='/api/admin/usage')data={};
 if(path==='/api/admin/issues')data=Array.from({length:150},(_,n)=>({id:n+1,page_name:'Organize',description:'What happened: Test issue',management_status:'new',issue_type:'bug_problem',priority:'normal'}));
 if(path==='/api/issues'&&route.request().method()==='POST'){sent=true;data={id:999,email_status:'sent'};}
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/${role==='user'?'':'admin.html'}`);await page.locator('#issueFab').waitFor();
 if(role!=='user'){await page.locator('[data-admin-tool="issues"] > summary').click();await page.locator('.issue-admin-card').first().waitFor();}
 // Hidden content must not delay the visible page screenshot, even if its image never loads.
 await page.route('**/slow-shot.png',()=>{});
 await page.evaluate(()=>{
   const panel=document.createElement('div');panel.hidden=true;
   panel.innerHTML='<img src="/slow-shot.png">'+('<div>Hidden content</div>'.repeat(2000));document.body.append(panel);
   const details=document.createElement('details');details.innerHTML='<summary>Collapsed evidence</summary><div><img src="/slow-shot.png"></div>';document.body.append(details);
   window.captureStarted=false;const render=window.html2canvas;window.html2canvas=(...args)=>{window.captureStarted=true;return render(...args);};
 });
 const start=Date.now();await page.locator('#issueFab').dispatchEvent('click');
 assert(await page.locator('#issueModal').isVisible());
 assert.equal(await page.evaluate(()=>window.captureStarted),false,'form opens before expensive capture starts');
 const opened=Date.now()-start;
 await page.locator('#issueMarkupCanvas').waitFor({timeout:5000});
 console.log(engine.name(),role,'dialog ms',opened,'screenshot ms',Date.now()-start);
 assert.deepEqual(errors,[]);
 await page.close();console.log(engine.name(),role,'desktop speed PASS');
 }
 }finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
