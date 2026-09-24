const {explain}=require('./public/issue-review-guidance');
const {build}=require('./public/issue-retest-guidance');

// One first retest per report. Never overwrite an owner's decision or repeat a
// previous retest, including manual requests recorded before this feature.
async function requestFirstRetests(pool){
 const client=await pool.connect();const requested=[];
 try{
  await client.query('BEGIN');
  const rows=(await client.query(`SELECT i.* FROM issue_reports i
   WHERE i.issue_type='bug_problem' AND i.management_status='blocked'
   AND i.auto_retest_requested_at IS NULL AND i.review_decision IS NULL
   AND i.tester_result IS NULL AND i.tester_retested_at IS NULL
   AND (i.repair_lease_until IS NULL OR i.repair_lease_until<now())
   AND NOT EXISTS (SELECT 1 FROM issue_repair_events e WHERE e.issue_id=i.id AND e.event IN ('retest','bug_review_retest','automatic_retest_requested','retest_requested'))
   AND NOT EXISTS (SELECT 1 FROM issue_cloud_events e WHERE e.issue_id=i.id AND e.status IN ('ready_to_test','retest_requested'))
   ORDER BY i.id FOR UPDATE OF i SKIP LOCKED`)).rows;
  for(const row of rows){
   if(explain(row).action!=='retest')continue;
   const instructions=build(row);
   await client.query(`UPDATE issue_reports SET management_status='retest_requested',
    auto_retest_requested_at=now(),retest_instructions=$2,review_decision='retest',
    review_note=$2,reviewed_by=NULL,reviewed_at=NULL,blocked_reason=NULL,
    repair_claim_hash=NULL,repair_lease_until=NULL,updated_at=now(),
    fix_summary=NULL,verification=NULL,fix_commit=NULL,release_reference=NULL,resolved_at=NULL,
    tester_notification_status='in_app',tester_notified_at=now() WHERE id=$1`,[row.id,instructions]);
   await client.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'automatic_retest_requested',$2)",[row.id,JSON.stringify({instructions,previous_status:row.management_status,previous_reason:row.blocked_reason,previous_fix_summary:row.fix_summary,previous_verification:row.verification,previous_release:row.release_reference})]);
   requested.push(row.id);
  }
  await client.query('COMMIT');return requested;
 }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
module.exports={requestFirstRetests};
