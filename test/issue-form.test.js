const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const url=process.env.ISSUE_FORM_DATABASE_URL;
test('Issue types, screenshot layout, and real browser audio attachment',{skip:!url},async()=>{
 const target=new URL(url);assert.ok(['127.0.0.1','localhost'].includes(target.hostname));assert.equal(target.pathname,'/pn_issue_form_test');
 const uploads=await fs.mkdtemp(path.join(os.tmpdir(),'pn-issue-form-'));
 Object.assign(process.env,{DATABASE_URL:url,SESSION_SECRET:'local-test-secret',ADMIN_EMAIL:'form@example.test',ADMIN_PASSWORD:'local-test-password',PGSSL:'',UPLOAD_DIR:uploads});delete process.env.RESEND_API_KEY;process.env.TESTER_QUEUE_TOKEN='result-evidence-local-queue';
 const {pool,init}=require('../db');await init();const {app}=require('../server');const server=app.listen(0);await new Promise(r=>server.once('listening',r));const base='http://localhost:'+server.address().port;
 const {chromium}=require('playwright');const browser=await chromium.launch({headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',permissions:['microphone'],serviceWorkers:'block'});
 const page=await context.newPage();await page.addInitScript(()=>{localStorage.setItem('pn_first_use_v1:form%40example.test','done');localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');});await page.goto(base);await page.locator('#email').fill('form@example.test');await page.locator('#pw').fill('local-test-password');await page.locator('#loginBtn').click();await page.locator('#issueFab').click();await page.locator('#issueMarkupCanvas').waitFor();
 assert.deepEqual(await page.locator('#issueType option').allTextContents(),['Bug/Problem','UI Improvement','Feature Improvement Idea','New Feature Idea']);assert.equal(await page.locator('#issueShotStatus').innerText(),'');assert.equal(await page.locator('#issueStatus').innerText(),'');
 const order=await page.evaluate(()=>{const above=(a,b)=>!!(document.querySelector(a).compareDocumentPosition(document.querySelector(b))&Node.DOCUMENT_POSITION_FOLLOWING);return above('#issueFrequency','.issue-evidence')&&above('#issueMarkupCanvas','.issue-markup-toolbar')&&above('.issue-evidence','#issueSend')});assert.equal(order,true);
 await page.locator('#issueType').selectOption('ui_improvement');await page.locator('#issueRecord').click();await page.waitForFunction(()=>issueMediaRecorder?.state==='recording');await page.waitForTimeout(600);await page.locator('#issueRecord').click();await page.waitForFunction(()=>issueVoiceBlob?.size>0);
 const resultImage=await require('sharp')({create:{width:200,height:120,channels:3,background:'#ff6600'}}).png().toBuffer();
 await page.locator('#issueResultScreenshot').setInputFiles({name:'downloaded-result.png',mimeType:'image/png',buffer:resultImage});
 await page.locator('#issueResultPreview').waitFor({state:'visible'});
 assert.equal(await page.locator('#issueResultStatus').innerText(),'Result screenshot attached.');
 await page.locator('#issueResultRemove').click();assert.equal(await page.locator('#issueResultPreview').isVisible(),false);
 await page.locator('#issueResultScreenshot').setInputFiles({name:'downloaded-result.png',mimeType:'image/png',buffer:resultImage});
 await page.locator('#issueResultPreview').waitFor({state:'visible'});
 const sentMail=[];const realFetch=global.fetch;process.env.RESEND_API_KEY='local-fixture-only';global.fetch=(url,options)=>String(url)==='https://api.resend.com/emails'?(sentMail.push(JSON.parse(options.body)),Promise.resolve(new Response('{}',{status:200}))):realFetch(url,options);
 const posted=page.waitForResponse(r=>r.url()===base+'/api/issues'&&r.request().method()==='POST');await page.locator('#issueSend').click();const response=await posted;assert.equal(response.status(),200);const id=(await response.json()).id;
 const row=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];assert.equal(row.issue_type,'ui_improvement');assert.ok(row.result_screenshot_path);assert.notEqual(row.result_screenshot_path,row.screenshot_path);assert.deepEqual(await fs.readFile(path.join(uploads,path.basename(row.result_screenshot_path))),resultImage);assert.ok(row.voice_path);assert.ok(row.screenshot_path);assert.ok((await fs.stat(path.join(uploads,path.basename(row.voice_path)))).size>0);assert.ok((await fs.stat(path.join(uploads,path.basename(row.screenshot_path)))).size>0);
 delete process.env.RESEND_API_KEY;global.fetch=realFetch;assert.equal(sentMail.length,1);assert.equal(sentMail[0].attachments.length,3);const resultAttachment=sentMail[0].attachments.find(a=>a.filename.includes('-result.'));assert.deepEqual(Buffer.from(resultAttachment.content,'base64'),resultImage);
 const mine=await context.request.get(base+'/api/issues/mine');assert.equal((await mine.json()).find(i=>i.id===id).result_screenshot_path,row.result_screenshot_path);
 process.env.SUPER_ADMIN_USER_IDS=String(row.user_id);
 const admin=await context.request.get(base+'/api/admin/issues');assert.equal((await admin.json()).find(i=>i.id===id).result_screenshot_path,row.result_screenshot_path);
 const automationHeaders={Authorization:'Bearer result-evidence-local-queue'};
 // Idea reports require approval before entering the repair queue.
 await pool.query("UPDATE issue_reports SET issue_type='bug_problem' WHERE id=$1",[id]);
 const actionable=await context.request.get(base+'/api/automation/testing-queue',{headers:automationHeaders});assert.equal((await actionable.json()).issues.find(i=>i.id===id).has_result_screenshot,true);
 const attachment=await context.request.get(base+`/api/automation/issues/${id}/attachment/result_screenshot`,{headers:automationHeaders});assert.equal(attachment.status(),200);assert.deepEqual(await attachment.body(),resultImage);
 assert.equal((await fetch(base+`/api/automation/issues/${id}/attachment/result_screenshot`)).status,401);
 const before=(await fs.readdir(uploads)).length;
 for(const bad of [{name:'fake.png',mimeType:'image/png',buffer:Buffer.from('this is not an image')},{name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(8*1024*1024+1)}]){
 const rejected=await context.request.post(base+'/api/issues',{multipart:{description:'Invalid screenshot fixture',result_screenshot:bad}});assert.equal(rejected.status(),400);assert.equal((await fs.readdir(uploads)).length,before,'invalid screenshot is cleaned up');}
 for(const type of ['bug_problem','feature_improvement','new_feature','invalid']){const response=await context.request.post(base+'/api/issues',{multipart:{description:'Synthetic type test',issue_type:type}});assert.equal(response.status(),type==='invalid'?400:200);if(type!=='invalid'){const data=await response.json();assert.equal((await pool.query('SELECT issue_type FROM issue_reports WHERE id=$1',[data.id])).rows[0].issue_type,type);}}
 await page.locator('#issueModal').waitFor({state:'hidden'});await page.locator('[data-language="es"]').click();await page.locator('#issueFab').click();await page.locator('#issueMarkupCanvas').waitFor();assert.equal(await page.locator('#issueType option').nth(1).innerText(),'Mejora de la interfaz');assert.equal(await page.locator('#issueResultChoose').innerText(),'Elegir captura del resultado');await page.locator('.issue-evidence').last().scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/pn-issue-form-es.png'});assert.equal(await page.evaluate(()=>document.querySelector('.issue-dialog').scrollWidth>document.querySelector('.issue-dialog').clientWidth),false);
 }finally{await browser.close();await new Promise(r=>server.close(r));await pool.end();await fs.rm(uploads,{recursive:true,force:true});}
});
