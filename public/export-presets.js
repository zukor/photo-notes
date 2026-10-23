/* Saved document settings (Export Presets) shared by New Document setup, the document page and Send. */
(()=>{
'use strict';
let active=null,migration=null,sendOptions=null;
const EDITIONS=['general','paving','asphalt','concrete','hoa','property','contractor','roofer'];
const LAYOUT_CHOICES={document_type:['standard','exhibit'],orientation:['portrait','landscape'],photo_layout:['one_per_page','two_vertical','two_horizontal','two_per_page','three_vertical','three_horizontal','four_per_page','five_per_page','six_per_page'],font:['Arial','Helvetica','Aptos','Calibri','Georgia','Times New Roman'],page_number_position:['bottom_left','bottom_center','bottom_right']};
const PHOTO_LAYOUT_LABELS={one_per_page:'1',two_vertical:'2 Vertical',two_horizontal:'2 Horizontal',two_per_page:'2 per Page',three_vertical:'3 Vertical',three_horizontal:'3 Horizontal',four_per_page:'4',five_per_page:'5',six_per_page:'6'};
const BRANDING_LIMITS={company_name:160,header_text:200,footer_text:240};
const baselines=new WeakMap();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const defaults=()=>({version:1,format:'pdf',resolution:'standard',layout:{cover_page:true,header:true,footer:true,page_numbers:true,font:'Arial',photo_layout:'one_per_page',accent:'#1d4ed8'},branding:{},logo:true});
const request=async(url,method,body)=>{const r=await api(url,{method,headers:{'Content-Type':'application/json','X-Photo-Notes-Presets':'1'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();if(!r.ok)throw Error(d.error||'Presets are unavailable');return d;};
function current(){const c=structuredClone(active?.config||defaults());if(document.getElementById('documentFont'))c.layout=layoutFromControls();if(document.getElementById('documentCompanyName'))c.branding={company_name:document.getElementById('documentCompanyName').value,header_text:document.getElementById('documentHeaderText').value,footer_text:document.getElementById('documentFooterText').value};const f=sendOptions?.format?.();if(['pdf','docx','bundle'].includes(f))c.format=f;return c;}
function query(){return active?'&packaging='+encodeURIComponent(JSON.stringify(current())):'';}
const supported=()=>typeof isProClient==='function'&&isProClient()&&EDITIONS.includes(state.proType);
// A preset made from document settings: every layout option plus company name, header and footer text.
function configFromLayout(layout){const l=layout||{},out={version:1,format:'pdf',resolution:'standard',layout:{},branding:{},logo:true};
 for(const key of ['cover_page','header','footer','page_numbers'])if(typeof l[key]==='boolean')out.layout[key]=l[key];
 for(const [key,list] of Object.entries(LAYOUT_CHOICES))if(list.includes(l[key]))out.layout[key]=l[key];
 if(/^#[0-9a-f]{6}$/i.test(l.accent||''))out.layout.accent=l.accent;
 for(const [key,max] of Object.entries(BRANDING_LIMITS))out.branding[key]=String(l[key]||'').slice(0,max);
 return out;}
const sameConfig=(a,b)=>Object.entries(a.layout).every(([k,v])=>b?.layout?.[k]===v)&&Object.entries(a.branding).every(([k,v])=>(b?.branding?.[k]||'')===v);
const list=()=>request('/api/export-presets','GET');
const create=body=>request('/api/export-presets','POST',body);
// New Document presets and defaults used to live only in this browser. Copy them into the account once,
// keeping their names and skipping copies already made, then remove the browser copy. Nothing is removed
// unless every copy was saved, so an interrupted move is retried on the next visit.
function readLocal(key){try{const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}catch{return undefined;}}
function migrateLocal(){
 if(migration)return migration;
 // Calls made while a move is running share it; later calls check browser storage again, which costs nothing once it is empty.
 migration=(async()=>{
 if(!supported())return {copied:0};
 const accounts=[...new Set([state.me?.id,'local'].filter(v=>v!=null))],sources=[];
 for(const account of accounts){const keys={default:`pn-document-default-${account}`,presets:`pn-document-presets-${account}`},def=readLocal(keys.default),presets=readLocal(keys.presets);if(def===undefined||presets===undefined)continue;if(def||presets)sources.push({keys,def,presets:Array.isArray(presets)?presets:[]});}
 if(!sources.length)return {copied:0};
 const rows=await list(),byName=new Map(rows.map(r=>[String(r.name).trim().toLowerCase(),r]));let copied=0;
 for(const source of sources){
  const wanted=source.presets.filter(p=>p&&String(p.name||'').trim()&&p.layout).map(p=>({name:String(p.name).trim().slice(0,80),config:configFromLayout(p.layout)}));
  if(source.def?.layout)wanted.push({name:'New Document Defaults',config:configFromLayout(source.def.layout)});
  for(const item of wanted){
   let name=item.name,attempt=1,existing=byName.get(name.toLowerCase());
   while(existing&&!sameConfig(item.config,existing.config)){attempt++;name=item.name.slice(0,64)+(attempt===2?' (New Document)':` (New Document ${attempt-1})`);existing=byName.get(name.toLowerCase());}
   if(existing)continue;
   const saved=await create({name,description:'Copied from New Document settings saved in this browser.',config:item.config,is_default:false});byName.set(name.toLowerCase(),saved);copied++;
  }
  if(source.def?.layout){
   const r=await api('/api/document-settings');if(!r.ok)throw Error('Document settings are unavailable');const account=await r.json();
   if(!account.layout_saved){const b=account.branding||{},l=source.def.layout,body={layout:l};for(const key of Object.keys(BRANDING_LIMITS))body[key]=String(b[key]||'').trim()?b[key]:String(l[key]||'').slice(0,BRANDING_LIMITS[key]);
    const saved=await api('/api/document-settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!saved.ok)throw Error('Document defaults could not be saved');}
  }
  try{localStorage.removeItem(source.keys.default);localStorage.removeItem(source.keys.presets);}catch{}
 }
 return {copied};
 })().finally(()=>{migration=null;});
 return migration;
}
// Send lists the presets as choices, with Account Defaults first. Manage Presets opens the full preset editor below them.
const LAYOUT_DETAIL={one_per_page:'1 photo per page',two_vertical:'2 photos per page, stacked',two_horizontal:'2 photos per page, side by side',two_per_page:'2 photos per page',three_vertical:'3 photos per page, stacked',three_horizontal:'3 photos per page, side by side',four_per_page:'4 photos per page',five_per_page:'5 photos per page',six_per_page:'6 photos per page'};
const tr=text=>window.photoNotesI18n?window.photoNotesI18n.t(text):text;
function presetDetail(row){if(String(row.description||'').trim())return String(row.description).trim();const l=row.config?.layout||{},parts=[];if(LAYOUT_DETAIL[l.photo_layout])parts.push(tr(LAYOUT_DETAIL[l.photo_layout]));if(l.cover_page)parts.push(tr('cover page'));if(row.config?.logo===false)parts.push(tr('no logo'));return parts.join(', ');}
let chooser=null;
function renderChooser(box,rows){
 const host=box.querySelector('#epChooser');if(!host)return;chooser={box,rows};
 const pressed=v=>v?'true':'false';
 const choice=(id,name,detail,on)=>`<button type="button" class="btn secondary send-choice send-preset-choice" data-ep-pick="${escape(id)}" aria-pressed="${pressed(on)}"><span class="send-preset-name">${escape(name)}</span>${detail?`<span class="send-preset-detail">${escape(detail)}</span>`:''}</button>`;
 const custom=active&&active.id==null;
 host.innerHTML=choice('',tr('Account Defaults'),tr('Your saved document settings'),!active)+rows.map(r=>choice(r.id,r.name+(r.is_default?' '+tr('(Default)'):''),presetDetail(r),String(active?.id)===String(r.id))).join('')+(custom?choice('custom',tr('Custom Output Settings'),tr('Adjusted for this Send only'),true):'');
 host.querySelectorAll('[data-ep-pick]').forEach(b=>b.onclick=()=>{if(b.dataset.epPick==='custom')return;const select=box.querySelector('#epChoose');select.value=b.dataset.epPick;select.dispatchEvent(new Event('change'));});
}
function activeName(){return active?(active.id==null?'Custom Output Settings':active.name):'Account Defaults';}
async function mount(box,options){
 active=null;const send=!!options;sendOptions=send?options:null;if(!box)return;
 if(!supported()){if(send){box.innerHTML='<div class="send-choice-list" id="epChooser"></div>';renderChooser(box,[]);options.onChange?.('');}return;}
 try{await migrateLocal();}catch{}
 let rows;try{rows=await request('/api/export-presets','GET');}catch(e){box.textContent=e.message;return;}if(!box.isConnected)return;
 box.style.color='#000';box.style.textAlign='left';
 const editor=`<label>Use Export Preset<select id="epChoose"><option value="">${send?'Account Defaults':'No preset'}</option>${rows.map(r=>`<option value="${r.id}">${escape(r.name)}${r.is_default?' (Default)':''}</option>`).join('')}</select></label><div style="display:flex;gap:8px;flex-wrap:wrap">${send?'':'<button class="btn slim" id="epExport" disabled>Download Using Preset</button>'}<button class="btn secondary slim" id="epSave">Save as Preset</button><button class="btn secondary slim" id="epAdjust">Adjust Output Settings</button><button class="btn secondary slim" id="epEdit">Edit / Rename</button><button class="btn secondary slim" id="epDuplicate">Duplicate</button><button class="btn secondary slim" id="epDelete">Delete</button></div><div id="epStatus" role="status"></div><div id="epEditor"></div>`;
 box.innerHTML=send?`<div class="send-choice-list" id="epChooser" role="group" aria-label="Settings"></div><button type="button" class="backlink" id="sendManagePresets" aria-expanded="false" aria-controls="epManage">Manage Presets</button><div class="send-preset-manager" id="epManage" hidden>${editor}</div>`:editor;
 if(send){const manage=box.querySelector('#sendManagePresets'),panel=box.querySelector('#epManage');manage.onclick=()=>{panel.hidden=!panel.hidden;manage.setAttribute('aria-expanded',String(!panel.hidden));};}
 const choose=box.querySelector('#epChoose'),status=box.querySelector('#epStatus');
 const context=box.id+':'+(box.id==='exportPresetDocument'?currentGroup.id:'')+':'+state.proType;const stored=baselines.get(box);const baseline=stored?.context===context?stored.config:current();baselines.set(box,{context,config:baseline});
 const exportButton=box.querySelector('#epExport');if(exportButton)exportButton.onclick=()=>deliverExport(current().format,box.id==='exportPresetDocument'?currentGroup.id:null,'download');
 function apply(row){active=row?{...row,config:structuredClone(row.config)}:null;const c=row?.config||(box.id==='exportPresetDocument'?{...baseline,layout:normalizedDocumentLayout(),branding:currentDocumentSettings.branding||{}}:baseline);
 const map={font:'documentFont',photo_layout:'documentPhotoLayout',accent:'documentAccent',cover_page:'documentCover',header:'documentHeader',footer:'documentFooter',page_numbers:'documentPageNumbers',document_type:'documentType',orientation:'documentOrientation',page_number_position:'documentPagePosition'};
 for(const [key,id] of Object.entries(map)){const el=document.getElementById(id);if(el&&c.layout?.[key]!=null){if(el.type==='checkbox')el.checked=c.layout[key];else el.value=c.layout[key];}}
 for(const [key,id] of Object.entries({company_name:'documentCompanyName',header_text:'documentHeaderText',footer_text:'documentFooterText'})){const el=document.getElementById(id);if(el)el.value=c.branding?.[key]||'';}
 if(document.getElementById('documentFont'))renderDocumentPreviewFromControls();
 if(exportButton)exportButton.disabled=!active;
 status.textContent=row?(send?(row.warnings||[]).join(' '):[row.description,...(row.warnings||[]),'Defaults applied. You can change settings before output. Layout and branding do not affect Photos (Markdown + Photos). Word templates retain their own styling.'].filter(Boolean).join(' ')):'';
 if(send){renderChooser(box,rows);options.onChange?.(active?(active.id==null?null:String(active.id)):'');}
 document.querySelectorAll('a[href^="/api/export/pdf?group="],a[href^="/api/export/docx?group="]').forEach(a=>{a.href=a.href.split('&packaging=')[0]+query();a.onclick=()=>{a.href=a.href.split('&packaging=')[0]+query();};});
 }
 choose.onchange=()=>apply(rows.find(r=>String(r.id)===choose.value));
 function edit(mode){const row=rows.find(r=>String(r.id)===choose.value);if(!['new','adjust'].includes(mode)&&!row){status.textContent='Choose a preset first.';return;}
 const c=['new','adjust'].includes(mode)?current():structuredClone(row.config),host=box.querySelector('#epEditor');
 host.innerHTML=`<form id="epForm">${mode==='adjust'?'':`<label>Preset Name<input id="epName" required maxlength="80" value="${escape(['new','adjust'].includes(mode)?'':(mode==='duplicate'?row.name.slice(0,75)+' Copy':row.name))}"></label><label>Description<textarea id="epDescription" maxlength="500">${escape(['new','adjust'].includes(mode)?'':row.description)}</textarea></label>`}<label>Output Format<select id="epFormat">${[['pdf','PDF'],['docx','Word'],['bundle','Markdown + Photos']].map(([v,t])=>`<option value="${v}"${v===c.format?' selected':''}>${t}</option>`).join('')}</select></label><label>Image Quality<select id="epQuality">${[['standard','Standard (2048 px)'],['print','Print (3000 px)'],['web','Web (1400 px)']].map(([v,t])=>`<option value="${v}"${v===c.resolution?' selected':''}>${t}</option>`).join('')}</select></label><label>Photos per Page<select id="epLayout">${LAYOUT_CHOICES.photo_layout.map(v=>`<option value="${v}">${PHOTO_LAYOUT_LABELS[v]}</option>`).join('')}</select></label><label>Typeface<select id="epFont">${LAYOUT_CHOICES.font.map(v=>`<option>${v}</option>`).join('')}</select></label><label>Accent Color<input id="epAccent" type="color" value="${escape(c.layout.accent||'#1d4ed8')}"></label>${['cover_page','header','footer','page_numbers'].map(k=>`<label><input type="checkbox" data-ep-layout="${k}"${c.layout[k]!==false?' checked':''}>${escape(k.replaceAll('_',' '))}</label>`).join('')}${['company_name','header_text','footer_text'].map(k=>`<label>${escape(k.replaceAll('_',' '))}<input data-ep-branding="${k}" maxlength="${{company_name:160,header_text:200,footer_text:240}[k]}" value="${escape(c.branding[k]||'')}"></label>`).join('')}<label><input id="epLogo" type="checkbox"${c.logo!==false?' checked':''}>Use current account logo</label>${mode==='adjust'?'':`<label><input id="epDefault" type="checkbox"${mode==='edit'&&row.is_default?' checked':''}>Default</label>`}<p>Photo titles, notes, date, location, topics, available evidence details and markings follow the existing export behavior. Specialty reports keep their own presentation. A removed logo is omitted.</p><button class="btn slim" id="epCommit" type="submit">${mode==='adjust'?'Apply to Output':'Save Preset'}</button><button class="btn secondary slim" id="epCancel" type="button">Cancel</button></form>`;
 host.querySelector('#epLayout').value=c.layout.photo_layout||'one_per_page';host.querySelector('#epFont').value=c.layout.font||'Arial';
 host.querySelector('#epCancel').onclick=()=>host.replaceChildren();
 host.querySelector('#epForm').onsubmit=async e=>{e.preventDefault();const button=host.querySelector('#epCommit');button.disabled=true;try{
 c.format=host.querySelector('#epFormat').value;c.resolution=host.querySelector('#epQuality').value;c.logo=host.querySelector('#epLogo').checked;
 c.layout.photo_layout=host.querySelector('#epLayout').value;c.layout.font=host.querySelector('#epFont').value;c.layout.accent=host.querySelector('#epAccent').value;
 host.querySelectorAll('[data-ep-layout]').forEach(el=>c.layout[el.dataset.epLayout]=el.checked);host.querySelectorAll('[data-ep-branding]').forEach(el=>c.branding[el.dataset.epBranding]=el.value);
 if(mode==='adjust'){apply({name:'Custom output settings',config:c,warnings:[]});host.replaceChildren();return;}
 const saved=await request('/api/export-presets'+(mode==='edit'?'/'+row.id:''),mode==='edit'?'PUT':'POST',{name:host.querySelector('#epName').value,description:host.querySelector('#epDescription').value,config:c,is_default:host.querySelector('#epDefault').checked});
 await mount(box,sendOptions?{...sendOptions,initial:String(saved.id)}:undefined);box.querySelector('#epChoose').value=saved.id;box.querySelector('#epChoose').dispatchEvent(new Event('change'));
 }catch(err){status.textContent=err.message;button.disabled=false;}};
 }
 box.querySelector('#epAdjust').onclick=()=>edit('adjust');
 box.querySelector('#epSave').onclick=()=>edit('new');box.querySelector('#epEdit').onclick=()=>edit('edit');box.querySelector('#epDuplicate').onclick=()=>edit('duplicate');
 box.querySelector('#epDelete').onclick=async()=>{if(!choose.value){status.textContent='Choose a preset first.';return;}if(!confirm('Delete this Export Preset? Documents and photos are kept.'))return;try{await request('/api/export-presets/'+choose.value,'DELETE');apply(null);await mount(box,sendOptions?{...sendOptions,initial:''}:undefined);}catch(e){status.textContent=e.message;}};
 const remembered=send&&typeof options.initial==='string'?options.initial:null;
 const d=remembered!=null?(remembered===''?null:rows.find(r=>String(r.id)===remembered)||rows.find(r=>r.is_default)):rows.find(r=>r.is_default);
 if(d){choose.value=d.id;apply(d);}else if(send)apply(null);
}
if(typeof document!=='undefined')document.addEventListener('photo-notes-languagechange',()=>{if(chooser?.box.isConnected)renderChooser(chooser.box,chooser.rows);});
window.PhotoNotesExportPresets={mount,activeName,query,supported,list,create,configFromLayout,migrateLocal,previewBranding:()=>active?current().branding:null,includeLogo:()=>!active||active.config.logo!==false,format:()=>active?.config.format||'pdf'};
})();
