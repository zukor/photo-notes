(()=>{
 'use strict';
 // Reset Safari's page-wide audio capture routing before a speech attempt.
 // Never keep a getUserMedia track alive alongside SpeechRecognition.
 let priming=false;
 async function primeMicrophone(isCurrent=()=>true){
  if(priming)throw new Error('Microphone initialization already in progress');
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access unavailable');
  priming=true;
  let retired=false,deadline;
  const request=Promise.resolve().then(()=>navigator.mediaDevices.getUserMedia({audio:true})).then(stream=>{
   if(retired){stream.getTracks().forEach(track=>track.stop());return null;}
   return stream;
  });
  try{
   const stream=await Promise.race([request,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Microphone initialization timed out')),15000);})]);
   clearTimeout(deadline);
   try{if(!isCurrent())return false;}finally{stream.getTracks().forEach(track=>track.stop());}
   // Let WebKit finish deactivating direct capture before speech takes ownership.
   await new Promise(resolve=>setTimeout(resolve,300));
   return isCurrent();
  }finally{retired=true;clearTimeout(deadline);priming=false;}
 }
 function create(){
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
 const api={prepare(callback){notify=callback;if(!frame)reset();else report();},reset,dispose,constructor(){if(!ready)return null;try{return frame.contentWindow.SpeechRecognition||frame.contentWindow.webkitSpeechRecognition;}catch{return null;}}};
 return api;
 }
 window.PhotoNotesSpeechDocument=create();
 window.PhotoNotesSpeechDocument.create=create;
 window.PhotoNotesSpeechDocument.primeMicrophone=primeMicrophone;
 window.addEventListener('pagehide',()=>window.PhotoNotesSpeechDocument.dispose());
})();
