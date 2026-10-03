/* Packaging defaults shared by applicable Pro document workspaces. */
(()=>{
'use strict';
let active=null;
const baselines=new WeakMap();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaults=()=>({version:1,format:'pdf',resolution:'standard',layout:{cover_page:true,header:true,footer:true,page_numbers:true,font:'Arial',photo_layout:'one_per_page',accent:'#1d4ed8'},branding:{},logo:true});
const request=async(url,method,body)=>{const r=await api(url,{method,headers:{'Content-Type':'application/json','X-Photo-Notes-Presets':'1'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'Presets are unavailable');return d;};
function current(){const c=structuredClone(active?.config||defaults());if(document.getElementById('documentFont'))c.layout=layoutFromControls();if(document.getElementById('documentCompanyName'))c.branding={company_name:document.getElementById('documentCompanyName').value,header_text:document.getElementById('documentHeaderText').value,footer_text:document.getElementById('documentFooterText').value};const f=document.getElementById('sendformat');if(f)c.format=f.value;return c;}
function query(){return active?'&packaging='+encodeURIComponent(JSON.stringify(current())):'';}
async function mount(box){
 active=null;if(!box||!isProClient()||!['general','paving','asphalt','concrete','hoa','property','contractor','roofer'].includes(state.proType))return;
 let rows;try{rows=await request('/api/export-presets','GET');}catch(e){box.textContent=e.message;return;}if(!box.isConnected)return;
 box.style.color='#000';box.style.textAlign='left';
 box.innerHTML=`<label>Use Export Preset<select id="epChoose"><option value="">No preset</option>${rows.map(r=>`<option value="${r.id}">${escape(r.name)}${r.is_default?' (Default)':''}</option>`).join('')}</select></label><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn slim" id="epExport" disabled>Download Using Preset</button><button class="btn secondary slim" id="epSave">Save as Preset</button><button class="btn secondary slim" id="epAdjust">Adjust Output Settings</button><button class="btn secondary slim" id="epEdit">Edit / Rename</button><button class="btn secondary slim" id="epDuplicate">Duplicate</button><button class="btn secondary slim" id="epDelete">Delete</button></div><div id="epStatus" role="status"></div><div id="epEditor"></div>`;
 const choose=box.querySelector('#epChoose'),status=box.querySelector('#epStatus');
 const context=box.id+':'+(box.id==='exportPresetDocument'?currentGroup.id:'')+':'+state.proType;const stored=baselines.get(box);const baseline=stored?.context===context?stored.config:current();baselines.set(box,{context,config:baseline});
 box.querySelector('#epExport').onclick=()=>deliverExport(current().format,box.id==='exportPresetDocument'?currentGroup.id:null,'download');
 function apply(row){active=row?{...row,config:structuredClone(row.config)}:null;const c=row?.config||(box.id==='exportPresetDocument'?{...baseline,layout:normalizedDocumentLayout(),branding:currentDocumentSettings.branding||{}}:baseline);
 const map={font:'documentFont',photo_layout:'documentPhotoLayout',accent:'documentAccent',cover_page:'documentCover',header:'documentHeader',footer:'documentFooter',page_numbers:'documentPageNumbers'};
 for(const [key,id] of Object.entries(map)){const el=document.getElementById(id);if(el&&c.layout?.[key]!=null){if(el.type==='checkbox')el.checked=c.layout[key];else el.value=c.layout[key];}}
 for(const [key,id] of Object.entries({company_name:'documentCompanyName',header_text:'documentHeaderText',footer_text:'documentFooterText'})){const el=document.getElementById(id);if(el)el.value=c.branding?.[key]||'';}
 const format=document.getElementById('sendformat');if(format)format.value=c.format;
 if(document.getElementById('documentFont'))renderDocumentPreviewFromControls();
 box.querySelector('#epExport').disabled=!active;
 status.textContent=row?[row.description,...(row.warnings||[]),'Defaults applied. You can change settings before output. Layout and branding do not affect Markdown + Photos. Word templates retain their own styling.'].filter(Boolean).join(' '):'';
 document.querySelectorAll('a[href^="/api/export/pdf?group="],a[href^="/api/export/docx?group="]').forEach(a=>{a.href=a.href.split('&packaging=')[0]+query();a.onclick=()=>{a.href=a.href.split('&packaging=')[0]+query();};});
 }
 choose.onchange=()=>apply(rows.find(r=>String(r.id)===choose.value));
 function edit(mode){const row=rows.find(r=>String(r.id)===choose.value);if(!['new','adjust'].includes(mode)&&!row){status.textContent='Choose a preset first.';return;}
 const c=['new','adjust'].includes(mode)?current():structuredClone(row.config),host=box.querySelector('#epEditor');
 host.innerHTML=`<form id="epForm">${mode==='adjust'?'':`<label>Preset Name<input id="epName" required maxlength="80" value="${escape(['new','adjust'].includes(mode)?'':row.name+(mode==='duplicate'?' Copy':''))}"></label><label>Description<textarea id="epDescription" maxlength="500">${escape(['new','adjust'].includes(mode)?'':row.description)}</textarea></label>`}<label>Output Format<select id="epFormat">${[['pdf','PDF'],['docx','Word'],['bundle','Markdown + Photos']].map(([v,t])=>`<option value="${v}"${v===c.format?' selected':''}>${t}</option>`).join('')}</select></label><label>Image Quality<select id="epQuality">${[['standard','Standard (2048 px)'],['print','Print (3000 px)'],['web','Web (1400 px)']].map(([v,t])=>`<option value="${v}"${v===c.resolution?' selected':''}>${t}</option>`).join('')}</select></label><label>Photo Arrangement<select id="epLayout"><option value="one_per_page">One photo per page</option><option value="two_per_page">Two photos per page</option></select></label><label>Typeface<select id="epFont">${['Arial','Aptos','Calibri','Georgia','Times New Roman'].map(v=>`<option>${v}</option>`).join('')}</select></label><label>Accent Color<input id="epAccent" type="color" value="${escape(c.layout.accent||'#1d4ed8')}"></label>${['cover_page','header','footer','page_numbers'].map(k=>`<label><input type="checkbox" data-ep-layout="${k}"${c.layout[k]!==false?' checked':''}>${escape(k.replaceAll('_',' '))}</label>`).join('')}${['company_name','header_text','footer_text'].map(k=>`<label>${escape(k.replaceAll('_',' '))}<input data-ep-branding="${k}" maxlength="160" value="${escape(c.branding[k]||'')}"></label>`).join('')}<label><input id="epLogo" type="checkbox"${c.logo!==false?' checked':''}>Use current account logo</label>${mode==='adjust'?'':`<label><input id="epDefault" type="checkbox"${mode==='edit'&&row.is_default?' checked':''}>Default</label>`}<p>Photo titles, notes, date, location, topics, available evidence details and markings follow the existing export behavior. Specialty reports keep their own presentation. A removed logo is omitted.</p><button class="btn slim" id="epCommit" type="submit">${mode==='adjust'?'Apply to Output':'Save Preset'}</button><button class="btn secondary slim" id="epCancel" type="button">Cancel</button></form>`;
 host.querySelector('#epLayout').value=c.layout.photo_layout||'one_per_page';host.querySelector('#epFont').value=c.layout.font||'Arial';
 host.querySelector('#epCancel').onclick=()=>host.replaceChildren();
 host.querySelector('#epForm').onsubmit=async e=>{e.preventDefault();const button=host.querySelector('#epCommit');button.disabled=true;try{
 c.format=host.querySelector('#epFormat').value;c.resolution=host.querySelector('#epQuality').value;c.logo=host.querySelector('#epLogo').checked;
 c.layout.photo_layout=host.querySelector('#epLayout').value;c.layout.font=host.querySelector('#epFont').value;c.layout.accent=host.querySelector('#epAccent').value;
 host.querySelectorAll('[data-ep-layout]').forEach(el=>c.layout[el.dataset.epLayout]=el.checked);host.querySelectorAll('[data-ep-branding]').forEach(el=>c.branding[el.dataset.epBranding]=el.value);
 if(mode==='adjust'){apply({name:'Custom output settings',config:c,warnings:[]});host.replaceChildren();return;}
 const saved=await request('/api/export-presets'+(mode==='edit'?'/'+row.id:''),mode==='edit'?'PUT':'POST',{name:host.querySelector('#epName').value,description:host.querySelector('#epDescription').value,config:c,is_default:host.querySelector('#epDefault').checked});
 await mount(box);box.querySelector('#epChoose').value=saved.id;box.querySelector('#epChoose').dispatchEvent(new Event('change'));
 }catch(err){status.textContent=err.message;button.disabled=false;}};
 }
 box.querySelector('#epAdjust').onclick=()=>edit('adjust');
 box.querySelector('#epSave').onclick=()=>edit('new');box.querySelector('#epEdit').onclick=()=>edit('edit');box.querySelector('#epDuplicate').onclick=()=>edit('duplicate');
 box.querySelector('#epDelete').onclick=async()=>{if(!choose.value){status.textContent='Choose a preset first.';return;}if(!confirm('Delete this Export Preset? Documents and photos are kept.'))return;try{await request('/api/export-presets/'+choose.value,'DELETE');apply(null);await mount(box);}catch(e){status.textContent=e.message;}};
 const d=rows.find(r=>r.is_default);if(d){choose.value=d.id;apply(d);}
}
window.PhotoNotesExportPresets={mount,query,previewBranding:()=>active?current().branding:null,includeLogo:()=>!active||active.config.logo!==false,format:()=>active?.config.format||'pdf'};
})();
