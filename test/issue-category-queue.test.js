const test=require('node:test'),assert=require('node:assert/strict');
const {registerIssueRepair,digest}=require('../issue-repair');
test('database queue, claims, and stale worker updates exclude all idea categories',{skip:!process.env.PN_CATEGORY_TEST_DB},async()=>{
 const url=process.env.PN_CATEGORY_TEST_DB;if(!url.startsWith('postgres://postgres@127.0.0.1:55473/'))throw Error('Disposable database required');
 const {Pool}=require('pg'),pool=new Pool({connectionString:url}),express=require('express'),app=express();app.use(express.json());
 let server;
 try{
  await pool.query(`CREATE TABLE issue_reports(id serial PRIMARY KEY,issue_type text,management_status text DEFAULT 'new',priority text DEFAULT 'normal',repair_claim_hash text,repair_lease_until timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());CREATE TABLE issue_worker_state(id integer PRIMARY KEY,last_checked timestamptz);CREATE TABLE issue_repair_events(issue_id integer,event text,detail text,created_at timestamptz DEFAULT now())`);
  for(const col of ['review_decision','implementation_instructions','reviewed_by','description','page_name','page_url','reported_edition','app_version','viewport','user_agent','fix_summary','release_reference','retest_instructions','verification','blocked_reason','reporter_details','tester_result','tester_notes','screenshot_path','voice_path'])await pool.query(`ALTER TABLE issue_reports ADD COLUMN ${col} text`);
  for(const type of ['bug_problem','ui_improvement','feature_improvement','new_feature'])await pool.query('INSERT INTO issue_reports(issue_type) VALUES($1)',[type]);
  const pass=(req,res,next)=>next();registerIssueRepair(app,{pool,requireAuth:pass,requireAdmin:pass,requireTestingQueueToken:pass});
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body={})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.deepEqual((await(await fetch(base+'/api/automation/testing-queue')).json()).issues.map(i=>i.id),[1]);
  for(const id of [2,3,4]){
   assert.equal((await post(`/api/automation/issues/${id}/claim`)).status,409);
   await pool.query("UPDATE issue_reports SET management_status='fixing',repair_claim_hash=$1,repair_lease_until=now()+interval '1 hour' WHERE id=$2",[digest('old-token'),id]);
   assert.equal((await post(`/api/automation/issues/${id}`,{management_status:'testing',claim_token:'old-token'})).status,409);
  }
  const claim=await(await post('/api/automation/issues/1/claim')).json();assert.ok(claim.claim_token);
  assert.equal((await post('/api/automation/issues/1',{management_status:'blocked',claim_token:claim.claim_token,blocked_reason:'Sam must choose the intended behavior'})).status,200);
  assert.equal((await post('/api/automation/issues/1/claim')).status,409);
 }finally{if(server)await new Promise(r=>server.close(r));await pool.end();}
});
