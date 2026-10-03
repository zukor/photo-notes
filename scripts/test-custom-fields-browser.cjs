'use strict';
const express=require('express'),assert=require('node:assert/strict'),path=require('node:path'),{chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(path.join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [320,390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});let rows=[],saved;
  const make=(id,name,type,extra={})=>{const d={id,name,type,scope:'general',prompt:'User-entered '+name,required:false,active:true,options:[],revision:1,...extra};return {...d,versions:{1:d}};};
  rows=[make('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Store Number','text'),make('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Lane Width','number'),make('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Inspection Date','date'),make('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Customer Present','boolean'),make('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','Surface Type','choice',{options:['Asphalt','Concrete','Gravel'],required:true}),make('ffffffff-ffff-4fff-8fff-ffffffffffff','Pour Number','number',{scope:'edition',edition:'concrete'})];
  await page.route('**/api/**',async route=>{const request=route.request(),p=new URL(request.url()).pathname;let data=[];
   if(p==='/api/me')data={id:1,name:'Test',email:'test@example.invalid',role:'user',plan:'pro',pro_type:'general',edition_access:['pro']};
   else if(p==='/api/custom-fields')data=rows;
   else if(p.startsWith('/api/custom-fields/')&&request.method()==='PUT'){const body=request.postDataJSON(),id=p.split('/').at(-1),old=rows.find(d=>d.id===id),revision=(old?.revision||0)+1;data={...body,id,revision,versions:{...old?.versions,[revision]:body}};rows=rows.filter(d=>d.id!==id).concat(data);}
   else if(p.endsWith('/custom-fields')&&request.method()==='PUT'){saved=request.postDataJSON();data={custom_fields:saved.values.filter(f=>f.value!==null).map(f=>({...f,name:rows.find(d=>d.id===f.id).name,type:rows.find(d=>d.id===f.id).type}))};}
   else if(p==='/api/config')data={};else if(p==='/api/billing/config')data={checkout_enabled:false};
   await route.fulfill({json:data});
  });
  await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_v1:test%40example.invalid','done');});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me&&document.getElementById('body'));await page.evaluate(()=>{state.view='capture';renderApp();});await page.waitForFunction(()=>document.getElementById('cfCapture')?.querySelector('[data-cf-id]'));
  await page.waitForTimeout(300);
  for(const edition of ['general','paving','concrete','hoa','property','contractor','roofer']){
   await page.evaluate(edition=>{state.plan='pro';state.proType=edition;state.view='capture';state.communities=[];renderApp();},edition);
   await page.waitForSelector('[data-cf-id]',{state:'attached'});await page.locator('#cfCapture').evaluate(el=>el.open=true);
   assert.equal(await page.locator('[data-cf-id]').count(),edition==='concrete'?6:5);
   assert.equal(await page.locator('#cfCapture').evaluate(el=>getComputedStyle(el).color),'rgb(0, 0, 0)');
   await page.locator('[data-cf-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]').fill('1842');
   await page.locator('[data-cf-id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]').fill('0');
   await page.locator('[data-cf-id="cccccccc-cccc-4ccc-8ccc-cccccccccccc"]').fill('2026-10-03');
   await page.locator('[data-cf-id="dddddddd-dddd-4ddd-8ddd-dddddddddddd"]').selectOption('No');
   assert.match(await page.evaluate(()=>{try{PhotoNotesCustomFields.payload();return '';}catch(e){return e.message;}}),/required/);
   await page.locator('[data-cf-id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]').selectOption('Gravel');
   const values=JSON.parse(await page.evaluate(()=>PhotoNotesCustomFields.payload()));assert.equal(values.find(v=>v.id.startsWith('bbbb')).value,0,JSON.stringify(values));assert.equal(values.find(v=>v.id.startsWith('dddd')).value,false);
   await page.evaluate(()=>renderCapture());await page.locator('#cfCapture').evaluate(el=>el.open=true);assert.equal(await page.locator('[data-cf-id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]').inputValue(),'1842');
   // The actual IndexedDB queue and FormData round trip retain all custom values.
   const queued=await page.evaluate(async()=>{const account=await PhotoNotesQueue.accountKey('test@example.invalid'),payload={note:'Test',custom_fields:PhotoNotesCustomFields.payload()};const q=await PhotoNotesQueue.create(payload,false,account,selectedEdition());const all=await PhotoNotesQueue.all();const row=all.find(r=>r.id===q.id);const fd=payloadFormData(row.payload);await PhotoNotesQueue.remove(q.id);return fd.get('custom_fields');});assert.deepEqual(JSON.parse(queued),values);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(edition==='concrete')assert(await page.locator('#concretePhase').count());
   if(edition==='property'||edition==='hoa')assert(await page.locator('#hoaType').count());
   if(edition==='property')await page.screenshot({path:`/tmp/custom-fields-${engine.name()}-${width}.png`});
   await page.evaluate(()=>PhotoNotesCustomFields.clear());
  }
  await page.evaluate(()=>{state.plan='pro';state.proType='general';state.view='capture';renderApp();});await page.waitForSelector('#cfManage',{state:'attached'});await page.locator('#cfCapture').evaluate(el=>el.open=true);await page.locator('#cfManage').click();
  await page.locator('#cfName').fill('Roof Section');await page.locator('#cfType').selectOption('choice');await page.locator('#cfChoices').fill('A\nB');await page.locator('#cfDefinitionSave').click();await page.waitForFunction(()=>!document.getElementById('cfDialog'));
  assert(rows.some(r=>r.name==='Roof Section'));
  await page.evaluate(()=>{const host=document.createElement('section');host.id='cfFixture';document.getElementById('body').append(host);PhotoNotesCustomFields.details({id:1,custom_fields:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'Store Number',type:'text',value:'1842',revision:1},{id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',name:'Surface Type',type:'choice',value:'Gravel',revision:1}]},host,{edition:'pro',toast});});
  await page.locator('#cfEditValues').click();await page.locator('#cfEdit-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').fill('1843');await page.locator('#cfValuesSave').click();await page.waitForFunction(()=>!document.getElementById('cfValuesDialog'));assert.equal(saved.values[0].value,'1843');assert((await page.locator('#cfFixture').textContent()).includes('1843'));
  // Dynamic control Help is authored in management, Capture and value dialogs.
  await page.locator('#cfEditValues').click();assert.deepEqual(await page.evaluate(()=>PhotoNotesHelp.inspect().filter(x=>!x.authored).map(x=>x.title)),[]);await page.locator('#cfValuesClose').click();
  for(const edition of ['basic','issue','roads']){
   await page.evaluate(edition=>{state.plan=edition==='issue'?'pro':'free';state.proType=edition==='basic'?'general':edition;state.view='capture';renderApp();},edition);assert.equal(await page.locator('#cfCapture').count(),0);
  }
  await page.close();console.log(`${engine.name()} ${width}: seven editions, five types, scope, required values, false/zero, draft rerender, IndexedDB/FormData, definition/value editing, authored Help and exclusions PASS`);
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
