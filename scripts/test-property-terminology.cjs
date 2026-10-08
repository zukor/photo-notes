// Local fixture checks for terminology only, no production writes.
const assert=require('node:assert/strict'),express=require('express'),{chromium,webkit}=require('playwright');
const property={id:1,name:'Customer Community Board Center',address:'100 Main Street',manager_name:'Manager'};
const item={id:1,title:'Repair equipment',community_name:property.name,priority:'high',status:'waiting_board',item_type:'maintenance',area:'Equipment',budget_source:'reserve',board_approval:'agenda',created_at:'2026-10-03T10:00:00Z'};
(async()=>{const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));try{
for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [390,1440]){const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/api/**',r=>{const p=new URL(r.request().url()).pathname;return r.fulfill({json:p==='/api/me'?{id:1,name:'Test',plan:'pro',pro_type:'property',edition_access:['property','hoa']}:p==='/api/hoa/company'?{id:1,name:'Management Company'}:p==='/api/hoa/communities'?[property]:p==='/api/hoa/items'?[item]:p==='/api/hoa/items/1'?{item,history:[],photos:[]}:p==='/api/hoa/dashboard'?{board_needed:1}:[]});});
await page.addInitScript(()=>localStorage.setItem('pn_install_prompt_dismissed_v1','dismissed'));await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>state.me);
for(const edition of ['property','hoa']){await page.evaluate(edition=>{state.plan='pro';state.proType=edition},edition);
for(const view of ['capture','hoa-communities','hoa-assets','hoa-inspections','hoa-visits','hoa-maintenance','hoa-dashboard','hoa-reports','record']){
// Keep the in-flight browser promise reachable while CDP awaits it.
await page.evaluate(view=>{window.terminologyViewTask=(async()=>{await loadHoaContext();if(view==='record'){state.view='hoa-maintenance';await renderHoaItem(1);}else{state.view=view;renderApp();}})();return window.terminologyViewTask;},view);await page.evaluate(()=>{delete window.terminologyViewTask;});await page.waitForTimeout(180);
const body=await page.locator('#body').innerText(),authored=body.replaceAll(property.name,'');
if(edition==='property')assert(!/\bHOA\b|\bboard\b|\bcommunit(?:y|ies)\b|\breserve\b|meeting agenda/i.test(authored),view+': '+authored);
if(view==='record'){for(const [id,value] of [['hiStatus','waiting_board'],['hiBudget','reserve'],['hiApproval','agenda']])assert.equal(await page.locator('#'+id).inputValue(),value);assert(body.includes(edition==='property'?'Waiting for Approval':'Waiting for Board'));assert(body.includes(edition==='property'?'Capital':'Reserve Budget'));assert(body.includes(edition==='property'?'Approval Requested':'On Meeting Agenda'));assert(body.includes(property.name));}
if(view==='hoa-reports')assert(body.includes(edition==='property'?'Property Maintenance Report PDF':'Board Photo Report PDF'));
if(view==='hoa-dashboard')assert(body.includes(edition==='property'?'Approval Needed':'Board Needed'));
await page.evaluate(()=>PhotoNotesHelp.mount({edition:state.proType,page:state.view,name:productName()}));await page.locator('.pn-help-fab').click();await page.waitForTimeout(80);
if(edition==='property')assert(await page.locator('#pnHelpResults .pn-help-article').count()>0,'Property Help is authored for '+view);
if(edition==='property'&&view==='hoa-communities'){const term=page.locator('#pnHelpTermsList [data-term="Community"]');assert.equal(await term.textContent(),'Property');const id=await term.getAttribute('aria-describedby');assert((await page.locator('#'+id).textContent()).includes('property'));}
await page.locator('#pnHelpClose').click();
if(edition==='property'){await page.evaluate(()=>photoNotesI18n.setLanguage('es'));await page.waitForTimeout(50);const spanish=(await page.locator('#body').innerText()).replaceAll(property.name,'');assert(!/\bHOA\b|\bjunta\b|\bcomunidad(?:es)?\b|\breservas?\b/i.test(spanish),spanish);await page.evaluate(()=>photoNotesI18n.setLanguage('en'));}
}}
assert.deepEqual(errors,[]);await page.screenshot({path:`/tmp/property-terminology-${engine.name()}-${width}.png`});await page.close();console.log(`${engine.name()} ${width}: Property + HOA terminology, saved values and Help PASS`);
}}finally{await browser.close();}}
}finally{server.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
