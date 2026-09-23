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
 if(role==='super'){await page.locator('[data-admin-tool="issues"] > summary').click();await page.locator('.issue-admin-card').first().waitFor();}
 await page.evaluate(()=>{window.html2canvas=async()=>{throw Error('Synthetic capture unavailable');};});
 await page.locator('#issueFab').dispatchEvent('click');await page.locator('#issueModal').waitFor();
 for(const width of [320,390,1440]){
 await page.setViewportSize({width,height:1000});
 for(const [type,label] of Object.entries({bug_problem:'Describe the bug or problem',ui_improvement:'Describe the suggested UI improvement',feature_improvement:'Describe the suggested feature improvement idea',new_feature:'Describe the new feature idea'})){
 await page.locator('#issueType').selectOption(type);assert.equal(await page.locator('#issueDescriptionLabel').textContent(),label);
 assert.equal(await page.locator('#issueDescription').getAttribute('placeholder'),label);
 const heading=await page.locator('#issueDescriptionLabel').boundingBox(),button=await page.locator('#issueRecord').boundingBox(),field=await page.locator('#issueDescription').boundingBox();
 assert(button.x>=heading.x+heading.width,'speech control must be right of label');assert(button.width<field.width/2,'speech control is compact');assert(heading.y<field.y&&button.y<field.y,'heading and speech control above textarea');
 }
 }
 assert.equal(await page.locator('#issueRecord').textContent(),'Click to speak description');
 if(role==='user'){await page.evaluate(()=>photoNotesI18n.setLanguage('es'));await page.locator('#issueType').selectOption('bug_problem');assert.equal(await page.locator('#issueDescriptionLabel').textContent(),'Describe el error o problema');}
 assert.deepEqual(errors,[]);
 await page.close();console.log(engine.name(),role,'description heading PASS');
 }
 }finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
