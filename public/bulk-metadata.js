/* Shared Organize batch editor. Uses the existing selection and batch endpoint. */
(() => {
'use strict';
const editions=new Set(['general','pro','paving','asphalt','concrete','property','hoa','contractor','roofer']);
function enabled(state){return state.plan==='pro'&&editions.has(state.proType);}
async function open({ids,jobs,topics,api,esc,toast,refresh}){
 if(!ids.length)return toast('Select at least one Photo Note.');
 if(ids.length>500)return toast('Select up to 500 Photo Notes per edit.');
 const request=async(metadata,extra={})=>{
  let r,d;try{r=await api('/api/captures/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,metadata,...extra})});d=await r.json();}catch(e){throw new Error(extra.preview?'Selected metadata could not be loaded. Try again.':'The save outcome could not be confirmed. Refresh your library before trying again.');}
  if(!r.ok)throw new Error(`${d.updated??0} updated, ${d.not_updated??ids.length} not updated. ${d.error||'Bulk changes could not be saved.'}`);return d;
 };
 let initial;try{initial=await request({},{preview:true});}catch(e){return toast(e.message);}
 const previous=document.activeElement,dialog=document.createElement('dialog');dialog.id='bulkMetadataDialog';dialog.setAttribute('aria-labelledby','bulkMetadataTitle');
 dialog.style.cssText='box-sizing:border-box;width:calc(100% - 24px);max-width:560px;max-height:90dvh;overflow:auto;border:1px solid #000;border-radius:12px;padding:20px;background:#fff;color:#000;text-align:left;font-family:Arial,Helvetica,sans-serif';
 const fieldEntries=Object.entries(initial.fields),draft={};let metadata={},review,busy=false;
 const describe=(key,value)=>{
  if(key==='area_tags')return value?.length?value.join(', '):'No Topics';
  if(key==='job_id')return value==null?'No Job':jobs.find(j=>j.id===value)?.name||'Job '+value;
  return initial.fields[key].options?.find(o=>o[0]===value)?.[1]||'Not set';
 };
 const current=key=>{const values=initial.rows.map(row=>JSON.stringify(Array.isArray(row[key])?[...row[key]].sort():row[key]??null));return new Set(values).size>1?'Multiple Values':describe(key,initial.rows[0][key]);};
 const close=()=>{if(busy)return;dialog.close();dialog.remove();previous?.focus();};
 const shell=content=>{dialog.innerHTML=`<h2 id="bulkMetadataTitle" style="color:#000">Edit Selected</h2><p>${ids.length} Photo Notes selected</p>${content}<p id="bulkMetadataStatus" role="status" style="color:#000"></p><button type="button" class="btn secondary" id="bulkMetadataCancel">Cancel</button>`;dialog.querySelector('#bulkMetadataCancel').onclick=close;};
 function choose(){
  shell(`<p>Choose replacements below. Leave other fields unchanged.</p>${fieldEntries.map(([key,field])=>{
   let options=field.type==='topics'?topics.map(t=>[t,t]):field.type==='job'?jobs.map(j=>[String(j.id),j.name]):field.options;
   return `<div style="margin:16px 0"><label for="bulkMetadata-${key}" style="color:#000">${esc(field.label)}</label><p style="color:#000;margin:4px 0">Current: ${esc(current(key))}</p><select id="bulkMetadata-${key}" data-bulk-metadata-field="${key}" style="width:100%;min-height:44px;color:#000"><option value="">Leave unchanged</option>${field.type==='topics'||field.type==='job'||field.clear?`<option value="__clear">Remove ${esc(field.label)}</option>`:''}${options.map(([value,label])=>`<option value="set:${esc(value)}">${esc(label)}</option>`).join('')}</select></div>`;
  }).join('')}<button type="button" class="btn" id="bulkMetadataReview">Review Changes</button>`);
  dialog.querySelectorAll('[data-bulk-metadata-field]').forEach(el=>{el.value=draft[el.dataset.bulkMetadataField]||'';el.onchange=()=>draft[el.dataset.bulkMetadataField]=el.value;});
  dialog.querySelector('#bulkMetadataReview').onclick=async()=>{
   metadata={};for(const [key,field] of fieldEntries){const value=draft[key];if(!value)continue;metadata[key]=value==='__clear'?(field.type==='topics'?[]:null):field.type==='topics'?[value.slice(4)]:field.type==='job'?Number(value.slice(4)):value.slice(4);}
   if(!Object.keys(metadata).length){dialog.querySelector('#bulkMetadataStatus').textContent='Choose at least one change.';return;}
   busy=true;dialog.querySelector('#bulkMetadataReview').disabled=true;
   try{review=await request(metadata,{preview:true});confirmChanges();}catch(e){dialog.querySelector('#bulkMetadataStatus').textContent=e.message;}finally{busy=false;const b=dialog.querySelector('#bulkMetadataReview');if(b)b.disabled=false;}
  };
 }
 function confirmChanges(){
  shell(`<h3 style="color:#000">Review Changes</h3><ul>${Object.keys(metadata).map(k=>`<li>${esc(initial.fields[k].label)} → ${esc(describe(k,metadata[k]))}</li>`).join('')}</ul><p>Apply these changes to all ${ids.length} selected Photo Notes? ${'area_tags' in metadata?'Topic replacement removes their existing Topics. ':''}Other metadata and original evidence stay unchanged. Changes are recorded in Photo History. There is no automatic Undo.</p><button type="button" class="btn secondary" id="bulkMetadataBack">Back</button><button type="button" class="btn" id="bulkMetadataApply">Apply to ${ids.length} Photo Notes</button>`);
  dialog.querySelector('#bulkMetadataBack').onclick=choose;
  dialog.querySelector('#bulkMetadataApply').onclick=async()=>{
   if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{const d=await request(metadata,{snapshot:review.snapshot});busy=false;close();toast(`${d.updated} updated, ${d.unchanged||0} unchanged, ${d.not_updated||0} not updated.`);Promise.resolve().then(refresh).catch(()=>toast('Changes saved. Refresh the library to see the updated results.'));}
   catch(e){dialog.querySelector('#bulkMetadataStatus').textContent=e.message;busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);dialog.querySelector('#bulkMetadataApply').disabled=true;}
  };
 }
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});document.body.append(dialog);choose();dialog.showModal();
}
window.PhotoNotesBulkMetadata={enabled,open};
})();
