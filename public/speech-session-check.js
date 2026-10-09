(()=>{
 'use strict';
 const el=name=>document.getElementById('speechCheck'+name),SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 const audioSession=navigator.audioSession,originalAudioType=audioSession?.type;
 const audioInfo=()=>({supported:!!audioSession,type:audioSession?.type||'unavailable',state:audioSession?.state||'unavailable'});
 const attempts=[];let recognizer=null,active=null,timer=null;
 const event=(row,name,extra={})=>{row.events.push({at:new Date().toISOString(),event:name,...extra});};
 function render(){el('Results').replaceChildren(...attempts.map(row=>{const li=document.createElement('li');li.textContent=`Attempt ${row.attempt}, ${row.method}: ${row.results} result events, ${row.finished?'ended':'in progress'}.`;return li;}));}
 function finish(row){if(active!==row)return;clearTimeout(timer);timer=null;row.finished=true;active=null;el('Start').disabled=!SR;el('Stop').disabled=true;el('Method').disabled=attempts.length>0;el('Audio').disabled=attempts.length>0;el('Status').textContent=row.results?'Words were detected. Start another attempt.':'No words were detected. Start another attempt or download the timing.';render();}
 el('Start').onclick=()=>{
  if(active||!SR)return;
  const row={attempt:attempts.length+1,method:el('Method').value,results:0,finished:false,events:[]};attempts.push(row);active=row;
  el('Start').disabled=true;el('Stop').disabled=false;el('Method').disabled=true;el('Audio').disabled=true;el('Status').textContent='Starting speech recognition...';event(row,'request');render();
  try{
   if(el('Audio').value==='play-and-record'){if(!audioSession){event(row,'audio-session-unavailable');finish(row);el('Status').textContent='Audio session control is unavailable. Reload and use Browser default.';return;}audioSession.type='play-and-record';}
   event(row,'audio-session',audioInfo());
   if(row.method==='fresh'||!recognizer)recognizer=new SR();
   const session=recognizer;session.lang='en-US';session.continuous=false;session.interimResults=true;
   for(const name of ['start','audiostart','soundstart','speechstart','speechend','soundend','audioend','nomatch'])session['on'+name]=()=>{if(active!==row)return;event(row,name);if(name==='start')el('Status').textContent='Listening. Speak harmless test words.';};
   session.onresult=()=>{if(active!==row)return;row.results++;event(row,'result');el('Status').textContent='Words detected. Pause until the attempt ends.';render();};
   session.onerror=e=>{if(active!==row)return;const code=['no-speech','aborted','audio-capture','network','not-allowed','service-not-allowed','bad-grammar','language-not-supported'].includes(e.error)?e.error:'other';event(row,'error',{code});finish(row);};
   session.onend=()=>{if(active!==row)return;event(row,'end',audioInfo());finish(row);};
   timer=setTimeout(()=>{if(active!==row)return;event(row,'timeout');finish(row);try{session.abort();}catch{}},45000);
   session.start();
  }catch{event(row,'start-failed');finish(row);}
 };
 el('Stop').onclick=()=>{if(!active)return;event(active,'stop');try{recognizer.stop();}catch{finish(active);}};
 el('Clear').onclick=()=>location.reload();
 el('Download').onclick=()=>{const blob=new Blob([JSON.stringify({check:'speech-session-comparison-v1',browser:navigator.userAgent,attempts},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='photo-notes-speech-timing.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 window.addEventListener('pagehide',()=>{clearTimeout(timer);active=null;try{recognizer?.abort();}catch{}try{if(audioSession&&originalAudioType)audioSession.type=originalAudioType;}catch{}});
 if(!SR){el('Start').disabled=true;el('Status').textContent='Speech recognition is unavailable in this browser.';}
})();
