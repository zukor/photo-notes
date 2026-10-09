(()=>{
  let screen='',edition='',session=crypto.randomUUID(),last=Date.now(),interaction=Date.now(),userId=null,seconds=0,visible=document.visibilityState==='visible';
  function accrue(){
    const now=Date.now();
    if(userId&&visible)seconds+=Math.max(0,Math.min(now,interaction+60000)-last)/1000;
    last=now;
  }
  function pulse(visit=false){
    accrue();
    const count=Math.min(30,Math.floor(seconds));seconds=0;
    if(!userId||!screen||(!visit&&!count))return;
    fetch('/api/usage/pulse',{method:'POST',credentials:'same-origin',keepalive:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({session,screen,edition,seconds:count,visit})}).catch(()=>{});
  }
  window.PhotoNotesUsage={screen(view,product,user){
    if(!user){userId=null;screen='';seconds=0;return;}
    if(userId!==user.id){userId=user.id;session=crypto.randomUUID();screen='';seconds=0;last=Date.now();}
    if(screen===view&&edition===product)return;
    pulse();screen=view;edition=product||'general';last=Date.now();interaction=last;pulse(true);
  }};
  ['pointerdown','keydown','scroll','touchstart'].forEach(type=>document.addEventListener(type,()=>{accrue();interaction=Date.now();},{passive:true}));
  document.addEventListener('visibilitychange',()=>{pulse();visible=document.visibilityState==='visible';last=Date.now();});
  window.addEventListener('pagehide',()=>pulse());
  setInterval(()=>pulse(),30000);
})();
