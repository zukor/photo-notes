const {isSuperAdmin}=require('./super-admin');
// Only a recorded owner approval admits a UI idea to the implementation worker.
function eligibleIssueSql(alias=''){
 const p=alias?alias+'.':'';
 return `(${p}issue_type='bug_problem' OR (${p}issue_type='ui_improvement' AND ${p}review_decision='implement' AND ${p}reviewed_by IS NOT NULL AND length(trim(COALESCE(${p}implementation_instructions,'')))>0))`;
}
function registerUiReview(app,{pool,requireAuth}){
 app.post('/api/admin/issues/:id/ui-review',requireAuth,async(req,res)=>{
  if(!isSuperAdmin(req.user))return res.status(403).json({error:'Super Admin access required'});
  const id=Number(req.params.id),decision=req.body?.decision,text=typeof req.body?.instructions==='string'?req.body.instructions.trim():'';
  if(!Number.isInteger(id)||id<1||!['implement','clarify','no_change'].includes(decision)||!text||text.length>5000||!req.body.expected_updated_at)return res.status(400).json({error:'Choose an action and enter 1-5,000 characters explaining it.'});
  const c=await pool.connect();try{
   await c.query('BEGIN');const row=(await c.query('SELECT * FROM issue_reports WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!row||row.issue_type!=='ui_improvement'){await c.query('ROLLBACK');return res.status(404).json({error:'UI improvement not found'});}
   if(new Date(row.updated_at).getTime()!==new Date(req.body.expected_updated_at).getTime()){await c.query('ROLLBACK');return res.status(409).json({error:'This report changed. Reload it before submitting your decision.'});}
   if(row.repair_lease_until&&new Date(row.repair_lease_until)>new Date()){await c.query('ROLLBACK');return res.status(409).json({error:'Implementation is currently running. Wait for its result before changing this decision.'});}
   const status=decision==='implement'?'new':decision==='clarify'?'blocked':'wont_fix';
   const updated=(await c.query(`UPDATE issue_reports SET review_decision=$2,implementation_instructions=$3,review_note=$4,reviewed_by=$5,reviewed_at=now(),management_status=$6,blocked_reason=$7,repair_claim_hash=NULL,repair_lease_until=NULL,updated_at=now(),resolved_at=CASE WHEN $2='no_change' THEN now() ELSE NULL END,fix_summary=NULL,verification=NULL,fix_commit=NULL,release_reference=NULL,retest_instructions=NULL,tester_result=NULL,tester_notes=NULL,tester_retested_at=NULL,tester_notification_status='in_app',tester_notified_at=now() WHERE id=$1 RETURNING *`,[id,decision,decision==='implement'?text:null,decision==='implement'?null:text,req.user.id,status,decision==='clarify'?text:null])).rows[0];
   await c.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,$2,$3)",[id,'ui_review_'+decision,JSON.stringify({decision,instructions:text,reviewed_by:req.user.id,previous_status:row.management_status,previous_decision:row.review_decision,previous_instructions:row.implementation_instructions,previous_note:row.review_note,previous_fix_summary:row.fix_summary,previous_verification:row.verification,previous_release:row.release_reference,previous_retest_instructions:row.retest_instructions,previous_tester_result:row.tester_result,previous_tester_notes:row.tester_notes})]);
   // Explicit approval/reapproval starts a fresh dispatch attempt, not an old retry delay.
   await c.query('DELETE FROM issue_cloud_dispatch WHERE issue_id=$1',[id]);
   if(status==='blocked'&&row.management_status==='blocked')await c.query("INSERT INTO issue_cloud_events(issue_id,status) VALUES($1,'blocked')",[id]);
   await c.query('COMMIT');res.json(updated);
  }catch(e){await c.query('ROLLBACK');console.error('[ui-review]',e.message);res.status(500).json({error:'Decision could not be saved'});}finally{c.release();}
 });
}
module.exports={eligibleIssueSql,registerUiReview};
