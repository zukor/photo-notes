(()=>{
'use strict';
// Live Record Notes: streams microphone audio to the transcription service and
// shows words as they are spoken. A copy of the audio is kept in memory for the
// whole recording. If the live connection fails, the copy is transcribed after
// Stop, so words are not lost. The object mimics the browser SpeechRecognition
// interface so the existing Capture lifecycle code can drive it unchanged.
const RATE=16000, CHUNK=1600; // 100 ms of 16 kHz mono PCM per streamed chunk.
const CONFIG_KEY='pn_live_transcription_v1';
let config=null, configPromise=null, sharedContext=null, workletReady=null, lastFailed=null;

function readCachedConfig(){try{return JSON.parse(localStorage.getItem(CONFIG_KEY)||'null');}catch{return null;}}
function refresh(){
 configPromise=fetch('/api/transcription/config',{credentials:'same-origin',cache:'no-store'})
  .then(r=>r.ok?r.json():Promise.reject(new Error('config '+r.status)))
  .then(value=>{config={live:!!value.live};try{localStorage.setItem(CONFIG_KEY,JSON.stringify(config));}catch{}return config;})
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
  if(!sharedContext||sharedContext.state==='closed'){const Ctx=window.AudioContext||window.webkitAudioContext;sharedContext=new Ctx();workletReady=null;}
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
async function transcribeRecording(wav,language,timeoutMs=60000){
 const controller=typeof AbortController==='function'?new AbortController():null,timer=setTimeout(()=>controller?.abort(),timeoutMs);
 try{
  const r=await fetch('/api/transcription/recording?language='+encodeURIComponent(language||'en'),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'audio/wav'},body:wav,signal:controller?.signal});
  if(!r.ok)throw new Error('recording '+r.status);
  const body=await r.json();return String(body.text||'').trim();
 }finally{clearTimeout(timer);}
}

class LiveRecognizer{
 constructor(){
  this.lang='en-US';this.continuous=true;this.interimResults=true;
  this.onstart=this.onaudiostart=this.onspeechstart=this.onaudioend=this.onresult=this.onerror=this.onend=this.onstatus=null;
  // Stop may wait for the after-the-fact transcription; the Capture finish timer reads this.
  this.finishTimeoutMs=75000;
  this._state='idle';this._turns=new Map();this._chunks=[];this._pending=new Int16Array(CHUNK);this._pendingLength=0;
  this._sent=0;this._ws=null;this._open=false;this._terminated=false;this._failure='';this._spoke=false;this._ended=false;
 }
 static get isPhotoNotesLive(){return true;}
 get audioSeconds(){return (this._chunks.length*CHUNK+this._pendingLength)/RATE;}
 _emit(name,event={}){const fn=this['on'+name];if(typeof fn==='function')try{fn.call(this,event);}catch(error){setTimeout(()=>{throw error;});}}
 _status(state,detail=''){this._emit('status',{state,detail});}
 _result(){
  const text=joinTurns(this._turns),final=Array.from(this._turns.values()).every(t=>t.final);
  if(text&&!this._spoke){this._spoke=true;this._emit('speechstart');}
  const result=[{transcript:text,confidence:1}];result.isFinal=final;
  this._emit('result',{resultIndex:0,results:[result]});
 }
 start(){
  if(this._state!=='idle')throw Object.assign(new Error('Recognition already started'),{name:'InvalidStateError'});
  this._state='starting';
  this._run().catch(error=>this._fail(error&&error.error||'audio-capture'));
 }
 async _run(){
  const context=sharedContext||unlock();
  if(!context)throw speechError('audio-capture');
  const language=String(this.lang||'en').slice(0,2);
  const session=fetch('/api/transcription/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({language})})
   .then(r=>r.ok?r.json():Promise.reject(new Error('session '+r.status))).catch(error=>{this._failure='session: '+error.message;return null;});
  let stream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}
  catch(error){throw speechError(error&&(error.name==='NotAllowedError'||error.name==='SecurityError')?'not-allowed':'audio-capture');}
  if(this._state!=='starting'){stream.getTracks().forEach(t=>t.stop());return;}
  this._stream=stream;
  for(const track of stream.getAudioTracks())track.addEventListener('ended',()=>this._captureEnded());
  if(context.state!=='running')try{await context.resume();}catch{}
  await this._attach(context,stream);
  if(this._state!=='starting'){this._detach();return;}
  this._state='recording';this._emit('start');this._emit('audiostart');
  this._emit('status',{state:'capture',detail:`rate=${context.sampleRate} state=${context.state} node=${this._node&&this._node.port?'worklet':'script'}`});
  // A paused audio pipeline would record silence. Detect it within seconds instead of losing the note.
  this._silenceCheck=setTimeout(()=>{if(this._state!=='recording'||this._chunks.length||this._pendingLength)return;context.resume?.().catch(()=>{});
   this._silenceCheck=setTimeout(()=>{if(this._state==='recording'&&!this._chunks.length&&!this._pendingLength)this._fail('audio-capture');},4000);},3000);
  const details=await session;
  if(this._state==='aborted')return;
  if(details&&details.url)this._connect(details.url);
  else{this._status('offline',this._failure);}
 }
 async _attach(context,stream){
  const resample=createResampler(context.sampleRate);
  const receive=block=>{if(this._state==='starting'||this._state==='recording')this._push(resample(block));};
  this._source=context.createMediaStreamSource(stream);
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
  clearTimeout(this._silenceCheck);
  try{this._source?.disconnect();}catch{}try{this._node?.disconnect();}catch{}try{this._sink?.disconnect();}catch{}
  if(this._node?.port)this._node.port.onmessage=null;
  this._source=this._node=this._sink=null;
  this._stream?.getTracks().forEach(t=>t.stop());this._stream=null;
 }
 _push(samples){
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
  try{while(this._sent<this._chunks.length)this._ws.send(this._chunks[this._sent++].buffer);}catch{this._lost('send');}
 }
 _connect(url){
  let ws;try{ws=new WebSocket(url);}catch{this._lost('connect');return;}
  ws.binaryType='arraybuffer';this._ws=ws;
  const opened=setTimeout(()=>{if(!this._open&&this._ws===ws)this._lost('connect-timeout');},8000);
  ws.onopen=()=>{clearTimeout(opened);if(this._ws!==ws)return;this._open=true;this._status('live');this._flush();};
  ws.onmessage=e=>{
   let message;try{message=JSON.parse(e.data);}catch{return;}
   if(message.type==='Turn'){
    const final=!!message.end_of_turn&&(message.turn_is_formatted!==false||!/format_turns=true/.test(url));
    this._turns.set(Number(message.turn_order)||0,{text:message.transcript||'',final});
    if(this._state!=='aborted')this._result();
   }else if(message.type==='Termination'){this._terminated=true;this._settle?.();}
   else if(message.error){this._lost('provider');}
  };
  ws.onerror=()=>{};
  ws.onclose=()=>{clearTimeout(opened);if(this._ws!==ws)return;this._open=false;if(!this._terminated&&this._state==='recording')this._lost('closed');this._settle?.();};
 }
 _lost(reason){
  if(this._failure&&this._failure!=='')return;
  this._failure=reason;this._open=false;
  try{this._ws?.close();}catch{}
  // Recording continues. The saved copy is transcribed after Stop.
  if(this._state==='recording'||this._state==='starting')this._status('offline',reason);
 }
 _captureEnded(){
  // The phone took the microphone away (call, Siri, lock). Keep what was captured.
  if(this._state!=='recording')return;
  this._interrupted=true;this.stop();
 }
 stop(){
  if(this._state==='starting'){this._state='aborted';this._detach();this._close();this._end();return;}
  if(this._state!=='recording')return;
  this._state='stopping';
  void this._finalize();
 }
 abort(){
  if(this._state==='ended'||this._state==='aborted')return;
  this._state='aborted';this._detach();this._close();this._end();
 }
 _close(){
  const ws=this._ws;this._ws=null;this._open=false;
  if(ws){try{if(ws.readyState===1)ws.send(JSON.stringify({type:'Terminate'}));}catch{}setTimeout(()=>{try{ws.close();}catch{}},1000);}
 }
 async _finalize(){
  this._emit('audioend');
  this._detach();
  if(this._pendingLength){this._chunks.push(this._pending.slice(0,this._pendingLength));this._pendingLength=0;}
  let streamed=false;
  if(this._ws&&this._open&&!this._failure){
   this._flush();
   const done=new Promise(resolve=>{this._settle=resolve;setTimeout(resolve,6000);});
   try{this._ws.send(JSON.stringify({type:'Terminate'}));}catch{}
   await done;
   streamed=this._terminated&&!this._failure;
  }
  try{this._ws?.close();}catch{}this._ws=null;
  if(this._state==='aborted')return;
  const seconds=this.audioSeconds,text=joinTurns(this._turns);
  // Use the saved recording when the live text is incomplete or never arrived.
  if((!streamed||(!text&&seconds>=1.5))&&seconds>=0.5){
   this._status('transcribing');
   const wav=encodeWav(this._chunks),language=String(this.lang||'en').slice(0,2);
   try{
    const recovered=await transcribeRecording(wav,language);
    if(this._state==='aborted')return;
    if(recovered){this._turns=new Map([[0,{text:recovered,final:true}]]);this._result();}
    lastFailed=null;
   }catch(error){
    if(this._state==='aborted')return;
    lastFailed={wav,language,seconds,at:Date.now()};
    this._status('kept',error.message);
   }
  }
  this._chunks=[];
  this._end();
 }
 _fail(error){
  if(this._state==='aborted'||this._state==='ended')return;
  this._state='aborted';this._detach();this._close();
  this._emit('error',{error});this._end();
 }
 _end(){if(this._ended)return;this._ended=true;const aborted=this._state==='aborted';this._state=aborted?'aborted':'ended';setTimeout(()=>this._emit('end',{interrupted:!!this._interrupted}),0);}
}

// Simple text-field dictation for secondary fields (Extra Work description,
// Report Issue description). Call from the button tap. Tapping again stops and
// waits for the final words. Returns true when the live engine handled the tap.
const fieldSessions=new Map();
function dictateField({field,button,status,idleLabel,retryId,language='en-US',onText}){
 if(!field||!button)return false;
 const active=fieldSessions.get(button);
 if(active){if(active.state==='recording'){active.state='finishing';button.disabled=true;button.textContent='Finishing...';try{active.recognizer.stop();}catch{}}return true;}
 if(!enabled())return false;
 unlock();
 const say=text=>{if(status)status.textContent=text;else if(typeof window.toast==='function')window.toast(text);};
 const merge=(a,b)=>typeof window.mergeSpeechTranscript==='function'?window.mergeSpeechTranscript(a,b):[String(a||'').trim(),String(b||'').trim()].filter(Boolean).join(' ');
 document.getElementById(retryId)?.remove();
 const base=field.value.trim(),recognizer=new LiveRecognizer(),session={recognizer,state:'recording'};
 fieldSessions.set(button,session);recognizer.lang=language;
 const reset=()=>{fieldSessions.delete(button);button.disabled=false;button.textContent=idleLabel;button.classList.remove('on');};
 recognizer.onstart=()=>{if(session.state==='recording'){button.textContent='Recording... tap to stop';say('Listening...');}};
 recognizer.onresult=e=>{const text=e.results[0][0].transcript;field.value=merge(base,text);onText?.(field.value);};
 recognizer.onstatus=e=>{
  if(e.state==='offline')say('Connection lost. Still recording. Your words will be added when you stop.');
  else if(e.state==='transcribing')say('Adding your words from the recording...');
  else if(e.state==='kept'){
   say('Your recording is kept on this device but could not be turned into text yet. Check your connection, then tap Transcribe Recording.');
   const retry=document.createElement('button');retry.type='button';retry.className='btn secondary';retry.id=retryId;retry.textContent='Transcribe Recording';
   retry.onclick=async()=>{retry.disabled=true;retry.textContent='Transcribing...';
    try{const text=await window.PhotoNotesLiveTranscription.retryPending();if(!field.isConnected){retry.remove();return;}if(text){field.value=merge(field.value,text);onText?.(field.value);}say(text?'Words added from your recording.':'No words were found in the recording.');retry.remove();}
    catch{retry.disabled=false;retry.textContent='Transcribe Recording';say('Still could not transcribe the recording. Check your connection and try again.');}};
   button.after(retry);
  }};
 recognizer.onerror=e=>{say(e.error==='not-allowed'?'Allow microphone access for this website, then try again. You can also type.':'The microphone stopped. Your words are kept. Tap to record again or type.');};
 recognizer.onend=e=>{reset();if(e&&e.interrupted)say('Recording stopped early. Your words are kept.');else if(status&&/Listening|Adding/.test(status.textContent))status.textContent='';};
 button.textContent='Starting microphone... tap to stop';button.classList.add('on');
 try{recognizer.start();}catch{reset();return false;}
 return true;
}
function fieldActive(button){return fieldSessions.has(button);}
function stopField(button){const active=fieldSessions.get(button);if(active){fieldSessions.delete(button);try{active.recognizer.abort();}catch{}}}

window.PhotoNotesLiveTranscription={
 refresh,enabled,supported,unlock,Recognizer:LiveRecognizer,dictateField,stopField,fieldActive,
 pendingRecording(){return lastFailed;},
 async retryPending(){if(!lastFailed)return '';const item=lastFailed;const text=await transcribeRecording(item.wav,item.language);lastFailed=null;return text;},
 discardPending(){lastFailed=null;},
 _test:{createResampler,encodeWav,joinTurns}
};
})();
