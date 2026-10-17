/* Record Notes self-test: ten live recordings in a row with automatic pass/fail.
   Uses the same engine as Capture. Outcomes are reported without words or audio. */
(()=>{
'use strict';
const SENTENCES=[
 'The driveway crack is near the north gate.',
 'Measure the patio at twelve feet by sixteen feet.',
 'The curb and gutter need repair before Friday.',
 'Take a photo of the drainage problem by the pool.',
 'Rebar spacing is eighteen inches on center.',
 'The sidewalk panel is lifted about two inches.',
 'Call the property manager about the broken sprinkler.',
 'Seal the parking lot cracks after the rain stops.',
 'The retaining wall shows water stains on the left side.',
 'This is the last test sentence for Record Notes.'];
const TOTAL=SENTENCES.length,MAX_SECONDS=15;
const el=id=>document.getElementById('selfTest'+id);
const L=window.PhotoNotesLiveTranscription;
let index=0,results=[],active=null;
const status=text=>{el('Status').textContent=text;};
const words=text=>String(text||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(Boolean);
function matched(expected,heard){const want=words(expected),got=new Set(words(heard));return want.length?want.filter(w=>got.has(w)).length/want.length:0;}

function showCycle(){
 el('Cycle').hidden=index>=TOTAL;
 if(index>=TOTAL){finish();return;}
 el('Step').textContent=`Test ${index+1} of ${TOTAL}. Tap Start Recording, read this sentence, then tap Stop.`;
 el('Sentence').textContent=SENTENCES[index];el('Heard').textContent='';
 el('Record').disabled=false;el('Record').textContent='Start Recording';
}
function render(){
 const body=el('Results').querySelector('tbody');body.replaceChildren();
 for(const r of results){const tr=document.createElement('tr');for(const v of [r.test,r.passed?'Passed':'Failed',r.how,r.firstWords,`${Math.round(r.match*100)}%`]){const td=document.createElement('td');td.textContent=v;tr.append(td);}body.append(tr);}
 el('Results').hidden=!results.length;
}
function summaryText(){
 const passed=results.filter(r=>r.passed).length;
 return `Record Notes self-test: ${passed} of ${results.length} passed. Device: ${el('Device').value.trim()||'not entered'}. ${navigator.userAgent}. `+results.map(r=>`Test ${r.test}: ${r.passed?'passed':'FAILED'} (${r.how}, first words ${r.firstWords}, ${Math.round(r.match*100)}% matched)`).join('; ');
}
function finish(){
 const passed=results.filter(r=>r.passed).length;
 el('Summary').textContent=passed===TOTAL?`All ${TOTAL} tests passed.`:`${passed} of ${TOTAL} tests passed. Use Copy Results and paste them into a Report Issue report.`;
 el('Copy').hidden=false;el('Reset').hidden=false;status('Self-test finished.');
}
function record(){
 if(active){active.stop();return;}
 const recognizer=new L.Recognizer();
 L.unlock();
 const started=Date.now(),test=index+1;let firstAt=0,text='',how='live',ended=false;
 active={stop(){el('Record').disabled=true;el('Record').textContent='Finishing...';try{recognizer.stop();}catch{}}};
 recognizer.surface='selftest';recognizer.lang=document.documentElement.lang||'en-US';
 recognizer.onstart=()=>{el('Record').textContent='Stop';status('Listening. Read the sentence now.');};
 recognizer.onresult=e=>{text=e.results[0][0].transcript;if(text&&!firstAt)firstAt=Date.now();el('Heard').textContent=text;};
 recognizer.onstatus=e=>{if(e.state==='offline'){how='reconnected';status('Connection lost. Still recording.');}else if(e.state==='transcribing'){how=how==='live'?'checked against recording':how;status('Checking the words against the recording...');}else if(e.state==='kept'){how='saved for later';}};
 recognizer.onerror=e=>{status(e.error==='not-allowed'?'Microphone access was not allowed. Allow it in your browser or phone settings, then tap Run Again.':'The microphone stopped.');};
 recognizer.onend=()=>{
  if(ended)return;ended=true;clearTimeout(limit);active=null;
  const score=matched(SENTENCES[index],text);
  results.push({test,passed:score>=0.6,how,firstWords:firstAt?`${((firstAt-started)/1000).toFixed(1)} s`:'none',match:score});
  render();index++;showCycle();
 };
 const limit=setTimeout(()=>{if(active)active.stop();},MAX_SECONDS*1000);
 el('Record').textContent='Starting microphone...';
 try{recognizer.start();}catch{status('The recording could not start.');active=null;}
}
el('Record').onclick=record;
el('Copy').onclick=async()=>{try{await navigator.clipboard.writeText(summaryText());el('Copy').textContent='Copied';}catch{status(summaryText());}};
el('Reset').onclick=()=>{index=0;results=[];render();el('Summary').textContent='';el('Copy').hidden=true;el('Copy').textContent='Copy Results';el('Reset').hidden=true;status('Ready.');showCycle();};
fetch('/api/me',{credentials:'same-origin',cache:'no-store'}).then(r=>{if(!r.ok)throw Error('signed out');return L.refresh();}).catch(()=>null).then(config=>{
 if(!config){status('Sign in to PhotoNotes in this browser or app first, then reopen this page.');return;}
 if(!config.live){status('Live transcription is not available. Sign in to PhotoNotes in this browser first, then reopen this page.');return;}
 status('Ready.');showCycle();
});
})();
