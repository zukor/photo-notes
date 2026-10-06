// Durable four-hour reminders, anchored to the latest request, not server uptime.
const crypto=require('node:crypto');
async function initReminders(pool){
 await pool.query(`CREATE TABLE IF NOT EXISTS issue_retest_reminders(
 id bigserial PRIMARY KEY,issue_id integer NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,request_at timestamptz NOT NULL,cycle integer NOT NULL,
 sent_at timestamptz,attempts integer NOT NULL DEFAULT 0,next_try timestamptz NOT NULL DEFAULT now(),error text,
 UNIQUE(issue_id,user_id,request_at,cycle));
 ALTER TABLE issue_retest_reminders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
 CREATE TABLE IF NOT EXISTS issue_retest_reminder_cycles(issue_id integer NOT NULL REFERENCES issue_reports(id) ON DELETE CASCADE,request_at timestamptz NOT NULL,cycle integer NOT NULL,PRIMARY KEY(issue_id,request_at,cycle));
 UPDATE issue_retest_reminders SET error=NULL WHERE error='Email delivery is not configured';
 UPDATE issue_repair_events SET event='developer_investigation' WHERE event='blocked' AND detail LIKE '%"blocked_reason":"Developer investigation recorded October 6, 2026.%';`);
}
const waitingSql=`(i.management_status='retest_requested' OR (i.management_status='ready_to_test' AND coalesce(i.release_reference,'')<>'' AND coalesce(i.verification,'')<>''))`;
async function remindRetests(pool,{fetcher=fetch,env=process.env}={}){
 const c=await pool.connect();let locked=false;
 try{
  locked=(await c.query('SELECT pg_try_advisory_lock(740194) AS locked')).rows[0].locked;if(!locked)return;
  await c.query(`INSERT INTO issue_retest_reminders(issue_id,user_id,request_at,cycle)
   SELECT i.id,u.id,r.request_at,floor(extract(epoch FROM (now()-r.request_at))/14400)::int
   FROM issue_reports i CROSS JOIN LATERAL (SELECT coalesce((SELECT max(created_at) FROM issue_repair_events WHERE issue_id=i.id AND event IN ('ready_to_test','automatic_retest_requested','bug_review_retest','ui_review_retest')),i.tester_notified_at,i.updated_at) AS request_at) r
   JOIN users u ON u.active=true AND (u.id=i.user_id OR u.is_testing_manager=true)
   WHERE ${waitingSql} AND r.request_at<=now()-interval '4 hours'
   AND (i.tester_retested_at IS NULL OR i.tester_retested_at<r.request_at)
   ON CONFLICT DO NOTHING`);
  await c.query(`WITH due AS (
   INSERT INTO issue_retest_reminder_cycles(issue_id,request_at,cycle)
   SELECT DISTINCT d.issue_id,d.request_at,d.cycle FROM issue_retest_reminders d JOIN issue_reports i ON i.id=d.issue_id
   WHERE ${waitingSql} AND NOT EXISTS(SELECT 1 FROM issue_repair_events e WHERE e.issue_id=i.id AND e.created_at>d.request_at AND e.event IN ('ready_to_test','automatic_retest_requested','bug_review_retest','ui_review_retest')) AND d.cycle=floor(extract(epoch FROM (now()-d.request_at))/14400)::int
   AND (i.tester_retested_at IS NULL OR i.tester_retested_at<d.request_at)
   ON CONFLICT DO NOTHING RETURNING issue_id)
   INSERT INTO issue_cloud_events(issue_id,status,kind) SELECT i.id,i.management_status,'retest_reminder' FROM due JOIN issue_reports i ON i.id=due.issue_id`);
  // In-app and browser reminders work independently of optional email delivery.
  if(!env.RESEND_API_KEY)return;
  const rows=(await c.query(`SELECT d.*,u.email,u.is_testing_manager,i.user_id AS reporter_id,i.retest_instructions,i.fix_summary,i.management_status
   FROM issue_retest_reminders d JOIN issue_reports i ON i.id=d.issue_id JOIN users u ON u.id=d.user_id
   WHERE d.sent_at IS NULL AND d.next_try<=now() AND u.active=true AND (u.id=i.user_id OR u.is_testing_manager=true)
   AND ${waitingSql} AND (i.tester_retested_at IS NULL OR i.tester_retested_at<d.request_at)
   AND NOT EXISTS(SELECT 1 FROM issue_repair_events e WHERE e.issue_id=i.id AND e.created_at>d.request_at AND e.event IN ('ready_to_test','automatic_retest_requested','bug_review_retest','ui_review_retest'))
   AND d.cycle=floor(extract(epoch FROM (now()-d.request_at))/14400)::int
   ORDER BY d.id LIMIT 50`)).rows;
  for(const d of rows){
   let error=null;
   try{
    if(!env.RESEND_API_KEY)throw Error('Email delivery is not configured');
    const manager=d.user_id!==d.reporter_id;
    const url=manager?'https://photonotesapp.com/admin?tool=issues':'https://photonotesapp.com/?issues=1';
    const body={from:env.ISSUE_REPORT_FROM||'Photo Notes Issues <issues@photonotesapp.com>',to:[d.email],subject:`Retest reminder: Photo Notes issue #${d.issue_id}`,text:`${manager?'A tester has not submitted the requested retest. Please monitor and follow up.':'Please retest your original issue and submit Fixed, Still Happening, or Unable to Test in My Issue Reports.'}\n\nIssue #${d.issue_id}\n${d.management_status==='retest_requested'?'No fix is being claimed.':''}\n${d.retest_instructions||'Open the original issue for the requested checks.'}\n\n${url}\n\nReminders repeat every four hours until a retest is submitted.`};
    const key=crypto.createHash('sha256').update(`${d.issue_id}:${d.user_id}:${new Date(d.request_at).toISOString()}:${d.cycle}`).digest('hex');
    const r=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',authorization:`Bearer ${env.RESEND_API_KEY}`,'Idempotency-Key':key},body:JSON.stringify(body)});
    if(!r.ok)throw Error(`Mail service returned ${r.status}`);
   }catch(e){error=e.message==='Email delivery is not configured'?e.message:/^Mail service returned \d+$/.test(e.message)?e.message:'Email request failed';}
   await c.query(`UPDATE issue_retest_reminders SET sent_at=CASE WHEN $2::text IS NULL THEN now() ELSE NULL END,attempts=attempts+1,error=$2,next_try=now()+interval '5 minutes' WHERE id=$1`,[d.id,error]);
  }
 }finally{if(locked)await c.query('SELECT pg_advisory_unlock(740194)').catch(()=>{});c.release();}
}
module.exports={initReminders,remindRetests,waitingSql};
