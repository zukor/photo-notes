(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.PhotoNotesIssuePresentation=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 const resultLabel=result=>({fixed:'Retest Succeeded',still_happening:'Retest Failed',unable_to_test:'Unable to Retest'}[result]||'Result Not Recorded');
 function title(issue){
  const description=String(issue.description||'');
  const current=description.match(/Current Result:\s*([\s\S]*?)(?=\n\s*Frequency:|$)/i);
  const problem=description.match(/(?:What happened|What went wrong)\s*[:?]\s*([\s\S]*?)(?=\n\s*(?:Expected|Frequency)\s*:|$)/i);
  const source=String(current?.[1]||problem?.[1]||description).replace(/^(?:What happened|What went wrong|Describe issue)\s*[:?]\s*/i,'').replace(/\s+/g,' ').trim();
  const phrase=source.split(/(?<=[.!?])\s|\s(?:Expected Result|Frequency):/)[0];
  if(!phrase)return (issue.page_name||'Photo Notes')+' issue';
  if(phrase.length<=85)return phrase.replace(/[.!?]$/,'');
  const short=phrase.slice(0,82).replace(/\s+\S*$/,'');return short+'…';
 }
 function rounds(issue){
  const out=[];let current;
  const start=(data,date)=>{current={fix:data.fix_summary||'',verified:!!data.verified,instructions:data.retest_instructions||data.instructions||'',date,comments:[],decisions:[]};out.push(current);};
  for(const event of issue.progress_events||[]){
   const d=event.detail||{};
   if(['ready_to_test','bug_review_retest','ui_review_retest','automatic_retest_requested'].includes(event.event))start({...d,verified:event.event==='ready_to_test'},event.created_at);
   else if(event.event==='retest'){if(!current)start({},null);current.comments.push({notes:d.notes,result:d.result,date:event.created_at});}
   else if(current&&/^(bug|ui)_review_/.test(event.event)&&d.instructions)current.decisions.push({action:d.decision,notes:d.instructions,date:event.created_at});
  }
  if(!out.length&&(issue.fix_summary||issue.retest_instructions||issue.tester_result||issue.tester_notes)){
   start({fix_summary:issue.fix_summary,retest_instructions:issue.retest_instructions,verified:!!(issue.verification&&issue.release_reference)},null);
   for(const reply of issue.retest_comments||[])current.comments.push({notes:reply.notes,result:reply.result,date:reply.created_at});
   if(!current.comments.length&&(issue.tester_result||issue.tester_notes))current.comments.push({notes:issue.tester_notes,result:issue.tester_result,date:issue.tester_retested_at});
  }
  return out;
 }
 return {title,rounds,resultLabel};
});
