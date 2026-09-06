// ================= Shared issue reporter =================
let issueScreenshotBlob = null, issueVoiceBlob = null, issuePageName = '', issueRecognizer = null, issueMediaRecorder = null, issueMediaStream = null;
let issueGeneration = 0, issueMicPending = false;
let issueDictationActive = false, issueDictationBase = '', issueDictationRestartTimer = null, issueDictationWatchdog = null;
const issuePageLabels = { capture:'Capture', organize:'Organize', edit:'Edit', create:'Create', send:'Send', map:'Job Site Map' };
async function openIssueReporter() {
  closeIssueReporter();
  const generation=issueGeneration;
  const fab=document.getElementById('issueFab'); if(fab){fab.disabled=true;fab.textContent='Capturing...';}
  issuePageName=typeof adminIssuePageName==='function'?adminIssuePageName():(issuePageLabels[state.view]||state.view||'Photo Notes'); issueScreenshotBlob=null;issueVoiceBlob=null;
  const send=document.getElementById('issueSend'),description=document.getElementById('issueDescription'),status=document.getElementById('issueStatus');
  if(send){send.disabled=false;send.textContent='Send Issue Report';}
  if(description)description.value='';for(const id of ['issueAction','issueExpected','issueFrequency']){const field=document.getElementById(id);if(field)field.value='';}
  if(status)status.textContent='';
  try {
    if(window.html2canvas){const canvas=await window.html2canvas(document.querySelector('.wrap'),{useCORS:true,allowTaint:false,backgroundColor:'#ffffff',scale:Math.min(window.devicePixelRatio||1,1.5),logging:false});const shot=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.78));if(generation===issueGeneration)issueScreenshotBlob=shot;}
  } catch(e){if(generation===issueGeneration)issueScreenshotBlob=null;}
  const modal=document.getElementById('issueModal'); if(!modal||generation!==issueGeneration)return; modal.hidden=false;
  const record=document.getElementById('issueRecord');record.disabled=false;record.classList.remove('on');record.textContent=isIOS()?'Record Voice Description':'Speak Description';
  if(isIOS())status.textContent='Attach a voice recording, or use your keyboard microphone to enter text. Audio is not automatically transcribed.';
  document.getElementById('issueShotStatus').textContent=issueScreenshotBlob?'✓ Screenshot of this page attached':'Screenshot unavailable; your description will still be saved';
  document.getElementById('issueClose').onclick=closeIssueReporter;
  document.getElementById('issueRecord').onclick=toggleIssueDictation;
  document.getElementById('issueSend').onclick=submitIssueReport;
  document.getElementById('issueClose').focus();
  if(fab){fab.disabled=false;fab.textContent=issueFabLabel();}
}
function stopIssueMediaStream(){if(issueMediaStream){issueMediaStream.getTracks().forEach(track=>track.stop());issueMediaStream=null;}issueMediaRecorder=null;}
function closeIssueReporter(){issueGeneration++;issueMicPending=false;issueDictationActive=false;if(issueDictationRestartTimer)clearTimeout(issueDictationRestartTimer);if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationRestartTimer=null;issueDictationWatchdog=null;if(issueRecognizer){try{issueRecognizer.stop();}catch(e){}}if(issueMediaRecorder&&issueMediaRecorder.state==='recording'){try{issueMediaRecorder.stop();}catch(e){}}stopIssueMediaStream();const m=document.getElementById('issueModal');if(m)m.hidden=true;issueScreenshotBlob=null;issueVoiceBlob=null;issueRecognizer=null;}
function cleanSpeechTranscript(value){
  let words=String(value||'').trim().split(/\s+/).filter(Boolean);
  // Android speech services occasionally return the same short fragment three
  // or more times inside one result. Ordinary two-word emphasis is preserved.
  for(let size=6;size>=1;size--){
    const cleaned=[];
    for(let i=0;i<words.length;){
      const phrase=words.slice(i,i+size),key=phrase.map(w=>w.toLowerCase()).join('\u0000');
      if(phrase.length<size){cleaned.push(...phrase);break;}
      let repeats=1;
      while(i+(repeats+1)*size<=words.length&&words.slice(i+repeats*size,i+(repeats+1)*size).map(w=>w.toLowerCase()).join('\u0000')===key)repeats++;
      cleaned.push(...phrase);i+=size*(repeats>=3?repeats:1);
    }
    words=cleaned;
  }
  return words.join(' ');
}
function mergeSpeechTranscript(base,incoming){
  const left=String(base||'').trim().split(/\s+/).filter(Boolean),right=cleanSpeechTranscript(incoming).split(/\s+/).filter(Boolean);
  let overlap=0,max=Math.min(16,left.length,right.length);
  for(let size=1;size<=max;size++)if(left.slice(-size).map(w=>w.toLowerCase()).join('\u0000')===right.slice(0,size).map(w=>w.toLowerCase()).join('\u0000'))overlap=size;
  return cleanSpeechTranscript([...left,...right.slice(overlap)].join(' '));
}
async function toggleIssueDictation(){
  if(issueMicPending)return;
  const generation=issueGeneration;
  const ta=document.getElementById('issueDescription'),btn=document.getElementById('issueRecord'),SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(isIOS()&&window.MediaRecorder&&navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)return toggleIssueVoiceRecording(btn);
  if(!SR){ta.focus();toast('Use the microphone key on your keyboard to dictate');return;}
  if(issueDictationActive){issueDictationActive=false;if(issueDictationRestartTimer)clearTimeout(issueDictationRestartTimer);if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationRestartTimer=null;issueDictationWatchdog=null;if(issueRecognizer){try{issueRecognizer.stop();}catch(e){}}btn.textContent='Speak Description';btn.classList.remove('on');return;}
  if(issueRecognizer)return;
  // Safari owns the microphone permission prompt for webkitSpeechRecognition.
  // Opening getUserMedia immediately beforehand can leave iOS showing an active
  // microphone while returning no recognition results.
  issueMicPending=true;btn.disabled=true;
  if(!isIOS())try{if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());}}catch(e){if(generation===issueGeneration){issueMicPending=false;btn.disabled=false;toast('Allow microphone access for this website, then try again');}return;}
  if(generation!==issueGeneration)return;
  issueMicPending=false;btn.disabled=false;
  issueDictationActive=true;issueDictationBase=ta.value.trim();if(issueDictationBase)issueDictationBase+=' ';btn.textContent='Recording... tap to stop';btn.classList.add('on');startIssueDictationSession(SR);
}
async function toggleIssueVoiceRecording(btn){
  const status=document.getElementById('issueStatus'),generation=issueGeneration;
  if(issueMicPending)return;
  if(issueMediaRecorder&&issueMediaRecorder.state==='recording'){btn.disabled=true;btn.textContent='Saving voice recording...';issueMediaRecorder.stop();return;}
  if(issueMediaRecorder)return;
  issueMicPending=true;btn.disabled=true;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(generation!==issueGeneration){stream.getTracks().forEach(track=>track.stop());return;}
    issueMicPending=false;issueMediaStream=stream;
    const preferred=['audio/mp4','audio/webm;codecs=opus','audio/webm'].find(type=>MediaRecorder.isTypeSupported(type));
    const chunks=[],recorder=new MediaRecorder(stream,preferred?{mimeType:preferred}:undefined);issueMediaRecorder=recorder;
    recorder.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
    recorder.onstop=()=>{if(generation!==issueGeneration||issueMediaRecorder!==recorder)return;const blob=new Blob(chunks,{type:recorder.mimeType||'audio/mp4'});if(blob.size)issueVoiceBlob=blob;stopIssueMediaStream();btn.disabled=false;btn.textContent='Record Again';btn.classList.remove('on');status.textContent=blob.size?'Voice recording attached. You may also type a description.':'No voice recording was captured. Please try again.';};
    recorder.onerror=()=>{if(generation!==issueGeneration||issueMediaRecorder!==recorder)return;stopIssueMediaStream();btn.disabled=false;btn.textContent='Record Voice Description';btn.classList.remove('on');status.textContent='Voice recording stopped unexpectedly. Please try again or type the description.';};
    recorder.start(250);btn.disabled=false;btn.textContent='Recording... tap to stop';btn.classList.add('on');status.textContent='Recording your voice. Tap the blue button when you are finished.';
  }catch(e){if(generation!==issueGeneration)return;issueMicPending=false;stopIssueMediaStream();btn.disabled=false;btn.textContent='Record Voice Description';btn.classList.remove('on');status.textContent='Microphone access is required. On iPhone, allow microphone access for photonotesapp.com, then try again.';}
}
function startIssueDictationSession(SR){
  if(!issueDictationActive)return;
  const generation=issueGeneration;
  const ta=document.getElementById('issueDescription'),session=new SR(),ios=isIOS();issueRecognizer=session;session.lang=uiSpeechLanguage();session.continuous=!ios;session.interimResults=!ios;let sessionText='';
  if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationWatchdog=setTimeout(()=>{if(issueRecognizer!==session||sessionText)return;issueDictationActive=false;try{session.stop();}catch(e){}const b=document.getElementById('issueRecord'),s=document.getElementById('issueStatus');if(b){b.textContent='Speak Description';b.classList.remove('on');}if(s)s.textContent='No speech was received. On iPhone, tap the text box and use the microphone on the keyboard, or try again.';},10000);
  session.onresult=e=>{if(generation!==issueGeneration||issueRecognizer!==session)return;if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationWatchdog=null;const parts=[];for(let i=0;i<e.results.length;i++)parts.push(e.results[i][0].transcript.trim());sessionText=cleanSpeechTranscript(parts.filter(Boolean).join(' '));if(ta)ta.value=mergeSpeechTranscript(issueDictationBase,sessionText);};
  session.onerror=e=>{if(generation!==issueGeneration||issueRecognizer!==session)return;const err=e&&e.error;if(err==='not-allowed'||err==='service-not-allowed'){toast('Allow microphone access for this website, then try again');issueDictationActive=false;}else if(err==='audio-capture'||err==='network'){toast('Recording stopped. You can continue by typing or try again');issueDictationActive=false;}else if(err!=='aborted'&&err!=='no-speech'){toast('Recording stopped. You can continue by typing or try again');issueDictationActive=false;}};
  session.onend=()=>{if(generation!==issueGeneration||issueRecognizer!==session)return;if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationWatchdog=null;if(issueRecognizer===session)issueRecognizer=null;if(sessionText){issueDictationBase=mergeSpeechTranscript(issueDictationBase,sessionText);if(issueDictationBase)issueDictationBase+=' ';}if(issueDictationActive&&!ios){const b=document.getElementById('issueRecord');if(b)b.textContent='Listening... tap to stop';issueDictationRestartTimer=setTimeout(()=>startIssueDictationSession(SR),300);}else{issueDictationActive=false;const b=document.getElementById('issueRecord');if(b){b.textContent='Speak Description';b.classList.remove('on');}if(ios&&sessionText){const s=document.getElementById('issueStatus');if(s)s.textContent='Description added. Tap Speak Description to continue.';}}};
  try{session.start();}catch(e){issueDictationActive=false;issueRecognizer=null;const b=document.getElementById('issueRecord');if(b){b.textContent='Speak Description';b.classList.remove('on');}}
}
async function submitIssueReport(){
  const status=document.getElementById('issueStatus');
  if(document.getElementById('issueSend').disabled)return;
  if(issueMicPending){status.textContent='Finish the microphone permission prompt before sending.';return;}
  if(issueMediaRecorder){if(issueMediaRecorder.state==='recording')toggleIssueVoiceRecording(document.getElementById('issueRecord'));status.textContent='Finishing your recording. Tap Send Issue Report again when it is attached.';return;}
  if(issueRecognizer||issueDictationActive){issueDictationActive=false;if(issueDictationRestartTimer)clearTimeout(issueDictationRestartTimer);if(issueRecognizer)try{issueRecognizer.stop();}catch(e){}status.textContent='Finishing dictation. Review the text, then tap Send Issue Report again.';return;}
  const generation=issueGeneration;

  issueDictationActive=false;if(issueDictationRestartTimer)clearTimeout(issueDictationRestartTimer);if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationRestartTimer=null;issueDictationWatchdog=null;
  if(issueRecognizer){try{issueRecognizer.stop();}catch(e){}}
  const ta=document.getElementById('issueDescription'),whatHappened=ta.value.trim(),action=document.getElementById('issueAction').value.trim(),expected=document.getElementById('issueExpected').value.trim(),frequency=document.getElementById('issueFrequency').value,btn=document.getElementById('issueSend'),st=document.getElementById('issueStatus');
  const description=[action&&`Trying to do: ${action}`,whatHappened&&`What happened: ${whatHappened}`,expected&&`Expected: ${expected}`,frequency&&`Frequency: ${frequency}`].filter(Boolean).join('\n');
  if(!whatHappened&&!issueVoiceBlob){st.textContent='Please type what went wrong or attach a voice recording before sending.';ta.focus();return;}
  btn.disabled=true;btn.textContent='Sending...';st.textContent='Saving your report...';
  try{const fd=new FormData();fd.append('description',description||'Voice recording attached for review.');fd.append('page_name',issuePageName);fd.append('page_url',location.href);fd.append('viewport',`${window.innerWidth} × ${window.innerHeight}`);fd.append('user_agent',navigator.userAgent);if(issueScreenshotBlob)fd.append('screenshot',issueScreenshotBlob,'issue-screen.jpg');if(issueVoiceBlob)fd.append('voice',issueVoiceBlob,issueVoiceBlob.type.includes('webm')?'issue-voice.webm':'issue-voice.m4a');const r=await api('/api/issues',{method:'POST',body:fd});const d=await r.json().catch(()=>({}));if(generation!==issueGeneration)return;if(!r.ok)throw new Error();st.textContent=d.email_status==='sent'?`Issue #${d.id} sent. Thank you.`:`Issue #${d.id} saved. Thank you.`;btn.textContent='Sent';setTimeout(()=>{if(generation===issueGeneration)closeIssueReporter();},1800);}catch(e){if(generation!==issueGeneration)return;st.textContent='The report could not be sent. Check your connection and try again.';btn.disabled=false;btn.textContent='Send Issue Report';}
}

function issueReporterMarkup(){return `    <div class="issue-modal" id="issueModal" hidden data-html2canvas-ignore="true">
      <div class="issue-dialog" role="dialog" aria-modal="true" aria-labelledby="issueTitle">
        <button class="issue-close" id="issueClose" type="button" aria-label="Close">×</button>
        <h2 id="issueTitle">Report Issue</h2>
        <p class="status">Answer these short questions. Photo Notes attaches the page and device details automatically.</p>
        <div class="issue-shot-status" id="issueShotStatus">Capturing this page...</div>
        <label for="issueAction">What were you trying to do?</label>
        <input id="issueAction" type="text" placeholder="For example: record a note after taking a photo">
        <label for="issueDescription">What went wrong?</label>
        <button class="btn" id="issueRecord" type="button">Speak Description</button>
        <textarea id="issueDescription" placeholder="Describe the problem in detail..."></textarea>
        <label for="issueExpected">What did you expect to happen?</label>
        <input id="issueExpected" type="text" placeholder="Tell us what should have happened">
        <label for="issueFrequency">How often does it happen?</label>
        <select id="issueFrequency"><option value="">Choose one</option><option>Every time</option><option>Sometimes</option><option>Only happened once</option><option>Not sure</option></select>
        <button class="btn" id="issueSend" type="button">Send Issue Report</button>
        <div class="status" id="issueStatus" role="status" aria-live="polite"></div>
      </div>
    </div>`;}
