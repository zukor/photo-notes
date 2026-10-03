/* Shared, explicit photo context. No specialized relationships are changed. */
(() => {
'use strict';
let modal,counts={},countPending=false,countLoaded=false;
async function request(url,opts={}){const r=await fetch(url,{credentials:'same-origin',headers:{'Content-Type':'application/json'},...opts});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;}
async function refreshCounts(){if(!isProClient()||countPending)return;countPending=true;try{countLoaded=true;counts=Object.fromEntries((await request('/api/related-photos/counts')).map(r=>[r.photo_id,r.count]));paintCounts();}catch(e){}finally{countPending=false;}}
function paintCounts(){document.querySelectorAll('[data-related-id]').forEach(b=>{const n=counts[b.dataset.relatedId]||0,text=n?`Related Photos (${n})`:'Related Photos';if(b.textContent!==text)b.textContent=text;});}
function options(types,value){return `<option value="">Unclassified</option>`+types.map(t=>`<option ${t===value?'selected':''}>${esc(t)}</option>`).join('');}
function photo(c){return `<img src="${esc(c.photo_path)}" alt="${esc(c.photo_title||'Photo Note')}" style="width:96px;height:80px;object-fit:contain"><div><strong>${esc(c.photo_title||'Photo Note '+c.id)}</strong><p>${esc(new Date(c.created_at).toLocaleString())}</p><p>${esc(c.note||'')}</p></div>`;}
async function open(id){
 if(!isProClient())return;
 if(!modal){modal=document.createElement('div');modal.className='related-dialog';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Related Photos');modal.style.cssText='position:fixed;inset:0;z-index:1300;background:#0008;overflow:auto;color:#000;text-align:left;padding:12px;font-family:Arial,Helvetica,sans-serif;overflow-wrap:anywhere';document.body.append(modal);}
 modal.innerHTML='<section style="background:white;padding:20px;max-width:700px;margin:0 auto"><button id="relatedClose">Close</button><p role="status">Loading Related Photos...</p></section>';modal.querySelector('#relatedClose').onclick=close;
 try{
 const d=await request(`/api/captures/${id}/related`);if(!modal)return;
 modal.innerHTML=`<section style="background:white;padding:20px;max-width:700px;margin:0 auto;border-radius:12px"><button class="btn secondary" id="relatedClose">Close</button><h2>Related Photos (${d.photos.length})</h2><div style="display:flex;gap:12px;flex-wrap:wrap">${photo(d.capture)}</div><p>Link independently saved Photo Notes for photographic context. Use Before/After or Photo Sets for those specific purposes.</p><div id="relatedStatus" role="status"></div>${d.photos.map(c=>`<article style="border-top:1px solid #000;padding:12px 0"><div style="display:flex;gap:12px;flex-wrap:wrap">${photo(c)}</div><button class="btn secondary" data-related-open="${c.id}">Open Related Photo</button><label>Relationship<select data-related-type="${c.id}">${options(d.types,c.relationship_type)}</select></label><label>Relationship note<textarea maxlength="2000" data-related-note="${c.id}">${esc(c.relationship_note)}</textarea></label><button class="btn secondary" data-related-save="${c.id}">Save Relationship</button><button class="btn secondary" data-related-remove="${c.id}">Remove Relationship</button></article>`).join('')}<details id="relatedPicker"><summary>Link Existing Photos</summary><label>Find photos<input id="relatedSearch" type="search"></label><div id="relatedChoices"></div><button class="btn secondary" id="relatedMore" hidden>More Photos</button><label>Relationship (optional)<select id="relatedType">${options(d.types)}</select></label><label>Relationship note (optional)<textarea id="relatedNote" maxlength="2000"></textarea></label><button class="btn" id="relatedLink">Link Selected Photos</button></details><p>Remove Relationship unlinks the photos and keeps both Photo Notes. Related photos are not automatically included in documents.</p>${d.photos.length?'<button class="btn secondary" id="relatedSelect">Select These Photos for a Document</button>':''}</section>`;
 modal.querySelectorAll('button,input,select,textarea,summary').forEach(n=>n.style.color='#000');
 modal.querySelector('#relatedClose').onclick=close;
 const status=message=>{if(modal)modal.querySelector('#relatedStatus').textContent=message;};
 const mutate=async(fn)=>{try{await fn();await refreshCounts();await open(id);}catch(e){status(e.message||'Could not save. Keep this window open and retry.');}};
 modal.querySelectorAll('[data-related-open]').forEach(b=>b.onclick=()=>open(Number(b.dataset.relatedOpen)));
 modal.querySelectorAll('[data-related-save]').forEach(b=>b.onclick=()=>{const target=Number(b.dataset.relatedSave);mutate(()=>api(`/api/captures/${id}/related`,{method:'POST',body:JSON.stringify({ids:[target],type:modal.querySelector(`[data-related-type="${target}"]`).value,note:modal.querySelector(`[data-related-note="${target}"]`).value})}));});
 modal.querySelectorAll('[data-related-remove]').forEach(b=>b.onclick=()=>mutate(()=>api(`/api/captures/${id}/related/${b.dataset.relatedRemove}`,{method:'DELETE'})));
 modal.querySelector('#relatedLink').onclick=()=>{const ids=[...chosen];if(!ids.length)return status('Select at least one existing photo.');mutate(()=>api(`/api/captures/${id}/related`,{method:'POST',body:JSON.stringify({ids,type:modal.querySelector('#relatedType').value,note:modal.querySelector('#relatedNote').value})}));};
 const chosen=new Set();modal.querySelector('#relatedChoices').onchange=e=>{if(e.target.matches('[data-related-choice]')){const id=Number(e.target.value);if(e.target.checked)chosen.add(id);else chosen.delete(id);}};
 const select=modal.querySelector('#relatedSelect');if(select)select.onclick=()=>{[id,...d.photos.map(c=>c.id)].forEach(x=>state.selectedIds.add(x));close();state.view='create';renderApp();};
 let offset=0,loading=false,all=[],timer;
 async function candidates(reset=false){if(loading)return;loading=true;try{if(reset){offset=0;all=[];}const query=modal.querySelector('#relatedSearch').value;const rows=await request('/api/related-photos/candidates?limit=100&offset='+offset+'&q='+encodeURIComponent(query));offset+=rows.length;all.push(...rows);modal.querySelector('#relatedChoices').innerHTML=all.filter(c=>c.id!==id&&c.photo_path&&!d.photos.some(p=>p.id===c.id)).map(c=>`<label style="display:flex;gap:8px;align-items:center;padding:8px"><input type="checkbox" data-related-choice value="${c.id}" ${chosen.has(c.id)?'checked':''}>${photo(c)}</label>`).join('');modal.querySelector('#relatedMore').hidden=rows.length<100;}catch(e){status('Photos could not load. Reopen Link Existing Photos to retry.');}finally{loading=false;}}
 modal.querySelector('#relatedPicker').ontoggle=()=>{if(modal?.querySelector('#relatedPicker').open&&!all.length)candidates();};
 modal.querySelector('#relatedMore').onclick=()=>candidates();modal.querySelector('#relatedSearch').oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>candidates(true),300);};modal.querySelector('#relatedClose').focus();
 }catch(e){if(modal)modal.querySelector('[role="status"]').textContent=e.message||'Could not load Related Photos.';}
}
function close(){modal?.remove();modal=null;}
document.addEventListener('click',e=>{const b=e.target.closest('[data-related-id]');if(b)open(Number(b.dataset.relatedId));});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal)close();});
new MutationObserver(()=>{if(document.querySelector('[data-related-id]')){paintCounts();if(!countLoaded)refreshCounts();}}).observe(document.getElementById('app'),{childList:true,subtree:true});
window.RelatedPhotos={open,refreshCounts};
})();
