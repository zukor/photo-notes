const assert=require('node:assert/strict'),express=require('express'),{chromium,webkit}=require('playwright');
(async()=>{const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{
for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440])for(const pro_type of ['general','paving','concrete','property','hoa','contractor','roofer']){
 const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});let saved=null,published=0;const allowed=require('../public/scanner-availability'),types={toolPlan:'plan_sketch',toolCard:'business_card',toolEquipment:'equipment_plate',toolMaterial:'material_label',toolGauge:'gauge'};
 await page.route('**/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname;let data=[];
 if(p==='/api/me')data={id:1,name:'Reader Tester',role:'user',plan:'pro',pro_type,feature_access:{camera_readers:true}};
 if(p==='/api/camera-readings/scan')data={ai_read:false,reading:{id:1,fields:{},confidence:'low',photo_path:'/icon-192.png'}};
 if(p==='/api/camera-readings/1'&&req.method()==='POST'){saved={id:1,...req.postDataJSON(),photo_path:'/icon-192.png'};data={ok:true,reading:saved};}
 if(p==='/api/camera-readings'&&saved)data=[saved];
 if(p==='/api/camera-readings/1/library'){published++;data={ok:true,capture_id:10};}
 await route.fulfill({json:data});});
 await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('#tabCapture').waitFor();await page.locator('#tabCapture').click();
 if(pro_type==='paving'){await page.locator('.paving-reason-guide > summary').click();await page.locator('#pavingToolsGuide').click();}else await page.locator('#openCameraTools').click();
 for(const [id,type] of Object.entries(types))assert.equal(await page.locator('#'+id).count(),allowed.allowed(pro_type,type)?1:0);
 assert.equal(await page.locator('#toolTicket').count(),pro_type==='paving'?1:0);
 for(const id of ['toolPlan','toolCard','toolEquipment','toolMaterial','toolGauge']){
  if(!allowed.allowed(pro_type,types[id]))continue;await page.locator('#'+id).click();assert(await page.locator('#readerTake').isVisible());assert(await page.locator('#readerChoose').isVisible());
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
  await page.locator('#readerBack').click();
 }
 if(pro_type!=='general'){ const manual=pro_type==='contractor'?'toolCard':allowed.allowed(pro_type,'gauge')?'toolGauge':'toolMaterial',field=manual==='toolCard'?'name':manual==='toolGauge'?'instrument_type':'product_name';await page.locator('#'+manual).click();await page.locator('#readerLib').setInputFiles(require('node:path').join(__dirname,'../public/icon-192.png'));await page.locator('#readerRead').click();await page.locator('#readerSave').waitFor();
 assert.match(await page.locator('#readerReview').innerText(),/low/);await page.locator('#cr_'+field).fill('Reviewed Vendor');assert.equal(published,0);await page.locator('#readerSave').click();await page.locator('[data-reader-library]').waitFor();assert.equal(saved.fields[field],'Reviewed Vendor');assert.equal(published,0);await page.locator('[data-reader-library]').click();await page.waitForFunction(()=>['organize','photo-library'].includes(state.view));assert.equal(published,1);assert.equal(await page.evaluate(()=>state.proType),pro_type);
 }
 await page.evaluate(()=>{state.view='capture';state.me.feature_access.camera_readers=false;renderApp();});assert.equal(await page.evaluate(()=>featureOn('camera_readers')),false);await page.evaluate(()=>renderCameraTools());for(const id of ['toolPlan','toolCard','toolEquipment','toolMaterial','toolGauge'])assert.equal(await page.locator('#'+id).count(),0);assert.equal(await page.locator('#toolTicket').count(),pro_type==='paving'?1:0);
 for(const proType of ['general','issue','roads']){await page.evaluate(proType=>{state.plan='free';state.proType=proType;state.view='capture';renderApp();},proType);assert.equal(await page.locator('#openCameraTools').count(),0);assert.equal(await page.evaluate(()=>featureOn('camera_readers')),false);}
 await page.close();console.log(engine.name(),width,pro_type,'PASS');
}}finally{await browser.close();}}}finally{server.close();}})().catch(e=>{console.error(e);process.exit(1);});
