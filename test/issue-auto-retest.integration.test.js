const test=require('node:test'),assert=require('node:assert/strict');
test('first retests are automatic, durable, and return failed results to owner review',{skip:process.env.PN_AUTO_RETEST_TEST!=='1',timeout:60000},async()=>{
 process.env.DATABASE_URL='postgresql://127.0.0.1:55489/pn_pro_retest';process.env.PGSSL='disable';process.env.SESSION_SECRET='auto-retest-local';process.env.ISSUE_CLOUD_RUNNER_ENABLED='false';
 const {pool,init}=require('../db');
 assert.equal((await pool.query('SHOW data_directory')).rows[0].data_directory,'/tmp/pn-pro-retest/db');await init();
 await require('../issue-cloud').initCloud(pool);
 const {requestFirstRetests}=require('../issue-auto-retest');
 const user=(await pool.query("INSERT INTO users(email,password_hash,role,plan) VALUES($1,'none','user','pro') RETURNING id",['auto-retest-'+Date.now()+'@example.invalid'])).rows[0].id;
 const ids=[];let server;
 const make=async(extra={})=>{
  const row=(await pool.query("INSERT INTO issue_reports(user_id,issue_type,description,page_name,management_status,blocked_reason) VALUES($1,$2,'Photo annotations disappear','Edit','blocked',$3) RETURNING *",[user,extra.type||'bug_problem',extra.reason||'The original device still needs a live retest.'])).rows[0];ids.push(row.id);
  if(extra.decision)await pool.query('UPDATE issue_reports SET review_decision=$2 WHERE id=$1',[row.id,extra.decision]);
  return row.id;
 };
 try{
  const negative=await make(),positive=await make(),clarify=await make({reason:'The original photo is needed.'}),repair=await make({reason:'The automatic repair did not pass review testing.'}),idea=await make({type:'ui_improvement'}),owner=await make({decision:'clarify'}),previous=await make(),leased=await make(),alreadyFailed=await make();
  await pool.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'bug_review_retest','old manual request')",[previous]);
  await pool.query("UPDATE issue_reports SET repair_lease_until=now()+interval '10 minutes' WHERE id=$1",[leased]);
  await pool.query("UPDATE issue_reports SET tester_result='still_happening' WHERE id=$1",[alreadyFailed]);
  await Promise.all([requestFirstRetests(pool),requestFirstRetests(pool)]);
  for(const id of [negative,positive]){
   const r=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[id])).rows[0];
   assert.equal(r.management_status,'retest_requested');assert(r.auto_retest_requested_at);assert.equal(r.reviewed_by,null);assert.equal(r.verification,null);assert.equal(r.tester_notification_status,'in_app');
   assert.match(r.retest_instructions,/Steps for Retest:/);assert.match(r.retest_instructions,/text annotation/);
   assert.equal((await pool.query("SELECT count(*)::int n FROM issue_repair_events WHERE issue_id=$1 AND event='automatic_retest_requested'",[id])).rows[0].n,1);
   assert.equal((await pool.query("SELECT count(*)::int n FROM issue_cloud_events WHERE issue_id=$1 AND status='retest_requested'",[id])).rows[0].n,1);
  }
  for(const id of [clarify,repair,idea,owner,previous,leased,alreadyFailed])assert.equal((await pool.query('SELECT management_status FROM issue_reports WHERE id=$1',[id])).rows[0].management_status,'blocked');
  const {app}=require('../server');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const token=require('jsonwebtoken').sign({id:user},process.env.SESSION_SECRET);
  for(const [id,result,status] of [[negative,'still_happening','blocked'],[positive,'fixed','tester_confirmed']]){
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/issues/'+id+'/retest',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'pn_token='+token},body:JSON.stringify({result,notes:'Checked the original photo again.'})});
   assert.equal(response.status,200);assert.equal((await response.json()).status,status);
  }
  await pool.query("UPDATE issue_reports SET management_status='ready_to_test',verification='Verified',release_reference='test-release' WHERE id=$1",[positive]);
  const unable=await fetch('http://127.0.0.1:'+server.address().port+'/api/issues/'+positive+'/retest',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'pn_token='+token},body:JSON.stringify({result:'unable_to_test',notes:'Original test device unavailable.'})});
  assert.equal(unable.status,200);assert.equal((await unable.json()).status,'blocked');
  const unableRow=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[positive])).rows[0];assert.equal(unableRow.tester_result,'unable_to_test');assert.match(unableRow.blocked_reason,/could not complete/);
  await pool.query("UPDATE issue_reports SET management_status='ready_to_test',verification='Verified',release_reference='test-release' WHERE id=$1",[positive]);
  const failedDeployed=await fetch('http://127.0.0.1:'+server.address().port+'/api/issues/'+positive+'/retest',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'pn_token='+token},body:JSON.stringify({result:'still_happening',notes:'Deployed change still fails.'})});
  assert.equal(failedDeployed.status,200);assert.equal((await failedDeployed.json()).status,'blocked');
  await requestFirstRetests(pool);
  const failed=(await pool.query('SELECT * FROM issue_reports WHERE id=$1',[negative])).rows[0];
  assert.equal(failed.management_status,'blocked');assert.match(failed.blocked_reason,/tester checked again/);assert.equal(failed.tester_notes,'Checked the original photo again.');
  assert.equal((await pool.query("SELECT count(*)::int n FROM issue_repair_events WHERE issue_id=$1 AND event='automatic_retest_requested'",[negative])).rows[0].n,1);
 }finally{
  if(server)await new Promise(r=>server.close(r));
  await pool.query('DELETE FROM issue_cloud_events WHERE issue_id=ANY($1::int[])',[ids]);
  await pool.query('DELETE FROM issue_repair_events WHERE issue_id=ANY($1::int[])',[ids]);
  await pool.query('DELETE FROM issue_reports WHERE id=ANY($1::int[])',[ids]);await pool.query('DELETE FROM users WHERE id=$1',[user]);await pool.end();
 }
});
