/* Optional per-account, per-edition capture defaults. No photograph or evidence data. */
(() => {
'use strict';
let ctx, rows=[], last='', syncing=false;
const enabled=['pro','paving','concrete','hoa','property','contractor','roofer'];
const key=()=>`pn.captureTemplates.v1.${ctx.user}.${ctx.edition}`;
function persist(){localStorage.setItem(key(),JSON.stringify({rows,last}));}
function read(){try{const data=JSON.parse(localStorage.getItem(key())||'{}');rows=Array.isArray(data.rows)?data.rows:[];last=data.last||'';}catch{rows=[];last='';}}
async function sync(){
 if(syncing||!ctx||!navigator.onLine)return;
 const scope=key(), active=ctx;syncing=true;
 try{
  for(const row of rows.filter(r=>r.pending)){
   const r=await fetch(`/api/capture-templates/${row.id}`,{method:'PUT',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(row)});
   if(!r.ok)throw Error('sync');if(scope!==key())return;row.pending=false;persist();
  }
  const response=await fetch('/api/capture-templates',{credentials:'same-origin'});if(!response.ok)throw Error('sync');const remote=await response.json();
  if(scope!==key()||active!==ctx)return;
  const pending=rows.filter(r=>r.pending), ids=new Set(pending.map(r=>r.id));
  rows=[...remote.filter(r=>r.edition===ctx.edition&&!ids.has(r.id)),...pending];persist();mountBar();
 }catch{}finally{syncing=false;}
}
function fields(){
 const ids=ctx.edition==='concrete'?['concretePhase','concretePurpose','concreteElement']:['hoa','property'].includes(ctx.edition)?['hoaType','hoaPriority','hoaArea']:ctx.edition==='paving'?['pavingPhotoReason']:[];
 return ids.map(id=>document.getElementById(id)).filter(Boolean);
}
function current(){const d={};if(ctx.topic())d.topic=ctx.topic();const urgency=document.getElementById('captureUrgency');if(urgency)d.urgency=urgency.value;for(const el of fields())if(el.value)d[el.id]=el.value;return d;}
function live(){return rows.filter(r=>!r.deleted);}
function apply(row){
 const d=row.defaults||{}, skipped=[];
 if(d.topic){if(ctx.topics().includes(d.topic))ctx.setTopic(d.topic);else skipped.push('Topic no longer available');}
 for(const id of ['captureUrgency',...fields().map(el=>el.id)]){
  const value=id==='captureUrgency'?d.urgency:d[id];if(!value)continue;
  const el=document.getElementById(id);if(!el||![...el.options].some(o=>o.value===value)){skipped.push(id);continue;}
  el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));el.dispatchEvent(new Event('input',{bubbles:true}));
 }
 last=row.id;ctx.active(row.name);persist();mountBar();ctx.toast(skipped.length?'Saved settings applied. Review unavailable choices: '+skipped.join(', '):'Saved settings applied. Review before saving.');
}
function dialog(mode,row){
 document.getElementById('ctDialog')?.remove();
 const box=document.createElement('dialog');box.id='ctDialog';box.style.cssText='color:var(--pn-text-000,#000);text-align:left;font-family:Arial,sans-serif;width:min(480px,90vw);max-height:85vh;overflow:auto';
 const escape=ctx.escape;
 box.innerHTML=`<h2>Saved Capture Settings</h2><p>Save choices such as Topic and Urgency, then reuse them for new photos. You still take a new photo and add new notes. Review all choices before saving the photo.</p><label for="ctChoice">Saved settings</label><select id="ctChoice"><option value="">Choose saved settings</option>${live().map(r=>`<option value="${r.id}">${escape(r.name)}</option>`).join('')}</select><div class="row"><button id="ctApply" class="btn">Use Saved Settings</button><button id="ctEdit" class="btn secondary">Edit / Rename</button><button id="ctDuplicate" class="btn secondary">Duplicate</button><button id="ctDelete" class="btn secondary">Delete</button></div><button id="ctNew" class="btn secondary">Create Saved Settings</button><div id="ctEditor" hidden></div><p id="ctStatus" role="status"></p><button id="ctClose" class="btn secondary">Close</button>`;
 document.body.appendChild(box);box.showModal();
 const choice=box.querySelector('#ctChoice'),selected=()=>live().find(r=>r.id===choice.value);
 box.querySelector('#ctClose').onclick=()=>box.remove();
 box.querySelector('#ctApply').onclick=()=>{if(selected()){apply(selected());box.remove();}};
 const edit=(entry,copy=false,defaults={})=>{
  const editor=box.querySelector('#ctEditor');editor.hidden=false;const d=entry?.defaults||defaults;
  editor.innerHTML=`<label for="ctName">Settings Name (required)</label><input id="ctName" maxlength="100" value="${escape(entry?(copy?entry.name+' Copy':entry.name):'')}"><label for="ctDescription">Description (optional)</label><textarea id="ctDescription" maxlength="500">${escape(entry?.description||'')}</textarea><label for="ctTopic">Topic (optional)</label><select id="ctTopic"><option value="">Leave unchanged</option>${ctx.topics().map(t=>`<option ${d.topic===t?'selected':''} value="${escape(t)}">${escape(t)}</option>`).join('')}</select><label for="ctUrgency">Urgency (optional)</label><select id="ctUrgency"><option value="">Leave unchanged</option><option value="standard" ${d.urgency==='standard'?'selected':''}>Standard</option><option value="urgent" ${d.urgency==='urgent'?'selected':''}>Urgent</option></select><div id="ctSpecialty"></div><button id="ctSave" class="btn">Save Settings</button>`;
  for(const source of fields()){
   const label=document.createElement('label');label.htmlFor='ct-'+source.id;label.textContent=source.id==='hoaArea'?'Maintenance Category':source.id==='hoaType'?'Record Type':source.id==='hoaPriority'?'Priority':source.id==='concretePhase'?'Project phase':source.id==='concretePurpose'?'Photo purpose':source.id==='concreteElement'?'Project type':'Photo Reason';
   const select=document.createElement('select');select.id='ct-'+source.id;select.dataset.source=source.id;
   select.innerHTML='<option value="">Leave unchanged</option>'+[...source.options].filter(o=>o.value&&(source.id!=='pavingPhotoReason'||o.value==='proposal')).map(o=>`<option value="${escape(o.value)}">${escape(o.textContent)}</option>`).join('');select.value=d[source.id]||'';
   editor.querySelector('#ctSpecialty').append(label,select);
  }
  const phase=editor.querySelector('#ct-concretePhase'),purpose=editor.querySelector('#ct-concretePurpose');
  const updatePurpose=()=>{const previous=purpose.value;purpose.innerHTML='<option value="">Leave unchanged</option>'+(window.ConcreteCapture.phase(phase.value)?.purposes||[]).map(p=>`<option value="${escape(p[0])}">${escape(p[1])}</option>`).join('');purpose.value=previous;};
  if(phase&&purpose){phase.onchange=updatePurpose;updatePurpose();purpose.value=d.concretePurpose||'';}
  editor.querySelector('#ctSave').onclick=()=>{
   const name=editor.querySelector('#ctName').value.trim();if(!name){box.querySelector('#ctStatus').textContent='Settings Name is required.';return;}
   const defaults={};const topic=editor.querySelector('#ctTopic').value,urgency=editor.querySelector('#ctUrgency').value;if(topic)defaults.topic=topic;if(urgency)defaults.urgency=urgency;
   editor.querySelectorAll('[data-source]').forEach(el=>{if(el.value)defaults[el.dataset.source]=el.value;});
   const saved={id:entry&&!copy?entry.id:crypto.randomUUID(),edition:ctx.edition,name,description:editor.querySelector('#ctDescription').value,defaults,pending:true,deleted:false};
   const previous=rows.slice();rows=rows.filter(r=>r.id!==saved.id).concat(saved);
   try{persist();}catch{rows=previous;box.querySelector('#ctStatus').textContent='Device storage unavailable. Settings were not saved.';return;}
   if(entry&&!copy&&last===entry.id)ctx.active(name);box.remove();mountBar();void sync();ctx.toast('Settings saved on this device. Syncs when connected.');
  };
 };
 box.querySelector('#ctNew').onclick=()=>edit(null);
 box.querySelector('#ctEdit').onclick=()=>{if(selected())edit(selected());};
 box.querySelector('#ctDuplicate').onclick=()=>{if(selected())edit(selected(),true);};
 box.querySelector('#ctDelete').onclick=()=>{const entry=selected();if(!entry||!confirm('Delete these saved capture settings? Saved photos are unchanged.'))return;entry.deleted=true;entry.pending=true;if(last===entry.id)last='';persist();box.remove();mountBar();void sync();};
 if(mode==='save')edit(null,false,current());
 if(row){choice.value=row.id;edit(row);}
}
function mountBar(){
 const bar=document.getElementById('ctBar');if(!bar)return;
 const expanded=bar.querySelector('details')?.open;
 bar.innerHTML='<details'+(expanded?' open':'')+'><summary id="ctOptions">Saved Capture Settings (optional)</summary><p>Reuse Topic and Urgency for new photos.</p><div class="ct-saved-actions"><button id="ctUse" class="btn secondary slim">Use Saved Settings</button> <button id="ctSaveSetup" class="btn secondary slim">Save Current Settings</button> <button id="ctManage" class="btn secondary slim">Manage Saved Settings</button>'+(live().some(r=>r.id===last)?' <button id="ctLast" class="btn secondary slim">Last Used Settings</button>':'')+'</div></details><div id="ctIndicator" role="status"></div>';
 bar.querySelector('#ctUse').onclick=()=>dialog('use');bar.querySelector('#ctManage').onclick=()=>dialog('manage');bar.querySelector('#ctSaveSetup').onclick=()=>dialog('save');
 if(bar.querySelector('#ctLast'))bar.querySelector('#ctLast').onclick=()=>apply(live().find(r=>r.id===last));
 bar.querySelector('#ctIndicator').textContent=ctx.activeName()?'Saved settings: '+ctx.activeName():'';
}
window.PhotoNotesCaptureTemplates={mount(options){if(!enabled.includes(options.edition)||!options.user)return;ctx=options;read();if(!document.getElementById('ctStyles')){const style=document.createElement('style');style.id='ctStyles';style.textContent='#ctBar,#ctDialog{color:var(--pn-text-000,#000)!important;background:var(--pn-bg-fff,#fff);text-align:left}#ctBar *,#ctDialog *{color:var(--pn-text-000,#000)!important}#ctDialog input,#ctDialog textarea,#ctDialog select,#ctDialog button,#ctBar button{background:var(--pn-bg-fff,#fff)!important}';document.head.appendChild(style);}let bar=document.getElementById('ctBar');if(!bar){bar=document.createElement('section');bar.id='ctBar';bar.style.cssText='color:var(--pn-text-000,#000);text-align:left;margin-bottom:12px';document.getElementById('captureSettings').append(bar);}mountBar();void sync();}};
window.addEventListener('online',()=>{void sync();});
})();
