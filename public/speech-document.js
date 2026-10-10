(()=>{
 'use strict';
 let frame=null,ready=false,failed=false,notify=()=>{},timer=null;
 const report=()=>notify({ready,failed});
 function dispose(){clearTimeout(timer);timer=null;frame?.remove();frame=null;ready=false;failed=false;}
 function reset(){
  dispose();report();const next=document.createElement('iframe');frame=next;
  next.hidden=true;next.title='Capture speech session';next.allow='microphone';
  const finish=ok=>{if(frame!==next)return;clearTimeout(timer);timer=null;ready=ok;failed=!ok;report();};
  next.onload=()=>{try{finish(!!(next.contentWindow.SpeechRecognition||next.contentWindow.webkitSpeechRecognition));}catch{finish(false);}};
  next.onerror=()=>finish(false);timer=setTimeout(()=>finish(false),10000);
  next.src='/speech-session-frame.html';document.body.append(next);
 }
 window.PhotoNotesSpeechDocument={prepare(callback){notify=callback;if(!frame)reset();else report();},reset,dispose,constructor(){if(!ready)return null;try{return frame.contentWindow.SpeechRecognition||frame.contentWindow.webkitSpeechRecognition;}catch{return null;}}};
 window.addEventListener('pagehide',dispose);
})();
