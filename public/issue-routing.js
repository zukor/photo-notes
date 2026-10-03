(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PhotoNotesIssueRouting=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 const closed=new Set(['resolved','tester_confirmed','wont_fix']);
 const ideas=new Set(['ui_improvement','feature_improvement','new_feature']);
 function failures(i){return Number(i.failed_attempts)||0;}
 function disposition(i){
  if(closed.has(i.management_status))return 'closed';
  if(i.review_decision==='clarify'||i.management_status==='retest_requested'||(i.management_status==='ready_to_test'&&i.release_reference&&i.verification))return 'waiting';
  if(ideas.has(i.issue_type)&&i.review_decision!=='implement')return 'ideas';
  if(i.management_status==='ready_to_test')return 'decision';
  if(i.management_status!=='blocked')return 'working';
  if(i.blocked_kind==='developer')return 'developer';
  return 'decision';
 }
 function priority(i){
  const text=[i.description,i.tester_notes].join(' ').toLowerCase();
  if(/data loss|lost photos|photos.*disappear|different job|another job|wrong (job|customer)|data mixing/.test(text))return {score:100,reason:'Risk of lost photos or evidence assigned to the wrong job'};
  if(i.priority==='urgent')return {score:95,reason:'Marked urgent'};
  if(/cannot sign in|could not sign in|unable to (save|record)|cannot (save|open)|does not load|did not load/.test(text))return {score:85,reason:'A core workflow is blocked'};
  if(failures(i)>=2)return {score:80,reason:'Repeated unsuccessful attempts need investigation'};
  if(Number(i.affected_testers)>1)return {score:75,reason:'Reported by '+i.affected_testers+' testers'};
  if(i.priority==='high')return {score:70,reason:'Marked high priority'};
  if(i.tester_result==='still_happening')return {score:60,reason:'The tester reports the problem still happens'};
  return {score:i.priority==='low'?10:40,reason:'Standard priority; oldest reports first'};
 }
 function summary(i){
  const lane=disposition(i),p=priority(i);
  const last=(i.progress_events||[]).filter(e=>['ready_to_test','blocked','fixing','testing','reviewing'].includes(e.event)).at(-1);
  const deployed=!!(i.release_reference&&i.verification);
  const attempt=last?.event==='blocked'?'A repair attempt stopped before a verified fix.':last?.event==='ready_to_test'?'A fix was verified and deployed.':last?'Investigation or repair was recorded.':i.admin_notes?'Attempt notes are available in the history.':'No repair attempt is recorded.';
  const latest=(i.retest_comments||[]).at(-1);
  let reply=latest?{text:latest.notes||'No written comments provided.',result:latest.result,date:latest.created_at}:i.tester_result?{text:i.tester_notes||'No written comments provided.',result:i.tester_result,date:i.tester_retested_at}:null;
  const clarification=(i.progress_events||[]).filter(e=>e.event==='reporter_details').at(-1);if(clarification&&(!reply||Date.parse(clarification.created_at)>Date.parse(reply.date||0)))reply={text:clarification.detail?.notes||i.reporter_details,result:'clarification',date:clarification.created_at};
  let actor='Repair worker',action='Investigate the report and record the next result.';
  if(lane==='closed'){actor='No one';action=i.management_status==='wont_fix'?'Closed without a fix.':'Closed. Check the confirmation in the history.';}
  else if(lane==='waiting'){actor='Tester';action=i.review_decision==='clarify'?'Answer the question shown below.':'Repeat the supplied test steps and submit the result.';}
  else if(lane==='ideas'){actor='Sam';action='Decide whether to implement this idea or close it.';}
  else if(lane==='developer'){actor='Developer';action='Investigate the technical blocker. Another restricted cloud attempt will not resolve it.';}
  else if(lane==='decision'){actor='Sam';action=failures(i)>=2?'Repeated attempts failed. Choose developer investigation, revised instructions, or closure.':i.blocked_reason||'Review the reported behavior and choose a concrete next action.';}
  else if(i.repair_lease_until&&Date.parse(i.repair_lease_until)>Date.now())action='A worker has an active repair lease. Wait for its result.';
  else action='Queued for investigation. No active worker lease is recorded.';
  return {lane,priority:p,attempt,deployed,reply,actor,action};
 }
 return {disposition,priority,summary,failures};
});
