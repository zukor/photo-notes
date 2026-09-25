/* Concrete Pro: one reviewed group is one Ramo intake submission. */
async function openRamoIntake(historyOnly=false) {
  const es=window.photoNotesI18n?.getLanguage()==='es',t=(en,sp)=>es?sp:en;
  const body=document.getElementById('body');
  const ids=Array.from(state.selectedIds||[]).map(Number);
  if(!historyOnly&&(!ids.length||ids.length>20)){toast(t('Select 1 to 20 photos for one change order.','Seleccione de 1 a 20 fotos para una orden de cambio.'));return;}
  const draftKey=`pn-ramo-draft:${state.me.email}`;
  const call=async(url,options)=>{const r=await api(url,options);const data=await r.json();if(!r.ok)throw new Error(data.error||'submission_unavailable');return data;};
  const post=(url,data)=>call(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const errorText=code=>({ramo_not_configured:t('The Ramo connection is not configured yet.','La conexión con Ramo aún no está configurada.'),original_photo_changed:t('An original photo could not be verified. Nothing was sent.','No se pudo verificar una foto original. No se envió nada.'),original_photo_unavailable:t('An original photo is unavailable. Nothing was sent.','Una foto original no está disponible. No se envió nada.'),photo_exceeds_20_mib:t('Each photo must be 20 MiB or smaller.','Cada foto debe tener 20 MiB o menos.'),submission_exceeds_100_mib:t('The group exceeds 100 MiB. Reduce the selection before sending.','El grupo supera 100 MiB. Reduzca la selección antes de enviar.'),unsupported_original_photo:t('Use JPEG, PNG, WebP, HEIC, or HEIF photos.','Use fotos JPEG, PNG, WebP, HEIC o HEIF.'),description_required:t('Add a group description or a photo caption.','Agregue una descripción del grupo o una nota de foto.'),ramo_access_required:t('This account does not have Ramo sending access.','Esta cuenta no tiene acceso para enviar a Ramo.')})[code]||t('Could not complete the request. Your saved submissions remain available below. Retry when connected.','No se pudo completar la solicitud. Sus envíos guardados siguen disponibles abajo. Reintente cuando tenga conexión.');
  body.innerHTML=`<section id="ramoScreen" style="color:#000;text-align:left;font-family:Arial,Helvetica,sans-serif"><button class="backlink" id="ramoBack">${state.view==='send'?t('Back to Send','Volver a Enviar'):t('Back to Organize','Volver a Organizar')}</button><h2>${t('Send to Ramo Optimizer','Enviar a Ramo Optimizer')}</h2><p>${t('One group, one change order. Assign the job and change order in Ramo after receipt.','Un grupo, una orden de cambio. Asigne el trabajo y la orden de cambio en Ramo después de recibirlo.')}</p><div id="ramoReview"></div><p id="ramoMessage" role="status" aria-live="polite"></p><h3>${t('Submission history','Historial de envíos')}</h3><p>${t('Received by Ramo means every photo and note was stored. Review and assignment happen separately in Ramo.','Recibido por Ramo significa que se guardaron todas las fotos y notas. La revisión y asignación se realizan por separado en Ramo.')}</p><div id="ramoHistory"></div></section>`;
  const root=document.getElementById('ramoScreen'),q=id=>root.querySelector('#'+id);
  q('ramoBack').onclick=()=>renderApp();
  let pending=null;
  try{pending=JSON.parse(localStorage.getItem(draftKey)||'null');}catch{}
  async function refresh(){
    if(!root.isConnected)return;
    try{
      const data=await call('/api/ramo-intake');if(!root.isConnected)return;
      q('ramoHistory').innerHTML=data.submissions.length?data.submissions.map(s=>`<article style="border:1px solid #0066cc;border-radius:8px;padding:12px;margin:12px 0;overflow-wrap:anywhere"><strong>${esc(s.title)}</strong><p>${s.attachmentCount} ${t('photos','fotos')} · ${new Date(s.createdAt).toLocaleString(uiLocale())}</p><p><strong>${s.status==='received'?t('Received by Ramo','Recibido por Ramo'):s.status==='failed'?t('Failed, Retry','Falló, Reintentar'):t('Sending','Enviando')}</strong>${s.receivedAt?' · '+new Date(s.receivedAt).toLocaleString(uiLocale()):''}</p>${s.description?`<p style="white-space:pre-wrap">${esc(s.description)}</p>`:''}${s.status==='failed'?`<button class="btn secondary" data-retry="${s.id}">${t('Retry','Reintentar')}</button>`:''}</article>`).join(''):`<p>${t('No submissions yet.','Aún no hay envíos.')}</p>`;
      q('ramoHistory').querySelectorAll('[data-retry]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await post(`/api/ramo-intake/submissions/${b.dataset.retry}/retry`,{});await refresh();}catch(e){q('ramoMessage').textContent=errorText(e.message);b.disabled=false;}});
      if(!data.configured)q('ramoMessage').textContent=errorText('ramo_not_configured');
      if(data.submissions.some(s=>s.status==='sending'))setTimeout(refresh,3000);
    }catch(e){if(root.isConnected)q('ramoMessage').textContent=errorText(e.message);}
  }
  async function send(payload){
    const button=q('ramoSend');if(button)button.disabled=true;
    q('ramoMessage').textContent=t('Saving submission and starting send...','Guardando el envío...');
    try{
      // Persist the exact request before sending, including its idempotency key.
      localStorage.setItem(draftKey,JSON.stringify(payload));pending=payload;
      await post('/api/ramo-intake/submissions',payload);
      localStorage.removeItem(draftKey);pending=null;
      if(!root.isConnected)return;
      q('ramoReview').innerHTML='';q('ramoMessage').textContent=t('Submission saved. Sending continues even if you close this page.','Envío guardado. El envío continúa aunque cierre esta página.');await refresh();
    }catch(e){
      if(!root.isConnected)return;
      // A validation rejection is definitive. Network/server failures retain the exact request for safe replay.
      if(['invalid_fields','description_required','photo_exceeds_20_mib','submission_exceeds_100_mib','unsupported_original_photo','original_photo_changed','original_photo_unavailable','ramo_not_configured','photo_not_found'].includes(e.message)){localStorage.removeItem(draftKey);pending=null;}
      q('ramoMessage').textContent=errorText(e.message);if(button)button.disabled=false;
    }
  }
  try{
    if(pending){
      q('ramoReview').innerHTML=`<p>${t('A previous send needs confirmation. Retry it safely before starting another.','Un envío anterior necesita confirmación. Reinténtelo antes de iniciar otro.')}</p><strong>${esc(pending.title)}</strong><p>${pending.photos.length} ${t('photos','fotos')}</p><button class="btn secondary" id="ramoSend">${t('Retry previous submission','Reintentar envío anterior')}</button>`;
      q('ramoSend').onclick=()=>send(pending);
    }else if(!historyOnly){
      const data=await post('/api/ramo-intake/preview',{captureIds:ids});if(!root.isConnected)return;
      q('ramoReview').innerHTML=`<form id="ramoForm"><p><strong>${data.photos.length} ${t('photos in this submission','fotos en este envío')}</strong></p><label for="ramoTitle">${t('Submission title','Título del envío')}</label><input id="ramoTitle" maxlength="240" required><label for="ramoDescription">${t('Description for the whole group','Descripción de todo el grupo')}</label><textarea id="ramoDescription" maxlength="50000" rows="4"></textarea>${data.photos.map((p,i)=>`<article style="margin:16px 0"><img src="${esc(p.photoPath)}" alt="${t('Original photo','Foto original')} ${i+1}" style="max-width:100%;max-height:300px;display:block"><p>${p.capturedAt?new Date(p.capturedAt).toLocaleString(uiLocale()):''} ${esc(p.location)}</p><label for="ramoCaption${i}">${t('Photo','Foto')} ${i+1}: ${t('notes and captions','notas y descripciones')}</label><textarea id="ramoCaption${i}" maxlength="20000" rows="4">${esc(p.caption)}</textarea></article>`).join('')}<p>${t('Original photos will be sent. Your edits here apply only to this submission.','Se enviarán las fotos originales. Sus cambios aquí se aplican solo a este envío.')}</p><button class="btn secondary" id="ramoSend" type="submit">${t('Send group to Ramo Optimizer','Enviar grupo a Ramo Optimizer')}</button></form>`;
      q('ramoForm').onsubmit=e=>{e.preventDefault();if(pending){void send(pending);return;}const payload={requestId:crypto.randomUUID(),title:q('ramoTitle').value,description:q('ramoDescription').value,photos:data.photos.map((p,i)=>({captureId:p.captureId,caption:q(`ramoCaption${i}`).value}))};if(!payload.description.trim()&&!payload.photos.some(p=>p.caption.trim())){q('ramoMessage').textContent=errorText('description_required');return;}void send(payload);};
    }
  }catch(e){q('ramoMessage').textContent=errorText(e.message);}
  await refresh();
}
