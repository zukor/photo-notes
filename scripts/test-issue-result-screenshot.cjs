// Local shared-edition fixtures. No production requests or real reports.
const express=require('express'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(path.join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const png=await require('sharp')({create:{width:300,height:160,channels:3,background:'#ff6600'}}).png().toBuffer();
 const editions=['basic','issue','roads','general','contractor','paving','hoa','property','concrete','roofer'];
 const evidence={id:1,user_id:1,user_name:'Fixture tester',issue_type:'bug_problem',description:'Output differs from preview',management_status:'new',created_at:new Date().toISOString(),screenshot_path:'/favicon-32.png',result_screenshot_path:'/icon-192.png'};
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:950},serviceWorkers:'block'});let postCount=0;
  await page.route('**/api/**',route=>{const p=new URL(route.request().url()).pathname;if(p==='/api/issues'&&route.request().method()==='POST'){postCount++;const body=route.request().postDataBuffer().toString('latin1');assert(body.includes('name="screenshot"'));assert(body.includes('name="result_screenshot"'));return route.fulfill({status:postCount===1?500:200,json:postCount===1?{error:'Fixture retry required'}:{ok:true,id:2,email_status:'pending'}});}return route.fulfill({json:p==='/api/me'?{id:1,name:'Fixture',role:'admin',is_super_admin:true,plan:'pro',pro_type:'general',edition_access:['pro']}:['/api/admin/issues','/api/issues/mine'].includes(p)?[evidence]:p==='/api/billing/config'?{checkout_enabled:false}:[]});});
  await page.goto(base);await page.waitForFunction(()=>state.me);
  await page.evaluate(bytes=>{window.resultFixtureBytes=bytes;captureIssueScreenshot=async()=>new Blob([new Uint8Array(bytes)],{type:'image/png'});},[...png]);
  for(const edition of editions){
   await page.evaluate(edition=>{state.plan=['basic','issue','roads'].includes(edition)?'free':'pro';state.proType=edition==='basic'?'general':edition;state.view='capture';renderApp();},edition);
   await page.locator('#issueFab').click();await page.locator('#issueMarkupCanvas').waitFor();
   await page.locator('#issueResultScreenshot').setInputFiles({name:'result.png',mimeType:'image/png',buffer:png});await page.locator('#issueResultPreview').waitFor({state:'visible'});
   assert.equal(await page.locator('#issueResultScreenshot').evaluate(e=>e.files[0].name),'result.png');
   assert.equal(await page.evaluate(()=>document.querySelector('.issue-dialog').scrollWidth<=document.querySelector('.issue-dialog').clientWidth),true,edition+' dialog fits');
   const original=await page.evaluate(()=>issueScreenshotBlob);assert(original);
   await page.locator('#issueResultRemove').click();assert.equal(await page.locator('#issueResultPreview').isVisible(),false);assert.equal(await page.evaluate(()=>!!issueScreenshotBlob),true);
   await page.locator('#issueResultScreenshot').setInputFiles({name:'result.png',mimeType:'image/png',buffer:png});await page.locator('#issueResultPreview').waitFor({state:'visible'});
   if(edition==='property'){
    await page.locator('#issueResultPreview').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/pn-result-'+engine.name()+'-'+width+'.png'});
    await page.locator('#issueDescription').fill('Exported result differs from the app preview');await page.locator('#issueSend').click();await page.getByText('Fixture retry required',{exact:true}).waitFor();assert.equal(await page.locator('#issueResultPreview').isVisible(),true);
    await page.locator('#issueSend').click();await page.getByText('Issue #2 saved. Thank you.',{exact:true}).waitFor();
   }
   await page.locator('#issueClose').click();assert.equal(await page.evaluate(()=>issueResultFile===null&&issueResultURL===null),true);
  }
  await page.evaluate(()=>renderMyIssueReports());await page.getByText('Show Result Screenshot',{exact:true}).click();assert.equal(await page.locator('img[alt="Result screenshot supplied by the reporter"]').getAttribute('src'),evidence.result_screenshot_path);
  await page.goto(base+'/admin.html');await page.locator('[data-admin-tool="issues"] > summary').click();await page.locator('[data-issue-card="1"] > summary').click();assert.equal(await page.getByText('Show App Screenshot',{exact:true}).count(),1);await page.getByText('Show Result Screenshot',{exact:true}).click();assert.equal(await page.locator('img[alt="Result screenshot supplied by the reporter"]').getAttribute('src'),evidence.result_screenshot_path);
  console.log(engine.name(),width,'all ten editions: separate preview, remove, close, retry and admin evidence PASS');await page.close();
 }}finally{await browser.close();}}}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
