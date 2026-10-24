/* My Issue Reports: the one renderer for a person's own issue reports and retests. The app's Testing Dashboard
   and the Testing Dashboard page for testing managers and the Super Admin both use it. */
function myIssueText(text){return typeof uiT==='function'?uiT(text):text;}
function myIssueLocale(){return typeof uiLocale==='function'?uiLocale():undefined;}
let myIssueRerender=()=>{};
const MY_ISSUE_STATUS={retest_requested:'Retest Requested',blocked:'Needs attention',new:'Received',reviewing:'Automatic Repair Review',fixing:'Working',testing:'Testing',ready_to_test:'Deployed - awaiting your confirmation',tester_confirmed:'Closed - you confirmed',resolved:'Closed - no verified fix',wont_fix:'Closed without a fix'};
let myIssueFilter='open';
function reporterIssueDescription(description){
  // Older reports keep diagnostic evidence in the description for developers.
  // Reporter cards show only the authored report, including legacy truncated logs.
  return String(description||'').split(/\r?\n\s*\r?\nVoice-note diagnostics \(no note text or audio\):\r?\n/)[0];
}
async function renderMyIssueList(body,options={}){
  myIssueRerender=()=>renderMyIssueList(body,options);
  body.innerHTML=(options.back?'<button class="backlink" id="issuesBack">← Back</button>':'')+'<div class="workflow-intro"><strong>'+ 'My Issue Reports' +'</strong><span>See what you reported, whether it has been fixed, and what needs another test.</span></div><label for="myIssueFilter">'+myIssueText('Show issues')+'</label><select id="myIssueFilter"><option value="open">'+myIssueText('Open issues')+'</option><option value="closed">'+myIssueText('Closed issues')+'</option><option value="all">'+myIssueText('All issues')+'</option></select>'+issueNotificationControls()+'<div id="myIssueList"><p class="status">Loading your reports...</p></div>';
  const issuesBack=document.getElementById('issuesBack');if(issuesBack&&options.back)issuesBack.onclick=options.back;
  const filter=document.getElementById('myIssueFilter'),box=document.getElementById('myIssueList');
  filter.value=myIssueFilter;
  filter.onchange=()=>{myIssueFilter=filter.value;};
  const r=await api('/api/issues/mine');
  if(!box.isConnected)return;
  if(!r.ok){box.innerHTML='<p class="status">Your issue reports could not be loaded.</p>';return;}
  const rows=await r.json();
  if(!box.isConnected)return;
  box.innerHTML=rows.length?rows.map(i=>`<article class="card tester-issue-card" data-issue-closed="${['resolved','tester_confirmed','wont_fix'].includes(i.management_status)}">${i.retest_reminder_at&&['ready_to_test','retest_requested'].includes(i.management_status)?'<p><strong>Retest reminder:</strong> Please submit your result on this original issue. Reminders repeat every four hours until you reply.</p>':''}<div class="tester-issue-head"><strong>Issue #${i.id}: ${esc(i.page_name||'Photo Notes')}</strong><span class="badge issue-status-${esc(i.management_status||'new')}">${esc(i.management_status==='blocked'&&i.review_decision==='clarify'?'Clarification Requested':i.management_status==='blocked'&&['developer','repeated_failure','retry'].includes(i.blocked_kind)?'Developer Investigation':i.management_status==='ready_to_test'&&(!i.verification||!i.release_reference)?'Ready status needs verification':(['ui_improvement','feature_improvement','new_feature'].includes(i.issue_type)?(i.management_status==='wont_fix'?'Closed - No Change':i.review_decision==='clarify'?'Clarification Requested':i.review_decision==='implement'&&i.management_status==='new'?'Approved For Implementation':i.management_status==='new'?'Awaiting Sam Review':MY_ISSUE_STATUS[i.management_status]):MY_ISSUE_STATUS[i.management_status])||'Received')}</span></div><div class="meta">Reported ${new Date(i.created_at).toLocaleString(myIssueLocale())}</div><p>${esc(reporterIssueDescription(i.description))}</p>${i.result_screenshot_path?`<details><summary data-issue-result-evidence>Show Result Screenshot</summary><a href="${esc(i.result_screenshot_path)}" target="_blank" rel="noopener" data-issue-result-evidence><img loading="lazy" src="${esc(i.result_screenshot_path)}" alt="Result screenshot supplied by the reporter" style="max-width:100%;height:auto"></a></details>`:''}${i.management_status==='blocked'&&(i.review_decision==='clarify'||i.issue_type!=='bug_problem')?`<div class="issue-fix-summary"><strong>${i.review_decision==='clarify'?'Question About Your Report':'What stopped and what happens next'}</strong><p style="white-space:pre-wrap">${esc(i.blocked_reason||'Please add reproduction details.')}</p><label for="issueDetailsResult-${i.id}">Result of your check</label><select id="issueDetailsResult-${i.id}"><option value="details">Providing more information</option><option value="fixed">I retested and it is now working</option></select><label for="issueDetails-${i.id}">Your reply and what you tested</label><textarea id="issueDetails-${i.id}" maxlength="5000"></textarea><button class="btn" data-issue-details="${i.id}">Send Details for Review</button></div>`:''}${i.management_status==='blocked'&&i.issue_type==='bug_problem'&&i.review_decision!=='clarify'?'<p>Your report and latest test result are saved. The responsible developer or owner must review them before another test is requested. No additional details are requested from you right now.</p>':''}${i.management_status==='new'&&i.issue_type==='bug_problem'&&i.tester_result==='still_happening'?'<p>'+myIssueText('Your failed retest was received and this report is queued for another repair attempt. You do not need to submit a new report.')+'</p>':''}${i.management_status==='wont_fix'&&i.review_note?`<div class="issue-fix-summary"><strong>Reason For No Change</strong><p>${esc(i.review_note)}</p></div>`:''}${i.fix_summary?`<div class="issue-fix-summary"><strong>What changed</strong><span>${esc(i.fix_summary)}</span></div>`:''}${i.deployed_at&&i.management_status!=='retest_requested'?`<div class="meta">Deployed: ${new Date(i.deployed_at).toLocaleString(myIssueLocale())}</div>`:''}<details data-issue-history="${i.id}"><summary>Issue history</summary><div>Open to load history.</div></details>${i.release_reference?`<div class="meta">Release: ${esc(i.release_reference)}</div>`:''}${i.management_status==='retest_requested'||(i.management_status==='ready_to_test'&&i.verification&&i.release_reference)?`<div class="issue-retest"><strong>${i.management_status==='retest_requested'?'Please Retest':'How to retest'}</strong><p style="white-space:pre-wrap">${esc(i.retest_instructions||'Refresh Photo Notes and repeat the steps that caused the problem.')}</p><label for="retestNotes-${i.id}">Comments After Retesting</label><textarea id="retestNotes-${i.id}" placeholder="Describe what you tested, what happened, or why you could not complete the test."></textarea><div class="issue-retest-actions"><button class="btn" type="button" data-retest-fixed="${i.id}">Retest Succeeded</button><button class="btn secondary" type="button" data-retest-broken="${i.id}">Retest Failed</button><button class="btn secondary" type="button" data-retest-unable="${i.id}">Unable to Retest</button></div></div>`:i.tester_result?`<div class="meta">Your retest: ${i.tester_result==='fixed'?'Retest Succeeded':i.tester_result==='unable_to_test'?'Unable to Retest':'Retest Failed'}${i.tester_notes?' - '+esc(i.tester_notes):''}</div>`:''}</article>`).join(''):'<p class="status">You have not submitted any issue reports yet.</p>';
  const empty=document.createElement('p');
  empty.className='status';empty.setAttribute('role','status');box.appendChild(empty);
  const applyFilter=()=>{
    let visible=0;
    box.querySelectorAll('.tester-issue-card').forEach(card=>{
      card.hidden=myIssueFilter!=='all'&&card.dataset.issueClosed!==(myIssueFilter==='closed'?'true':'false');
      if(!card.hidden)visible++;
    });
    empty.hidden=!rows.length||visible>0;
    empty.textContent=myIssueText(myIssueFilter==='closed'?'No closed issues.':'No open issues.');
  };
  filter.onchange=()=>{myIssueFilter=filter.value;applyFilter();};
  applyFilter();
  box.querySelectorAll('[data-issue-history]').forEach(details=>details.ontoggle=async()=>{
    if(!details.open||details.dataset.loaded)return;const target=details.querySelector('div');
    try{const r=await api(`/api/issues/${details.dataset.issueHistory}/history`);if(!r.ok)throw Error();const rows=await r.json();target.innerHTML=rows.map(h=>`<p>${esc(MY_ISSUE_STATUS[h.event]||h.event)}: ${new Date(h.created_at).toLocaleString(myIssueLocale())}</p>`).join('')||'No repair activity yet.';details.dataset.loaded='1';}catch{target.textContent='History could not be loaded. Close and reopen to retry.';}
  });
  box.querySelectorAll('[data-issue-details]').forEach(b=>b.onclick=async()=>{const id=b.dataset.issueDetails;b.disabled=true;try{const r=await api(`/api/issues/${id}/details`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({details:speechRetestEvidence(document.getElementById(`issueDetails-${id}`).value),result:document.getElementById(`issueDetailsResult-${id}`).value})});if(!r.ok)throw new Error();await myIssueRerender();}catch(e){toast('Details could not be saved. Enter details and try again.');b.disabled=false;}});
  box.querySelectorAll('[data-retest-fixed]').forEach(b=>b.onclick=()=>submitIssueRetest(Number(b.dataset.retestFixed),'fixed',b));
  box.querySelectorAll('[data-retest-unable]').forEach(b=>b.onclick=()=>submitIssueRetest(Number(b.dataset.retestUnable),'unable_to_test',b));
  box.querySelectorAll('[data-retest-broken]').forEach(b=>b.onclick=()=>submitIssueRetest(Number(b.dataset.retestBroken),'still_happening',b));
}
function speechRetestEvidence(notes) {
  if(!/record|speech|microphone|dictat/i.test(notes))return notes;
  try {
    const history=JSON.parse(localStorage.getItem('photoNotesSpeechDiagnostics')||'[]');
    if(!Array.isArray(history))return notes;
    const recent=history.filter(e=>e&&Date.now()-Date.parse(e.at)<3600000).slice(-120).filter((e,i,rows)=>!['result','started'].includes(e.event)||i===0||i===rows.length-1||rows[i-1].event!==e.event||rows[i+1].event!==e.event||rows[i-1].generation!==e.generation||rows[i+1].generation!==e.generation).map(e=>({at:e.at,version:e.version,event:e.event,generation:e.generation,active:e.active,pending:e.pending,finishing:e.finishing,mode:e.mode,...(['error','start-error','stop-error','permission-error'].includes(e.event)&&['aborted','no-speech','audio-capture','network','not-allowed','service-not-allowed','language-not-supported','InvalidStateError','NotAllowedError','NotFoundError','NotReadableError'].includes(e.detail)?{error:e.detail}:{})}));
    const heading='\n\nSpeech event diagnostics (no note text or audio):\n';
    while(recent.length&&notes.length+heading.length+JSON.stringify(recent).length>5000)recent.shift();
    return recent.length?notes+heading+JSON.stringify(recent):notes;
  }catch{return notes;}
}
async function submitIssueRetest(id,result,button){
  const notes=((document.getElementById(`retestNotes-${id}`)||{}).value||'').trim();
  if(result!=='fixed'&&!notes){toast('Explain what still happens or what prevented the test, including the steps and result.');document.getElementById(`retestNotes-${id}`)?.focus();return;}
  button.disabled=true;
  try{const r=await api(`/api/issues/${id}/retest`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({result,notes:result==='still_happening'?speechRetestEvidence(notes):notes})});
  if(r.ok){toast(result==='fixed'?'Thank you. The fix is confirmed.':'Thank you. Your result and comments were sent for review.');myIssueRerender();refreshIssueAttention();}
  else{toast('Your retest result could not be saved');button.disabled=false;}}catch{toast('Your retest result could not be saved');button.disabled=false;}
}
