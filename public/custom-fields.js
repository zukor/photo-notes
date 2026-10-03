/* Individual Photo Note metadata. Evidence and annotations remain separate. */
(()=>{
'use strict';
const editions=['pro','paving','concrete','property','hoa','contractor','roofer'];
const labels={text:'Short Text',number:'Number',date:'Date',boolean:'Yes / No',choice:'Choice'};
let ctx=null,rows=[],draft={},loaded=false;
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=()=>`pn.customFields.v1.${ctx.user}`;
const applicable=()=>rows.filter(d=>(d.active||draft[d.id]?.value!=null)&&(d.scope==='general'||d.edition===ctx.edition)).map(d=>draft[d.id]?.revision&&d.versions?.[draft[d.id].revision]?{...d,...d.versions[draft[d.id].revision],revision:draft[d.id].revision}:d);
async function request(url,options){const r=await fetch(url,{credentials:'same-origin',...options});const data=await r.json();if(!r.ok)throw Error(data.error||'Custom Fields unavailable');return data;}
function cache(){try{localStorage.setItem(key(),JSON.stringify(rows));}catch{ctx.toast('Field definitions could not be cached for offline use.');}}
function controls(defs,values,prefix){return defs.map(d=>{
 const id=prefix+d.id,old=values[d.id],v=old?.value??'',required=d.required?' (required)':'',opts=d.type==='boolean'?['Yes','No']:d.options||[];
 let control;
 if(['choice','boolean'].includes(d.type)){
  const selected=d.type==='boolean'?(v===true?'Yes':v===false?'No':''):v;
  const choices=selected&&!opts.includes(selected)?[selected,...opts]:opts;
  control=`<select id="${id}" data-cf-id="${d.id}"><option value="">Not entered</option>${choices.map(o=>`<option value="${escape(o)}" ${o===selected?'selected':''}>${escape(o)}</option>`).join('')}</select>`;
 }else control=`<input id="${id}" data-cf-id="${d.id}" type="${d.type==='text'?'text':d.type}" ${d.type==='number'?'step="any"':''} maxlength="250" value="${escape(v)}">`;
 return `<div class="cf-field"><label for="${id}">${escape(d.name)}${required}</label>${d.prompt?`<p>${escape(d.prompt)}</p>`:''}${control}</div>`;
}).join('');}
function collect(container,defs,values){return defs.map(d=>{
 const el=container.querySelector(`[data-cf-id="${d.id}"]`);const raw=el?.value??'';
 let value=raw===''?null:d.type==='number'?Number(raw):d.type==='boolean'?raw==='Yes':raw;
 if(d.required&&value===null)throw Error(d.name+' is required');
 if(el&&!el.checkValidity())throw Error('Check '+d.name);
 return {id:d.id,revision:values[d.id]?.revision||d.revision,value};
});}
function remember(){const box=document.getElementById('cfCapture');if(!box)return;for(const d of applicable()){
 const el=box.querySelector(`[data-cf-id="${d.id}"]`);if(!el)continue;
 const raw=el.value;draft[d.id]={id:d.id,revision:d.revision,value:raw===''?null:d.type==='number'?Number(raw):d.type==='boolean'?raw==='Yes':raw};
}}
function render(){const anchor=document.getElementById('save');if(!anchor)return;
 let box=document.getElementById('cfCapture');if(!box){box=document.createElement('details');box.id='cfCapture';box.className='cf-section';anchor.before(box);}
 box.innerHTML=`<summary>Additional Details</summary><p>User-entered metadata, separate from photographic evidence.</p>${controls(applicable(),draft,'cfValue-')}${loaded&&!applicable().length?'<p>No active fields for this edition.</p>':''}${!loaded?'<p>Field definitions unavailable. Reconnect to load them.</p>':''}<button id="cfManage" type="button" class="btn secondary slim">Manage Custom Fields</button>`;
 box.querySelectorAll('[data-cf-id]').forEach(el=>el.oninput=remember);
 box.querySelector('#cfManage').onclick=manage;
}
async function refresh(){const active=ctx;try{const remote=await request('/api/custom-fields');if(ctx!==active)return;remember();rows=remote;loaded=true;cache();render();}catch{if(ctx===active)render();}}
async function manage(){
 const box=document.createElement('dialog');box.id='cfDialog';box.className='cf-dialog';
 box.innerHTML=`<h2>Custom Fields</h2><p>Fields supplement individual photos. Your account can use up to 12 active fields in General and 12 in each Edition scope. Required is off by default.</p><label for="cfDefinition">Existing fields</label><select id="cfDefinition"><option value="">Create a field</option>${rows.filter(d=>d.scope==='general'||d.edition===ctx.edition).map(d=>`<option value="${d.id}">${escape(d.name)}${d.active?'':' (inactive)'}</option>`).join('')}</select><label for="cfName">Field Name (required)</label><input id="cfName" maxlength="60"><label for="cfType">Field Type (required)</label><select id="cfType">${Object.entries(labels).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}</select><label for="cfScope">Scope</label><select id="cfScope"><option value="general">General, all your Pro editions</option><option value="edition">This Edition</option></select><label for="cfPrompt">Description / Prompt (optional)</label><textarea id="cfPrompt" maxlength="300"></textarea><div id="cfChoicesBox" hidden><label for="cfChoices">Choices, one per line (1 to 12)</label><textarea id="cfChoices" maxlength="731"></textarea></div><label><input id="cfRequired" type="checkbox"> Required</label><label><input id="cfActive" type="checkbox" checked> Active, available for new captures</label><p>Deactivation preserves saved values and pending captures. Type and scope cannot change after creation. Names are up to 60 characters, prompts 300, Short Text values 250, and choices 60 each.</p><p id="cfStatus" role="status"></p><button id="cfDefinitionSave" type="button" class="btn">Save Field</button><button id="cfClose" type="button" class="btn secondary">Close</button>`;
 document.body.append(box);box.showModal();const get=id=>box.querySelector('#'+id);
 get('cfClose').onclick=()=>box.remove();const choices=()=>get('cfChoicesBox').hidden=get('cfType').value!=='choice';get('cfType').onchange=choices;
 get('cfDefinition').onchange=()=>{const d=rows.find(d=>d.id===get('cfDefinition').value);get('cfName').value=d?.name||'';get('cfType').value=d?.type||'text';get('cfScope').value=d?.scope||'general';get('cfType').disabled=get('cfScope').disabled=!!d;get('cfPrompt').value=d?.prompt||'';get('cfRequired').checked=d?.required||false;get('cfActive').checked=d?.active??true;get('cfChoices').value=(d?.options||[]).join('\n');choices();};
 get('cfDefinitionSave').onclick=async()=>{const button=get('cfDefinitionSave');button.disabled=true;try{
  const data={name:get('cfName').value,type:get('cfType').value,scope:get('cfScope').value,edition:ctx.edition,prompt:get('cfPrompt').value,required:get('cfRequired').checked,active:get('cfActive').checked,options:get('cfChoices').value.split('\n').map(v=>v.trim()).filter(Boolean)};
  const saved=await request('/api/custom-fields/'+(get('cfDefinition').value||crypto.randomUUID()),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  remember();rows=rows.filter(d=>d.id!==saved.id).concat(saved);loaded=true;cache();render();box.remove();ctx.toast('Custom Field saved. Historical values are preserved.');
 }catch(e){get('cfStatus').textContent=e.message;}finally{button.disabled=false;}};
}
function details(c,container,options){
 const fields=c.custom_fields||[];if(!editions.includes(options.edition))return;
 const section=document.createElement('section');section.className='cf-section';
 section.innerHTML=`<h3>Additional Details</h3><p>User-entered metadata, not verified photographic evidence.</p>${fields.length?fields.map(f=>`<p><strong>${escape(f.name)}:</strong> ${escape(f.type==='boolean'?(f.value?'Yes':'No'):f.value)}</p>`).join(''):'<p>No Additional Details saved.</p>'}<button class="btn secondary slim" id="cfEditValues">Edit Additional Details</button>`;
 container.append(section);section.querySelector('button').onclick=async()=>{try{
  const defs=await request('/api/custom-fields');const eligible=defs.filter(d=>d.active&&((d.scope==='general'||d.edition===options.edition)||fields.some(f=>f.id===d.id)));
  // Existing older choices remain selectable until deliberately changed.
  const values=Object.fromEntries(fields.map(f=>[f.id,f]));const box=document.createElement('dialog');box.id='cfValuesDialog';box.className='cf-dialog';
  box.innerHTML=`<h2>Edit Additional Details</h2><p>Inactive fields are retained unchanged. Saving edits does not alter original photo, receipt time, fingerprint or GPS.</p>${controls(eligible,values,'cfEdit-')}<p id="cfValueStatus" role="status"></p><button id="cfValuesSave" class="btn">Save Additional Details</button><button id="cfValuesClose" class="btn secondary">Cancel</button>`;
  document.body.append(box);box.showModal();box.querySelector('#cfValuesClose').onclick=()=>box.remove();box.querySelector('#cfValuesSave').onclick=async()=>{try{
   const data=await request(`/api/captures/${c.id}/custom-fields`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({values:collect(box,eligible,values)})});
   c.custom_fields=data.custom_fields;box.remove();section.remove();details(c,container,options);options.toast('Additional Details saved in photo history.');
  }catch(e){box.querySelector('#cfValueStatus').textContent=e.message;}};
 }catch(e){options.toast(e.message);}};
}
async function filters(options){
 if(!editions.includes(options.edition))return;
 const anchor=document.getElementById('photoSearch');if(!anchor)return;
 try{
  const defs=(await request('/api/custom-fields')).filter(d=>['choice','boolean'].includes(d.type));if(!defs.length||!anchor.isConnected)return;
  const box=document.createElement('section');box.className='cf-section';box.id='cfFilterBox';box.innerHTML=`<label for="cfFilterField">Additional Details filter</label><select id="cfFilterField"><option value="">All values</option>${defs.map(d=>`<option value="${d.id}">${escape(d.name)}${d.active?'':' (inactive)'}</option>`).join('')}</select><label for="cfFilterValue">Saved value</label><select id="cfFilterValue" disabled><option value="">Choose a field first</option></select>`;
  anchor.closest('.row')?.after(box);
  const field=box.querySelector('#cfFilterField'),value=box.querySelector('#cfFilterValue');
  field.onchange=()=>{const d=defs.find(d=>d.id===field.value);value.disabled=!d;const choices=!d?[]:d.type==='boolean'?['Yes','No']:[...new Set([...d.options,...Object.values(d.versions||{}).flatMap(v=>v.options||[])])];value.innerHTML='<option value="">All values</option>'+choices.map(v=>`<option value="${escape(d?.type==='boolean'?v==='Yes'?'true':'false':v)}">${escape(v)}</option>`).join('');options.search();};value.onchange=options.search;
 }catch{}
}
window.PhotoNotesCustomFields={filters,query(params){const id=document.getElementById('cfFilterField')?.value,value=document.getElementById('cfFilterValue')?.value;if(id&&value){params.set('custom_field',id);params.set('custom_value',value);return true;}return false;},mount(options){if(!editions.includes(options.edition))return;
 const changed=!ctx||ctx.user!==options.user||ctx.edition!==options.edition;if(changed){draft={};rows=[];loaded=false;}ctx=options;
 if(changed)try{const cached=JSON.parse(localStorage.getItem(key())||'null');if(Array.isArray(cached)){rows=cached;loaded=true;}}catch{}
 render();void refresh();},payload(){if(!ctx||!document.getElementById('cfCapture'))return undefined;return JSON.stringify(collect(document.getElementById('cfCapture'),applicable(),draft));},clear(){draft={};},details,
 html(c){const fields=c.custom_fields||[];return fields.length?`<section class="cf-section"><strong>Additional Details (user-entered)</strong>${fields.map(f=>`<p>${escape(f.name)}: ${escape(f.type==='boolean'?(f.value?'Yes':'No'):f.value)}</p>`).join('')}</section>`:'';}};
})();
