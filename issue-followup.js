const {eligibleIssueSql}=require('./issue-ui-review');
const {clarificationDraft}=require('./public/issue-review-guidance');
function kind(row){
 const reason=String(row.blocked_reason||'').toLowerCase();
 if(row.blocked_kind)return row.blocked_kind;
 if(/security|credentials|destructive|storage restriction|changes? storage behavior|product decision|conflicting|choose.*behavior/.test(reason))return 'decision';
 if(/outside the allowed|expanded file scope|allowed change files|allowed files/.test(reason))return 'developer';
 if(/original.*(needed|required)|exact steps.*(missing|required)|report.*(unclear|not enough detail)/.test(reason))return 'evidence';
 if(/tester.*(checked|confirmed).*still happening|tester has replied|automatic repair.*(did not pass|ended without)|maintainer must inspect/.test(reason))return 'retry';
 if(require('./public/issue-review-guidance').explain(row).action==='retest')return 'retest';
 return 'decision';
}
async function followupIssues(pool){
 const c=await pool.connect(),changed=[];
 try{await c.query('BEGIN');
 const rows=(await c.query(`SELECT i.*, (SELECT count(*)::int FROM issue_repair_events e WHERE e.issue_id=i.id AND (e.event='blocked' OR (e.event='retest' AND e.detail::text LIKE '%still_happening%'))) AS failed_attempts FROM issue_reports i WHERE ${eligibleIssueSql('i')} AND i.management_status='blocked' AND i.review_decision IS DISTINCT FROM 'clarify' AND (i.repair_lease_until IS NULL OR i.repair_lease_until<now()) ORDER BY i.id FOR UPDATE OF i SKIP LOCKED`)).rows;
 for(const row of rows){
  // Preserve explicit owner holds and approvals. Only unreviewed bugs are routed automatically.
  if(row.issue_type!=='bug_problem'||row.blocked_kind==='decision'||['clarify','retest','no_change'].includes(row.review_decision))continue;
  const route=kind(row);
  if(route==='retry'&&row.failed_attempts<2){
   await c.query("UPDATE issue_reports SET management_status='new',blocked_kind=NULL,blocked_reason=NULL,repair_claim_hash=NULL,repair_lease_until=NULL,updated_at=now() WHERE id=$1",[row.id]);
   await c.query('DELETE FROM issue_cloud_dispatch WHERE issue_id=$1',[row.id]);
   await c.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'automatic_followup',$2)",[row.id,JSON.stringify({previous_reason:row.blocked_reason,notes:row.tester_notes||row.reporter_details,action:'Repair queued with the latest tester evidence'})]);changed.push(row.id);
  }else if(route==='evidence'){
   const question=clarificationDraft(row)||'Please send the original example, the exact steps, and the result you see so we can reproduce this problem.';
   await c.query("UPDATE issue_reports SET blocked_kind='evidence',review_decision='clarify',review_note=$2,blocked_reason=$2,tester_notification_status='in_app',tester_notified_at=now(),updated_at=now() WHERE id=$1",[row.id,question]);
   await c.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'automatic_clarification',$2)",[row.id,JSON.stringify({instructions:question,previous_reason:row.blocked_reason})]);
   await c.query("INSERT INTO issue_cloud_events(issue_id,status) VALUES($1,'blocked')",[row.id]);changed.push(row.id);
  }else if(!row.blocked_kind){await c.query('UPDATE issue_reports SET blocked_kind=$2,updated_at=now() WHERE id=$1',[row.id,route==='retry'?'decision':route]);}
 }
 await c.query('COMMIT');return changed;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
module.exports={kind,followupIssues};
