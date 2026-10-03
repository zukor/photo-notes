// Local UI Help verification. Mock data and blocked external traffic prevent production writes/provider calls.
const express=require('express'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium,webkit}=require('playwright');
const path=require('node:path'),root=path.join(__dirname,'..');
const photo={id:1,user_id:99,photo_path:'/logo.svg',photo_title:'Site photo',note:'Observed condition',area_tags:['Site'],address:'Test site',latitude:29.5,longitude:-98.5,created_at:'2026-10-03T10:00:00Z',overlays:[],kind:'note'};
const job={id:1,name:'Test job',job_number:'J1',customer:'Test customer',address:'Test site',photo_count:1};
const group={id:1,title:'Evidence report',description:'Review photos',item_count:1,created_at:photo.created_at,layout:{font:'Arial',photo_layout:'one_per_page'}};
const community={id:1,name:'Test property',address:'Test site'};
const asset={id:1,name:'Gate',community_id:1,community_name:community.name,asset_type:'gate',condition:'good',location_description:'North entrance',photo_count:1};
const item={id:1,title:'Repair gate',community_id:1,community_name:community.name,priority:'routine',status:'new',item_type:'maintenance',area:'Maintenance',photo_path:'/logo.svg',description:'Hinge damage',budget_source:'operating',created_at:photo.created_at};
const stop={id:1,name:'North entrance',required_views:['overview','close-up'],status:'pending',photos:[]};
const visit={id:1,route_name:'Monthly visit',community_name:community.name,status:'in_progress',started_at:photo.created_at,stops:[stop]};
const route={id:1,name:'Monthly inspection',community_id:1,community_name:community.name,stops:[stop],stop_count:1};
const assignment={id:1,user_id:99,edition:'pro',title:'Pro check',title_es:'Prueba Pro',summary:'Verify photo flow',status:'assigned',template_id:1,steps:[{id:'step1',title:'Take photo',instruction:'Take a photo',expected:'Preview visible'}],results:{},issues:[],photos:[]};
const user={id:99,email:'help-test@example.invalid',name:'Help test',plan:'pro',pro_type:'general',role:'admin',is_super_admin:true,is_testing_manager:true,is_tester:true,edition_access:['basic','pro','contractor','roads','paving','hoa','concrete','roofer'],features:{measurements:true,extra_work:true,before_after:true},active:true};
function data(url){const p=url.pathname;
 if(p==='/api/me')return user;if(p==='/api/areas')return ['Site'];if(p==='/api/jobs')return [job];
 if(p==='/api/captures'||p==='/api/captures/search')return [photo];if(p==='/api/groups')return [group];
 if(p==='/api/groups/1')return {group,items:[{...photo,id:1,capture_id:1,caption:'Condition',sort_order:0}],pairs:[],zones:{}};
 if(p==='/api/document-settings')return {branding:{company_name:'Test company'}};
 if(p==='/api/hoa/context')return {company:{id:1,name:'Test management'},members:[],communities:[community]};
 if(p==='/api/hoa/communities')return [community];if(p==='/api/hoa/assets')return [asset];if(p==='/api/hoa/assets/1')return {asset,photos:[{...photo,photo_type:'identity'}]};
 if(p==='/api/hoa/routes')return [route];if(p==='/api/hoa/visits')return [visit];if(p==='/api/hoa/visits/1')return visit;
 if(p==='/api/hoa/items')return [item];if(p==='/api/hoa/items/1')return {item,photos:[],history:[],comments:[]};
 if(p==='/api/hoa/report')return {items:[item],summary:{}};if(p==='/api/hoa/dashboard')return {open:1,counts:{total:1,new:1},items:[item],communities:[community]};
 if(p==='/api/concrete/dashboard')return {summary:{},captures:[photo],jobs:[job],readiness:[]};
 if(p.includes('concrete/report'))return {summary:{},captures:[photo],readiness:[],jobs:[job]};
 if(p==='/api/ramo-intake')return {submissions:[]};
 if(p==='/api/document-links')return [{id:1,path:'/shared-document/test',filename:'Report.pdf',expires_at:'2026-10-30T10:00:00Z'}];
 if(p==='/api/jobs/1/timeline')return {job,captures:[photo],events:[]};
 if(p==='/api/issues/mine')return [{id:1,description:'Test app issue',management_status:'retest_requested',issue_type:'bug_problem',created_at:photo.created_at,history:[]}];
 if(p==='/api/testing/assignments/mine')return [assignment];if(p==='/api/admin/testing/assignments')return [assignment];
 if(p==='/api/admin/testing/templates')return [{id:1,title:'Template',title_es:'Plantilla',summary:'Test',edition:'pro',steps:assignment.steps,assignee_ids:[99]}];
 if(p==='/api/admin/users')return [user];if(p==='/api/admin/usage')return {users:[user],totals:{}};
 if(p==='/api/admin/stats'||p==='/api/admin/system'||p==='/api/billing/config'||p==='/api/config')return {};
 if(p==='/api/issues/attention')return {count:0};if(p==='/api/ewr/1')return {id:1,job_id:1,reason:'other',status:'open',description:'Added work',photos:[photo],notifications:[]};
 if(p.includes('/evidence'))return {capture:photo,evidence:{},history:[],verification:{}};
 return [];
}
(async()=>{
 const app=express();app.use('/vendor/leaflet',express.static(path.dirname(require.resolve('leaflet/dist/leaflet.js'))));app.use(express.static(path.join(root,'public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=process.env.PN_HELP_BASE_URL||`http://127.0.0.1:${server.address().port}`;
 const missing=new Map(),errors=[],seen=new Set();let cases=0;
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:960},serviceWorkers:'block',reducedMotion:'reduce',...(width===390?{hasTouch:true}: {})});
  await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==new URL(base).origin)return r.abort();if(u.pathname.startsWith('/api/'))return r.fulfill({json:data(u)});return r.continue();});
  await page.goto(base);await page.waitForFunction(()=>typeof state!=='undefined'&&state.me&&document.getElementById('body'));
  async function check(name){
   await page.evaluate(()=>PhotoNotesHelp.refresh());const items=await page.evaluate(()=>PhotoNotesHelp.inspect());assert(items.length>0,name+' has features');
   for(const i of items){seen.add(i.key+'|'+i.title);if(!i.authored)missing.set(i.key+'|'+i.title,{name,...i});}
   await page.locator('.pn-help-fab').click();assert.equal(await page.locator('.pn-help-fab').getAttribute('aria-expanded'),'true');
   const titles=await page.locator('.pn-help-article summary').allTextContents();assert.deepEqual(titles,items.map((i,k)=>`${k+1}. ${i.title}`),name+' Help follows page order');
   const h=await page.locator('.pn-help-fab').boundingBox();assert(h.x>width/2);const report=page.locator('#issueFab');if(await report.count()){const b=await report.boundingBox();assert(b.x<width/2&&b.x+b.width<h.x);}
   const drawer=await page.locator('.pn-help-drawer').boundingBox();assert(drawer.x>=-1&&drawer.x+drawer.width<=width+1);if(width>=1100)assert(drawer.width/width>=.25&&drawer.width/width<=.3);
   const terms=page.locator('[data-term]');if(await terms.count()){await terms.first().click();assert(await terms.first().locator('xpath=following-sibling::*').isVisible());}
   await page.locator('#pnHelpSearch').fill('impossible-no-match');assert.equal(await page.locator('.pn-help-article').count(),0);await page.locator('#pnHelpClear').click();
   await page.locator('#pnHelpClose').click();assert.equal(await page.locator('.pn-help-fab').getAttribute('aria-expanded'),'false');cases++;
  }
  for(const edition of ['basic','issue','roads','general','contractor','paving','hoa','property','concrete','roofer']){
   const views=['basic','issue','roads'].includes(edition)?['capture']:['capture','organize','edit','create','send','my-issues','my-assignment','manage-testing'];
   for(const view of views){await page.evaluate(async({edition,view})=>{state.plan=['basic','issue','roads'].includes(edition)?'free':'pro';state.proType=edition==='basic'?'general':edition;state.view=view;state.groupId=null;state.ewrId=null;state.jobs=[{id:1,name:'Test job'}];state.communities=[{id:1,name:'Test property'}];renderApp();},{edition,view});await page.waitForTimeout(150);await check(edition+'/'+view);}
  }
  await page.evaluate(()=>{state.plan='pro';state.proType='paving';state.view='capture';renderApp();});
  for(const fn of ['renderCameraTools','renderTicketScanner','renderAlignmentTool']){await page.evaluate(fn=>window[fn](),fn);await page.waitForTimeout(150);await check(fn);}
  for(const fn of ['renderHoaAssets','renderHoaInspections','renderHoaVisits','renderHoaMaintenance','renderHoaCommunities','renderHoaDashboard','renderHoaReports']){await page.evaluate(async fn=>{state.proType='hoa';await window[fn]();},fn);await page.waitForTimeout(150);await check(fn);}
  for(const fn of ['renderHoaAsset','renderHoaVisit','renderHoaItem']){await page.evaluate(async fn=>window[fn](1),fn);await page.waitForTimeout(150);await check(fn);}
  await page.evaluate(()=>{state.proType='general';state.view='create';state.groupId=1;renderApp();});await page.waitForTimeout(200);await check('Document composer');
  await page.locator('#editTitle').click();await check('Edit document title');await page.locator('#cancelTitle').click();
  await page.evaluate(()=>{state.proType='general';state.view='edit';renderApp();});await page.waitForTimeout(150);
  await page.evaluate(c=>renderStampEditor(c),photo);await page.waitForTimeout(150);await check('Markup editor');
  for(const kind of ['custom','rect','arrow']){await page.evaluate(kind=>addOverlayItem(kind),kind);await check('Markup '+kind);}
  await page.evaluate(c=>renderCropEditor(c),photo);await page.waitForTimeout(150);await check('Crop editor');
  await page.evaluate(c=>renderSavedDimsEditor(c),photo);await check('Measurements');
  await page.evaluate(()=>showEvidence(1));await page.waitForTimeout(150);await check('Evidence history');await page.locator('#evidenceClose').click();
  await page.evaluate(()=>openPhotoViewer('/logo.svg','Source photo'));await check('Photo viewer');await page.locator('#photoViewerClose').click();
  await page.evaluate(()=>{state.proType='concrete';state.view='send';renderApp();});await page.waitForTimeout(150);await page.evaluate(()=>{state.selectedIds=new Set(['1']);state.me.ramo_intake_access=true;PhotoNotesShortcuts.open();});await page.waitForTimeout(150);await check('Shortcuts');await page.locator('#shortcutCreate').click();await check('Create shortcut');await page.locator('#shortcutClose').click();await page.locator('#shortcutClose').click();
  await page.evaluate(()=>openRamoIntake());await page.waitForTimeout(150);await check('Ramo grouped intake');
  await page.evaluate(()=>{state.proType='paving';state.view='camera-reader';cameraReaderType=Object.keys(readerConfigs)[0];renderApp();cameraReaderDraft={fields:{},confidence:'low',title:'Reviewed reading'};renderCameraReaderReview();});await check('Camera reader and review');
  await page.evaluate(()=>{state.proType='concrete';renderConcreteReport();});await page.waitForTimeout(150);await check('Concrete evidence report');
  await page.evaluate(()=>{state.proType='paving';state.ewrId='new';renderEwrCreate(document.getElementById('body'));});await check('Extra work creation');
  await page.evaluate(()=>{state.proType='general';state.view='send';renderApp();});await page.waitForTimeout(150);await page.locator('#sharedDocumentLinks').evaluate(n=>n.open=true);await page.waitForTimeout(150);await check('Shared document links');
  await page.evaluate(()=>{state.view='manage-testing';renderApp();});await page.waitForTimeout(150);await page.locator('[data-new]').click();await page.locator('[data-add]').click();await check('Testing assignment editor');
  await page.evaluate(()=>{state.view='capture';renderApp();});await page.evaluate(()=>showPendingPhotos());await page.waitForTimeout(150);await check('Pending uploads native dialog');await page.locator('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>openIssueReporter());await page.waitForTimeout(150);await check('Issue reporter');await page.locator('#issueClose').click();
  await page.evaluate(()=>{state.proType='general';state.view='capture';renderApp();});await page.locator('.pn-help-fab').click();
  await page.screenshot({path:`/tmp/pn-complete-help-${engine.name()}-${width}.png`});await page.locator('#pnHelpClose').click();
  // Feature insertion/removal must synchronize without a navigation or manual Help refresh.
  await page.locator('.pn-help-fab').click();await page.evaluate(()=>{const b=document.createElement('button');b.id='captureUrgency';b.textContent='Urgency';document.getElementById('body').append(b);});await page.waitForFunction(()=>document.getElementById('pnHelpResults').textContent.includes('Urgency'));await page.evaluate(()=>document.getElementById('captureUrgency').remove());await page.waitForFunction(()=>!document.getElementById('pnHelpResults').textContent.includes('Urgency'));await page.locator('#pnHelpClose').click();
  await page.goto(base+'/install.html');await check('Installation guide');
  await page.goto(base+'/admin.html');await page.waitForTimeout(250);await check('Administration');
  await page.close();console.log(`${engine.name()} ${width}: page order, dynamic update, terms, drawer, edition/screens PASS`);
 }}finally{await browser.close();}}}finally{server.close();}
 fs.writeFileSync('/tmp/pn-help-browser-coverage.json',JSON.stringify({cases,uniqueControls:seen.size,missing:[...missing.values()],errors},null,2));
 assert.deepEqual(errors,[],'No browser runtime errors');assert.equal(missing.size,0,JSON.stringify([...missing.values()],null,2));
 console.log(`${cases} screen checks; ${seen.size} distinct rendered controls, all with authored Help.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
