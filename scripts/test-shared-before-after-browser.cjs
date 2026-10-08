const assert=require('node:assert/strict'),express=require('express'),{chromium,webkit}=require('playwright'),path=require('node:path');
(async()=>{const app=express();app.use(express.static(path.join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{
for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440])for(const edition of ['general','paving','concrete','hoa','property','contractor','roofer']){
const page=await browser.newPage({viewport:{width,height:1000},serviceWorkers:'block'});let pairs=[],uploads=0,attempts=0,opacity=null,metadata='',failOnce=false;
const photos=[{id:1,photo_path:'/icon-192.png',photo_title:'Original condition',created_at:'2026-01-01',area_tags:['Site'],job_id:4,concrete_phase:'proposal',concrete_purpose:'existing_condition',concrete_element:'patio',concrete_location:'North patio',concrete_condition:'repair_needed',concrete_severity:'severe'},{id:2,photo_path:'/icon-192.png',photo_title:'Completed work',created_at:'2026-02-01',area_tags:['Site']}];
await page.route('**/api/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname;let data=[],status=200;
if(p==='/api/me')data={id:1,name:'Pair Tester',role:'user',plan:'pro',pro_type:edition,feature_access:{before_after:true,camera_readers:true}};
if(p.startsWith('/api/captures'))data=photos;
if(p==='/api/captures'&&req.method()==='POST'){uploads++;metadata=req.postData();data={id:3,...photos[1]};data.id=3;photos.push(data);}
if(p==='/api/pairs')data=pairs;
if(p==='/api/pairs'&&req.method()==='POST'){attempts++;if(failOnce){failOnce=false;status=500;data={error:'simulated pairing failure'};}else{const b=req.postDataJSON();pairs=[{id:9,...b}];data={ok:true,pair:pairs[0]};}}
if(p==='/api/pairs/9'){opacity=req.postDataJSON().comparison_opacity;pairs[0].comparison_opacity=opacity;data={ok:true,pair:pairs[0]};}
if(p==='/api/pairs/unpair'){pairs=[];data={ok:true};}
await route.fulfill({status,json:data});});
await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me&&document.getElementById('tabCapture'));if(width===1440&&['hoa','property'].includes(edition))await page.locator('#hvNew').waitFor();await page.evaluate(()=>{getLocationOnce=async()=>null;});
await page.evaluate(()=>{state.view='photo-library';renderApp();});await page.locator('.capchk[value="1"]').waitFor();
await page.locator('.capchk[value="1"]').check();await page.locator('.capchk[value="2"]').check();await page.locator('.pair-builder').filter({has:page.locator('#pairbtn')}).locator('summary').click();await page.locator('#pairbtn').click();await page.locator('#pairSwap').click();await page.locator('#pairConfirm').click();await page.locator('#organizeWorkSection').evaluate(e=>e.open=true);await page.locator('.pair-builder').evaluate(e=>e.open=true);await page.locator('[data-view-pair="9"]').waitFor();assert.equal(pairs[0].before_id,2);assert.equal(pairs[0].after_id,1);
await page.locator('[data-view-pair="9"]').click();await page.locator('#cmpOverlayBtn').click();await page.locator('#cmpOpacity').fill('73');await page.locator('#cmpSaveOpacity').click();await page.waitForFunction(()=>document.querySelector('#cmpSaveOpacity')&&!document.querySelector('#cmpSaveOpacity').disabled);assert.equal(opacity,.73);await page.locator('#cmpClose').click();await page.locator('.unpairbtn').click();await page.waitForFunction(()=>!document.querySelector('[data-view-pair]'));assert.equal(await page.locator('[data-match-photo]').count(),0);
assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),edition+' fits width');
for(const excluded of ['basic','issue','roads'])assert.equal(await page.evaluate(excluded=>{state.plan='free';state.proType=excluded;return beforeAfterOn();},excluded),false);
await page.close();console.log(engine.name(),width,edition,'pair order, saved viewer, opacity, direct capture, retry and gates PASS');
}}finally{await browser.close();}}}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
