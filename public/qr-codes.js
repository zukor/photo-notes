/* Physical labels open existing photographic records. Tokens never confer access. */
(() => {
'use strict';
const editions=new Set(['pro','property','hoa','concrete','paving','contractor','roofer']);
let resolving=false;
window.PhotoNotesQR={
 enabled:edition=>editions.has(edition),
 button(type,id,edition){return editions.has(edition)?`<button type="button" class="btn secondary slim" data-qr-target="${type}" data-qr-id="${Number(id)}">Create / Manage QR Code</button>`:'';},
 wire(root,opts){root.querySelectorAll('[data-qr-target]').forEach(b=>b.onclick=()=>this.manage(b.dataset.qrTarget,b.dataset.qrId,opts));},
 wireSavedCards(root,rows,edition,opts){
  if(!editions.has(edition))return;
  for(const row of rows){const card=root.querySelector(`.capchk[value="${Number(row.id)}"]`)?.closest('.card');if(card&&!card.querySelector(`[data-qr-id="${Number(row.id)}"]`))card.querySelector('.photo-title')?.insertAdjacentHTML('afterend',this.button('note',row.id,edition));}
  this.wire(root,opts);
 },
 mountAsset({id,edition,...opts}){
  const body=document.getElementById('body'),photo=body?.querySelector('#hapPhoto');if(!photo||!editions.has(edition)||body.querySelector('#qrAssetPhoto'))return;
  body.querySelector('.workflow-intro')?.insertAdjacentHTML('afterend','<button type="button" class="btn secondary" id="qrAssetPhoto">Add Photo</button>'+this.button('asset',id,edition));
  const add=body.querySelector('#qrAssetPhoto');if(add)add.onclick=()=>{photo.scrollIntoView({block:'center'});photo.click();};this.wire(body,opts);
 },
 async resume({api,state,renderApp,toast}){
  const t=new URLSearchParams(location.search).get('qr');if(!t||!state.me||resolving)return;
  resolving=true;
  try{const r=await api('/api/qr/resolve/'+encodeURIComponent(t));if(!r.ok)throw new Error('Photo Notes context unavailable. Sign in with an authorized account, or ask the label owner for a current QR code.');const d=await r.json();
   const url=new URL(location.href);url.searchParams.delete('qr');history.replaceState(null,'',url);
   if(d.type==='asset'){state.hoaAssetId=d.id;state.view='hoa-asset';}else{state.view='edit';state.editTopic='';state._focusCapture=d.id;state.selectedIds=new Set([String(d.id)]);}
   renderApp();
  }catch(e){toast(e.message);}finally{resolving=false;}
 },
 async manage(type,id,{api,esc,toast}){
  const path='/api/qr/'+encodeURIComponent(type)+'/'+Number(id);
  const json=async(method='GET',action)=>{const r=await api(path,{method,...(action?{headers:{'Content-Type':'application/json'},body:JSON.stringify({action})}:{})});if(!r.ok)throw new Error('QR code unavailable. Check your connection and access.');return r.json();};
  const dialog=document.createElement('dialog');dialog.className='pn-qr-dialog';dialog.setAttribute('aria-label','Photo Notes QR Code');document.body.appendChild(dialog);
  let objectURL;
  const close=()=>{if(objectURL)URL.revokeObjectURL(objectURL);dialog.remove();};dialog.addEventListener('close',close);
  const draw=async d=>{
   if(objectURL){URL.revokeObjectURL(objectURL);objectURL=null;}
   dialog.innerHTML=`<h2>Photo Notes QR Code</h2><p>Scan at the physical subject to open its photographic record. Sign-in and authorization are required.</p><label for="qrLabel">Printed label</label><input id="qrLabel" maxlength="100" value="${esc(d.name)}"><p>Use a short, non-sensitive name. Remove private property details before printing.</p><label for="qrProperty">Property label (optional)</label><input id="qrProperty" maxlength="100" value="${esc(d.property)}"><div id="qrPreview"></div><p id="qrStatus" role="status">${d.active?'Active QR code.':'No active QR code.'}</p><div class="pn-qr-actions">${d.active?'<button type="button" class="btn" id="qrDownload">Download Label Image</button><button type="button" class="btn" id="qrPrint">Print Label</button><button type="button" class="btn secondary" id="qrReissue">Reissue QR Code</button><button type="button" class="btn secondary" id="qrDisable">Disable QR Code</button>':'<button type="button" class="btn" id="qrCreate">Create QR Code</button>'}<button type="button" class="btn secondary" id="qrClose">Close</button></div>`;
   dialog.querySelector('#qrClose').onclick=()=>dialog.close();
   const act=action=>async()=>{if(d.active&&['disable','reissue'].includes(action)&&!confirm(action==='disable'?'Disable this QR code? The printed label will stop opening the record.':'Replace this QR code? Previous printed labels will stop working.'))return;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);try{await draw(await json('POST',action));}catch(e){toast(e.message);dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}};
   if(!d.active){dialog.querySelector('#qrCreate').onclick=act('reissue');return;}
   dialog.querySelector('#qrReissue').onclick=act('reissue');dialog.querySelector('#qrDisable').onclick=act('disable');
   const imageResponse=await api(path+'/image');if(!imageResponse.ok)throw new Error('QR image could not be loaded.');objectURL=URL.createObjectURL(await imageResponse.blob());
   const img=new Image();img.src=objectURL;await img.decode();const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=1200;canvas.style.cssText='width:100%;max-width:340px;height:auto';canvas.setAttribute('aria-label','Printable Photo Notes QR label');dialog.querySelector('#qrPreview').appendChild(canvas);
   const update=()=>{const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1000,1200);ctx.fillStyle='#000';ctx.textAlign='left';ctx.font='bold 44px Arial';ctx.fillText('Photo Notes',65,70);ctx.font='32px Arial';ctx.fillText(dialog.querySelector('#qrLabel').value,65,128,870);ctx.fillText(dialog.querySelector('#qrProperty').value,65,180,870);ctx.drawImage(img,50,210,900,900);ctx.font='26px Arial';ctx.fillText('Sign in to Photo Notes to open this record.',65,1150);};
   update();['qrLabel','qrProperty'].forEach(key=>dialog.querySelector('#'+key).oninput=update);
   dialog.querySelector('#qrDownload').onclick=()=>canvas.toBlob(blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Photo-Notes-QR-Label.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');
   dialog.querySelector('#qrPrint').onclick=()=>{const w=window.open('','_blank');if(!w)return toast('Allow the print window, or download the image and print it.');w.document.write('<!doctype html><html><head><title>Photo Notes QR Label</title><style>body{margin:0;color:#000;font-family:Arial;text-align:left}img{width:90mm;max-width:100%;height:auto}</style></head><body><img alt="Photo Notes QR label"></body></html>');w.document.close();const output=w.document.querySelector('img');output.onload=()=>{w.focus();w.print();};output.src=canvas.toDataURL('image/png');};
  };
  try{dialog.showModal();await draw(await json());}catch(e){close();toast(e.message);}
 }
};
})();
