/* Shared Photo Notes shortcuts. Preferences are stored on the signed-in account across clients. */
(function () {
  const t=(en,es)=>window.photoNotesI18n?.getLanguage()==='es'?es:en;
  async function fetchShortcuts(path='',method='GET',body){
    const response=await api('/api/send-shortcuts'+path,{method,headers:{'Content-Type':'application/json','X-Photo-Notes-Shortcuts':'1'},...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Shortcuts unavailable');return data;
  }
  function valid(type,target){
    if(type==='email')return /^[^\s@?,&#]+@[^\s@?,&#]+\.[^\s@?,&#]+$/.test(target);
    if(type==='sms')return /^\+?[\d ()-]{3,30}$/.test(target);
    if(type==='website'){try{const url=new URL(target);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}}
    return type==='ramo'&&isConcreteClient()&&!!state.me.ramo_intake_access;
  }
  function open(){
    if(!state.me)return;
    const owner=state.me?.id||state.me?.email;
    const request=async(...args)=>{if((state.me?.id||state.me?.email)!==owner)throw new Error('Account changed');const data=await fetchShortcuts(...args);if((state.me?.id||state.me?.email)!==owner)throw new Error('Account changed');return data;};
    document.getElementById('sendShortcutsDialog')?.remove();
    const modal=document.createElement('div');modal.id='sendShortcutsDialog';modal.className='export-share-modal';
    modal.innerHTML=`<section class="export-share-dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-labelledby="shortcutsTitle"><h2 id="shortcutsTitle" tabindex="-1">${t('Select Shortcut','Seleccionar atajo')}</h2><div id="shortcutChooser"><label for="shortcutSelect" class="shortcut-select-label">${t('Select Shortcut','Seleccionar atajo')}</label><select id="shortcutSelect" aria-describedby="shortcutSelectHelp" disabled><option value="">${t('Select Shortcut','Seleccionar atajo')}</option></select><p id="shortcutSelectHelp">${t('Choose where to send these PhotoNotes.','Elija dónde enviar estas PhotoNotes.')}</p><p id="shortcutEmpty" hidden>${t('No saved shortcuts yet. Create your first shortcut below.','Todavía no hay atajos guardados. Cree su primer atajo abajo.')}</p><div id="shortcutReady"></div><button type="button" id="shortcutDelete" class="btn secondary" hidden>${t('Delete selected shortcut','Eliminar el atajo seleccionado')}</button><button type="button" id="shortcutCreate" class="btn secondary">${t('Create New Shortcut','Crear nuevo atajo')}</button></div><form id="shortcutForm" hidden><label for="shortcutName">${t('Shortcut name','Nombre del atajo')}</label><input id="shortcutName" placeholder="${t('Enter shortcut name here','Escriba el nombre del atajo aquí')}" maxlength="80" required><label for="shortcutType">${t('Send using','Enviar mediante')}</label><select id="shortcutType"><option value="email">${t('Email','Correo')}</option><option value="sms">${t('Text message','Mensaje de texto')}</option><option value="website">${t('Website upload page','Página web para cargar archivos')}</option>${isConcreteClient()&&state.me.ramo_intake_access?`<option value="ramo">${t('Ramo change-order review','Revisión de órdenes de cambio en Ramo')}</option>`:''}</select><label for="shortcutTarget" id="shortcutTargetLabel"></label><input id="shortcutTarget" maxlength="2048" required><p id="shortcutHelp"></p></form><p id="shortcutStatus" role="status" aria-live="polite"></p><div class="shortcut-footer"><button class="btn secondary" id="shortcutSave" type="submit" form="shortcutForm" hidden>${t('Save Shortcut','Guardar atajo')}</button><button type="button" id="shortcutClose" class="btn secondary">${t('Close','Cerrar')}</button></div></section>`;
    document.body.appendChild(modal);
    const q=id=>modal.querySelector('#'+id),status=msg=>q('shortcutStatus').textContent=msg;
    const close=()=>{modal.remove();document.getElementById('sendshortcuts')?.focus();};
    q('shortcutClose').onclick=()=>q('shortcutForm').hidden?close():showSetup(false);modal.onclick=e=>{if(e.target===modal)close();};
    modal.onkeydown=e=>{if(e.key==='Escape')close();if(e.key==='Tab'){const els=[...modal.querySelectorAll('button,input,select,a')].filter(x=>!x.hidden&&!x.disabled&&x.getClientRects().length),first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
    function help(){const type=q('shortcutType').value;q('shortcutTarget').hidden=type==='ramo';q('shortcutTarget').required=type!=='ramo';q('shortcutTargetLabel').hidden=type==='ramo';q('shortcutTargetLabel').textContent=type==='email'?t('Email address','Dirección de correo'):type==='sms'?t('Phone number','Número de teléfono'):t('Website page address','Dirección de la página web');q('shortcutHelp').textContent=type==='ramo'?t('Opens the existing group review. Ramo assigns the project and change order.','Abre la revisión del grupo. Ramo asigna el proyecto y la orden de cambio.'):type==='website'?t('Enter the address of the page where you upload files. This shortcut opens that page. Your PhotoNotes will be uploaded there.','Ingrese la dirección de la página donde carga archivos. Este atajo abre esa página. Sus PhotoNotes se cargarán allí.'):t('Send opens an addressed message with a PhotoNotes link valid for 7 days.','Enviar abre un mensaje al destinatario con un enlace de PhotoNotes válido por 7 días.');}
    let savedRows=[];
    function showSetup(setup){
      q('shortcutChooser').hidden=setup;q('shortcutForm').hidden=!setup;q('shortcutSave').hidden=!setup;
      q('shortcutsTitle').textContent=setup?t('Create New Shortcut','Crear nuevo atajo'):t('Select Shortcut','Seleccionar atajo');
      status('');q('shortcutReady').replaceChildren();q('shortcutDelete').hidden=true;q('shortcutSelect').value='';q('shortcutSelectHelp').hidden=false;q('shortcutCreate').hidden=false;q('shortcutClose').hidden=false;
      (setup?q('shortcutName'):q('shortcutSelect')).focus();
    }
    q('shortcutCreate').onclick=()=>showSetup(true);
    async function list(selected=''){
      q('shortcutSelect').disabled=true;
      try{savedRows=await request();if(!modal.isConnected)return;}catch{status(t('Saved shortcuts could not be read. Close and try again.','No se pudieron leer los atajos guardados. Cierre e inténtelo de nuevo.'));return;}
      const select=q('shortcutSelect');select.replaceChildren(new Option(t('Select Shortcut','Seleccionar atajo'),''));
      savedRows.forEach(row=>select.add(new Option(`${row.name} (${row.type==='ramo'?'Ramo':row.format==='docx'?'Word':row.format==='bundle'?'ZIP':'PDF'})`,String(row.id))));
      select.value=String(selected);select.disabled=!savedRows.length;q('shortcutEmpty').hidden=!!savedRows.length;
    }
    function selection(){
      status('');q('shortcutReady').replaceChildren();
      const row=savedRows.find(row=>String(row.id)===q('shortcutSelect').value),selected=!!row;
      q('shortcutSelectHelp').hidden=selected;q('shortcutCreate').hidden=selected;q('shortcutClose').hidden=selected;q('shortcutDelete').hidden=true;
      if(!row)return;
      const send=document.createElement('button');send.type='button';send.className='btn secondary';send.textContent=t('Send','Enviar');
      send.onclick=async()=>{
        if((state.me?.id||state.me?.email)!==owner)return;
        if(!valid(row.type,row.target)||!['pdf','docx','bundle'].includes(row.format)){status(t('This shortcut needs a valid destination.','Este atajo necesita un destino válido.'));return;}
        if(!state.selectedIds.size){status(t('Select at least one capture first.','Seleccione al menos una captura primero.'));return;}
        if(row.type==='ramo'){close();openRamoIntake();return;}
        send.disabled=true;
        try{
          if(row.type==='website'){
            if(window.PhotoNotesNative){const blob=await exportBlob(row.format,null);await window.PhotoNotesNative.share(blob,safeSharedFileName(row.format,null,row.format==='bundle'?'zip':row.format));}
            else await deliverExport(row.format,null,'download');
            const link=document.createElement('a');link.href=row.target;link.target='_blank';link.rel='noopener noreferrer';document.body.appendChild(link);link.click();link.remove();return;
          }
          const blob=await exportBlob(row.format,null),name=safeSharedFileName(row.format,null,row.format==='bundle'?'zip':row.format);
          const response=await api('/api/document-links?'+new URLSearchParams({format:row.format,name}),{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Photo-Notes-Share':'1'},body:blob});
          const data=await response.json();if(!response.ok||!data.path)throw Error('Could not prepare document');
          if((state.me?.id||state.me?.email)!==owner)return;
          const url=new URL(data.path,window.PhotoNotesNative?'https://photonotesapp.com':location.origin).href;
          const body='PhotoNotes: '+url;
          const link=document.createElement('a');link.href=row.type==='email'?`mailto:${row.target}?subject=PhotoNotes&body=${encodeURIComponent(body)}`:`sms:${row.target.replace(/[ ()-]/g,'')}?body=${encodeURIComponent(body)}`;
          document.body.appendChild(link);link.click();link.remove();
        }catch{status(t('Could not prepare the send. Please try again.','No se pudo preparar el envío. Inténtelo de nuevo.'));}finally{send.disabled=false;}
      };
      q('shortcutReady').append(send);
    }
    q('shortcutSelect').onchange=selection;

    q('shortcutType').onchange=help;
    q('shortcutForm').onsubmit=async e=>{e.preventDefault();const name=q('shortcutName').value.trim(),type=q('shortcutType').value,target=q('shortcutTarget').value.trim(),format=document.getElementById('sendformat')?.value||'pdf';if(!name||!valid(type,target)){status(t('Enter a name and a valid destination.','Ingrese un nombre y un destino válido.'));return;}const save=q('shortcutSave');save.disabled=true;try{await request('','POST',{name,type,target,format});q('shortcutName').value='';q('shortcutTarget').value='';q('shortcutReady').replaceChildren();showSetup(false);await list();status(t('Shortcut saved.','Atajo guardado.'));}catch{status(t('Could not save shortcut. Please try again.','No se pudo guardar el atajo. Inténtelo de nuevo.'));}finally{save.disabled=false;}};
    help();list();q('shortcutsTitle').focus();
  }
  window.PhotoNotesShortcuts={open};
})();
