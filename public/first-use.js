/* One-tap first-use setup. Permissions belong to this device, and on iPhone
   the Home Screen app has its own permissions, so this runs once per signed-in
   account in each browser or installed app. */
(function(){
 const t=(en,es)=>window.photoNotesI18n?.getLanguage()==='es'?es:en;
 const KEY='pn_first_use_v1:';
 const isIOS=()=>/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const isPhone=()=>/Android|iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const isInstalled=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const ITEMS=[['microphone',()=>t('Microphone','Micrófono'),()=>t('for Record Notes','para Grabar notas')],['camera',()=>t('Camera','Cámara'),()=>t('for photos','para fotos')],['location',()=>t('Location','Ubicación'),()=>t('to show where each photo was taken','para mostrar dónde se tomó cada foto')]];
 const LABEL={waiting:()=>t('Not on yet','Aún no activado'),working:()=>t('Asking...','Solicitando...'),allowed:()=>t('On','Activado'),denied:()=>t('Not allowed','No permitido'),failed:()=>t('Could not turn on','No se pudo activar'),unsupported:()=>t('Not available here','No disponible aquí')};
 const stopAll=stream=>{try{stream?.getTracks().forEach(track=>track.stop());}catch{}};
 const denied=error=>error&&(error.name==='NotAllowedError'||error.name==='SecurityError'||error.code===1);

 async function requestMedia(kinds){
  const want={};if(kinds.includes('microphone'))want.audio=true;if(kinds.includes('camera'))want.video={facingMode:{ideal:'environment'}};
  const stream=await navigator.mediaDevices.getUserMedia(want);stopAll(stream);
 }
 function requestLocation(){
  return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(()=>resolve(),reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
 }

 function offer(me){
  if(!me?.email||document.getElementById('firstUseSetup'))return false;
  const key=KEY+encodeURIComponent(me.email);
  try{if(localStorage.getItem(key))return false;}catch{}
  const account=me.email,wantIcon=isPhone()&&!isInstalled();
  const status={microphone:'waiting',camera:'waiting',location:'waiting'};let busy=false,phase='permissions';
  const dialog=document.createElement('dialog');dialog.id='firstUseSetup';dialog.className='first-use-dialog';dialog.setAttribute('aria-labelledby','firstUseTitle');
  dialog.innerHTML='<h2 id="firstUseTitle"></h2><p id="firstUseIntro"></p><ul class="first-use-list" id="firstUseList"></ul><div id="firstUseIcon" class="first-use-icon" hidden></div><p id="firstUseStatus" role="status" aria-live="polite"></p><div class="first-use-actions"><button class="btn" id="firstUseYes" type="button"></button><button class="btn secondary" id="firstUseNext" type="button"></button></div>';
  document.body.append(dialog);
  const q=id=>dialog.querySelector('#'+id);
  const current=()=>typeof state==='undefined'||state.me?.email===account;
  function finish(){try{localStorage.setItem(key,'done');localStorage.setItem('pn_install_prompt_dismissed_v1','setup-seen');}catch{}if(dialog.open)dialog.close();}
  function renderList(){
   q('firstUseList').innerHTML='';
   for(const [id,name,why] of ITEMS){
    const li=document.createElement('li');li.dataset.permission=id;li.className='first-use-item '+status[id];
    const label=document.createElement('span');label.className='first-use-name';label.textContent=name()+' ';
    const reason=document.createElement('span');reason.className='first-use-why';reason.textContent=why();
    const badge=document.createElement('strong');badge.className='first-use-state';badge.textContent=LABEL[status[id]]();
    label.append(reason);li.append(label,badge);q('firstUseList').append(li);
   }
  }
  function showPermissions(){
   phase='permissions';q('firstUseTitle').textContent=t('Set up PhotoNotes','Configurar PhotoNotes');
   q('firstUseIntro').textContent=t('One tap turns on everything PhotoNotes needs. Your phone will ask you to allow each one.','Un toque activa todo lo que PhotoNotes necesita. Su teléfono le pedirá permitir cada uno.');
   q('firstUseIcon').hidden=true;q('firstUseList').hidden=false;renderList();
   q('firstUseYes').hidden=false;q('firstUseYes').disabled=false;q('firstUseYes').textContent=t('Turn On Everything','Activar todo');
   q('firstUseNext').textContent=t('Not Now','Ahora no');q('firstUseYes').focus();
  }
  function iconSteps(){
   if(isIOS())return [t('Tap the Share button in Safari. It is a square with an arrow pointing up. On some iPhones, tap the three dots first, then Share.','Toque el botón Compartir en Safari. Es un cuadrado con una flecha hacia arriba. En algunos iPhone, toque primero los tres puntos y luego Compartir.'),t('Scroll down and tap Add to Home Screen.','Desplácese hacia abajo y toque Agregar a pantalla de inicio.'),t('Tap Add. Then open PhotoNotes from the new icon.','Toque Agregar. Luego abra PhotoNotes desde el nuevo icono.'),t('iPhone asks for permissions again in the Home Screen app. Tap Turn On Everything there once more.','El iPhone vuelve a pedir permisos en la app de la pantalla de inicio. Toque Activar todo allí una vez más.')];
   return [t('Tap the three dots menu in Chrome.','Toque el menú de tres puntos en Chrome.'),t('Tap Add to Home screen or Install app.','Toque Agregar a pantalla de inicio o Instalar app.'),t('Tap Install or Add.','Toque Instalar o Agregar.')];
  }
  function showIcon(){
   phase='icon';q('firstUseTitle').textContent=t('Add PhotoNotes to your Home Screen','Agregar PhotoNotes a su pantalla de inicio');
   q('firstUseIntro').textContent=t('Open PhotoNotes like an app, straight from its icon.','Abra PhotoNotes como una app, directamente desde su icono.');
   q('firstUseList').hidden=true;q('firstUseStatus').textContent='';
   const prompt=typeof deferredInstallPrompt==='undefined'?null:deferredInstallPrompt;
   const box=q('firstUseIcon');box.hidden=false;box.innerHTML='';
   if(prompt&&!isIOS()){
    const p=document.createElement('p');p.textContent=t('Tap Add to Home Screen, then confirm.','Toque Agregar a pantalla de inicio y luego confirme.');box.append(p);
    q('firstUseYes').hidden=false;q('firstUseYes').disabled=false;q('firstUseYes').textContent=t('Add to Home Screen','Agregar a pantalla de inicio');
   }else{
    const list=document.createElement('ol');for(const step of iconSteps()){const li=document.createElement('li');li.textContent=step;list.append(li);}box.append(list);
    q('firstUseYes').hidden=true;
   }
   q('firstUseNext').textContent=t('Done','Listo');q(q('firstUseYes').hidden?'firstUseNext':'firstUseYes').focus();
  }
  function summary(){
   const off=ITEMS.filter(([id])=>status[id]!=='allowed').map(([,name])=>name());
   if(!off.length)return t('Everything is on.','Todo está activado.');
   return t('Not turned on: ','Sin activar: ')+off.join(', ')+'. '+t('You can allow them later in your browser or phone settings. Typing notes and choosing photos still work.','Puede permitirlos después en los ajustes del navegador o del teléfono. Escribir notas y elegir fotos sigue funcionando.');
  }
  async function turnOnEverything(){
   busy=true;q('firstUseYes').disabled=true;q('firstUseNext').disabled=true;
   const media=['microphone','camera'];
   try{
    if(!navigator.mediaDevices?.getUserMedia){media.forEach(id=>status[id]='unsupported');}
    else{
     media.forEach(id=>status[id]='working');renderList();
     // One combined request shows a single camera-and-microphone prompt on most phones.
     try{await requestMedia(media);media.forEach(id=>status[id]='allowed');}
     catch(error){
      if(!dialog.open||!current())return;
      // Ask separately so one refusal does not block the other.
      for(const id of media){
       try{await requestMedia([id]);status[id]='allowed';}catch(e){status[id]=denied(e)?'denied':(e&&e.name==='NotFoundError')?'unsupported':'failed';}
       if(!dialog.open||!current())return;
      }
     }
    }
    if(!dialog.open||!current())return;
    renderList();
    if(!navigator.geolocation)status.location='unsupported';
    else{status.location='working';renderList();try{await requestLocation();status.location='allowed';}catch(e){status.location=denied(e)?'denied':'failed';}}
    if(!dialog.open||!current())return;
    renderList();q('firstUseStatus').textContent=summary();
    if(wantIcon&&ITEMS.every(([id])=>status[id]==='allowed')){setTimeout(()=>{if(dialog.open&&phase==='permissions')showIcon();},900);return;}
    q('firstUseYes').hidden=!ITEMS.some(([id])=>['failed','denied'].includes(status[id]));q('firstUseYes').textContent=t('Try Again','Intentar de nuevo');
    q('firstUseNext').textContent=wantIcon?t('Continue','Continuar'):t('Done','Listo');
   }finally{busy=false;q('firstUseYes').disabled=false;q('firstUseNext').disabled=false;}
  }
  q('firstUseYes').onclick=async()=>{
   if(busy||!current())return;
   if(phase==='icon'){
    const prompt=typeof deferredInstallPrompt==='undefined'?null:deferredInstallPrompt;
    if(!prompt){showIcon();return;}
    deferredInstallPrompt=null;try{await prompt.prompt();await prompt.userChoice;}catch{}
    finish();return;
   }
   q('firstUseStatus').textContent='';await turnOnEverything();
  };
  q('firstUseNext').onclick=()=>{if(busy)return;if(phase==='permissions'&&wantIcon){showIcon();return;}finish();};
  dialog.addEventListener('cancel',()=>{try{localStorage.setItem(key,'done');localStorage.setItem('pn_install_prompt_dismissed_v1','setup-seen');}catch{}});
  dialog.addEventListener('close',()=>dialog.remove());
  dialog.showModal();showPermissions();return true;
 }
 window.PhotoNotesFirstUse={offer};
})();
