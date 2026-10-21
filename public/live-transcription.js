(()=>{
'use strict';
// Live Record Notes: streams microphone audio to the transcription service and
// shows words as they are spoken. A copy of the audio is kept for the whole
// recording. If the live connection drops, the engine reconnects and resends
// the unconfirmed audio; after Stop, any recording whose live text may be
// incomplete is transcribed again from the saved copy. A recording that still
// cannot be transcribed is saved on this device and retried automatically.
// Phones cannot record while a web app is in the background. When the app
// leaves the screen, the audio captured so far is saved on the device at once,
// before any network step, and transcribed when the app is back on screen.
// The object mimics the browser SpeechRecognition interface so the existing
// Capture lifecycle code can drive it unchanged. Each recording reports a
// content-free outcome (never audio or words) for reliability measurement.
const RATE=16000, CHUNK=1600; // 100 ms of 16 kHz mono PCM per streamed chunk.
const CONFIG_KEY='pn_live_transcription_v1', MAX_RECONNECTS=3;
let config=null, configPromise=null, sharedContext=null, workletReady=null, lastFailed=null;
// Audio kept after Stop so words still in the phone's audio pipeline reach the note.
const STOP_TAIL_MS=600;
// iPhone stops a page's audio pipeline when the app leaves the screen and may not
// restart it. After the page has been hidden, the next recording uses a fresh one.
let contextHidden=false, captures=0;
document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='hidden')contextHidden=true;else onReturn();});
// The after-the-fact transcription can take longer than the live session for long
// notes. The server polls the provider for up to 90 seconds, then tries the backup.
const UPLOAD_TIMEOUT_MS=110000;
// Peak level (16-bit) at or below which a recording is digital silence: the
// microphone delivered no sound at all, as when the phone has muted the input.
const SILENT_PEAK=2;
const hidden=()=>document.visibilityState==='hidden';

function readCachedConfig(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'null');}catch{return null;}}
function refresh(){
 configPromise=fetch('/api/transcription/config',{credentials:'same-origin',cache:'no-store'})
  .then(r=>r.ok?r.json():Promise.reject(new Error('config '+r.status)))
  .then(value=>{config={live:!!value.live};try{localStorage.setItem(CONFIG_KEY,JSON.stringify(config));}catch{}if(config.live)setTimeout(async()=>{await retryKept({force:true});try{const items=await listKept();if(items.some(i=>i.status==='transcribed')&&!document.querySelector('dialog[open]'))void showRecovered();}catch{}},2500);return config;})
  .catch(()=>{config=config||readCachedConfig()||{live:false};return config;});
 return configPromise;
}
function supported(){return !!(window.WebSocket&&navigator.mediaDevices?.getUserMedia&&(window.AudioContext||window.webkitAudioContext));}
function enabled(){if(!config)config=readCachedConfig();return !!(config&&config.live)&&supported();}

// iPhone only lets audio start from a tap. Call this synchronously from the
// Record Notes tap, before any await, so the shared context is allowed to run.
function unlock(){
 if(!supported())return null;
 try{
  if(sharedContext&&sharedContext.state!=='closed'&&!captures&&(contextHidden||sharedContext.state==='interrupted')){const old=sharedContext;sharedContext=null;try{old.close?.()?.catch?.(()=>{});}catch{}}
  if(!sharedContext||sharedContext.state==='closed'){const Ctx=window.AudioContext||window.webkitAudioContext;sharedContext=new Ctx();workletReady=null;contextHidden=false;}
  if(sharedContext.state!=='running')sharedContext.resume().catch(()=>{});
 }catch{sharedContext=null;}
 return sharedContext;
}

function createResampler(inputRate,outputRate=RATE){
 const ratio=inputRate/outputRate;let carry=new Float32Array(0),offset=0;
 return input=>{
  const buffer=new Float32Array(carry.length+input.length);buffer.set(carry);buffer.set(input,carry.length);
  const out=[];let position=offset;
  while(position+ratio<=buffer.length){
   const start=Math.floor(position),end=Math.max(start+1,Math.floor(position+ratio));
   let sum=0;for(let i=start;i<end;i++)sum+=buffer[i];
   const sample=Math.max(-1,Math.min(1,sum/(end-start)));
   out.push(sample<0?sample*0x8000:sample*0x7fff);position+=ratio;
  }
  const keep=Math.floor(position);carry=buffer.slice(keep);offset=position-keep;
  return Int16Array.from(out);
 };
}
function encodeWav(chunks,sampleRate=RATE){
 const samples=chunks.reduce((n,c)=>n+c.length,0),bytes=new ArrayBuffer(44+samples*2),view=new DataView(bytes);
 const text=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,36+samples*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples*2,true);
 let at=44;for(const chunk of chunks)for(let i=0;i<chunk.length;i++,at+=2)view.setInt16(at,chunk[i],true);
 return new Blob([bytes],{type:'audio/wav'});
}
function joinTurns(turns){return Array.from(turns.keys()).sort((a,b)=>a-b).map(k=>String(turns.get(k).text||'').trim()).filter(Boolean).join(' ');}
function speechError(error){const e=new Error(error);e.error=error;return e;}
// Errors carry a short content-free code (upload-502-provider-timeout, upload-network)
// so the reliability report shows why the saved recording could not be transcribed.
function codedError(code){const e=new Error(code);e.code=code;return e;}
const failCode=error=>String(error&&error.code||'upload-error').slice(0,40);
async function transcribeRecording(wav,language,timeoutMs=UPLOAD_TIMEOUT_MS){
 const controller=typeof AbortController==='function'?new AbortController():null,timer=setTimeout(()=>controller?.abort(),timeoutMs);
 const lost=error=>codedError(error&&error.name==='AbortError'?'upload-timeout':navigator.onLine===false?'upload-offline':hidden()?'upload-hidden':'upload-network');
 try{
  let r;try{r=await fetch('/api/transcription/recording?language='+encodeURIComponent(language||'en'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'audio/wav'},body:wav,signal:controller?.signal});}catch(error){throw lost(error);}
  if(!r.ok){let code='';try{code=String((await r.json())?.code||'');}catch{}throw codedError('upload-'+r.status+(code?'-'+code:''));}
  let body;try{body=await r.json();}catch(error){throw lost(error);}
  return String(body.text||'').trim();
 }finally{clearTimeout(timer);}
}

// ---------- Content-free outcome reporting ----------
function appVersion(){return Number(document.querySelector?.('script[src*="/app.js"]')?.src?.match(/[?&]v=(\d+)/)?.[1])||0;}
function installed(){try{return navigator.standalone===true||!!window.matchMedia?.('(display-mode: standalone)').matches;}catch{return false;}}
// reason: why the live text was incomplete or the recording ended (background, mic-ended,
// closed, session). cause: what interrupted it. fallback: why the saved recording could
// not be transcribed (upload-502, upload-network). Codes only, never words or audio.
function report(outcome,{surface='capture',seconds=0,reconnects=0,words=0,reason='',interrupted=false,cause='',fallback='',attempts=0,restored=false,wake=''}={}){
 const code=v=>String(v||'').slice(0,40);
 const body={surface,outcome,seconds,reconnects,words,reason:code(reason),interrupted:!!interrupted,cause:code(cause),fallback:code(fallback),attempts,restored:!!restored,wake:code(wake),hidden:hidden(),
  mode:installed()?'installed':'browser',touch:Number(navigator.maxTouchPoints)>1,version:appVersion()};
 try{fetch('/api/transcription/outcome',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).catch(()=>{});}catch{}
}
const wordCount=text=>String(text||'').trim().split(/\s+/).filter(Boolean).length;

// ---------- Recordings kept on this device ----------
// A recording that could not be transcribed is stored in IndexedDB so closing
// or reloading the app does not lose it. Retries run when the app opens, when
// the connection returns, and every minute while any are waiting.
const DB_NAME='photonotes-recordings',STORE='kept';let dbPromise=null,retrying=false,retryTimer=null;
// id -> function(text) registered by the screen that made the recording. It returns
// true when it placed the words; false (screen closed) keeps them for the Recovered list.
const claimers=new Map(),inFlight=new Set();
// Recordings saved during this page load. Others were saved before iPhone closed the app.
const createdHere=new Set();
function db(){
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{try{const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);}catch(error){reject(error);}}).catch(error=>{dbPromise=null;throw error;});
 return dbPromise;
}
async function tx(mode,fn){const database=await db();return new Promise((resolve,reject)=>{const t=database.transaction(STORE,mode),request=fn(t.objectStore(STORE));let value;if(request)request.onsuccess=()=>{value=request.result;};t.oncomplete=()=>resolve(value);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});}
const newId=()=>(crypto.randomUUID?.()||String(Date.now())+Math.random().toString(16).slice(2));
// outcome: the recording's report, sent once the first transcription attempt settles
// (used when the app left the screen, since the result is not known yet).
async function keepRecording(wav,{language,seconds,surface,reason='',outcome=null}){
 const item={id:newId(),language,seconds,surface,reason,pendingOutcome:outcome,createdAt:Date.now(),status:'pending',attempts:0,text:''};createdHere.add(item.id);
 try{item.audio=await wav.arrayBuffer();item.stored=true;await tx('readwrite',store=>store.put(item));}catch{item.stored=false;}
 item.wav=wav;lastFailed=item;scheduleRetry();return item;
}
async function listKept(){try{return await tx('readonly',store=>store.getAll())||[];}catch{return lastFailed&&!lastFailed.stored?[lastFailed]:[];}}
async function removeKept(id){try{await tx('readwrite',store=>store.delete(id));}catch{}if(lastFailed?.id===id)lastFailed=null;}
async function updateKept(item){if(item.stored===false)return;try{const {wav,...row}=item;await tx('readwrite',store=>store.put(row));}catch{}}
function audioOf(item){return item.wav||new Blob([item.audio],{type:'audio/wav'});}
async function transcribeKept(item){
 if(inFlight.has(item.id))throw new Error('already transcribing');
 inFlight.add(item.id);
 try{
  item.attempts=(item.attempts||0)+1;
  const restored=!createdHere.has(item.id),pending=item.pendingOutcome;let text;
  try{text=await transcribeRecording(audioOf(item),item.language);}
  catch(error){
   // Back off so a recording that keeps failing does not use up the transcription limit.
   item.nextAt=Date.now()+Math.min(3600000,60000*Math.pow(2,Math.min(6,item.attempts-1)));
   if(pending){item.pendingOutcome=null;report('kept',{...pending,surface:item.surface,seconds:item.seconds,fallback:failCode(error),attempts:item.attempts,restored});}
   throw error;
  }
  if(pending){item.pendingOutcome=null;report('recovered',{...pending,surface:item.surface,seconds:item.seconds,words:wordCount(text),attempts:item.attempts,restored});}
  else report('retried',{surface:item.surface,seconds:item.seconds,words:wordCount(text),reason:item.reason||'',attempts:item.attempts,restored});
  const claim=claimers.get(item.id);claimers.delete(item.id);
  let placed=false;try{placed=!!claim&&claim(text)!==false;}catch{}
  if(placed){await removeKept(item.id);return text;}
  item.status='transcribed';item.text=text;item.audio=undefined;delete item.wav;await updateKept(item);
  if(!item.stored&&lastFailed===item)lastFailed=item;
  window.dispatchEvent(new CustomEvent('photonotes-recordings-recovered'));
  return text;
 }finally{inFlight.delete(item.id);}
}
// force: the app just opened, came back on screen or reconnected, so recent recordings
// are tried at once. Otherwise each recording waits for its back-off time. A pass tries
// at most three recordings and never runs while the app is off screen.
async function retryKept({force=false}={}){
 if(retrying||!enabled()||navigator.onLine===false||hidden())return;retrying=true;
 try{let tried=0;for(const item of await listKept()){
  if(item.status!=='pending'||inFlight.has(item.id))continue;
  if(item.nextAt&&item.nextAt>Date.now()+1000&&!(force&&(item.attempts||0)<4))continue;
  if(tried++>=3)break;
  if(!item.wav&&lastFailed?.id===item.id)item.wav=lastFailed.wav;
  try{await transcribeKept(item);}catch{await updateKept(item);}
 }}
 finally{retrying=false;scheduleRetry();}
}
function scheduleRetry(){clearTimeout(retryTimer);retryTimer=setTimeout(async()=>{const items=await listKept();if(items.some(i=>i.status==='pending'))void retryKept();},60000);}
// Back on screen: the network may need a moment after iPhone resumes the app.
let returnTimers=[];
function onReturn(){returnTimers.forEach(t=>clearTimeout(t));returnTimers=[800,4000,12000].map(ms=>setTimeout(()=>void retryKept({force:true}),ms));}
window.addEventListener?.('online',()=>void retryKept({force:true}));

// Recovered recordings whose screen was closed are shown here to copy or add.
async function showRecovered(){
 const items=(await listKept()).filter(i=>i.status==='transcribed');
 document.getElementById('recoveredRecordingsDialog')?.remove();
 if(!items.length)return false;
 const dialog=document.createElement('dialog');dialog.id='recoveredRecordingsDialog';dialog.className='web-help-dialog';dialog.style.background='#fff';dialog.style.color='#000';
 dialog.innerHTML='<h2 style="color:#000">Recovered recordings</h2><p style="color:#000">These recordings could not be turned into text when you made them. They have now been transcribed. Copy the words, add them to the note you are writing, or discard them.</p><div id="recoveredList"></div><button class="btn secondary" id="recoveredClose" type="button">Close</button>';
 const list=dialog.querySelector('#recoveredList');
 for(const item of items){
  const box=document.createElement('div');box.className='recovered-recording';box.style.cssText='border:1px solid #000;border-radius:8px;padding:10px;margin:10px 0;color:#000;text-align:left';
  const when=document.createElement('p');when.style.color='#000';when.textContent=new Date(item.createdAt).toLocaleString()+' · '+({capture:'Record Notes',feedback:'Send Feedback',issue:'Report Issue',ewr:'Extra Work'}[item.surface]||'Recording');
  const text=document.createElement('p');text.style.color='#000';text.textContent=item.text||'No words were found in this recording.';
  const copy=document.createElement('button');copy.type='button';copy.className='btn';copy.dataset.recoveredCopy=item.id;copy.textContent='Copy Text';
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(item.text);copy.textContent='Copied';}catch{copy.textContent='Copy not available';}};
  const add=document.createElement('button');add.type='button';add.className='btn';add.dataset.recoveredAdd=item.id;add.textContent='Add to Current Note';
  add.hidden=!document.getElementById('note');
  add.onclick=async()=>{const note=document.getElementById('note');if(!note)return;note.value=[note.value.trim(),item.text].filter(Boolean).join(' ');note.dispatchEvent(new Event('change'));try{if(typeof state!=='undefined')state._note=note.value;}catch{}await removeKept(item.id);box.remove();if(!list.children.length)dialog.close();};
  const discard=document.createElement('button');discard.type='button';discard.className='btn secondary';discard.dataset.recoveredDiscard=item.id;discard.textContent='Discard';
  discard.onclick=async()=>{await removeKept(item.id);box.remove();if(!list.children.length)dialog.close();};
  box.append(when,text,copy,add,discard);list.append(box);
 }
 dialog.querySelector('#recoveredClose').onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return true;
}

// A recording whose screen was closed while its words were being checked: the words
// go to the Recovered recordings list instead of being lost.
async function saveRecovered(text,{language,seconds,surface}){
 const item={id:newId(),language,seconds,surface,createdAt:Date.now(),status:'transcribed',attempts:0,text};createdHere.add(item.id);
 try{await tx('readwrite',store=>store.put(item));item.stored=true;}catch{item.stored=false;lastFailed=item;}
 window.dispatchEvent(new CustomEvent('photonotes-recordings-recovered'));
}
// Words from a recovered recording replace the live words shown for the same
// recording, so nothing is repeated. segment: the live words as shown in the field;
// anchor: the field text before them. Without either, the words are added at the end.
function replaceSegment(value,{segment='',anchor=''}={},text,merge){
 const v=String(value||''),seg=String(segment||'').trim(),t=String(text||'').trim();
 if(!t)return v;
 if(seg){const at=v.lastIndexOf(seg);if(at>=0)return v.slice(0,at)+t+v.slice(at+seg.length);}
 const base=String(anchor||'').trim();
 if(!seg&&base&&v.startsWith(base)){const rest=v.slice(base.length).trim();return [base,t,rest].filter(Boolean).join(' ');}
 if(!seg&&!base&&!v.trim())return t;
 return typeof merge==='function'?merge(v,t):[v.trim(),t].filter(Boolean).join(' ');
}

class LiveRecognizer{
 constructor(){
  this.lang='en-US';this.continuous=true;this.interimResults=true;this.surface='capture';
  this.onstart=this.onaudiostart=this.onspeechstart=this.onaudioend=this.onresult=this.onerror=this.onend=this.onstatus=null;
  // Stop may wait for the after-the-fact transcription; the Capture finish timer reads this.
  this.finishTimeoutMs=UPLOAD_TIMEOUT_MS+15000;
  this._state='idle';this._turns=new Map();this._chunks=[];this._pending=new Int16Array(CHUNK);this._pendingLength=0;
  this._sent=0;this._ws=null;this._open=false;this._terminated=false;this._failure='';this._spoke=false;this._ended=false;
  this._session=0;this._sessionStart=0;this._confirmed=0;this._reconnects=0;this._dropped=false;this._outcome=null;
  this._peak=0;this._wakeState='none';this._abandoned=false;
 }
 static get isPhotoNotesLive(){return true;}
 get audioSeconds(){return (this._chunks.length*CHUNK+this._pendingLength)/RATE;}
 get keptRecording(){return this._kept||null;}
 get interruption(){return this._interrupted||'';}
 _emit(name,event={}){if(this._abandoned&&name!=='end')return;const fn=this['on'+name];if(typeof fn==='function')try{fn.call(this,event);}catch(error){setTimeout(()=>{throw error;});}}
 _status(state,detail=''){this._emit('status',{state,detail});}
 _report(outcome,reason='',extra={}){if(this._outcome)return;this._outcome=outcome;report(outcome,{surface:this.surface,seconds:Math.round(this.audioSeconds),reconnects:this._reconnects,words:wordCount(joinTurns(this._turns)),reason,interrupted:!!this._interrupted,cause:this._interrupted||'',wake:this._wakeState,...extra});}
 _cancelled(){return this._state==='aborted'&&!this._abandoned;}
 _result(){
  if(this._abandoned)return;
  const text=joinTurns(this._turns),final=Array.from(this._turns.values()).every(t=>t.final);
  if(text&&!this._spoke){this._spoke=true;this._emit('speechstart');}
  const result=[{transcript:text,confidence:1}];result.isFinal=final;
  this._emit('result',{resultIndex:0,results:[result]});
 }
 start(){
  if(this._state!=='idle')throw Object.assign(new Error('Recognition already started'),{name:'InvalidStateError'});
  this._state='starting';
  this._run().catch(error=>this._fail(error&&error.error||'audio-capture',error&&error.reason||'start-failed'));
 }
 _session_request(){
  const language=String(this.lang||'en').slice(0,2);
  return fetch('/api/transcription/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({language})})
   .then(r=>r.ok?r.json():Promise.reject(new Error('session-'+r.status)));
 }
 _keepAwake(){
  // Keep the screen on while recording; an auto-lock would end the note. iPhone can
  // release the lock (older Home Screen apps never grant it), so it is requested again.
  try{
   if(!navigator.wakeLock?.request){this._wakeState='none';return;}
   navigator.wakeLock.request('screen').then(lock=>{
    if(this._state!=='recording'){lock.release().catch(()=>{});return;}
    this._wake=lock;this._wakeState='ok';
    lock.addEventListener?.('release',()=>{if(this._wake!==lock)return;this._wake=null;if(this._state==='recording'&&!hidden()&&(this._wakeRetries=(this._wakeRetries||0)+1)<=3){this._wakeState='released';setTimeout(()=>{if(this._state==='recording'&&!hidden())this._keepAwake();},500);}});
   }).catch(()=>{this._wakeState='failed';});
  }catch{this._wakeState='failed';}
 }
 async _run(){
  const context=sharedContext||unlock();
  if(!context)throw Object.assign(speechError('audio-capture'),{reason:'no-audio-context'});
  const session=this._session_request().catch(error=>{this._sessionError=error.message;return null;});
  // Newer iPhones let a web app declare that it records, so Safari routes the microphone for capture.
  try{if(navigator.audioSession&&navigator.audioSession.type!=='play-and-record'){this._audioType=navigator.audioSession.type;navigator.audioSession.type='play-and-record';}}catch{}
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}
  catch(error){
   const denied=error&&(error.name==='NotAllowedError'||error.name==='SecurityError');
   throw Object.assign(speechError(denied?'not-allowed':'audio-capture'),{reason:denied?'mic-denied':'mic-'+String(error&&error.name||'error').toLowerCase().replace(/error$/,'').replace(/[^a-z]/g,'').slice(0,20)});
  }
  if(this._state!=='starting'){stream.getTracks().forEach(t=>t.stop());return;}
  this._stream=stream;
  for(const track of stream.getAudioTracks()){
   if(track.readyState==='ended'){this._detach();throw Object.assign(speechError('audio-capture'),{reason:'mic-ended-at-start'});}
   if(track.muted)this._startedMuted=true;
   track.addEventListener('ended',()=>this._captureEnded('mic-ended'));
   // A muted track means the phone has taken the microphone (call, Siri) or paused the app.
   track.addEventListener('mute',()=>{clearTimeout(this._muteTimer);this._muteTimer=setTimeout(()=>{if(track.muted)this._captureEnded('mic-muted');},1500);});
   track.addEventListener('unmute',()=>clearTimeout(this._muteTimer));
  }
  // Phones stop the microphone when the app leaves the screen. Desktop browsers keep recording.
  if(/iPhone|iPad|iPod|Android/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1)){
   this._onHidden=()=>{if(document.visibilityState==='hidden')this._captureEnded('background');};
   document.addEventListener('visibilitychange',this._onHidden);
  }
  this._onOnline=()=>{if(this._state==='recording'&&!this._open&&this._failure){this._failure='';this._reconnects=Math.min(this._reconnects,MAX_RECONNECTS-1);this._reconnect();}};
  window.addEventListener('online',this._onOnline);
  if(context.state!=='running')try{await context.resume();}catch{}
  await this._attach(context,stream);
  if(this._state!=='starting'){this._detach();return;}
  // iPhone can interrupt the audio pipeline (alarm, Siri, another app's audio) without
  // stopping the microphone. Resume it, and pause the note if it stays stopped.
  this._context=context;
  this._onContextState=()=>{
   if(this._state!=='recording')return;
   clearTimeout(this._contextTimer);if(context.state==='running')return;
   context.resume?.().catch(()=>{});
   this._contextTimer=setTimeout(()=>{if(this._state==='recording'&&context.state!=='running')this._captureEnded('audio-'+context.state);},1500);
  };
  context.addEventListener?.('statechange',this._onContextState);
  this._state='recording';this._emit('start');this._emit('audiostart');
  this._keepAwake();
  this._status('capture',`rate=${context.sampleRate} state=${context.state} node=${this._node&&this._node.port?'worklet':'script'}${this._startedMuted?' muted':''}`);
  // A paused audio pipeline would record silence. Detect it within seconds instead of losing the note.
  this._silenceCheck=setTimeout(()=>{if(this._state!=='recording')return;if(this._chunks.length||this._pendingLength){this._checkSilent();return;}context.resume?.().catch(()=>{});
   this._silenceCheck=setTimeout(()=>{if(this._state!=='recording')return;if(!this._chunks.length&&!this._pendingLength)this._fail('audio-capture','no-audio-'+context.state);else this._checkSilent();},4000);},3000);
  const details=await session;
  if(this._state==='aborted')return;
  if(details&&details.url&&this._state==='recording')this._connect(details.url);
  else if(this._state==='recording'){this._failure='token-failed';this._dropped=true;this._status('offline',this._sessionError||'session');this._scheduleReconnect();}
 }
 // The microphone delivers audio but no sound at all (the phone muted the input).
 // Tell the person while they can still restart; the words cannot be recovered later.
 _checkSilent(){if(this._state==='recording'&&this._peak<=SILENT_PEAK&&this.audioSeconds>=2)this._status('silent');}
 async _attach(context,stream){
  const resample=createResampler(context.sampleRate);
  const receive=block=>{if(this._state==='starting'||this._state==='recording'||this._state==='stopping'||(this._abandoned&&this._stream))this._push(resample(block));};
  this._source=context.createMediaStreamSource(stream);this._capturing=true;captures++;
  try{
   if(!context.audioWorklet)throw new Error('no worklet');
   if(!workletReady)workletReady=context.audioWorklet.addModule('/pcm-capture-worklet.js?v=1');
   await workletReady;
   this._node=new AudioWorkletNode(context,'photonotes-pcm-capture');
   this._node.port.onmessage=e=>receive(e.data);
  }catch{
   workletReady=null;
   this._node=context.createScriptProcessor(4096,1,1);
   this._node.onaudioprocess=e=>receive(e.inputBuffer.getChannelData(0).slice(0));
  }
  // A muted gain keeps the graph running in every browser without playing the microphone back.
  this._sink=context.createGain();this._sink.gain.value=0;
  this._source.connect(this._node);this._node.connect(this._sink);this._sink.connect(context.destination);
 }
 _detach(){
  try{this._wake?.release().catch(()=>{});}catch{}this._wake=null;
  try{if(this._audioType!==undefined&&navigator.audioSession){navigator.audioSession.type=this._audioType;this._audioType=undefined;}}catch{}
  clearTimeout(this._silenceCheck);clearTimeout(this._muteTimer);clearTimeout(this._reconnectTimer);clearTimeout(this._contextTimer);
  if(this._onHidden)document.removeEventListener('visibilitychange',this._onHidden);
  if(this._onOnline)window.removeEventListener('online',this._onOnline);
  if(this._onContextState){try{this._context?.removeEventListener?.('statechange',this._onContextState);}catch{}this._onContextState=null;}
  try{this._source?.disconnect();}catch{}try{this._node?.disconnect();}catch{}try{this._sink?.disconnect();}catch{}
  if(this._node?.port)this._node.port.onmessage=null;
  if(this._capturing){this._capturing=false;captures=Math.max(0,captures-1);}
  this._source=this._node=this._sink=null;
  this._stream?.getTracks().forEach(t=>t.stop());this._stream=null;
 }
 _push(samples){
  for(let i=0;i<samples.length;i++){const v=samples[i]<0?-samples[i]:samples[i];if(v>this._peak)this._peak=v;}
  let at=0;
  while(at<samples.length){
   const take=Math.min(CHUNK-this._pendingLength,samples.length-at);
   this._pending.set(samples.subarray(at,at+take),this._pendingLength);this._pendingLength+=take;at+=take;
   if(this._pendingLength===CHUNK){this._chunks.push(this._pending);this._pending=new Int16Array(CHUNK);this._pendingLength=0;}
  }
  this._flush();
 }
 _flush(){
  if(!this._open||!this._ws)return;
  try{while(this._sent<this._chunks.length)this._ws.send(this._chunks[this._sent++].buffer);}catch{this._lost('send-failed');}
 }
 _connect(url){
  let ws;try{ws=new WebSocket(url);}catch{this._lost('ws-connect');return;}
  const session=++this._session;
  ws.binaryType='arraybuffer';this._ws=ws;this._terminated=false;
  const opened=setTimeout(()=>{if(!this._open&&this._ws===ws)this._lost('ws-timeout');},8000);
  ws.onopen=()=>{clearTimeout(opened);if(this._ws!==ws)return;this._open=true;this._status('live');this._flush();};
  ws.onmessage=e=>{
   if(this._ws!==ws&&this._state!=='stopping'&&!this._abandoned)return;
   let message;try{message=JSON.parse(e.data);}catch{return;}
   if(message.type==='Turn'){
    const final=!!message.end_of_turn&&(message.turn_is_formatted!==false||!/format_turns=true/.test(url));
    // Turns from a reconnected session sort after earlier sessions.
    this._turns.set(session*100000+(Number(message.turn_order)||0),{text:message.transcript||'',final,session});
    if(final&&Array.isArray(message.words)&&message.words.length){
     const endMs=Math.max(...message.words.map(w=>Number(w.end)||0));
     this._confirmed=Math.max(this._confirmed,this._sessionStart+Math.ceil(endMs/100));
    }
    if(!this._cancelled())this._result();
   }else if(message.type==='Termination'){if(this._ws===ws||this._state==='stopping'||this._abandoned){this._terminated=true;this._settle?.();}}
   else if(message.error){this._lost('ws-provider-error');}
  };
  ws.onerror=()=>{};
  ws.onclose=e=>{clearTimeout(opened);if(this._ws!==ws)return;this._open=false;if(!this._terminated&&this._state==='recording')this._lost('ws-closed'+(e&&e.code&&e.code!==1000&&e.code!==1005?'-'+e.code:''));this._settle?.();};
 }
 _lost(reason){
  const ws=this._ws;this._ws=null;this._open=false;this._dropped=true;
  try{ws?.close();}catch{}
  if(this._state!=='recording'&&this._state!=='starting'){this._failure=this._failure||reason;this._settle?.();return;}
  // Recording continues. Unconfirmed words are dropped and resent after reconnecting.
  let removed=false;for(const [key,turn] of this._turns)if(!turn.final){this._turns.delete(key);removed=true;}
  if(removed)this._result();
  this._status('offline',reason);
  this._failure=reason;this._scheduleReconnect();
 }
 _scheduleReconnect(){
  if(this._reconnects>=MAX_RECONNECTS||this._state!=='recording')return;
  clearTimeout(this._reconnectTimer);
  this._reconnectTimer=setTimeout(()=>this._reconnect(),1000*Math.pow(2,this._reconnects));
 }
 async _reconnect(){
  if(this._state!=='recording'||this._open||this._reconnects>=MAX_RECONNECTS||navigator.onLine===false)return;
  this._reconnects++;
  let details;try{details=await this._session_request();}catch{details=null;}
  if(this._state!=='recording')return;
  if(!details?.url){this._failure='token-failed';this._scheduleReconnect();return;}
  // Resend from the last audio the service confirmed, so no words fall in the gap.
  this._sessionStart=this._confirmed;this._sent=this._confirmed;this._failure='';
  this._connect(details.url);
 }
 _captureEnded(reason){
  // The phone took the microphone away or the app went to the background. Keep what was captured.
  if(this._state!=='recording')return;
  // A call or a locked screen also hides the app; the app cannot record until it is back.
  this._interrupted=hidden()?'background':reason||'mic-ended';this.stop();
 }
 stop(){
  if(this._state==='starting'){this._state='aborted';this._detach();this._close();this._report('cancelled','before-start');this._end();return;}
  if(this._state!=='recording')return;
  this._state='stopping';
  void this._finalize();
 }
 abort(){
  if(this._state==='ended'||this._state==='aborted')return;
  if(this._state==='stopping'){
   // The screen is closing while the words are still being checked. Let the check
   // finish so the recording is not lost; its words go to Recovered recordings if needed.
   this._abandoned=true;this._state='aborted';this._end();return;
  }
  this._state='aborted';this._detach();this._close();
  this._report('cancelled');
  this._end();
 }
 _close(){
  const ws=this._ws;this._ws=null;this._open=false;
  if(ws){try{if(ws.readyState===1)ws.send(JSON.stringify({type:'Terminate'}));}catch{}setTimeout(()=>{try{ws.close();}catch{}},1000);}
 }
 async _finalize(){
  this._emit('audioend');
  if(!this._interrupted&&this._stream)await new Promise(resolve=>setTimeout(resolve,STOP_TAIL_MS));
  if(this._cancelled())return;
  this._detach();
  if(this._pendingLength){this._chunks.push(this._pending.slice(0,this._pendingLength));this._pendingLength=0;}
  if(this._interrupted==='background')return this._pauseForBackground();
  let streamed=false;
  if(this._ws&&this._open&&!this._failure){
   this._flush();
   const done=new Promise(resolve=>{this._settle=resolve;setTimeout(resolve,6000);});
   try{this._ws.send(JSON.stringify({type:'Terminate'}));}catch{}
   await done;
   streamed=this._terminated&&!this._failure;
  }
  try{this._ws?.close();}catch{}this._ws=null;
  if(this._cancelled())return;
  const seconds=this.audioSeconds,text=joinTurns(this._turns),language=String(this.lang||'en').slice(0,2);
  // No sound reached the app, so there is nothing to transcribe or keep.
  if(seconds>=1&&this._peak<=SILENT_PEAK&&!text){this._report('failed','mic-silent');this._status('silent');this._chunks=[];this._end();return;}
  // Re-transcribe the saved recording whenever the live text may be incomplete:
  // the connection never worked, dropped at any point, or returned nothing.
  const reason=!streamed?(this._failure||'ws-not-finished'):this._dropped?'reconnected':!text?'no-live-text':'';
  if(reason&&seconds>=0.5){
   this._status('transcribing');
   const wav=encodeWav(this._chunks);
   try{
    const recovered=await transcribeRecording(wav,language);
    if(this._cancelled())return;
    if(this._abandoned){if(recovered)await saveRecovered(recovered,{language,seconds:Math.round(seconds),surface:this.surface});}
    else if(recovered){this._turns=new Map([[0,{text:recovered,final:true}]]);this._result();}
    this._report('recovered',reason,{words:wordCount(recovered),cause:this._interrupted||(this._abandoned?'left-screen':'')});
   }catch(error){
    if(this._cancelled())return;
    if(streamed&&text)this._report('live','recheck-failed',{fallback:failCode(error)});
    else{this._kept=await keepRecording(wav,{language,seconds:Math.round(seconds),surface:this.surface,reason});this._report('kept',reason,{fallback:failCode(error),cause:this._interrupted||(this._abandoned?'left-screen':'')});this._status('kept',error.message);}
   }
  }else this._report(text?'live':'empty',text?'':seconds<0.5?'too-short':'no-speech');
  this._chunks=[];
  this._end();
 }
 // iPhone does not let a web app record in the background, and may close the app
 // while it is away. Save the captured audio on the device now, before any network
 // step, and end the session so Continue Recording works on return. The saved audio
 // is transcribed when the app is back on screen, replacing the live words shown.
 async _pauseForBackground(){
  const ws=this._ws;this._ws=null;this._open=false;
  try{if(ws&&ws.readyState===1)ws.send(JSON.stringify({type:'Terminate'}));}catch{}try{ws?.close();}catch{}
  const seconds=this.audioSeconds,text=joinTurns(this._turns),language=String(this.lang||'en').slice(0,2);
  if(seconds>=0.5&&this._peak>SILENT_PEAK){
   const wav=encodeWav(this._chunks);this._outcome='deferred';
   this._kept=await keepRecording(wav,{language,seconds:Math.round(seconds),surface:this.surface,reason:'background',
    outcome:{reconnects:this._reconnects,reason:'background',cause:'background',interrupted:true,wake:this._wakeState}});
   this._status('kept','background');
   if(!hidden())void retryKept({force:true});
  }else this._report(text?'live':'interrupted',seconds<0.5?'background-short':this._peak<=SILENT_PEAK?'mic-silent':'background');
  this._chunks=[];
  this._end();
 }
 _fail(error,reason=error){
  if(this._state==='aborted'||this._state==='ended')return;
  this._state='aborted';this._detach();this._close();
  this._report('failed',reason);
  this._emit('error',{error,reason});this._end();
 }
 _end(){if(this._ended)return;this._ended=true;const aborted=this._state==='aborted';this._state=aborted?'aborted':'ended';setTimeout(()=>this._emit('end',{interrupted:!!this._interrupted,reason:this._interrupted||''}),0);}
}

// Retry a kept recording from an open screen; the words go to that screen.
// Retry a kept recording now. The screen's registered claimer places the words;
// without one, the words are returned to the caller to place.
async function retryPending(id){
 const key=id||lastFailed?.id;const items=await listKept();
 const item=items.find(i=>i.id===key)||(lastFailed&&lastFailed.id===key?lastFailed:null);
 if(!item)return '';
 if(item.status==='transcribed'){await removeKept(item.id);return item.text;}
 if(!item.wav&&lastFailed?.id===item.id)item.wav=lastFailed.wav;
 const prior=claimers.get(item.id);let result='';
 claimers.set(item.id,text=>{result=text;return prior?prior(text):true;});
 try{await transcribeKept(item);}catch(error){if(prior)claimers.set(item.id,prior);else claimers.delete(item.id);await updateKept(item);throw error;}
 return prior?'':result;
}

// Simple text-field dictation for secondary fields (Extra Work description,
// Report Issue description). Call from the button tap. Tapping again stops and
// waits for the final words. Returns true when the live engine handled the tap.
const fieldSessions=new Map();
const BACKGROUND_SAVED_MESSAGE='Your words so far are saved on this device. They are checked against the recording when PhotoNotes is back on screen. You can also tap Transcribe Recording.';
const SILENT_MESSAGE='No sound is reaching PhotoNotes from the microphone. Stop, then start recording again. If this keeps happening, close PhotoNotes and open it again.';
// Plain-English reason shown when a recording pauses on its own. Phones do not let a
// web app record while it is off screen; that limit cannot be changed by PhotoNotes.
function pauseMessage(reason,next='Tap Continue Recording to keep going.'){
 return (reason==='background'?'Recording paused because PhotoNotes left the screen. Phones do not let web apps record in the background. Your words so far are saved. '
  :'Recording paused because the phone used the microphone or audio, for example for a call, Siri or an alarm. Your words so far are saved. ')+next;
}
function dictateField({field,button,status,idleLabel,retryId,language='en-US',surface='feedback',onText}){
 if(!field||!button)return false;
 const active=fieldSessions.get(button);
 if(active){if(active.state==='recording'){active.state='finishing';button.disabled=true;button.textContent='Finishing...';try{active.recognizer.stop();}catch{}}return true;}
 if(!enabled())return false;
 unlock();
 const say=text=>{if(status)status.textContent=text;else if(typeof window.toast==='function')window.toast(text);};
 const merge=(a,b)=>typeof window.mergeSpeechTranscript==='function'?window.mergeSpeechTranscript(a,b):[String(a||'').trim(),String(b||'').trim()].filter(Boolean).join(' ');
 document.getElementById(retryId)?.remove();
 const base=field.value.trim(),recognizer=new LiveRecognizer(),session={recognizer,state:'recording'};
 fieldSessions.set(button,session);recognizer.lang=language;recognizer.surface=surface;
 const reset=()=>{fieldSessions.delete(button);button.disabled=false;button.textContent=idleLabel;button.classList.remove('on');};
 recognizer.onstart=()=>{if(session.state==='recording'){button.textContent='Recording... tap to stop';say('Listening...');}};
 recognizer.onresult=e=>{const text=e.results[0][0].transcript;field.value=merge(base,text);onText?.(field.value);};
 recognizer.onstatus=e=>{
  if(e.state==='live'&&session.state==='recording')say('Listening...');
  else if(e.state==='offline')say('Connection lost. Still recording. Reconnecting; your words will be added when you stop.');
  else if(e.state==='transcribing')say('Checking your words against the recording...');
  else if(e.state==='silent')say(SILENT_MESSAGE);
  else if(e.state==='kept'){
   const kept=recognizer.keptRecording;
   // The live words shown for this recording are replaced by the checked words.
   const shown=field.value,where={anchor:base,segment:shown.startsWith(base)?shown.slice(base.length).trim():''};
   say(e.detail==='background'?BACKGROUND_SAVED_MESSAGE:'Your recording is saved on this device and will be turned into text automatically when the connection returns. You can also tap Transcribe Recording.');
   document.getElementById(retryId)?.remove();
   const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.id=retryId;retry.textContent='Transcribe Recording';
   if(kept)claimers.set(kept.id,text=>{if(!field.isConnected)return false;if(text){field.value=replaceSegment(field.value,where,text,merge);onText?.(field.value);}say(text?'Words added from your recording.':'No words were found in the recording.');retry.remove();return true;});
   retry.onclick=async()=>{retry.disabled=true;retry.textContent='Transcribing...';
    try{await retryPending(kept?.id);retry.remove();}
    catch{retry.disabled=false;retry.textContent='Transcribe Recording';say('Still could not transcribe the recording. It stays saved and will be retried automatically.');}};
   button.after(retry);
  }};
 recognizer.onerror=e=>{say(e.error==='not-allowed'?'Allow microphone access for this website, then try again. You can also type.':'The microphone stopped. Your words are kept. Tap to record again or type.');};
 recognizer.onend=e=>{reset();if(e&&e.interrupted)say(pauseMessage(e.reason,'Tap '+idleLabel+' to keep going.'));else if(status&&/Listening|Checking/.test(status.textContent))status.textContent='';};
 button.textContent='Starting microphone... tap to stop';button.classList.add('on');
 try{recognizer.start();}catch{reset();return false;}
 return true;
}
function fieldActive(button){return fieldSessions.has(button);}
function stopField(button){const active=fieldSessions.get(button);if(active){fieldSessions.delete(button);try{active.recognizer.abort();}catch{}}}
// Words from a kept recording are routed to the screen that is still open.
function claimKept(id,handler){if(id)claimers.set(id,handler);}
function releaseKept(id){claimers.delete(id);}

window.addEventListener?.('photonotes-recordings-recovered',()=>{setTimeout(()=>{if(!document.querySelector('dialog[open]'))void showRecovered();},500);});

window.PhotoNotesLiveTranscription={
 refresh,enabled,supported,unlock,Recognizer:LiveRecognizer,dictateField,stopField,fieldActive,claimKept,releaseKept,
 pendingRecording(){return lastFailed;},
 retryPending,retryKept,listKept,showRecovered,
 discardPending(){if(lastFailed)void removeKept(lastFailed.id);lastFailed=null;},
 pauseMessage,replaceSegment,messages:{backgroundSaved:BACKGROUND_SAVED_MESSAGE,silent:SILENT_MESSAGE},
 _test:{createResampler,encodeWav,joinTurns,report,replaceSegment}
};
})();
