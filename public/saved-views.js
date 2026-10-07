/* Saved Views use the existing workspace controls and authorized search functions. */
(() => {
'use strict';
const adapters=new Map();
const el=id=>document.getElementById(id);
let session=null;
function register(workspace,key,id,type='value'){
 if(!adapters.has(workspace))adapters.set(workspace,new Map());
 adapters.get(workspace).set(key,{id,type});
}
for(const [key,id,type] of [['search','photoSearch'],['topic','filter'],['job','jobFilter'],['from','searchFrom'],['to','searchTo'],['missingAddress','searchMissingAddress','checked'],['favorite','markerFavorites','checked'],['flagged','markerFlagged','checked']])register('organize',key,id,type);
for(const [key,id,type] of [['community','hoaFilterCommunity'],['status','hoaFilterStatus'],['priority','hoaFilterPriority'],['recordType','hoaFilterType'],['search','hoaSearch'],['showClosed','hoaShowClosed','checked'],['propertyArea','paItemFilter']])register('maintenance',key,id,type);
function supported(){return isProClient()&&['general','pro','paving','asphalt','concrete','property','hoa','contractor','roofer'].includes(state.proType);}
function capture(s){const filters={};for(const [key,a] of adapters.get(s.workspace)||[]){const e=el(a.id);if(e)filters[key]=a.type==='checked'?e.checked:e.value;}return {version:1,filters};}
function same(a,b){const x=a.filters||{},y=b?.filters||{};return a.version===b?.version&&Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>x[k]===y[k]);}
function status(s){if(session!==s||!s.root.isConnected)return;const node=s.root.querySelector('#svStatus');node.textContent=s.active?`Saved View active: ${s.active.name}${!same(capture(s),s.active.criteria)?' (current filters changed)':''}`:'';if(s.unavailable.length)node.textContent+=` Part of this Saved View is no longer available: ${s.unavailable.join(', ')}. Results are paused. Update the view or choose ${s.workspace==='organize'?'All Photos':'All Records'}.`;}
function blocked(workspace){return session?.root.isConnected&&session.workspace===workspace&&session.unavailable.length>0;}
function empty(workspace){return session?.root.isConnected&&session.workspace===workspace&&session.active?(same(capture(session),session.active.criteria)?'No Photo Notes currently match this Saved View.':'No Photo Notes match the current filters.'):null;}
function sync(s){const select=s.root.querySelector('#svSelect');select.replaceChildren(new Option('Choose Saved View',''),...s.views.map(v=>new Option(v.name+(v.is_default?' (Default)':''),v.id)));select.value=s.active?.id||'';s.root.querySelector('#svManage').disabled=!s.active;status(s);}
function apply(s,v){
 if(session!==s||!s.root.isConnected)return;
 s.active=v;s.unavailable=[];
 for(const [,a] of adapters.get(s.workspace)||[]){const e=el(a.id);if(e)e[a.type]=a.type==='checked'?false:'';}
 if(v){if(v.criteria?.version!==1)s.unavailable.push('unsupported criteria version');else for(const [key,value] of Object.entries(v.criteria.filters||{})){
  const a=adapters.get(s.workspace)?.get(key),e=a&&el(a.id);
  if(!e){if(value!==''&&value!==false)s.unavailable.push(key);continue;}
  if(a.type==='checked'?typeof value!=='boolean':typeof value!=='string'){s.unavailable.push(key);continue;}
  if(e.tagName==='SELECT'&&!Array.from(e.options).some(o=>o.value===value&&!o.disabled)){s.unavailable.push(key);continue;}
  e[a.type]=value;
 }}
 state.selectedIds.clear();sync(s);s.run();
 if(s.workspace==='organize')loadPavingReadiness();
}
async function mount(workspace,anchor,run){
 session=null;if(!supported()||!anchor)return false;
 const root=document.createElement('section');root.className='saved-views';root.style.cssText='color:var(--pn-text-000,#000);text-align:left;margin:12px 0';
 root.innerHTML=`<label for="svSelect">Saved Views</label><select id="svSelect" style="width:100%;min-height:44px"><option value="">Choose Saved View</option></select><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"><button type="button" class="btn secondary" id="svSave">Save View</button><button type="button" class="btn secondary" id="svManage" disabled>Manage View</button><button type="button" class="btn secondary" id="svAll">${workspace==='organize'?'All Photos':'All Records'}</button></div><p id="svStatus" role="status" style="color:var(--pn-text-000,#000)"></p>`;
 anchor.before(root);const s=session={workspace,root,run,views:[],active:null,unavailable:[],account:state.me?.email||state.me?.id};
 root.querySelector('#svSelect').onchange=e=>apply(s,s.views.find(v=>v.id===e.target.value)||null);
 root.querySelector('#svAll').onclick=()=>apply(s,null);
 root.querySelector('#svSave').onclick=()=>edit(s,null);
 root.querySelector('#svManage').onclick=()=>edit(s,s.active);
 // Clear and ordinary filter changes release an unavailable view without silently applying it.
 for(const [,a] of adapters.get(workspace)||[]){const e=el(a.id);if(e)for(const event of ['input','change'])e.addEventListener(event,()=>status(s));}
 if(workspace==='organize')el('photoSearchClear')?.addEventListener('click',()=>{s.active=null;s.unavailable=[];sync(s);run();});
 try{const r=await api('/api/saved-views?'+new URLSearchParams({workspace}));if(!r.ok)throw Error('Saved Views could not be loaded. You can still use ordinary search.');const views=await r.json();if(session!==s||!root.isConnected)return true;s.views=views;sync(s);const def=views.find(v=>v.is_default);if(def)apply(s,def);else run();}
 catch(e){if(session===s&&root.isConnected){root.querySelector('#svStatus').textContent=e.message;run();}}
 return true;
}
function edit(s,v){
 if(session!==s||!s.root.isConnected)return;
 const dialog=document.createElement('dialog');dialog.className='saved-view-dialog';dialog.setAttribute('aria-labelledby','svTitle');dialog.style.cssText='color:var(--pn-text-000,#000);text-align:left;width:460px;max-width:calc(100vw - 24px);box-sizing:border-box;border:2px solid #2455d9;border-radius:12px;padding:16px';
 dialog.innerHTML=`<form id="svForm"><h2 id="svTitle">${v?'Manage Saved View':'Save Current View'}</h2><label for="svName">View Name</label><input id="svName" required maxlength="100"><label for="svDescription">Description (optional)</label><textarea id="svDescription" maxlength="1000"></textarea><label for="svDefault" style="display:flex;gap:8px;color:var(--pn-text-000,#000)"><input id="svDefault" type="checkbox" style="width:22px"> Default</label>${v?'<label for="svReplace" style="display:flex;gap:8px;color:var(--pn-text-000,#000)"><input id="svReplace" type="checkbox" style="width:22px"> Replace saved criteria with current view</label>':''}<p style="color:var(--pn-text-000,#000)">Saves filters, not copies of photographs. Matching results change as Photo Notes change.</p><p id="svError" role="alert" style="color:var(--pn-text-000,#000)"></p><div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn" id="svSubmit" type="submit">Save View</button>${v?'<button class="btn secondary" id="svDuplicate" type="button">Duplicate View</button><button class="btn secondary" id="svDelete" type="button">Delete View</button>':''}<button class="btn secondary" id="svCancel" type="button">Cancel</button></div></form>`;
 document.body.append(dialog);dialog.querySelector('#svName').value=v?.name||'';dialog.querySelector('#svDescription').value=v?.description||'';dialog.querySelector('#svDefault').checked=!!v?.is_default;
 const close=()=>{dialog.close();window.PhotoNotesHelp?.refresh();dialog.remove();};dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.querySelector('#svCancel').onclick=close;
 const mutate=async(kind)=>{
  const form=dialog.querySelector('form');if(kind!=='delete'&&!form.reportValidity())return;
  if(kind==='delete'&&!confirm('Delete this Saved View? Photographs remain saved.'))return;
  if(session!==s||!s.root.isConnected||(state.me?.email||state.me?.id)!==s.account){close();return;}
  const body={workspace:s.workspace,name:dialog.querySelector('#svName').value.trim(),description:dialog.querySelector('#svDescription').value,is_default:kind==='duplicate'?false:dialog.querySelector('#svDefault').checked,criteria:!v||dialog.querySelector('#svReplace')?.checked?capture(s):v.criteria};
  if(kind==='duplicate')body.name=(body.name.slice(0,93)+' (copy)');
  const replacing=!v||dialog.querySelector('#svReplace')?.checked;
  if(s.unavailable.length&&replacing&&!confirm('Replace the saved criteria with the current available filters? Unavailable criteria will be removed.'))return;
  form.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{const r=await api('/api/saved-views'+(v&&kind!=='duplicate'?'/'+v.id:''),{method:kind==='delete'?'DELETE':v&&kind!=='duplicate'?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error('Saved View could not be changed. Check your connection and try again.');const saved=await r.json();if(session!==s||!s.root.isConnected){close();return;}
   if(kind==='delete'){s.views=s.views.filter(x=>x.id!==v.id);apply(s,null);}else{if(saved.is_default)s.views.forEach(x=>x.is_default=false);s.views=s.views.filter(x=>x.id!==saved.id);s.views.push(saved);apply(s,saved);}close();
  }catch(e){dialog.querySelector('#svError').textContent=e.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
 };
 dialog.querySelector('form').onsubmit=e=>{e.preventDefault();mutate('save');};if(v){dialog.querySelector('#svDuplicate').onclick=()=>mutate('duplicate');dialog.querySelector('#svDelete').onclick=()=>mutate('delete');}
 dialog.showModal();window.PhotoNotesHelp?.refresh();dialog.querySelector('#svName').focus();
}
window.PhotoNotesSavedViews={register,mount,blocked,empty,refresh:()=>session&&status(session)};
})();
