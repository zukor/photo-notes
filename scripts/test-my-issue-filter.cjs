const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let rows=['new','reviewing','fixing','testing','blocked','ready_to_test','resolved','tester_confirmed','wont_fix'].map((status,n)=>({id:n+1,management_status:status,page_name:'Capture',description:'Fixture report '+status,created_at:'2026-09-22T10:00:00Z',verification:'Verified',release_reference:'test-release'}));
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;let data=[];
  if(path==='/api/me')data={id:999,name:'Filter Tester',role:'admin',plan:'pro',pro_type:'general',edition_access:['basic','pro']};
  if(path==='/api/issues/mine')data=rows;
  if(path==='/api/issues/attention')data={count:0};
  if(path==='/api/issues/6/retest'){rows[5].management_status='tester_confirmed';data={ok:true};}
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('[data-theme-choice="dark"]').waitFor();
 await page.evaluate(()=>{state.view='my-issues';renderApp();});
 const filter=page.locator('#myIssueFilter'),cards=page.locator('.tester-issue-card:visible');
 await page.locator('.tester-issue-card').first().waitFor();
 assert.equal(await filter.inputValue(),'open');assert.equal(await cards.count(),6);
 await page.locator('#retestNotes-6').fill('Saved while filtering');
 await filter.selectOption('closed');assert.equal(await cards.count(),3);
 await filter.selectOption('all');assert.equal(await cards.count(),9);
 await filter.selectOption('open');assert.equal(await page.locator('#retestNotes-6').inputValue(),'Saved while filtering');
 await page.locator('[data-retest-fixed="6"]').click();
 await page.waitForFunction(()=>document.querySelectorAll('.tester-issue-card:not([hidden])').length===5);
 assert.equal(await filter.inputValue(),'open');
 await filter.selectOption('closed');assert.equal(await cards.count(),4);
 await page.locator('[data-language="es"]').click();assert.equal(await filter.locator('option[value="closed"]').textContent(),'Reportes cerrados');
 await page.locator('[data-theme-choice="dark"]').click();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`/tmp/pn-issue-filter-${engine.name()}.png`});
 rows=rows.filter(r=>['resolved','tester_confirmed','wont_fix'].includes(r.management_status));
 await page.evaluate(()=>renderMyIssueReports());await page.locator('.tester-issue-card').first().waitFor();
 await filter.selectOption('open');assert.equal(await cards.count(),0);assert.equal(await page.locator('#myIssueList [role="status"]').textContent(),'No hay reportes abiertos.');
 assert.deepEqual(errors,[]);console.log(engine.name(),'issue filters PASS');
 }finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
