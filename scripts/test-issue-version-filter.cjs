const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const editions=['basic','pro','contractor','roads','paving','hoa','concrete','roofer',null];
 const reports=editions.map((edition,index)=>({id:index+1,reported_edition:edition,user_id:index%2+1,user_name:index%2?'Tester Two':'Tester One',issue_type:'bug_problem',management_status:'new',priority:'normal',description:'Test report',page_name:'Capture',created_at:`2026-09-${String(index+1).padStart(2,'0')}T12:00:00Z`,user_agent:index%2?'Android':'Macintosh'}));
 reports.push({...reports[4],id:10,user_id:2,user_name:'Tester Two',user_agent:'Android',created_at:'2026-09-10T12:00:00Z'});
 const extraStatuses=['resolved','wont_fix','tester_confirmed','ready_to_test'];
 const extraReports=extraStatuses.map((status,index)=>({...reports[4],id:11+index,management_status:status,verification:'Deployment verified',release_reference:'test-release'}));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];
 if(path==='/api/me')data={id:1,name:'Owner',role:'admin',is_super_admin:true,plan:'pro'};
 if(path==='/api/admin/issues')data=[...reports,...extraReports];
 if(path==='/api/issues/attention')data={count:0};
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
 await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
 await page.locator('[data-admin-tool="issues"] > summary').click();
 await page.waitForFunction(()=>document.querySelectorAll('[data-issue-card]').length===11);
 assert.equal(await page.locator('#issueStatusFilter').inputValue(),'open');
 const cardIds=()=>page.locator('[data-issue-card]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.issueCard)).sort((a,b)=>a-b));
 assert.deepEqual(await cardIds(),[1,2,3,4,5,6,7,8,9,10,14]);
 await page.selectOption('#issueStatusFilter','closed');assert.deepEqual(await cardIds(),[11,12,13]);
 await page.selectOption('#issueVersionFilter','basic');assert.deepEqual(await cardIds(),[]);
 await page.selectOption('#issueVersionFilter','paving');assert.deepEqual(await cardIds(),[11,12,13]);
 await page.selectOption('#issueStatusFilter','resolved');assert.deepEqual(await cardIds(),[11,13]);
 await page.selectOption('#issueStatusFilter','wont_fix');assert.deepEqual(await cardIds(),[12]);
 await page.selectOption('#issueVersionFilter','all');
 await page.selectOption('#issueStatusFilter','all');assert.equal((await cardIds()).length,14);
 await page.selectOption('#issueStatusFilter','new');
 assert.equal(await page.locator('.issue-secondary').getAttribute('open'),null);
 assert.equal(await page.locator('#issueTesterFilter').isVisible(),false);
 assert.deepEqual(await page.locator('.issue-primary select').evaluateAll(nodes=>nodes.map(n=>n.id)),['issueVersionFilter','issueTypeFilter','issueStatusFilter','issuePriorityFilter','issueDateSort']);
 for(const edition of editions){
 await page.selectOption('#issueVersionFilter',edition||'unknown');
 const ids=await page.locator('[data-issue-card]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.issueCard)));
 assert.deepEqual(ids,reports.filter(r=>r.reported_edition===edition).map(r=>r.id).reverse());
 }
 await page.selectOption('#issueVersionFilter','paving');
 assert.match(await page.locator('#issueSummary').innerText(),/2 Unresolved Bugs/);
 await page.selectOption('#issueDateSort','oldest');
 assert.deepEqual(await page.locator('[data-issue-card]').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.issueCard))),[5,10]);
 await page.locator('.issue-secondary > summary').click();
 await page.selectOption('#issueTesterFilter','2');
 await page.selectOption('#issueDeviceFilter','android');
 assert.equal(await page.locator('[data-issue-card]').count(),1);
 assert.equal(await page.locator('[data-issue-card]').getAttribute('data-issue-card'),'10');
 await page.locator('.issue-secondary > summary').click();
 assert.equal(await page.locator('[data-issue-card]').count(),1);
 await page.selectOption('#issueVersionFilter','basic');
 assert.equal(await page.locator('[data-issue-card]').count(),0);
 await page.selectOption('#issueVersionFilter','all');
 assert.equal(await page.locator('[data-issue-card]').count(),5);
 if(width===1440){const tops=await page.locator('.issue-primary select').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top));assert(tops.every(t=>Math.abs(t-tops[0])<2));}
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`/tmp/pn-issue-version-${engine.name()}-${width}.png`});
 assert.deepEqual(errors,[]);await page.close();console.log(engine.name(),width,'version and secondary filters PASS');
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
