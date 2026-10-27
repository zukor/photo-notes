// Super Admin: Record Notes reliability from content-free recording outcomes.
(()=>{
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=(a,b)=>b?`${(100*a/b).toFixed(1)}%`:'None';
const LABEL={live:'Worked live',recovered:'Recovered from saved audio',retried:'Transcribed later',kept:'Saved, waiting to retry',failed:'Failed',empty:'No speech',cancelled:'Cancelled',interrupted:'Interrupted'};
const SURFACE={capture:'Record Notes',feedback:'Send Feedback',issue:'Report Issue',ewr:'Extra Work',selftest:'Self-test'};
const APP=mode=>mode==='ios-app'?'iPhone app':mode==='installed'?'Home Screen app':'Browser';
// Reason codes in plain English. Unknown codes are shown as sent.
const CODE={background:'App left the screen','mic-ended':'Microphone ended','mic-muted':'Microphone muted by the phone','audio-interrupted':'Phone audio interrupted','audio-suspended':'Phone audio paused','left-screen':'Screen closed while checking',
 'token-failed':'Live session could not start','ws-closed':'Live connection closed','ws-timeout':'Live connection timed out','ws-not-finished':'Live connection did not finish','ws-provider-error':'Live service error','send-failed':'Audio could not be sent',reconnected:'Reconnected during the note','no-live-text':'No live words','recheck-failed':'Check against recording failed',
 'mic-denied':'Microphone not allowed','mic-silent':'Microphone sent no sound','no-audio-suspended':'Audio did not start (paused)','no-audio-interrupted':'Audio did not start (interrupted)','no-audio-running':'Audio did not start','background-short':'Left the screen right away',
 'upload-network':'No connection for the recording','upload-offline':'Phone was offline','upload-hidden':'App was off screen','upload-timeout':'Recording check timed out','upload-429-rate-limit':'Too many recordings','upload-415-unsupported-format':'Unsupported audio format'};
const plain=c=>c?(CODE[c]||c):'';
window.PhotoNotesAdminRecordNotes={mount(host,api){
 if(!host)return;
 host.innerHTML=`<style>#recordNotesReliabilityHost,#recordNotesReliabilityHost *{color:#000!important;text-align:left}#recordNotesReliabilityHost select{background:#fff!important}#recordNotesReliabilityHost button{background:#ffe600!important}#recordNotesReliabilityHost table{width:100%;border-collapse:collapse}#recordNotesReliabilityHost td,#recordNotesReliabilityHost th{border-bottom:1px solid #000;padding:4px}</style>
 <details class="admin-section" data-admin-tool="record-notes-reliability"><summary id="recordNotesReliabilityHeading">Record Notes Reliability</summary><div class="admin-section-body" style="background:white">
 <p>Every recording reports how it ended, without any words or audio. Success means the words reached the note, either live or recovered from the saved recording. Not transcribed means the recording is still waiting on the device or failed. Cancelled and no-speech recordings are not counted in the rate.</p>
 <label for="recordNotesDays">Period</label> <select id="recordNotesDays"><option value="1">Last 24 hours</option><option value="7" selected>Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
 <button type="button" class="btn" id="recordNotesRefresh">Refresh</button><div id="recordNotesResults" aria-live="polite">Loading...</div></div></details>`;
 const out=host.querySelector('#recordNotesResults');
 const table=(head,rows)=>`<table><thead><tr>${head.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${head.length}">No recordings in this period.</td></tr>`}</tbody></table>`;
 const row=values=>`<tr>${values.map(v=>`<td>${escape(v)}</td>`).join('')}</tr>`;
 async function load(){
  out.textContent='Loading...';
  try{
   const r=await api('/api/admin/record-notes-reliability?days='+host.querySelector('#recordNotesDays').value);if(!r.ok)throw Error('Reliability could not be loaded');
   const d=await r.json();
   const counted=d.totals.filter(t=>!['cancelled','empty','retried'].includes(t.outcome));
   const total=counted.reduce((n,t)=>n+t.count,0),ok=counted.filter(t=>['live','recovered'].includes(t.outcome)).reduce((n,t)=>n+t.count,0);
   out.innerHTML=`<h3>Success rate: ${pct(ok,total)} of ${total} recordings</h3>`
    +table(['Outcome','Recordings'],d.totals.map(t=>row([LABEL[t.outcome]||t.outcome,t.count])))
    +'<h3>By device</h3>'+table(['Device','Browser','App','Recordings','Success','Recovered','Not transcribed','Transcribed later','Interrupted'],d.devices.map(x=>row([x.os,x.browser,APP(x.mode),x.recordings,pct(x.succeeded,x.recordings),x.recovered,x.not_transcribed,x.transcribed_later??0,x.interrupted])))
    +'<h3>Reasons by device</h3>'+table(['Device','Browser','App','Outcome','Interrupted by','Reason','Why not transcribed','Recordings'],(d.reasons||[]).map(x=>row([x.os,x.browser,APP(x.mode),LABEL[x.outcome]||x.outcome,plain(x.cause),plain(x.reason),plain(x.fallback),x.count])))
    +'<h3>By app version</h3>'+table(['Version','Recordings','Not transcribed'],d.versions.map(x=>row([x.version,x.recordings,x.not_transcribed])))
    +'<h3>Recent problems</h3>'+table(['When','Person','Where','Outcome','Device','App','Reason','Why not transcribed','Length'],d.problems.map(p=>row([new Date(p.created_at).toLocaleString(),p.name||p.email||'',SURFACE[p.detail.surface]||p.detail.surface,(LABEL[p.detail.outcome]||p.detail.outcome)+(p.detail.interrupted?' (interrupted)':''),`${p.detail.os} ${p.detail.os_version||''} ${p.detail.browser}`.trim(),APP(p.detail.mode),[p.detail.cause&&p.detail.cause!==p.detail.reason?plain(p.detail.cause):'',plain(p.detail.reason)].filter(Boolean).join(', ')+(p.detail.restored?' (app was reopened)':''),plain(p.detail.fallback),`${p.detail.seconds||0} s`])));
  }catch(e){out.textContent=e.message;}
 }
 host.querySelector('#recordNotesRefresh').onclick=load;host.querySelector('#recordNotesDays').onchange=load;load();
}};
})();
