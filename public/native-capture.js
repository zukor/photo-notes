// PhotoNotes AI iPhone app: native Take Photo, Record Notes and location for Capture.
// Loaded on every page and does nothing in a browser. Inside the iPhone app (a Capacitor shell
// that shows photonotesapp.com), Record Notes uses the native recorder, which keeps recording
// with the screen locked and through phone calls. The words come from the full recording,
// sent to the same server transcription the web app uses (/api/transcription/recording).
// Recordings stay on the iPhone until the PhotoNote that holds their words has uploaded.
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.PhotoNotesNativeCapture=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const PLUGIN='PhotoNotes';
  const doc=()=>root.document;

  // ---- Pure helpers (tested in Node) ----
  function isNativeShell(win=root){
    const cap=win&&win.Capacitor;
    if(!cap||typeof cap.nativePromise!=='function')return false;
    try{
      if(typeof cap.isNativePlatform==='function'&&!cap.isNativePlatform())return false;
      if(typeof cap.getPlatform==='function'&&cap.getPlatform()!=='ios')return false;
      return !!(cap.Plugins&&cap.Plugins[PLUGIN]);
    }catch{return false;}
  }
  function speechLanguage(value){return String(value||'').toLowerCase().startsWith('es')?'es':'en';}
  function clock(seconds){const s=Math.max(0,Math.floor(Number(seconds)||0)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=String(s%60).padStart(2,'0');return h?`${h}:${String(m).padStart(2,'0')}:${r}`:`${m}:${r}`;}
  function appendWords(existing,words){const a=String(existing||'').replace(/\s+$/,''),b=String(words||'').trim();if(!b)return a;if(!a)return b;return a+(/[\n]$/.test(existing)?'':' ')+b;}
  // Native location in the shape of the browser's GeolocationPosition.
  function toPosition(result){const c=(result&&result.coords)||{};return {coords:{latitude:Number(c.latitude),longitude:Number(c.longitude),accuracy:Number(c.accuracy),altitude:c.altitude==null?null:Number(c.altitude),altitudeAccuracy:c.altitudeAccuracy==null?null:Number(c.altitudeAccuracy),heading:c.heading==null?null:Number(c.heading),speed:c.speed==null?null:Number(c.speed)},timestamp:Number(result&&result.timestamp)||Date.now()};}
  function toPositionError(error){const code=[1,2,3].includes(Number(error&&error.code))?Number(error.code):2;return {code,message:String(error&&error.message||'Location is not available.'),PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3};}
  function base64ToBytes(text){const raw=root.atob(String(text||''));const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);return bytes;}
  function recordingIds(payload){return payload&&Array.isArray(payload._nativeRecordings)?payload._nativeRecordings.filter(id=>/^[0-9A-F-]{36}$/i.test(id)):[];}
  const helpers={isNativeShell,speechLanguage,clock,appendWords,toPosition,toPositionError,base64ToBytes,recordingIds};

  if(!isNativeShell()){
    return {...helpers,enabled:()=>false,configure(){},mount(){},release:async()=>{},keepEditing:()=>false,toggle:async()=>{},finish:async()=>true,cancel(){},takePhoto:async()=>null,uploaded(){},attach(){},showRecordings:async()=>{}};
  }

  const cap=root.Capacitor;
  const plugin=cap.Plugins[PLUGIN];
  const call=(method,options={})=>typeof plugin[method]==='function'?plugin[method](options):cap.nativePromise(PLUGIN,method,options);
  const camera=(method,options)=>cap.Plugins.Camera&&typeof cap.Plugins.Camera[method]==='function'?cap.Plugins.Camera[method](options):cap.nativePromise('Camera',method,options);

  // The web app supplies what Capture needs: the current photo, the signed-in account, language and messages.
  let host={photo:()=>null,account:async()=>null,language:()=>'en-US',toast:message=>{},placed:()=>{}};
  function configure(options){host={...host,...(options||{})};}

  // ---- Location: one native prompt for the app instead of a website prompt ----
  try{
    const geo={
      getCurrentPosition(success,failure,options={}){
        call('getCurrentPosition',{enableHighAccuracy:options.enableHighAccuracy!==false,timeout:Number(options.timeout)||15000,maximumAge:Number(options.maximumAge)||0})
          .then(result=>success&&success(toPosition(result)),error=>failure&&failure(toPositionError(error)));
      },
      watchPosition(success,failure,options={}){
        let stopped=false;const id=++watchCount;
        const tick=()=>{if(stopped||!watches.has(id))return;geo.getCurrentPosition(p=>{if(!watches.has(id))return;success&&success(p);watches.set(id,setTimeout(tick,4000));},e=>{if(!watches.has(id))return;failure&&failure(e);watches.set(id,setTimeout(tick,8000));},{...options,maximumAge:0});};
        watches.set(id,0);tick();
        return id;
      },
      clearWatch(id){const timer=watches.get(id);if(timer)clearTimeout(timer);watches.delete(id);}
    };
    const watches=new Map();let watchCount=0;
    Object.defineProperty(root.navigator,'geolocation',{configurable:true,get:()=>geo});
  }catch{}

  // ---- Take Photo ----
  async function takePhoto(){
    try{
      const photo=await camera('getPhoto',{source:'CAMERA',resultType:'base64',quality:90,correctOrientation:true,saveToGallery:false,allowEditing:false});
      if(!photo||!photo.base64String)return null;
      const type=photo.format==='png'?'image/png':'image/jpeg';
      return new root.File([base64ToBytes(photo.base64String)],`photo-${Date.now()}.${photo.format==='png'?'png':'jpg'}`,{type,lastModified:Date.now()});
    }catch(error){
      const message=String(error&&error.message||'');
      if(/cancel/i.test(message))return null;
      if(/denied|access|permission/i.test(message))host.toast('Camera access is off. Open iPhone Settings, PhotoNotes AI, and turn on Camera.',6000);
      else host.toast('The camera could not open. Try again.');
      return null;
    }
  }

  // ---- Record Notes ----
  // phase: idle, starting, recording, interrupted, stopping, transcribing, kept
  let phase='idle',session=null,ticker=0,lastStatus={seconds:0},silentSince=0,pending=null;
  const ids={button:'dictate',status:'dictationStatus',note:'note',retry:'dictationRetryTranscription'};
  const el=id=>doc()&&doc().getElementById(id);

  function render(){
    const button=el(ids.button),status=el(ids.status);
    if(button){
      button.classList.toggle('on',phase==='recording'||phase==='interrupted');
      button.disabled=phase==='starting'||phase==='stopping'||phase==='transcribing';
      button.textContent=({starting:'Starting Recording...',recording:'Stop Recording',interrupted:'Stop Recording',stopping:'Saving Recording...',transcribing:'Turning Recording into Words...'})[phase]||'Record Notes';
      button.setAttribute('aria-pressed',phase==='recording'||phase==='interrupted'?'true':'false');
    }
    if(!status)return;
    if(phase==='recording'){
      const silent=silentSince&&Date.now()-silentSince>8000;
      status.textContent=`Recording ${clock(lastStatus.seconds)}. Recording continues if you lock the screen or switch apps.${silent?' No sound is reaching the microphone. Check that nothing covers it.':''}`;
    }else if(phase==='interrupted')status.textContent=`Recording paused by a call or another app at ${clock(lastStatus.seconds)}. It continues in this note when the call ends.`;
    else if(phase==='transcribing')status.textContent='Turning your recording into words. You can keep working.';
    else if(phase==='stopping')status.textContent='Saving the recording on this iPhone...';
  }
  function startTicker(){
    clearInterval(ticker);
    ticker=setInterval(async()=>{
      if(phase!=='recording'&&phase!=='interrupted'){clearInterval(ticker);return;}
      if(doc()&&doc().hidden)return;
      try{applyStatus(await call('recordStatus'));}catch{}
    },1000);
  }
  function applyStatus(data){
    if(!data)return;
    lastStatus=data;
    if(typeof data.level==='number'){if(data.level<-55){if(!silentSince)silentSince=Date.now();}else silentSince=0;}
    // Only a recording in progress follows the native state; a late status never undoes Stop.
    if(phase==='recording'||phase==='interrupted'||phase==='starting'){
      if(data.state==='recording')phase='recording';
      else if(data.state==='interrupted')phase='interrupted';
      else if(data.state==='idle'&&phase!=='starting'&&session&&!pending){
        // Stopped natively (time limit). Turn it into words like a normal Stop.
        void finishRecording(session,data.reason==='limit'?'The recording reached the two-hour limit and was stopped.':'');
      }
    }
    render();
  }
  try{plugin.addListener&&plugin.addListener('recordingState',applyStatus);}catch{}

  function currentNote(){return el(ids.note);}
  // The same capture is still open. A recording started before the photo was taken belongs to that photo.
  function sameCapture(rec){
    const current=host.photo();
    if(rec.photo&&current!==rec.photo)return false;
    if(!rec.photo&&current)rec.photo=current;
    return true;
  }
  // Words go into the note only if the same capture is still open; otherwise they wait under Recordings On This iPhone.
  function place(rec,text){
    if(rec&&rec.placedIds.includes(rec.id))return true;
    const note=currentNote();
    if(!rec||!note||!note.isConnected||!sameCapture(rec))return false;
    if(text){note.value=appendWords(note.value,text);note.dispatchEvent(new root.Event('input',{bubbles:true}));}
    rec.placedIds.push(rec.id);
    void call('markPlaced',{id:rec.id}).catch(()=>{});
    host.placed(rec.id);
    return true;
  }
  function clearRetry(){el(ids.retry)?.remove();}
  // Reliability report for Admin, Record Notes reliability: outcome and timing only, never words or audio.
  function report(rec,outcome,code){
    try{
      const words=String(rec.text||'').trim().split(/\s+/).filter(Boolean).length;
      void root.fetch('/api/transcription/outcome',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({surface:'capture',outcome,mode:'native',seconds:rec.seconds||0,words,interrupted:!!rec.interrupted,reason:code||'',attempts:rec.attempts||1,touch:true})}).catch(()=>{});
    }catch{}
  }
  function showKept(rec,message){
    phase='idle';render();
    const status=el(ids.status);if(!status)return;
    clearRetry();
    status.textContent=message||'The recording is saved on this iPhone. Its words will be added when the connection returns.';
    const button=doc().createElement('button');button.type='button';button.className='btn secondary';button.id=ids.retry;button.textContent='Transcribe Recording';
    button.onclick=()=>{button.disabled=true;button.textContent='Transcribing...';void transcribeInto(rec,true);};
    status.after(button);
  }
  async function transcribeInto(rec,manual){
    phase='transcribing';render();clearRetry();
    rec.attempts=(rec.attempts||0)+1;
    try{
      const result=await call('transcribe',{id:rec.id});
      rec.text=result.text||'';rec.transcribed=true;
      report(rec,rec.attempts>1?'retried':rec.text?'live':'empty');
      phase='idle';render();
      const status=el(ids.status);
      if(place(rec,rec.text)){if(status)status.textContent=rec.text?'Words added from your recording. Review them before saving.':'No words were found in the recording.';}
      else{host.toast('Your recording was turned into words. Find them under Recordings On This iPhone.',5000);if(status)status.textContent='';}
      return true;
    }catch(error){
      rec.error=String(error&&error.message||'The words could not be prepared right now.');
      if(rec.attempts===1)report(rec,'kept',String(error&&error.code||'native'));
      if(sameCapture(rec))showKept(rec,rec.error);
      else{phase='idle';render();}
      if(!manual)scheduleRetry();
      return false;
    }finally{if(pending===rec)pending=null;}
  }
  let retryTimer=0;
  function scheduleRetry(){clearTimeout(retryTimer);retryTimer=setTimeout(()=>void retryKept(),30000);}
  async function retryKept(){
    if(doc()&&doc().hidden)return;
    const rec=session&&!session.transcribed&&session.stopped?session:null;
    if(rec&&!pending&&phase==='idle'){pending=rec;rec.promise=transcribeInto(rec,false);await rec.promise;}
  }
  if(root.addEventListener)root.addEventListener('online',()=>void retryKept());
  if(doc())doc().addEventListener('visibilitychange',()=>{if(!doc().hidden){void retryKept();if(phase==='recording'||phase==='interrupted')void call('recordStatus').then(applyStatus,()=>{});}});

  async function startRecording(){
    if(phase!=='idle')return;
    const account=await host.account();
    if(!account){host.toast('Sign in before recording.');return;}
    phase='starting';render();clearRetry();
    try{
      const result=await call('recordStart',{account,language:speechLanguage(host.language())});
      session={id:result.id,photo:host.photo(),note:currentNote(),placedIds:[],stopped:false,transcribed:false,text:''};
      phase='recording';lastStatus={seconds:0};silentSince=0;render();startTicker();
    }catch(error){
      phase='idle';render();
      const status=el(ids.status);if(status)status.textContent=String(error&&error.message||'Recording could not start.');
    }
  }
  async function finishRecording(rec,notice){
    if(pending)return pending.promise;
    phase='stopping';render();clearInterval(ticker);
    const done={};pending=rec;
    done.promise=(async()=>{
      try{const stopped=await call('recordStop');rec.seconds=Number(stopped&&stopped.seconds)||0;rec.interrupted=!!(stopped&&stopped.interrupted);}
      catch(error){if(!/No recording/i.test(String(error&&error.message)))throw error;}
      rec.stopped=true;
      if(notice)host.toast(notice,5000);
      return transcribeInto(rec,false);
    })().catch(()=>{
      // Stop did not reach the recorder. Show the recorder's real state so Stop Recording can be tapped again.
      if(pending===rec)pending=null;
      phase='idle';render();
      void call('recordStatus').then(data=>{if(data&&data.state!=='idle'&&!pending){phase=data.state==='interrupted'?'interrupted':'recording';lastStatus=data;render();startTicker();}},()=>{});
      const status=el(ids.status);if(status)status.textContent='The recording could not be stopped. Tap Stop Recording again.';
      return false;
    });
    rec.promise=done.promise;
    return done.promise;
  }
  async function toggle(){
    if(phase==='idle')return startRecording();
    if((phase==='recording'||phase==='interrupted')&&session)return void finishRecording(session);
  }
  // Save waits for the words. When they cannot be prepared (no connection), the person decides.
  let declined=false;
  function keepEditing(){const value=declined;declined=false;return value;}
  async function finish(){
    declined=false;
    const ready=await finishWords();
    declined=!ready;
    return ready;
  }
  async function finishWords(){
    if(!session)return true;
    let ok=true;
    if(phase==='recording'||phase==='interrupted')ok=await finishRecording(session);
    else if(pending&&pending.promise)ok=await pending.promise;
    else if(session.stopped&&!session.transcribed&&sameCapture(session))ok=await transcribeInto(session,true);
    if(ok)return true;
    if(!sameCapture(session))return true;
    return root.confirm('Your recording could not be turned into words yet, usually because there is no connection.\n\nChoose OK to save now without the spoken words. The recording stays on this iPhone under Recordings On This iPhone, where you can turn it into words later.\n\nChoose Cancel to keep this screen open and try again.');
  }
  // A new photo, Cancel Photo or signing out ends the recording. It is kept, never discarded.
  function cancel(reason){
    if(!session)return;
    const rec=session;
    if(phase==='recording'||phase==='interrupted'){void finishRecording(rec).then(()=>{});if(reason)host.toast(reason,5000);}
  }
  // The recordings whose words are in a PhotoNote being saved. Removed after that PhotoNote uploads.
  function attach(payload){
    if(!payload)return payload;
    if(!session||phase!=='idle'||pending)return payload;
    const list=session.placedIds.length&&(session.photo||null)===(payload.photo||null)?session.placedIds.slice():[];
    if(list.length)payload._nativeRecordings=list;
    // This recording now belongs to the saved PhotoNote; the next capture starts fresh.
    if(session.transcribed)session=null;
    return payload;
  }
  // Signing out stops a recording and keeps its audio on this iPhone, without sending it.
  async function release(){
    if(phase==='recording'||phase==='interrupted'){try{await call('recordStop');}catch{}}
    session=null;phase='idle';clearInterval(ticker);render();
  }
  // The page reloaded while recording (for example, iOS restarted the web view in the background):
  // the native recording kept going, so this page continues it.
  function adopt(){
    call('recordStatus').then(data=>{
      if(!data||data.state==='idle'||!data.id||session)return;
      session={id:data.id,photo:null,note:null,placedIds:[],stopped:false,transcribed:false,text:''};
      phase=data.state==='interrupted'?'interrupted':'recording';lastStatus=data;render();startTicker();
    },()=>{});
  }
  adopt();
  function uploaded(payload){for(const id of recordingIds(payload))void call('deleteRecording',{id}).catch(()=>{});}
  function mount(){
    // Capture was drawn again: keep the button and status in step with the native recorder.
    const button=el(ids.button);if(!button)return;
    render();
    if(session&&session.stopped&&!session.transcribed&&!pending&&session.photo&&host.photo()===session.photo)showKept(session,session.error);
  }

  // ---- Recordings On This iPhone ----
  async function showRecordings(){
    const account=await host.account();if(!account)return;
    let list=[];
    try{list=(await call('recordings',{account})).recordings||[];}catch{host.toast('Recordings on this iPhone could not be read.');return;}
    doc().getElementById('nativeRecordingsDialog')?.remove();
    const dialog=doc().createElement('dialog');dialog.id='nativeRecordingsDialog';dialog.className='web-help-dialog';dialog.style.background='#fff';dialog.style.color='#000';
    const heading=doc().createElement('h2');heading.textContent='Recordings On This iPhone';dialog.append(heading);
    const intro=doc().createElement('p');intro.style.color='#000';
    intro.textContent=list.length?'Recordings stay here until the PhotoNote with their words has uploaded. Recordings without words are never removed automatically.':'No recordings are waiting on this iPhone.';
    dialog.append(intro);
    for(const item of list.slice().reverse()){
      const box=doc().createElement('section');box.className='native-recording';box.style.borderTop='1px solid #000';box.style.paddingTop='10px';box.style.marginTop='10px';
      const title=doc().createElement('p');title.style.color='#000';
      const when=new Date(item.createdAt).toLocaleString();
      title.textContent=`${when}, ${clock(item.seconds)}${item.interrupted?'. Recording was interrupted; the audio before that is kept.':''}`;
      box.append(title);
      const words=doc().createElement('p');words.style.color='#000';
      words.textContent=item.state==='recording'?'Recording now.':item.state==='transcribed'?(item.text||'No words were found in this recording.'):(item.error||'Not turned into words yet.');
      box.append(words);
      const button=(label,cls,handler)=>{const b=doc().createElement('button');b.type='button';b.className='btn secondary slim '+cls;b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await handler();}finally{b.disabled=false;}};box.append(b);return b;};
      if(item.state==='stopped')button('Transcribe Recording','native-recording-transcribe',async()=>{try{const r=await call('transcribe',{id:item.id});item.state='transcribed';item.text=r.text||'';words.textContent=item.text||'No words were found in this recording.';}catch(error){words.textContent=String(error&&error.message||'Still could not turn this recording into words.');}});
      if(item.state!=='recording'){
        button('Add Words to This Note','native-recording-add',async()=>{
          const note=currentNote();
          if(!note){host.toast('Open Capture first, then add the words.');return;}
          let text=item.text;
          if(item.state!=='transcribed'){try{text=(await call('transcribe',{id:item.id})).text||'';item.state='transcribed';item.text=text;}catch(error){words.textContent=String(error&&error.message||'Still could not turn this recording into words.');return;}}
          if(text){note.value=appendWords(note.value,text);note.dispatchEvent(new root.Event('input',{bubbles:true}));}
          void call('markPlaced',{id:item.id}).catch(()=>{});
          host.placed(item.id);host.toast(text?'Words added to the note.':'No words were found in this recording.');dialog.close();
        });
        if(item.text)button('Copy Words','native-recording-copy',async()=>{try{await root.navigator.clipboard.writeText(item.text);host.toast('Words copied.');}catch{host.toast('The words could not be copied.');}});
        button('Share Recording','native-recording-share',async()=>{try{await call('shareRecording',{id:item.id});}catch{host.toast('The recording could not be shared.');}});
        button('Delete Recording','native-recording-delete',async()=>{if(!root.confirm(item.state==='transcribed'?'Delete this recording from this iPhone?':'This recording has not been turned into words. Delete it from this iPhone anyway?'))return;try{await call('deleteRecording',{id:item.id});box.remove();}catch{host.toast('The recording could not be deleted.');}});
      }
      dialog.append(box);
    }
    const close=doc().createElement('button');close.type='button';close.className='btn';close.id='nativeRecordingsClose';close.textContent='Close';close.onclick=()=>dialog.close();dialog.append(close);
    dialog.addEventListener('close',()=>dialog.remove());
    doc().body.append(dialog);dialog.showModal();
  }
  // After the app was closed during a recording, offer its words once per launch.
  async function offerRecovered(){
    const account=await host.account();if(!account)return;
    try{
      const list=((await call('recordings',{account})).recordings||[]).filter(item=>!item.placed&&item.state!=='recording');
      if(list.length)host.toast(`${list.length} recording${list.length===1?' is':'s are'} saved on this iPhone. Open the account menu, Recordings On This iPhone.`,7000);
    }catch{}
  }
  // The account menu gets Recordings On This iPhone.
  if(doc()&&root.MutationObserver){
    const observer=new root.MutationObserver(()=>{
      const menu=doc().getElementById('profileMenu');
      if(menu&&!doc().getElementById('menuNativeRecordings')){
        const button=doc().createElement('button');button.type='button';button.id='menuNativeRecordings';button.textContent='Recordings On This iPhone';
        button.onclick=()=>{menu.hidden=true;void showRecordings();};
        menu.append(button);
      }
    });
    const start=()=>observer.observe(doc().body||doc().documentElement,{childList:true,subtree:true});
    if(doc().body)start();else doc().addEventListener('DOMContentLoaded',start);
  }
  let offered=false;
  function ready(){if(offered)return;offered=true;setTimeout(()=>void offerRecovered(),2500);}

  return {...helpers,enabled:()=>true,configure:options=>{configure(options);ready();},mount,toggle,finish,keepEditing,cancel,release,takePhoto,uploaded,attach,showRecordings,_state:()=>({phase,session})};
});
