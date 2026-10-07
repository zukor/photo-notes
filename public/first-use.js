/* Permissions belong to this device. Ask once per signed-in account here. */
(function(){
 const t=(en,es)=>window.photoNotesI18n?.getLanguage()==='es'?es:en;
 function offer(me){
  if(!me?.email||document.getElementById('firstUseSetup'))return false;
  const key='pn_first_use_v1:'+encodeURIComponent(me.email);
  try{if(localStorage.getItem(key))return false;}catch{}
  const owner=me.email,phone=/Android|iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const installed=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const steps=['microphone','camera','location',...(phone&&!installed?['icon']:[])];let index=0,busy=false;
  const dialog=document.createElement('dialog');dialog.id='firstUseSetup';dialog.className='first-use-dialog';
  dialog.innerHTML='<h2 id="firstUseTitle"></h2><p id="firstUseStatus" role="status" aria-live="polite"></p><div class="first-use-actions"><button class="btn" id="firstUseYes" type="button"></button><button class="btn secondary" id="firstUseNext" type="button"></button></div>';
  dialog.setAttribute('aria-labelledby','firstUseTitle');document.body.append(dialog);
  const q=id=>dialog.querySelector('#'+id);
  function complete(){try{localStorage.setItem(key,'done');localStorage.setItem('pn_install_prompt_dismissed_v1','setup-seen');}catch{}dialog.close();}
  function current(){return typeof state==='undefined'||state.me?.email===owner;}
  function show(){if(!current()){dialog.close();return;}if(index>=steps.length){complete();return;}busy=false;q('firstUseYes').disabled=false;q('firstUseYes').hidden=false;q('firstUseStatus').textContent='';q('firstUseTitle').textContent=steps[index]==='microphone'?t('Activate your microphone?','¿Activar su micrófono?'):steps[index]==='camera'?t('Activate your camera?','¿Activar su cámara?'):steps[index]==='location'?t('Allow location access?','¿Permitir acceso a su ubicación?'):t('Add the icon to your Home Screen?','¿Agregar el icono a su pantalla de inicio?');q('firstUseYes').textContent=t('Yes','Sí');q('firstUseNext').textContent=t('Not Now','Ahora no');q('firstUseYes').focus();}
  q('firstUseNext').onclick=()=>{index++;show();};
  q('firstUseYes').onclick=async()=>{
   if(busy||!current())return;
   if(steps[index]==='icon'){
    q('firstUseTitle').textContent=t('Add Photo Notes to your Home Screen','Agregar Photo Notes a su pantalla de inicio');
    q('firstUseYes').hidden=true;q('firstUseNext').textContent=t('Done','Listo');
    const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    if(ios){q('firstUseStatus').textContent=t('In Safari: Share → Add to Home Screen → Add.','En Safari: Compartir → Agregar a pantalla de inicio → Agregar.');return;}
    const prompt=typeof deferredInstallPrompt==='undefined'?null:deferredInstallPrompt;
    if(prompt){deferredInstallPrompt=null;await prompt.prompt();await prompt.userChoice.catch(()=>{});if(dialog.isConnected)complete();}
    else q('firstUseStatus').textContent=t('In Chrome: ⋮ → Install app or Add to Home screen → Install or Add.','En Chrome: ⋮ → Instalar app o Agregar a pantalla de inicio → Instalar o Agregar.');
    return;
   }
   busy=true;q('firstUseYes').disabled=true;
   const step=steps[index];
   try{
    if(step==='location'){
     if(!navigator.geolocation)throw new Error('unsupported');
     await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(()=>resolve(),reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
    }else{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('unsupported');
    const stream=await navigator.mediaDevices.getUserMedia(step==='microphone'?{audio:true}:{video:{facingMode:{ideal:'environment'}}});
    stream.getTracks().forEach(track=>track.stop());
    }
    if(!dialog.open||!current())return;
    if(steps[index]!==step)return;
    index++;show();
   }catch(error){if(!dialog.open||steps[index]!==step)return;q('firstUseStatus').textContent=(error.name==='NotAllowedError'||(step==='location'&&error.code===1))?t('Access was not allowed. You can allow it in your browser settings or continue.','Acceso no permitido. Puede permitirlo en los ajustes del navegador o continuar.'):t('Could not activate it. You can try again or continue.','No se pudo activar. Puede intentarlo de nuevo o continuar.');q('firstUseYes').textContent=t('Try Again','Intentar de nuevo');q('firstUseNext').textContent=t('Continue','Continuar');}
   finally{busy=false;q('firstUseYes').disabled=false;}
  };
  dialog.addEventListener('cancel',()=>{try{localStorage.setItem(key,'done');localStorage.setItem('pn_install_prompt_dismissed_v1','setup-seen');}catch{}});
  dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();show();return true;
 }
 window.PhotoNotesFirstUse={offer};
})();
