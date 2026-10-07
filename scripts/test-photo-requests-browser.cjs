const express=require('express'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.get('/photo-request/:token',(req,res)=>res.sendFile(path.join(__dirname,'../public/photo-request.html')));app.use(express.static(path.join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const origin='http://127.0.0.1:'+server.address().port;
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
 const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});page.on('pageerror',e=>console.error('Browser error:',e.message));let requests=[],submission=null;
 await page.addInitScript(()=>localStorage.setItem('photo-notes-theme','dark'));
 await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),p=url.pathname;
  let data=[];
  if(p==='/api/me')data={id:1,name:'Test Sender',role:'user',plan:'pro',pro_type:'general',edition_access:['pro']};
  else if(p==='/api/billing/config')data={checkout_enabled:false};
  else if(p==='/api/photo-requests'&&req.method()==='POST'){const b=req.postDataJSON();data={...b,id:requests.length+1,status:'open',received_count:0,expires_at:new Date(Date.now()+86400000).toISOString(),url:origin+'/photo-request/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};requests.unshift(data);}
  else if(p==='/api/photo-requests')data=requests;
  else if(p.startsWith('/api/photo-requests/'))data={request:{...requests[0],status:'completed'},photos:[{view_index:0,view_name:'Overall',capture_id:1,submitter_name:'Contractor',note:'Clear view',original_name:'photo.jpg',submitted_at:new Date().toISOString(),photo_path:'/logo.svg'}],history:[{action:'submission_received',created_at:new Date().toISOString()}]};
  else if(p.startsWith('/api/public/photo-requests/')){if(req.method()==='POST'){submission=req.postDataBuffer();data={ok:true,status:'completed'};}else data={title:'HVAC Unit #4',sender_name:'Test Management',recipient_name:'Contractor',instructions:'Photograph the equipment and plate.',views:['Overall','Equipment Plate'],expires_at:new Date(Date.now()+86400000).toISOString(),received:[],allow_partial:false};}
  return route.fulfill({json:data});
 });
 await page.goto(origin);await page.waitForFunction(()=>state.me&&document.getElementById('body'));
 for(const edition of ['general','property','hoa','paving','concrete','contractor','roofer']){
  await page.evaluate(edition=>{state.plan='pro';state.proType=edition;state.view='organize';renderApp();},edition);
  await page.locator('#prOpen').click();await page.locator('#prTitle').waitFor();assert.equal(await page.locator('.photo-requests p').first().evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)');
  await page.locator('#prTitle').fill('Equipment photos');await page.locator('#prInstructions').fill('Photograph the unit.');await page.locator('#prViews').fill('Overall\nEquipment Plate');
  await page.locator('#prCreate').click();await page.waitForFunction(()=>document.getElementById('prCreateStatus').textContent.includes('Request created'));
  await page.locator('[data-pr-copy]').first().waitFor({state:'visible'});assert.equal(await page.locator('[data-pr-copy]').count()>0,true);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert.equal(overflow,false,edition+' overflow '+width);
  await page.locator('.pn-help-fab').click();await page.locator('#pnHelpSearch').fill('Photo Request');assert(await page.locator('.pn-help-article').count()>0);await page.locator('#pnHelpClose').click();
  const missing=await page.evaluate(()=>window.PhotoNotesHelpCatalog.rules.filter(r=>r.keys.some(k=>k==='prCreate')).length);assert.equal(missing,1);
  await page.locator('[data-pr-detail]').first().click();await page.locator('[data-pr-photo]').waitFor();assert(await page.locator('#prDetail').innerText().then(t=>t.includes('Contractor')&&t.includes('Clear view')));
  await page.screenshot({path:`/tmp/photo-requests-${engine.name()}-${edition}-${width}.png`,fullPage:true});
 }
 for(const edition of ['general','issue','roads']){await page.evaluate(edition=>{state.plan='free';state.proType=edition;state.view='capture';renderApp();},edition);assert.equal(await page.locator('#prOpen').count(),0);}
 await page.goto(origin+'/photo-request/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');await page.locator('#prPublicForm').waitFor();
 const image=await require('sharp')({create:{width:30,height:20,channels:3,background:'#114477'}}).jpeg().toBuffer();
 await page.locator('#prChoose0').setInputFiles({name:'overall.jpg',mimeType:'image/jpeg',buffer:image});await page.locator('#prPreview0').waitFor({state:'visible'});assert.equal(await page.locator('#prPreview0').isVisible(),true);
 await page.locator('#prPublicSubmit').click();assert((await page.locator('#prPublicStatus').innerText()).includes('every requested view'));
 await page.locator('#prCamera0').setInputFiles({name:'replacement.jpg',mimeType:'image/jpeg',buffer:image});await page.locator('#prChoose1').setInputFiles({name:'plate.jpg',mimeType:'image/jpeg',buffer:image});await page.locator('#prViewNote1').fill('Plate is readable');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 await page.screenshot({path:`/tmp/photo-request-recipient-${engine.name()}-${width}.png`,fullPage:true});
 await page.locator('#prPublicSubmit').click();await page.waitForFunction(()=>document.getElementById('prPublicStatus').textContent.includes('Photos received'));assert(submission.includes(Buffer.from('replacement.jpg')));assert(!submission.includes(Buffer.from('overall.jpg')));assert(submission.includes(Buffer.from('Plate is readable')));assert.equal(await page.locator('#prPublicForm').count(),0);
 await page.close();console.log(`${engine.name()} ${width}: seven Pro editions, excluded editions, creation, dynamic Help, received evidence, recipient preview/replacement/required views/receipt PASS`);
 }}finally{await browser.close();}}}finally{await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
