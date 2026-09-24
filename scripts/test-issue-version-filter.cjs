const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const express=require('express');
(async()=>{
 const app=express();app.use(express.static(require('node:path').join(__dirname,'../public')));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const editions=['basic','pro','contractor','roads','paving','hoa','concrete','roofer',null];
 const reports=editions.map((edition,index)=>({id:index+1,reported_edition:edition,user_id:index%2+1,user_name:index%2?'Tester Two':'Tester One',issue_type:'bug_problem',management_status:'new',priority:'normal',description:'Test report',page_name:'Capture',created_at:`2026-09-${String(index+1).padStart(2,'0')}T12:00:00Z`,user_agent:index%2?'Android':'Macintosh'}));
 reports.push({...reports[4],id:10,user_id:2,user_name:'Tester Two',user_agent:'Android',created_at:'2026-09-10T12:00:00Z'});
 const ideas=['ui_improvement','feature_improvement','new_feature'].map((type,index)=>({...reports[4],id:20+index,issue_type:type,management_status:'blocked',description:'Read this original report first.',blocked_reason:'Owner decision needed',voice_path:'/fixture-voice.webm'}));
 const extraStatuses=['resolved','wont_fix','tester_confirmed','ready_to_test'];
 const extraReports=extraStatuses.map((status,index)=>({...reports[4],id:11+index,management_status:status,verification:'Deployment verified',release_reference:'test-release'}));
 try{for(const engine of [chromium,webkit]){const browser=await engine.launch();try{for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1100},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;let data=[];
 if(path==='/api/me')data={id:1,name:'Owner',role:'admin',is_super_admin:true,plan:'pro'};
 if(path==='/api/admin/issues')data=[...reports,...extraReports,...ideas];
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
 await page.selectOption('#issueTypeFilter','all');
 await page.selectOption('#issueStatusFilter','all');
 await page.locator('.issue-secondary > summary').click();
 await page.selectOption('#issueTesterFilter','all');await page.selectOption('#issueDeviceFilter','all');
 await page.evaluate(()=>{const issue=allIssues.find(i=>i.id===5);issue.management_status='blocked';issue.blocked_reason='Exact accuracy depends on the device GPS location provider; the original inaccurate reading cannot be reproduced here.';renderIssues();});
 for(const id of [5,20,21,22]){
 const card=page.locator(`[data-issue-card="${id}"]`);await card.locator(':scope > summary').click();
 assert(await card.evaluate(card=>{const body=card.querySelector('.issue-detail-body'),original=body.querySelector('.issue-original-report'),footer=body.querySelector('.issue-review-footer');return original===body.children[1]&&footer===body.lastElementChild&&!!footer.querySelector('[data-ui-decision]');}));
 assert.equal(await card.getByRole('heading',{name:'Recommended Course of Action'}).count(),1);
 assert(await card.evaluate(card=>{const footer=card.querySelector('.issue-review-footer');const headings=[...footer.querySelectorAll('h3')].map(h=>h.textContent);return headings.join('|')==='Why This Needs Your Review|Recommended Course of Action|Your Decision';}));
 if(id===5){await page.selectOption('#ui-decision-5','retest');await page.fill('#ui-instructions-5','Keep this draft');await page.evaluate(()=>loadUsers());assert.equal(await page.locator('#ui-instructions-5').inputValue(),'Keep this draft');await page.selectOption('#ui-decision-5','');}
 if(id===5)await card.screenshot({path:`/tmp/pn-review-guidance-${engine.name()}-${width}.png`});
 if(id>=20)assert.equal(await card.locator('.issue-original-report audio').count(),1);
 }
 await page.evaluate(()=>{const issue=allIssues.find(i=>i.id===5);issue.blocked_reason='The original blurred image is needed to evaluate this failure.';renderIssues();});
 await page.locator('[data-issue-card="5"] > summary').click();
 await page.selectOption('#ui-decision-5','clarify');
 assert.equal(await page.locator('#ui-label-5').textContent(),'Directions or Questions for the Tester');
 const draft=await page.locator('#ui-instructions-5').inputValue();
 assert.match(draft,/original photo or file/);assert.match(draft,/fields the app filled in/);
 await page.fill('#ui-instructions-5',draft+'\nMy added question.');
 await page.selectOption('#ui-decision-5','retest');await page.selectOption('#ui-decision-5','clarify');
 assert.equal(await page.locator('#ui-instructions-5').inputValue(),draft+'\nMy added question.');
 await page.evaluate(()=>loadUsers());
 assert.equal(await page.locator('#ui-instructions-5').inputValue(),draft+'\nMy added question.');
 await page.screenshot({path:`/tmp/pn-clarification-${engine.name()}-${width}.png`});
 await page.evaluate(()=>{
  const reasons=['The original blurred image is needed.','Exact accuracy depends on GPS.','The automatic repair did not pass review testing.','API key is missing.','Waiting for a reply'];
  for(let n=0;n<5;n++){const i=allIssues.find(i=>i.id===n+1);i.management_status='blocked';i.blocked_reason=reasons[n];i.review_decision=n===4?'clarify':null;}
  renderIssues();
 });
 await page.selectOption('#issueTypeFilter','bug_problem');await page.selectOption('#issueStatusFilter','blocked');
 assert(await page.locator('#issueRecommendedAction').isVisible());
 for(const [action,ids] of [['clarify',[1]],['retest',[2]],['implement',[3]],['setup',[4]],['wait',[5]],['no_change',[]]]){
  await page.selectOption('#issueRecommendedAction',action);assert.deepEqual(await cardIds(),ids);
 }
 await page.selectOption('#issueRecommendedAction','all');assert.deepEqual(await cardIds(),[1,2,3,4,5]);
 await page.selectOption('#issueRecommendedAction','clarify');await page.selectOption('#issueVersionFilter','pro');assert.deepEqual(await cardIds(),[]);
 await page.selectOption('#issueVersionFilter','all');assert.deepEqual(await cardIds(),[1]);
 await page.selectOption('#issueStatusFilter','open');assert.equal(await page.locator('#issueRecommendedAction').isVisible(),false);assert.equal(await page.locator('#issueRecommendedAction').inputValue(),'all');
 await page.selectOption('#issueStatusFilter','blocked');await page.selectOption('#issueTypeFilter','ui_improvement');assert.equal(await page.locator('#issueRecommendedAction').isVisible(),false);assert.deepEqual(await cardIds(),[20]);
 await page.selectOption('#issueStatusFilter','open');
 await page.selectOption('#issueTypeFilter','feature_improvement');
 assert.equal(await page.locator('#issueStatusFilter').inputValue(),'blocked');
 await page.evaluate(()=>{const i=allIssues.find(i=>i.id===21);i.management_status='new';i.review_decision=null;renderIssues();});
 assert.deepEqual(await cardIds(),[21]);
 await page.evaluate(()=>{const i=allIssues.find(i=>i.id===21);i.review_decision='implement';renderIssues();});
 assert.deepEqual(await cardIds(),[]);
 await page.selectOption('#issueStatusFilter','open');assert.deepEqual(await cardIds(),[21]);
 await page.selectOption('#issueStatusFilter','blocked');
 await page.evaluate(()=>{allIssues.find(i=>i.id===21).management_status='blocked';renderIssues();});
 assert.deepEqual(await cardIds(),[21]);
 assert.match(await page.locator('[data-issue-card="21"]').textContent(),/Implementation Stopped/);
 assert.deepEqual(errors,[]);await page.close();console.log(engine.name(),width,'version and secondary filters PASS');
 }}finally{await browser.close();}}}finally{server.close();}
})().catch(e=>{console.error(e);process.exit(1);});
