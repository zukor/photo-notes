function registerRetest(app,{pool,requireAuth,ticketText,logEvent}){
 app.post('/api/issues/:id/retest',requireAuth,async(req,res)=>{
  const id=Number(req.params.id),result=req.body?.result;
  if(!Number.isInteger(id)||id<1||!['fixed','still_happening','unable_to_test'].includes(result))return res.status(400).json({error:'bad retest result'});
  const notes=ticketText(req.body?.notes,2000);let c;
  try{
   c=await pool.connect();await c.query('BEGIN');
   const row=(await c.query("SELECT * FROM issue_reports WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,req.user.id])).rows[0];
   if(!row||!(row.management_status==='retest_requested'||(row.management_status==='ready_to_test'&&row.verification&&row.release_reference))){await c.query('ROLLBACK');return res.status(404).json({error:'issue is not ready for retesting'});}
   const count=(await c.query("SELECT count(*)::int n FROM issue_repair_events WHERE issue_id=$1 AND (event='blocked' OR (event='retest' AND detail::text LIKE '%still_happening%'))",[id])).rows[0].n;
   const retry=result==='still_happening'&&row.issue_type==='bug_problem'&&count<1;
   const status=result==='fixed'?'tester_confirmed':retry?'new':'blocked';
   const reason=result==='unable_to_test'?'The tester could not complete the retest. Review their comments and supply revised instructions.':result==='still_happening'&&!retry?'Two retests failed. Developer investigation or a specific product decision is needed before another attempt.':null;
   await c.query(`UPDATE issue_reports SET tester_result=$2,tester_notes=$3,tester_retested_at=now(),management_status=$4,blocked_reason=$5,blocked_kind=$6,review_decision=CASE WHEN $2='unable_to_test' THEN 'clarify' ELSE NULL END,review_note=CASE WHEN $2='unable_to_test' THEN 'Please explain what prevented the retest and what device or example is unavailable. We will revise the steps using your reply.' ELSE NULL END,reviewed_by=NULL,repair_claim_hash=NULL,repair_lease_until=NULL,updated_at=now(),resolved_at=CASE WHEN $2='fixed' THEN now() ELSE NULL END WHERE id=$1`,[id,result,notes,status,reason,result==='unable_to_test'?'evidence':reason?'repeated_failure':null]);
   await c.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'retest',$2)",[id,JSON.stringify({result,notes,next_status:status})]);
   if(retry){await c.query('DELETE FROM issue_cloud_dispatch WHERE issue_id=$1',[id]);await c.query("INSERT INTO issue_repair_events(issue_id,event,detail) VALUES($1,'automatic_followup',$2)",[id,JSON.stringify({action:'Repair queued',notes})]);}
   await c.query('COMMIT');logEvent(req.user.id,'issue_retest',{issue_id:id,result});res.json({ok:true,status});
  }catch(e){if(c)await c.query('ROLLBACK');console.error('[issues.retest]',e.message);res.status(500).json({error:'retest failed'});}finally{c?.release();}
 });
}
module.exports={registerRetest};
