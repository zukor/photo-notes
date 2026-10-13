/* Customer feedback uses the existing issue submission and screenshot editor. */
(() => {
'use strict';
const categories=[['problem','🐞','Something isn’t working','Report a problem or unexpected result.'],['idea','💡','I have an idea','Suggest a new feature or improvement.'],['workflow','⇄','Help with our workflow','Tell us about a business process we could improve.'],['other','💬','Other feedback','Share an observation or general comment.']];
let editor=null,blob=null,generation=0,returnFocus=null,recognizer=null,speechFinish=null,speechWanted=false,speechRestart=null,emptySessions=0;
const el=id=>document.getElementById(id);
let speechDocument=null,speechReady=false;
const isolatedSpeech=()=>/iP(hone|ad|od)/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
function speechButton(){
 const button=el('feedbackDictate');if(!button)return;
 button.textContent=speechFinish?'Finishing dictation...':speechWanted?'Stop dictation':speechDocument&&!speechReady?'Preparing microphone...':'Dictate feedback';
 button.disabled=!!speechFinish||(!speechWanted&&!!speechDocument&&!speechReady)||el('feedbackSend').disabled;
}
function prepareSpeech(){
 if(!isolatedSpeech()||!window.PhotoNotesSpeechDocument?.create){speechButton();return;}
 if(!speechDocument)speechDocument=window.PhotoNotesSpeechDocument.create();
 speechDocument.prepare(({ready,failed})=>{speechReady=ready;speechButton();if(failed&&el('feedbackDialog').open&&!el('feedbackStatus').textContent)el('feedbackStatus').textContent='The microphone could not initialize. Close Feedback and reopen it to try again. Your text is kept until you close.';});
}
function releaseSpeech(){
 const current=recognizer;recognizer=null;
 if(current)try{current.abort();}catch{}
 speechDocument?.dispose();speechDocument=null;speechReady=false;
 speechButton();
 if(el('feedbackDialog')?.open)prepareSpeech();
}

function stopSpeech(cancel=false){
 speechWanted=false;clearTimeout(speechRestart);speechRestart=null;
 const speech=recognizer;
 if(el('feedbackStatus')&&!el('feedbackSend').disabled)el('feedbackStatus').textContent=cancel?'':speech?'Finishing dictation...':'Dictation stopped. Captured words are kept.';
 if(!speech){releaseSpeech();return Promise.resolve();}
 if(cancel){releaseSpeech();speechFinish?.();speechButton();return Promise.resolve();}
 if(speechFinish)return speechFinish.promise;
 let resolve;const promise=new Promise(done=>resolve=done);
 const timer=setTimeout(()=>{if(recognizer===speech){recognizer=null;try{speech.abort();}catch{}}finish();},8000);
 function finish(){clearTimeout(timer);speechFinish=null;releaseSpeech();if(el('feedbackDialog').open&&!el('feedbackSend').disabled)el('feedbackStatus').textContent='Dictation stopped. Captured words are kept.';resolve();}
 speechFinish=finish;speechFinish.promise=promise;speechButton();
 try{speech.stop();}catch{finish();}return promise;
}
function resetFeedback(){
 el('feedbackForm').reset();el('feedbackDescription').value='';
 el('feedbackForm').querySelectorAll('[name="feedbackCategory"]').forEach(input=>{input.checked=false;});
 editor?.destroy();editor=null;blob=null;el('feedbackMarkupHost').replaceChildren();el('feedbackRemoveScreenshot').hidden=true;
}
function close(){generation++;el('feedbackDialog').close();void stopSpeech(true);editor?.destroy();editor=null;blob=null;speechButton();returnFocus?.focus();}
function mount(){if(el('feedbackFab'))return;
 document.body.insertAdjacentHTML('beforeend',`<button type="button" id="feedbackFab" hidden>Feedback</button><dialog id="feedbackDialog" aria-labelledby="feedbackTitle"><form id="feedbackForm"><h2 id="feedbackTitle">Send Feedback</h2><p>Tell us what you’re experiencing or what would make Photo Notes more useful.</p><fieldset><legend>Choose a category</legend>${categories.map(([key,icon,label,description])=>`<label class="feedback-choice"><input type="radio" name="feedbackCategory" value="${key}" required><span><strong>${icon} ${label}</strong><br>${description}</span></label>`).join('')}</fieldset><label for="feedbackDescription">Your feedback</label><textarea id="feedbackDescription" rows="5" maxlength="10000" required></textarea><button type="button" id="feedbackDictate" hidden>Dictate feedback</button><button type="button" id="feedbackScreenshot">Attach screenshot (optional)</button><button type="button" id="feedbackRemoveScreenshot" hidden>Remove screenshot</button><div id="feedbackMarkupHost"></div><p id="feedbackStatus" role="status" aria-live="polite"></p><div class="feedback-actions"><button type="submit" id="feedbackSend">Send Feedback</button><button type="button" id="feedbackCancel">Cancel</button></div></form></dialog>`);
 const dialog=el('feedbackDialog');el('feedbackFab').onclick=()=>{returnFocus=document.activeElement;resetFeedback();el('feedbackCancel').textContent='Cancel';el('feedbackStatus').textContent='';el('feedbackSend').disabled=false;el('feedbackDictate').disabled=false;el('feedbackScreenshot').disabled=false;el('feedbackRemoveScreenshot').hidden=true;el('feedbackMarkupHost').replaceChildren();dialog.showModal();prepareSpeech();dialog.querySelector('input').focus();};
 dialog.oncancel=e=>{e.preventDefault();close();};el('feedbackCancel').onclick=close;
 el('feedbackRemoveScreenshot').onclick=()=>{editor?.destroy();editor=null;blob=null;el('feedbackMarkupHost').replaceChildren();el('feedbackRemoveScreenshot').hidden=true;};
 el('feedbackScreenshot').onclick=async()=>{const token=generation;el('feedbackScreenshot').disabled=true;el('feedbackStatus').textContent='Capturing screenshot...';dialog.style.visibility='hidden';try{await new Promise(requestAnimationFrame);const shot=await captureIssueScreenshot();if(token!==generation)return;editor?.destroy();blob=shot;el('feedbackMarkupHost').innerHTML=IssueMarkup.markup();const host=el('feedbackMarkupHost').firstElementChild;host.hidden=false;editor=IssueMarkup.create(host,blob);await editor.ready;host.querySelector('#issueMarkupRetake').onclick=()=>el('feedbackScreenshot').click();el('feedbackRemoveScreenshot').hidden=false;el('feedbackStatus').textContent='Screenshot attached. You can mark it with arrows, shapes, or text.';}catch{if(token===generation)el('feedbackStatus').textContent='Screenshot unavailable. You can still send your feedback.';}finally{dialog.style.visibility='';el('feedbackScreenshot').disabled=false;}};
 const Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(Speech){el('feedbackDictate').hidden=false;el('feedbackDictate').onclick=()=>{
  if(speechWanted||recognizer||speechFinish){void stopSpeech();return;}
  const field=el('feedbackDescription'),token=generation;
  speechWanted=true;emptySessions=0;el('feedbackStatus').textContent='Listening. Pause naturally, then keep speaking. Tap Stop dictation when finished.';
  function start(){
   speechRestart=null;
   if(!speechWanted||token!==generation||!el('feedbackDialog').open)return;
   const base=field.value,Constructor=speechDocument?speechDocument.constructor():Speech;
   if(!Constructor){speechWanted=false;speechButton();return;}
   const speech=new Constructor();let received=false;
   recognizer=speech;speech.lang=document.documentElement.lang||'en-US';speech.continuous=true;speech.interimResults=true;
   speech.onresult=e=>{if(token!==generation||recognizer!==speech)return;const parts=Array.from(e.results).map(r=>r[0].transcript);if(parts.some(text=>text.trim()))received=true;field.value=mergeSpeechTranscript(base,combineSpeechResults(parts)).slice(0,10000);};
   function interrupted(){speechWanted=false;clearTimeout(speechRestart);speechRestart=null;if(speechFinish)speechFinish();else releaseSpeech();speechButton();el('feedbackStatus').textContent='Dictation stopped. Captured words are kept. Tap Dictate feedback to continue or type your feedback.';}
   speech.onend=()=>{
    if(token!==generation||recognizer!==speech)return;
    // Completed sessions need document disposal, not another browser abort.
    if(speechFinish){recognizer=null;speechFinish();return;}
    recognizer=null;
    if(!speechWanted)return;
    emptySessions=received?0:emptySessions+1;
    if(emptySessions>=2||navigator.onLine===false||document.visibilityState==='hidden'){interrupted();return;}
    // A normal browser session end is not the user's Stop. Preserve the
    // current text as the next session's base and bound empty-session retries.
    speechRestart=setTimeout(start,250);
   };
   speech.onerror=e=>{
    if(token!==generation||recognizer!==speech)return;
    if(speechFinish)return;
    if(e.error==='no-speech')return; // Normal silence is handled by onend.
    try{speech.abort();}catch{}interrupted();
   };
   try{speech.start();el('feedbackDictate').textContent='Stop dictation';}catch{interrupted();}
  }
  start();
 };}
 el('feedbackForm').onsubmit=async e=>{e.preventDefault();if(el('feedbackSend').disabled)return;el('feedbackSend').disabled=true;el('feedbackDictate').disabled=true;el('feedbackStatus').textContent='Sending feedback...';const token=generation;await stopSpeech();if(token!==generation)return;const text=el('feedbackDescription').value.trim();if(!text){el('feedbackSend').disabled=false;el('feedbackDictate').disabled=false;el('feedbackStatus').textContent='Please describe your feedback.';return;}el('feedbackSend').disabled=true;el('feedbackScreenshot').disabled=true;try{const fd=new FormData();fd.append('feedback_category',new FormData(e.target).get('feedbackCategory'));fd.append('description',text);fd.append('page_name',typeof state!=='undefined'?state.view||'Photo Notes':'Photo Notes');fd.append('page_url',location.href);fd.append('viewport',`${innerWidth} x ${innerHeight}`);fd.append('user_agent',navigator.userAgent);const shot=editor?await editor.exportBlob():blob;if(token!==generation)return;if(shot)fd.append('screenshot',shot,'feedback.jpg');const r=await api('/api/issues',{method:'POST',body:fd});const data=await r.json();if(token!==generation)return;if(!r.ok)throw Error(data.error||'Feedback could not be sent. Please try again.');generation++;releaseSpeech();resetFeedback();el('feedbackSend').disabled=false;el('feedbackStatus').textContent=`Feedback #${data.id} sent. Thank you.`;el('feedbackCancel').textContent='Close';}catch(error){if(token===generation){el('feedbackStatus').textContent=error.message;el('feedbackSend').disabled=false;}}finally{if(token===generation||token+1===generation){el('feedbackScreenshot').disabled=false;speechButton();}}};
}
window.addEventListener('pagehide',()=>{generation++;el('feedbackDialog')?.close();void stopSpeech(true);});
window.refreshCustomerFeedback=async()=>{mount();try{const r=await api('/api/customer-feedback/access');const data=r.ok?await r.json():{};el('feedbackFab').hidden=!data.enabled;if(!data.enabled&&el('feedbackDialog').open)close();}catch{el('feedbackFab').hidden=true;}};
})();
