const test=require('node:test'),assert=require('node:assert/strict');
test('four-hour retest reminders persist, copy managers, retry and stop after replies',{skip:process.env.PN_REMINDER_TEST!=='1',timeout:60000},async()=>{
 process.env.DATABASE_URL=process.env.PN_LEGACY_TEST_DATABASE_URL;process.env.PGSSL='disable';process.env.SESSION_SECRET='reminders-local';
 const {pool,init}=require('../db');await init();
 const {initReminders,remindRetests}=require('../issue-reminders');await initReminders(pool);await require('../issue-cloud').initCloud(pool);await pool.query("ALTER TABLE issue_cloud_events ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'update'");
 const users=[];let server;
 const makeUser=async(manager=false)=>{const u=(await pool.query("INSERT INTO users(name,email,password_hash,role,is_testing_manager) VALUES('Fixture',$1,'none','user',$2) RETURNING id",[`reminder-${Date.now()}-${users.length}@example.invalid`,manager])).rows[0].id;users.push(u);return u;};
 try{
  const tester=await makeUser(),manager=await makeUser(true),other=await makeUser();
  const id=(await pool.query("INSERT INTO issue_reports(user_id,description,management_status,tester_notified_at) VALUES($1,'Fixture','retest_requested',now()-interval '3 hours') RETURNING id",[tester])).rows[0].id;
  for(const user of [tester,manager,other])await pool.query("INSERT INTO issue_push_subscriptions(user_id,endpoint,subscription,created_at) VALUES($1,$2,$3,now()-interval '10 minutes')",[user,'https://fcm.googleapis.com/reminder-'+user,JSON.stringify({endpoint:'fixture-'+user})]);
  const sent=[],fetcher=async(url,options)=>{sent.push(JSON.parse(options.body));return {ok:true};},env={RESEND_API_KEY:'fixture'};
  await remindRetests(pool,{fetcher,env});assert.equal(sent.length,0);
  await pool.query("UPDATE issue_reports SET tester_notified_at=now()-interval '4 hours 1 minute' WHERE id=$1",[id]);
  await Promise.all([remindRetests(pool,{fetcher,env}),remindRetests(pool,{fetcher,env})]);assert.equal(sent.length,2);assert(sent.every(s=>s.subject.includes('#'+id)));
  await remindRetests(pool,{fetcher,env});assert.equal(sent.length,2);assert.equal((await pool.query("SELECT count(*)::int n FROM issue_cloud_events WHERE issue_id=$1 AND kind='retest_reminder'",[id])).rows[0].n,1);
  const pushes=[];await require('../issue-cloud').tickCloud(pool,(await require('../issue-cloud').initCloud(pool)),{send:async(s,payload)=>pushes.push({subscription:s,...JSON.parse(payload)}),env:{ISSUE_CLOUD_RUNNER_ENABLED:'false'}});
  const reminders=pushes.filter(p=>p.title==='Photo Notes retest reminder');assert.equal(reminders.length,2);assert(reminders.some(p=>p.url==='/admin?tool=issues'));assert(reminders.some(p=>p.url==='/?issues=1'));assert(!reminders.some(p=>p.subscription.endpoint==='fixture-'+other));
  await pool.query("UPDATE issue_retest_reminders SET sent_at=NULL,next_try=now() WHERE issue_id=$1 AND user_id=$2",[id,manager]);
  await remindRetests(pool,{fetcher:async()=>({ok:false,status:429}),env});assert.equal((await pool.query('SELECT error FROM issue_retest_reminders WHERE issue_id=$1 AND user_id=$2',[id,manager])).rows[0].error,'Mail service returned 429');
  await pool.query('UPDATE issue_retest_reminders SET next_try=now() WHERE issue_id=$1',[id]);await remindRetests(pool,{fetcher,env});assert.equal(sent.length,3);
  await pool.query("UPDATE issue_reports SET management_status='blocked',tester_retested_at=now() WHERE id=$1",[id]);await remindRetests(pool,{fetcher,env});assert.equal(sent.length,3);
  await pool.query("UPDATE issue_reports SET management_status='retest_requested',tester_retested_at=NULL,tester_notified_at=now()-interval '8 hours 1 minute' WHERE id=$1",[id]);await remindRetests(pool,{fetcher,env});assert.equal(sent.length,5);
  const {app}=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const call=async(user,path,method='GET')=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Cookie:'pn_token='+require('jsonwebtoken').sign({id:user},process.env.SESSION_SECRET),'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});
  assert.equal((await call(manager,'/api/admin/issues')).status,200);assert.equal((await call(other,'/api/admin/issues')).status,403);
  assert.equal((await call(manager,`/api/issues/${id}/history`)).status,200);assert.equal((await call(other,`/api/issues/${id}/history`)).status,404);
  assert.equal((await call(manager,`/api/admin/issues/${id}`,'POST')).status,403);
  const {notifyRequests}=require('../issue-request-notices');
  const clarification=(await pool.query("INSERT INTO issue_reports(user_id,description,management_status,review_decision,review_note) VALUES($1,'Fixture clarification','blocked','clarify','Please identify the original photo') RETURNING id",[tester])).rows[0].id;
  await pool.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'bug_review_clarify','{}')",[clarification]);
  const initial=[],initialFetch=async(url,options)=>{initial.push(JSON.parse(options.body));return {ok:true};};
  await notifyRequests(pool,{fetcher:initialFetch,env});assert.equal(initial.length,2);assert(initial.every(n=>n.subject.includes('clarification')&&n.text.includes('original photo')));
  await notifyRequests(pool,{fetcher:initialFetch,env});assert.equal(initial.length,2);
  await pool.query("UPDATE issue_reports SET management_status='retest_requested',review_decision='retest',retest_instructions='Repeat the original capture',tester_retested_at=NULL WHERE id=$1",[clarification]);
  await pool.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'bug_review_retest','{}')",[clarification]);
  await notifyRequests(pool,{fetcher:initialFetch,env});assert.equal(initial.length,4);assert(initial.slice(2).every(n=>n.subject.includes('retest')&&n.text.includes('original capture')));
  await notifyRequests(pool,{fetcher:initialFetch,env});assert.equal(initial.length,4);
  await pool.query("UPDATE issue_request_notices SET sent_at=NULL,next_try=now() WHERE event_id IN (SELECT id FROM issue_repair_events WHERE issue_id=$1)",[clarification]);
  await pool.query("UPDATE issue_reports SET management_status='resolved',tester_retested_at=now() WHERE id=$1",[clarification]);
  await notifyRequests(pool,{fetcher:initialFetch,env});assert.equal(initial.length,4);

 }finally{if(server)await new Promise(r=>server.close(r));await pool.query('DELETE FROM users WHERE id=ANY($1::int[])',[users]);await pool.end();}
});
