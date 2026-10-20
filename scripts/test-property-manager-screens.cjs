'use strict';
// Static app with mocked API. Property Manager Pro management screens, Property edit, team assignee,
// document-only Capture, commercial categories, readable history and the report Area filter.
const assert=require('node:assert/strict'),express=require('express'),path=require('node:path'),{chromium,webkit}=require('playwright');
(async()=>{
 const app=express();app.use(express.static(path.join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});const errors=[],posts=[],gets=[];page.on('pageerror',e=>errors.push(e.message));
  const item={id:7,community_id:1,title:'Pool pump noise',community_name:'Office Park',area:'Pools and Recreation',priority:'routine',status:'scheduled',budget_source:'unassigned',board_approval:'not_required',primary_assignee:'ACME Roofing',primary_assignee_user_id:null,created_at:new Date().toISOString(),photo_path:null,has_photo:true,capture_id:3};
  await page.route('**/api/**',async r=>{const url=new URL(r.request().url()),p=url.pathname,method=r.request().method();let data=[];
   if(method==='POST'&&r.request().postData()&&!p.startsWith('/api/usage'))posts.push({path:p,body:(()=>{try{return JSON.parse(r.request().postData());}catch{return null;}})()});
   if(method==='GET')gets.push(p+url.search);
   if(p==='/api/me')data={id:1,name:'Fixture Lead',role:'user',plan:'pro',pro_type:'property',email:'pm-screens@example.test',edition_access:['property']};
   if(p==='/api/hoa/company')data={id:1,name:'Fixture Management',company_role:'administrator'};
   if(p==='/api/hoa/communities')data=[{id:1,name:'Office Park',address:'100 Main Street',manager_name:'Site Contact',open_items:1}];
   if(p==='/api/hoa/communities/1')data={id:1,name:'Office Park North'};
   if(p==='/api/hoa/members')data=[{id:1,name:'Fixture Lead',email:'lead@example.test',company_role:'administrator'},{id:2,name:'Fixture Mate',email:'mate@example.test',company_role:'manager'}];
   if(p==='/api/hoa/notifications')data=[{id:1,item_id:7,message:'Assigned to you: Pool pump noise',created_at:new Date().toISOString()}];
   if(p==='/api/hoa/dashboard')data={mine:1,open:1};
   if(p==='/api/property/areas')data=[{id:4,community_id:1,name:'Rooftop',active:true,community_name:'Office Park'}];
   if(p==='/api/hoa/items')data=[item];
   if(p==='/api/hoa/items/7'&&method==='GET')data={item,photos:[],evidence:{},history:[{action:'created',user_name:'Fixture Lead',created_at:new Date().toISOString(),detail:{}},{action:'status_changed',user_name:'Fixture Lead',created_at:new Date().toISOString(),detail:{from:'new',to:'board_decision'}},{action:'completion_photos_submitted',user_name:null,created_at:new Date().toISOString(),detail:{submitted_by:'Vendor Tech',photo_count:2}}]};
   if(p==='/api/hoa/items/7'&&method==='POST')data={...item};
   await r.fulfill({json:data});});
  await page.addInitScript(()=>{localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed');localStorage.setItem('pn_first_use_v1:'+encodeURIComponent('pm-screens@example.test'),'done');});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>typeof state!=='undefined'&&state.me&&document.getElementById('body'),null,{timeout:15000});
  await page.evaluate(async()=>{state.plan='pro';state.proType='property';state.view='capture';await loadHoaContext();renderApp();});await page.waitForSelector('#hoaCommunity');
  // Capture: commercial categories and document-only saving.
  const categories=await page.locator('#hoaArea option').allTextContents();assert(categories.includes('HVAC'));assert(!categories.includes('Pools and Recreation'));
  assert.equal(await page.locator('#hoaCreateRecord').isChecked(),true);await page.locator('#hoaCreateRecord').uncheck();assert.equal(await page.locator('#hoaTitle').isVisible(),false);
  const payload=await page.evaluate(()=>{const fd=payloadFormData({note:'n',hoa_create_record:'0'});return fd.get('hoa_create_record');});assert.equal(payload,'0');
  await page.locator('#hoaCreateRecord').check();assert.equal(await page.locator('#hoaTitle').isVisible(),true);
  // Records screen links.
  await page.locator('#tabSend').click();await page.waitForSelector('#hoaOpenCommunities');
  assert.equal((await page.locator('#hoaOpenCommunities').innerText()).trim(),'Properties and Team');assert.equal((await page.locator('#hoaOpenReports').innerText()).trim(),'Maintenance Report');assert.match(await page.locator('#hoaOpenDashboard').innerText(),/^Dashboard/);
  // Properties and Team: edit a Property.
  await page.locator('#hoaOpenCommunities').click();await page.waitForSelector('[data-edit-community="1"]');assert.equal(await page.locator('#tabSend').getAttribute('aria-current'),'page');
  await page.locator('[data-edit-community="1"]').click();await page.locator('#hcEditName1').fill('Office Park North');await page.locator('#hcEditManager1').fill('Building Engineer');await page.locator('[data-save-community="1"]').click();
  await page.waitForFunction(()=>true);await page.waitForTimeout(300);const saved=posts.find(x=>x.path==='/api/hoa/communities/1');assert(saved,'Property edit posted');assert.deepEqual(saved.body,{name:'Office Park North',address:'100 Main Street',manager_name:'Building Engineer'});
  assert(await page.locator('#propertyAreasManager').count(),'Property Areas management is reachable');assert.match(await page.locator('body').textContent(),/Team Member/);
  // Team removal, automatic assignment by category, archive and restore.
  await page.waitForSelector('[data-rules-community="1"]');
  assert.equal(await page.locator('[data-remove-member="1"]').count(),0,'administrator cannot remove self');
  const deletes=[];page.on('request',q=>{if(q.method()==='DELETE')deletes.push(new URL(q.url()).pathname);});
  await page.locator('summary',{hasText:'Management Company'}).click();
  await page.locator('[data-remove-member="2"]').click();assert.match(await page.locator('[data-remove-member="2"]').innerText(),/Tap Again to Remove Fixture Mate/);await page.locator('[data-remove-member="2"]').click();
  await page.waitForFunction(()=>true);await page.waitForTimeout(300);assert(deletes.includes('/api/hoa/members/2'),'member removal sent');
  await page.waitForSelector('[data-rules-community="1"]');await page.locator('[data-rules-community="1"]').click();
  const hvac=page.locator('select[data-rule-cat="HVAC"]');await hvac.selectOption('Fixture Mate');
  const plumbing=page.locator('select[data-rule-cat="Plumbing"]');await plumbing.selectOption('__other');await page.locator('input[data-rule-other="Plumbing"]').fill('ACME Plumbing');
  await page.locator('#hcRulesSave1').click();await page.waitForTimeout(300);
  const ruleSave=posts.filter(x=>x.path==='/api/hoa/communities/1').pop();assert.deepEqual(ruleSave.body,{assignment_rules:{HVAC:'Fixture Mate',Plumbing:'ACME Plumbing'}});
  await page.waitForSelector('[data-archive-community="1"]');await page.locator('[data-archive-community="1"]').click();await page.locator('[data-archive-community="1"]').click();await page.waitForTimeout(300);
  assert.deepEqual(posts.filter(x=>x.path==='/api/hoa/communities/1').pop().body,{active:false});
  await page.waitForSelector('#hcArchivedBox');await page.locator('#hcArchivedBox summary').click();await page.waitForSelector('[data-restore-community="1"]');await page.locator('[data-restore-community="1"]').click();await page.waitForTimeout(300);
  assert.deepEqual(posts.filter(x=>x.path==='/api/hoa/communities/1').pop().body,{active:true});
  // Profile menu: Dashboard, then open the record from its notification.
  await page.locator('#profileButton').click();await page.locator('#menuHoaDashboard').click();await page.waitForSelector('[data-hoa-notification-item="7"]');assert.match(await page.locator('#hoaDashStats').innerText(),/Assigned to Me/);
  await page.locator('[data-hoa-notification-item="7"]').click();await page.waitForSelector('#hiAssigneeUser');
  // Record: legacy category stays selected, team assignee choice, readable history.
  assert.equal(await page.locator('#hiArea').inputValue(),'Pools and Recreation');assert((await page.locator('#hiArea option').allTextContents()).includes('HVAC'));
  assert.equal(await page.locator('#hiAssigneeUser').inputValue(),'other');assert.equal(await page.locator('#hiAssignee').inputValue(),'ACME Roofing');
  const body=await page.locator('body').innerText();assert.match(body,/Status Changed: New to Approval Needed/);assert.match(body,/Completion Photos Received \(2\)/);assert.match(body,/Vendor Tech/);
  await page.locator('#hiAssigneeUser').selectOption('2');assert.equal(await page.locator('#hiAssignee').isVisible(),false);await page.locator('#hoaItemSave').click();await page.waitForTimeout(300);
  const update=posts.filter(x=>x.path==='/api/hoa/items/7').at(-1);assert(update);assert.equal(update.body.primary_assignee_user_id,2);assert.equal(update.body.primary_assignee,'Fixture Mate');assert.equal(update.body.area,'Pools and Recreation');
  // Report: Area filter reaches the preview request.
  await page.evaluate(()=>{state.view='hoa-reports';renderApp();});await page.waitForSelector('#paReportArea');await page.locator('#hrCommunity').selectOption('1');await page.waitForSelector('#paReportArea option[value="4"]',{state:'attached'});
  gets.length=0;await page.locator('#paReportArea').selectOption('4');await page.waitForTimeout(300);assert(gets.some(g=>g.startsWith('/api/hoa/items?')&&g.includes('property_area_id=4')&&g.includes('community_id=1')),JSON.stringify(gets));
  assert.match(await page.locator('#hoaReportItems').innerText(),/Only records with at least one photo/);
  assert(!(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1)),'No horizontal scroll at '+width);
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await browser.close();}}
 console.log('PASS Property Manager Pro screens: navigation, Property edit, document-only Capture, categories, team assignee, history labels and Area report filter');
 }finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
