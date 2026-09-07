const test=require('node:test'),assert=require('node:assert/strict');
const {validSubscription,initCloud,tickCloud}=require('../issue-cloud');
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}};
test('push endpoints reject arbitrary and internal hosts',()=>{assert.ok(validSubscription(sub));for(const endpoint of ['http://fcm.googleapis.com/test','https://127.0.0.1/test','https://evil.com/test','https://fcm.googleapis.com.evil.com/test','https://fcm.googleapis.com:8443/test'])assert.equal(validSubscription({...sub,endpoint}),false);});
test('push subscription rejects malformed keys',()=>{assert.equal(validSubscription({...sub,keys:{}}),false);assert.equal(validSubscription(null),false);});
test('durable notification worker respects ownership, retries, and idempotence',{skip:!process.env.PN_CLOUD_TEST_DB},async()=>{
  const url=process.env.PN_CLOUD_TEST_DB;if(!url.startsWith('postgres://postgres@127.0.0.1:55473/'))throw new Error('Disposable database required');
  const {Pool}=require('pg'),pool=new Pool({connectionString:url});
  try{
    await pool.query(`CREATE TABLE users(id integer PRIMARY KEY,role text);CREATE TABLE issue_reports(id integer PRIMARY KEY,user_id integer,management_status text,repair_lease_until timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());INSERT INTO users VALUES(1,'admin'),(2,'user'),(3,'user');`);
    const keys=await initCloud(pool);assert.ok(keys.private_key);
    for(const id of [1,2,3])await pool.query('INSERT INTO issue_push_subscriptions(user_id,endpoint,subscription) VALUES($1,$2,$3)',[id,sub.endpoint+id,JSON.stringify({...sub,endpoint:sub.endpoint+id})]);
    await pool.query("INSERT INTO issue_reports(id,user_id,management_status) VALUES(10,2,'new')");
    const sent=[];const send=async s=>sent.push(s.endpoint);
    await tickCloud(pool,keys,{send,env:{}});assert.deepEqual(sent,[]);
    await tickCloud(pool,keys,{send,env:{}});assert.equal(sent.length,0);
    await pool.query("UPDATE issue_reports SET management_status='ready_to_test' WHERE id=10");
    await pool.query("UPDATE issue_push_subscriptions SET created_at=now()-interval '5 minutes'");await pool.query("UPDATE issue_cloud_events SET created_at=now()-interval '61 seconds' WHERE status='ready_to_test'");await tickCloud(pool,keys,{send,env:{}});assert.equal(sent.length,2);assert.ok(!sent.includes(sub.endpoint+'3'));
    await pool.query("UPDATE issue_reports SET management_status='blocked' WHERE id=10");
    await tickCloud(pool,keys,{send:async()=>{throw {statusCode:503};},env:{}});
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM issue_push_delivery WHERE attempts=1 AND sent_at IS NULL')).rows[0].n,2);
    await pool.query('UPDATE issue_push_delivery SET next_try=now()');await tickCloud(pool,keys,{send,env:{}});assert.equal(sent.length,4);
    const before=keys.public_key;assert.equal((await initCloud(pool)).public_key,before);
    await pool.query("UPDATE issue_reports SET management_status='new',updated_at=now() WHERE id=10");let dispatched=0;
    const env={ISSUE_CLOUD_RUNNER_ENABLED:'true',ISSUE_GITHUB_TOKEN:'synthetic'},fetcher=async(url)=>{if(url.includes('/runs?'))return {ok:true,json:async()=>({workflow_runs:[]})};dispatched++;return {ok:true,status:204};};
    await tickCloud(pool,keys,{send,env,fetcher});await tickCloud(pool,keys,{send,env,fetcher});assert.equal(dispatched,1);
    // A missed start is retried after the durable deadline, even without a report edit.
    await pool.query("UPDATE issue_cloud_dispatch SET next_try=now()-interval '1 minute'");await pool.query("UPDATE issue_cloud_state SET last_dispatch_check=now()-interval '1 minute'");
    await tickCloud(pool,keys,{send,env,fetcher});assert.equal(dispatched,2);
    await pool.query("UPDATE issue_cloud_state SET last_dispatch_check=now()-interval '1 minute'");
    await tickCloud(pool,keys,{send,env:{ISSUE_CLOUD_RUNNER_ENABLED:'true'},fetcher});assert.match((await pool.query('SELECT dispatch_error FROM issue_cloud_state')).rows[0].dispatch_error,/ISSUE_GITHUB_TOKEN/);
    await pool.query("UPDATE issue_cloud_state SET last_dispatch_check=now()-interval '1 minute'");await tickCloud(pool,keys,{send,env,fetcher});
    // Two completion events are delivered in a single push per subscribed device.
    await pool.query("INSERT INTO issue_reports(id,user_id,management_status) VALUES(11,2,'new')");
    await pool.query("UPDATE issue_reports SET management_status='ready_to_test' WHERE id IN (10,11)");
    await pool.query("UPDATE issue_cloud_events SET created_at=now()-interval '61 seconds' WHERE status='ready_to_test'");
    const grouped=[];await tickCloud(pool,keys,{send:async(s,p)=>grouped.push(JSON.parse(p)),env:{}});
    assert.equal(grouped.length,2);assert.ok(grouped.every(p=>p.body.startsWith('2 issue repairs')));

  }finally{await pool.end();}
});
