const crypto=require('node:crypto');
async function initRequestNotices(pool){await pool.query(`CREATE TABLE IF NOT EXISTS issue_request_notices(
 event_id bigint NOT NULL REFERENCES issue_repair_events(id) ON DELETE CASCADE,
 user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,notice_type text NOT NULL,
 sent_at timestamptz,attempts integer NOT NULL DEFAULT 0,next_try timestamptz NOT NULL DEFAULT now(),error text,
 PRIMARY KEY(event_id,user_id));`);}
const requestEvents="'ready_to_test','automatic_retest_requested','bug_review_retest','ui_review_retest','bug_review_clarify','ui_review_clarify','automatic_clarification'";
const awaiting="(i.management_status='retest_requested' OR (i.management_status='ready_to_test' AND coalesce(i.release_reference,'')<>'' AND coalesce(i.verification,'')<>'') OR (i.management_status='blocked' AND i.review_decision='clarify'))";
async function notifyRequests(pool,{fetcher=fetch,env=process.env}={}){
 const c=await pool.connect();let locked=false;
 try{
  locked=(await c.query('SELECT pg_try_advisory_lock(740195) AS locked')).rows[0].locked;if(!locked)return;
  const settings=(await c.query('SELECT email_notifications_enabled,email_notifications_updated_at::text AS email_notifications_updated_at FROM issue_notification_settings WHERE id=1')).rows[0];
  if(settings?.email_notifications_enabled===false)return;
  const since=settings?.email_notifications_updated_at||null;
  await c.query(`INSERT INTO issue_request_notices(event_id,user_id,notice_type)
   SELECT e.id,u.id,CASE WHEN e.event LIKE '%clarif%' THEN 'clarification' ELSE 'retest' END
   FROM issue_reports i CROSS JOIN LATERAL (SELECT id,event,created_at FROM issue_repair_events WHERE issue_id=i.id AND event IN (${requestEvents}) ORDER BY created_at DESC,id DESC LIMIT 1) e
   JOIN users u ON u.active=true AND (u.id=i.user_id OR u.is_testing_manager=true)
   WHERE ${awaiting} AND ($1::timestamptz IS NULL OR e.created_at>=$1) AND (i.tester_retested_at IS NULL OR i.tester_retested_at<e.created_at)
   AND NOT EXISTS(SELECT 1 FROM issue_repair_events reply WHERE reply.issue_id=i.id AND reply.event='reporter_details' AND reply.created_at>e.created_at)
   ON CONFLICT DO NOTHING`,[since]);
  if(!env.RESEND_API_KEY)return;
  const rows=(await c.query(`SELECT d.*,u.email,e.issue_id,e.created_at,e.event,i.user_id reporter_id,i.review_note,i.retest_instructions
   FROM issue_request_notices d JOIN issue_repair_events e ON e.id=d.event_id JOIN issue_reports i ON i.id=e.issue_id JOIN users u ON u.id=d.user_id
   WHERE d.sent_at IS NULL AND d.next_try<=now() AND u.active=true AND (u.id=i.user_id OR u.is_testing_manager=true)
   AND ${awaiting} AND ($1::timestamptz IS NULL OR e.created_at>=$1) AND (i.tester_retested_at IS NULL OR i.tester_retested_at<e.created_at)
   AND NOT EXISTS(SELECT 1 FROM issue_repair_events newer WHERE newer.issue_id=i.id AND ((newer.event IN (${requestEvents}) AND (newer.created_at>e.created_at OR (newer.created_at=e.created_at AND newer.id>e.id))) OR (newer.event='reporter_details' AND newer.created_at>e.created_at)))
   ORDER BY d.event_id,d.user_id LIMIT 2`,[since])).rows;
  for(const d of rows){let error=null;
   try{
    const manager=d.user_id!==d.reporter_id,clarify=d.notice_type==='clarification';
    const instructions=clarify?d.review_note:d.retest_instructions;
    const body={from:env.ISSUE_REPORT_FROM||'Photo Notes Issues <issues@photonotesapp.com>',to:[d.email],subject:`Action needed: Photo Notes issue #${d.issue_id} ${clarify?'clarification':'retest'}`,text:`${manager?'A tester has received a new request. Please monitor their response.':clarify?'Please answer the clarification request in your original issue.':'Please retest your original issue and submit Fixed, Still Happening, or Unable to Test.'}\n\nIssue #${d.issue_id}\n\n${instructions||'Open the original issue for the full instructions.'}\n\n${manager?'https://photonotesapp.com/admin?tool=issues':'https://photonotesapp.com/?issues=1'}${clarify?'':'\n\nOutstanding retests also receive reminders every four hours.'}`};
    const key=crypto.createHash('sha256').update(`initial:${d.event_id}:${d.user_id}`).digest('hex');
    const r=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',authorization:`Bearer ${env.RESEND_API_KEY}`,'Idempotency-Key':key},body:JSON.stringify(body)});if(!r.ok)throw Error(`Mail service returned ${r.status}`);
   }catch(e){error=/^Mail service returned \d+$/.test(e.message)?e.message:'Email request failed';}
   await c.query("UPDATE issue_request_notices SET sent_at=CASE WHEN $3::text IS NULL THEN now() END,attempts=attempts+1,error=$3,next_try=now()+interval '1 minute' WHERE event_id=$1 AND user_id=$2",[d.event_id,d.user_id,error]);
  }
 }finally{if(locked)await c.query('SELECT pg_advisory_unlock(740195)').catch(()=>{});c.release();}
}
module.exports={initRequestNotices,notifyRequests};
