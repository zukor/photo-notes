const test=require('node:test'),assert=require('node:assert/strict');
test('UI review: owner decisions, tester clarification, approval-only queue and browser controls',{skip:process.env.PN_UI_REVIEW_TEST!=='1',timeout:90000},async()=>{
 const type=process.env.PN_REVIEW_TYPE||'ui_improvement';assert.ok(['bug_problem','ui_improvement','feature_improvement','new_feature'].includes(type));process.env.ISSUE_CLOUD_RUNNER_ENABLED='false';process.env.DATABASE_URL='postgresql://127.0.0.1:55489/pn_pro_retest';process.env.PGSSL='disable';process.env.SESSION_SECRET='ui-review-local';process.env.TESTER_QUEUE_TOKEN='local-ui-review-queue';
 const {pool,init}=require('../db');assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,'/tmp/pn-pro-retest/db');await init();const {initCloud}=require('../issue-cloud');await initCloud(pool);
 const users=[];for(const role of ['admin','admin','user','user'])users.push((await pool.query("INSERT INTO users(email,password_hash,role,plan) VALUES($1,'none',$2,'pro') RETURNING id",['ui-review-'+Date.now()+'-'+users.length+'@example.invalid',role])).rows[0].id);
 process.env.SUPER_ADMIN_USER_IDS=String(users[0]);const {app}=require('../server'),jwt=require('jsonwebtoken');const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const cookie=id=>'pn_token='+jwt.sign({id},process.env.SESSION_SECRET);
 const req=(path,body,user=users[0])=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:cookie(user)},...(body?{body:JSON.stringify(body)}:{})});
 const worker=(path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.TESTER_QUEUE_TOKEN},...(body?{body:JSON.stringify(body)}:{})});
 let browser;try{
 const report=(await pool.query("INSERT INTO issue_reports(user_id,issue_type,description,page_name) VALUES($1,$3,$2,'Organize') RETURNING *",[users[2],'What happened: Original suggestion\nWhat went wrong?\nToo much text\nWhat did you expect to happen?\nClear controls\nRecommended improvement:\nSimplify\nExpected result:\nLess clutter\nFrequency: Every time',type])).rows[0];
 if(type==='bug_problem'){await pool.query("UPDATE issue_reports SET management_status='blocked' WHERE id=$1",[report.id]);report.management_status='blocked';}
 const id=report.id,route=`/api/admin/issues/${id}/${type==='bug_problem'?'bug-review':'ui-review'}`;let current=report;
 const decide=async(decision,instructions,user=users[0])=>{const r=await req(route,{decision,instructions,expected_updated_at:current.updated_at},user);if(r.ok)current=await r.clone().json();return r;};
 assert.equal((await decide('implement','Use compact controls',users[1])).status,403);
 assert.equal((await decide('clarify','')).status,400);
 assert.equal((await worker(`/api/automation/issues/${id}/claim`,{})).status,409);
 assert.equal((await decide('clarify','Which controls should be compact?')).status,200);
 let mine=await(await req('/api/issues/mine',null,users[2])).json();assert.equal(mine.find(i=>i.id===id).blocked_reason,'Which controls should be compact?');
 assert.equal((await req(`/api/issues/${id}/details`,{details:'Only the top controls'},users[3])).status,404);
 assert.equal((await req(`/api/issues/${id}/details`,{details:'Only the top controls'},users[2])).status,200);
 current=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];assert.equal(current.review_decision,null);assert.equal((await worker(`/api/automation/issues/${id}/claim`,{})).status,409);
 assert.equal((await decide('no_change','The existing controls are needed.')).status,200);assert.equal(current.management_status,'wont_fix');mine=await(await req('/api/issues/mine',null,users[2])).json();assert.equal(mine.find(i=>i.id===id).review_note,'The existing controls are needed.');
 assert.equal((await worker(`/api/automation/issues/${id}/claim`,{})).status,409);

 if(type==='bug_problem'){
  assert.equal((await decide('retest','',users[1])).status,403);
  assert.equal((await decide('retest','')).status,200);
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/retest-'+id,keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}};
  await pool.query("INSERT INTO issue_push_subscriptions(user_id,endpoint,subscription,created_at) VALUES($1,$2,$3,now()-interval '1 hour')",[users[2],subscription.endpoint,JSON.stringify(subscription)]);
  const sent=[];await require('../issue-cloud').tickCloud(pool,(await pool.query('SELECT * FROM issue_push_config WHERE id=1')).rows[0],{env:{},send:async(sub,payload)=>{if(sub.endpoint===subscription.endpoint)sent.push(JSON.parse(payload));}});
  assert.ok(sent.some(p=>p.body.includes('Please test your reported issue again')&&!p.body.includes('deployed')));
  assert.equal(current.management_status,'retest_requested');assert.equal(current.fix_summary,null);assert.equal(current.verification,null);assert.equal(current.release_reference,null);
  assert.match(current.retest_instructions,/Please test this again/);assert.match(current.retest_instructions,/Steps for Retest:/);
  assert.equal((await worker(`/api/automation/issues/${id}/claim`,{})).status,409);
  assert.equal((await(await req('/api/issues/attention',null,users[2])).json()).ready_count,1);
  assert.equal((await req(`/api/issues/${id}/retest`,{result:'fixed'},users[3])).status,404);
  assert.equal((await req(`/api/issues/${id}/retest`,{result:'still_happening',notes:'Still broken'},users[2])).status,200);
  current=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];assert.equal(current.management_status,'blocked');assert.match(current.blocked_reason,/tester checked again/);
  assert.equal((await worker(`/api/automation/issues/${id}/claim`,{})).status,409);
  assert.equal((await decide('retest','Please repeat the original steps.')).status,200);
  assert.equal((await req(`/api/issues/${id}/retest`,{result:'fixed'},users[2])).status,200);
  current=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];assert.equal(current.management_status,'tester_confirmed');assert.equal(current.verification,null);
 }else assert.equal((await decide('retest','Try again')).status,200);
 assert.equal((await decide('implement','Use compact controls; retain all actions.')).status,200);
 const queue=await(await worker('/api/automation/testing-queue')).json();assert.equal(queue.issues.find(i=>i.id===id).implementation_instructions,'Use compact controls; retain all actions.');assert.equal(current.issue_type,type);
 const claimed=await(await worker(`/api/automation/issues/${id}/claim`,{})).json();assert.ok(claimed.claim_token);
 current=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];assert.equal((await decide('no_change','Stop')).status,409);
 assert.equal((await worker(`/api/automation/issues/${id}`,{claim_token:claimed.claim_token,management_status:'blocked',blocked_reason:'Needs a design decision.'})).status,200);
 current=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];assert.equal((await decide('clarify','Please describe the intended layout.')).status,200);
 assert.equal((await worker(`/api/automation/issues/${id}`,{claim_token:claimed.claim_token,management_status:'testing'})).status,409);
 assert.equal((await req(route,{decision:'implement',instructions:'stale',expected_updated_at:report.updated_at})).status,409);
 if(type==='bug_problem'){await pool.query("UPDATE issue_reports SET review_decision='implement',blocked_reason='The automatic repair did not pass review, testing, or deployment verification.' WHERE id=$1",[id]);}
 // Use the real admin page and real server to save the next clarification.
 browser=await require('playwright').chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:1000}});await page.context().addCookies([{name:'pn_token',value:cookie(users[0]).split('=')[1],url:base}]);await page.goto(base+'/admin?view=super',{waitUntil:'domcontentloaded'});await page.locator('[data-admin-tool="issues"] > summary').click();await page.waitForFunction(()=>typeof allIssues!=='undefined'&&allIssues.length>0);await page.evaluate(type=>{document.getElementById('issueTypeFilter').value=type;document.getElementById('issueStatusFilter').value='all';renderIssues();},type);const card=page.locator(`[data-issue-card="${id}"]`);await card.evaluate(el=>el.open=true);
 if(type==='bug_problem'){await card.getByText('Review Guidance',{exact:true}).click();assert.ok(await card.getByRole('heading',{name:'Why This Needs Your Review'}).isVisible());assert.ok((await card.textContent()).includes('saved result does not clearly say'));assert.equal(await card.locator('textarea').count(),1);assert.equal(await card.getByRole('heading',{name:'What Was Fixed',exact:true}).count(),0);assert.equal(await card.locator('summary').filter({hasText:'Technical Details And History'}).count(),1);}
 assert.equal(await card.locator('label').filter({hasText:'What Was Fixed'}).count(),0);assert.equal(await card.locator('.issue-description strong').filter({hasText:'Recommended improvement'}).count(),1);assert.ok((await card.locator('.issue-description').filter({hasText:'Original suggestion'}).first().textContent()).includes('\n\nFrequency:'));
 if(type==='bug_problem')await card.screenshot({path:'/tmp/pn-bug-needs-review.png'});
 await card.evaluate(el=>{el.open=true;el.closest('[data-admin-tool]').open=true;});
 await page.selectOption(`#ui-decision-${id}`,'clarify');await page.fill(`#ui-instructions-${id}`,'Which row should change?');await page.click(`[data-ui-submit="${id}"]`);await page.waitForFunction(id=>allIssues.find(i=>i.id===id)?.review_note==='Which row should change?',id);if(type!=='bug_problem'){await page.selectOption('#issueStatusFilter','all');await card.evaluate(el=>el.open=true);}await page.waitForFunction(id=>document.querySelector(`[data-issue-card="${id}"]`)?.textContent.includes('Which row should change?'),id);
 const record=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];assert.equal(record.review_note,'Which row should change?');assert.equal(record.description,report.description);
 await card.screenshot({path:'/tmp/pn-ui-review-desktop.png'});await page.setViewportSize({width:390,height:844});await card.screenshot({path:'/tmp/pn-ui-review-mobile.png'});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

 if(type==='bug_problem'){
  await page.selectOption(`#ui-decision-${id}`,'retest');const draft=await page.locator(`#ui-instructions-${id}`).inputValue();assert.match(draft,/Steps for Retest:/);await page.fill(`#ui-instructions-${id}`,draft+'\n\nAlso check the date after reopening.');await page.selectOption(`#ui-decision-${id}`,'clarify');await page.selectOption(`#ui-decision-${id}`,'retest');assert.match(await page.locator(`#ui-instructions-${id}`).inputValue(),/Also check the date/);await page.click(`[data-ui-submit="${id}"]`);
  await page.waitForFunction(id=>allIssues.find(i=>i.id===id)?.management_status==='retest_requested',id);
  await card.screenshot({path:'/tmp/pn-retest-request-admin.png'});
  const testerPage=await browser.newPage();await testerPage.context().addCookies([{name:'pn_token',value:cookie(users[2]).split('=')[1],url:base}]);await testerPage.goto(base+'/?issues=1');
  const reportCard=testerPage.locator('.tester-issue-card').filter({has:testerPage.locator(`[data-retest-fixed="${id}"]`)});
  await reportCard.getByRole('button',{name:'Retest Succeeded'}).waitFor();assert.match(await reportCard.textContent(),/No fix is being claimed/);assert.match(await reportCard.textContent(),/Also check the date after reopening/);assert.doesNotMatch(await reportCard.textContent(),/Deployed:|What changed/);
  await reportCard.screenshot({path:'/tmp/pn-retest-request-tester.png'});
  await testerPage.locator(`#retestNotes-${id}`).fill('Still happening after retry');await testerPage.locator(`[data-retest-broken="${id}"]`).click();
  await testerPage.waitForFunction(()=>!document.querySelector('[data-retest-broken]'));await testerPage.close();
  await page.reload();await page.locator('[data-admin-tool="issues"] > summary').click();await page.waitForFunction(()=>typeof allIssues!=='undefined'&&allIssues.length>0);await page.evaluate(id=>{document.getElementById('issueStatusFilter').value='all';renderIssues();document.querySelector(`[data-issue-card="${id}"]`).open=true;},id);
 }
 if(type==='bug_problem'){await page.selectOption(`#ui-decision-${id}`,'implement');await page.fill(`#ui-instructions-${id}`,'');await page.click(`[data-ui-submit="${id}"]`);await page.waitForFunction(id=>allIssues.find(i=>i.id===id)?.management_status==='new',id);const retried=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];assert.ok(retried.implementation_instructions.startsWith('Retry the repair'));}
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await pool.end();}
});
