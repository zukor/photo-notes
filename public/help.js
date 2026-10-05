/* Page-order Help follows the actual UI, including async panels and dialogs. */
(() => {
'use strict';
const catalog=window.PhotoNotesHelpCatalog;
if(!catalog)throw new Error('PhotoNotes Help catalog must load before Help.');
let context={edition:'public',page:'login',name:'PhotoNotes AI'},opened=false,query='',scope='page',timer,signature='';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const maintenanceText=s=>window.PhotoNotesMaintenanceTerminology?.text(s,context.edition)??s;
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
function hidden(n){
 for(let p=n;p&&p!==document.body;p=p.parentElement){if(p.hidden||p.getAttribute('aria-hidden')==='true'||p.style.display==='none'||getComputedStyle(p).display==='none'||p.id==='desktopHelp'||p.id==='photoNotesHelp')return true;}
 return false;
}
function labelText(n){const copy=n.cloneNode(true);copy.querySelectorAll('input,select,textarea,button').forEach(c=>c.remove());return clean(copy.textContent);}
function label(n){
 if(n.labels?.length)return clean([...n.labels].map(labelText).join(' '));
 const a=n.getAttribute('aria-label');if(a)return clean(a);
 if(n.tagName==='INPUT'||n.tagName==='TEXTAREA'||n.tagName==='SELECT'){
  const prev=n.previousElementSibling;if(prev?.tagName==='LABEL')return clean(prev.textContent);
  const parent=n.closest('label');if(parent)return labelText(parent);
  const before=n.parentElement?.previousElementSibling;if(before?.tagName==='LABEL')return clean(before.textContent);
  return clean(n.getAttribute('placeholder')||n.getAttribute('title')||n.name||n.id.replace(/([a-z])([A-Z])/g,'$1 $2')||'Selection');
 }
 return clean(n.getAttribute('title')||n.textContent||n.getAttribute('alt')||(n.dataset.col?'Annotation color '+n.dataset.col:'')||({'AUDIO':'Play recorded audio','VIDEO':'Play video'}[n.tagName])||n.id);
}
function matches(key,value){return key.endsWith('*')?value.startsWith(key.slice(0,-1)):key===value;}
function guide(n,title){
 const keys=[n.id,n.name,...Object.keys(n.dataset).filter(k=>k!=='add'||n.closest('#stampAdd')).map(k=>`data-${k.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}`),...n.classList,n.tagName.toLowerCase()].filter(Boolean);
 const rule=keys.map(v=>catalog.rules.find(r=>r.keys.some(k=>matches(k,v)))).find(Boolean);
 if(rule)return {text:maintenanceText(rule.text),terms:rule.terms,authored:true};
 const words=title.toLowerCase();
 const textRule=catalog.textRules.find(r=>new RegExp(r.match,'i').test(title));
 if(textRule)return {text:maintenanceText(textRule.text),terms:textRule.terms||[],authored:true};
 // New fields get current labels/options immediately; the release check flags unmapped controls.
 if(n.tagName==='SELECT')return {text:`Choose ${title.toLowerCase()} using the options listed on this page. Review the surrounding record before saving or applying the selection. Changing a filter changes the view rather than deleting records.`,terms:['Selection'],authored:false};
 if(n.tagName==='TEXTAREA')return {text:`Enter ${title.toLowerCase()} for the current record. Use specific facts supported by the photos, then review the text and use the form’s save/submit action.`,terms:['Photo note'],authored:false};
 if(n.tagName==='INPUT')return {text:n.type==='checkbox'?`Include or exclude ${title.toLowerCase()} in the current form or selection. Review the selected scope before saving or applying an action.`:n.type==='file'?`Choose the file requested by ${title.toLowerCase()}, using an accepted format. Review the selected source and use the form’s save/submit action.`:`Enter ${title.toLowerCase()} in the format shown by the field. Review the related record and save the form to retain the change.`,terms:['Selection'],authored:false};
 if(n.tagName==='SUMMARY')return {text:`Expand ${title} to see its settings, records, or instructions. The controls appear below this heading in Help in the same order as the page. Opening or closing this section does not save or delete work.`,terms:[],authored:true};
 return {text:`Use ${title} for the current record or selection. Review the scope and any confirmation or status shown before continuing.`,terms:[],authored:false};
}
function controls(){
 const dialogs=[...document.querySelectorAll('dialog[open],#issueModal:not([hidden]),.modal-backdrop,.evidence-modal,.photo-viewer-modal,.export-share-dialog[role=dialog],.location-dialog[role=dialog]')].filter(n=>!hidden(n)&&!n.closest('#photoNotesHelp'));
 const active=dialogs.at(-1);
 const nodes=[...(active||document.body).querySelectorAll('button,audio[controls],video[controls],input:not([type="hidden"]),select,textarea,summary,a[href],[role="button"],.pill[data-area],.pill[data-ref],.pill[data-add],.pill[data-col],.areax,.stamp-tool,#gps,#addr,#qualityStatus,#documentPreview,#stampStage,#cropStage,.evidence-readiness')];
 const seen=new Set(),items=[];
 if(active?.classList.contains('evidence-modal'))items.push({title:'Photo Details & History',text:'Review the original save time, file size, saved location, and file-check status. Original photo matches means the stored original agrees with its recorded fingerprint. An unavailable check means the app cannot confirm that comparison for this record. The original backup preserves the earlier image when supported. Changes lists recorded edits in time order. These records describe stored evidence and do not prove facts outside the photograph.',terms:['Evidence','Verification'],choices:[],authored:true,key:'photo-history-overview'});
 if(!active&&location.pathname.startsWith('/completion-photos/')&&document.querySelector('h1')?.textContent.includes('Photos received'))items.push({title:'Photos received',text:'The completion photos were added to the maintenance record. The property manager still needs to review the evidence. Receipt of photos is separate from verification and closure of the maintenance item.',terms:['Completion link','Verification','Receipt'],choices:[],authored:true,key:'completion-receipt'});
 if(!active&&location.pathname.startsWith('/review/'))items.push({title:'Review the photo evidence',text:'Inspect every photograph, its note, location, and date before responding. The displayed status shows whether the package is awaiting review or has already received a response. Approval records your decision about this package; request changes with a specific explanation when work needs attention.',terms:['Approval','Evidence'],choices:[],authored:true,key:'review-evidence'});
 for(const n of nodes){
  if(n.closest('#photoNotesHelp')||hidden(n)||n.closest('.document-preview-page')||n.closest('.leaflet-control-attribution')||n.closest('[inert]'))continue;
  if(n.tagName==='INPUT'&&n.style.display==='none')continue;
  const title=label(n);if(!title||title==='!'||title==='→')continue;
  const g=guide(n,title),key=[n.id.replace(/\d+/g,'#'),title,g.text].join('|');
  if(seen.has(key))continue;seen.add(key);
  const choices=n.tagName==='SELECT'?[...n.options].filter(o=>!o.hidden).map(o=>clean(o.textContent)).filter(Boolean):[];
  // Only structural choices, never user-entered field values, are read into Help.
  items.push({title,text:g.text,terms:g.terms,choices,authored:g.authored,key:keysFor(n),node:n});
 }
 return items;
}
function keysFor(n){return n.id||[...n.classList].filter(c=>!['btn','secondary','slim','tab','on'].includes(c)).join(' ')||n.tagName.toLowerCase();}
function relevantTerms(items){const names=new Set(items.flatMap(i=>i.terms));return [...names].filter(n=>catalog.terms[n]);}
function shell(){
 let root=document.getElementById('photoNotesHelp');
 const host=[...document.querySelectorAll('dialog[open]')].filter(n=>!n.closest('#photoNotesHelp')).at(-1)||document.body;
 if(root){if(root.parentElement!==host)host.append(root);return root;}
 root=document.createElement('div');root.id='photoNotesHelp';root.dataset.html2canvasIgnore='true';
 root.innerHTML=`<button class="pn-help-fab" type="button" aria-label="Open PhotoNotes AI Help" aria-controls="pnHelpDrawer" aria-expanded="${opened}" title="Help"><span aria-hidden="true">?</span></button>
 <aside id="pnHelpDrawer" class="pn-help-drawer" aria-labelledby="pnHelpTitle" aria-hidden="${!opened}" ${opened?'':'inert'}>
 <header><div><h2 id="pnHelpTitle">PhotoNotes AI Help</h2><p id="pnHelpPage"></p></div><button id="pnHelpClose" type="button" aria-label="Close Help">×</button></header>
 <div class="pn-help-search"><label for="pnHelpSearch">Search this page</label><div><input id="pnHelpSearch" type="search" placeholder="Find a feature or term"><button id="pnHelpClear" type="button">Clear</button></div>
 <nav aria-label="Help scope"><button type="button" data-pn-help-scope="page">This page</button><button type="button" data-pn-help-scope="general">Using PhotoNotes</button></nav></div>
 <div class="pn-help-reading"><p id="pnHelpCount" role="status" aria-live="polite"></p><div id="pnHelpResults"></div><section id="pnHelpTerms" aria-labelledby="pnHelpTermsTitle"><h3 id="pnHelpTermsTitle">Key Terms</h3><p>Hover, focus, or tap a term for its definition.</p><div id="pnHelpTermsList"></div></section></div>
 <footer><button id="pnHelpReport" type="button">Report an app problem</button></footer></aside>`;
 host.append(root);
 root.querySelector('.pn-help-fab').onclick=()=>opened?close():open();
 root.querySelector('#pnHelpClose').onclick=()=>close();
 root.querySelector('#pnHelpSearch').oninput=e=>{query=e.target.value;render();};
 root.querySelector('#pnHelpClear').onclick=()=>{query='';root.querySelector('#pnHelpSearch').value='';render();root.querySelector('#pnHelpSearch').focus();};
 root.querySelectorAll('[data-pn-help-scope]').forEach(b=>b.onclick=()=>{scope=b.dataset.pnHelpScope;query='';root.querySelector('#pnHelpSearch').value='';signature='';render();});
 root.querySelector('#pnHelpReport').onclick=()=>{close(false);if(context.reportIssue)context.reportIssue();else document.getElementById('issueFab')?.click();};
 root.querySelector('#pnHelpTermsList').addEventListener('click',e=>{const b=e.target.closest('[data-term]');if(!b)return;const expanded=b.getAttribute('aria-expanded')==='true';root.querySelectorAll('[data-term]').forEach(x=>x.setAttribute('aria-expanded','false'));b.setAttribute('aria-expanded',String(!expanded));});
 return root;
}
function pageTitle(){
 const dialog=document.querySelector('dialog[open],#issueModal:not([hidden]),.photo-viewer-modal,.evidence-modal,.export-share-dialog[role=dialog],.location-dialog[role=dialog]');
 return clean(dialog?.querySelector('h1,h2,h3,[id$=Title]')?.textContent||document.querySelector('#body .workflow-intro strong,#body h1,#body h2,#body .formhead,main h1')?.textContent||context.page.replaceAll('-',' ').replace(/^./,s=>s.toUpperCase()));
}
const general=[
 {title:'Property maintenance and completion',text:'In HOA Maintenance Pro and Property Manager Pro, choose the community and asset, follow inspection routes and guided visits, then document maintenance with photos, priority, assigned person, cost, and status. A completion link lets the recipient return photographs. Review that evidence before verification or closure; use dashboard, reports, and notification settings to follow outstanding work.',terms:['Completion link','Verification','Property visit','Inspection route']},
 {title:'Follow the photo workflow',text:'Take or import a photo, review it, add factual notes and relevant context, then use the Save or Send action offered by your edition. In Pro workflows, Organize finds and groups saved photos, Edit corrects them, Create composes documents, and Send prepares delivery. Industry tools add evidence specific to their work.',terms:['Capture','Edition','Document']},
 {title:'Save, upload, and delivery are different',text:'A local save means the browser is holding the photo on this device. Upload confirmation means PhotoNotes has received it. Sharing requires completing the chosen delivery action. Keep pending photos in this browser until upload succeeds; do not clear storage or change accounts while evidence is waiting.',terms:['Local save','Upload','Share sheet','Receipt']},
 {title:'Permissions and connection',text:'Allow camera, microphone, or location when using the corresponding tool. Check browser and device privacy settings if blocked. Type notes if dictation is unavailable. AI reading, server reports, road submissions, and most external delivery require a connection.',terms:['Permission','Dictation','AI']},
 {title:'Selecting the right version',text:'Use the account menu’s version selector to choose an enabled edition. Save your draft first. Your account’s permissions determine the versions and tools shown; contact the administrator if expected access is missing.',terms:['Edition','Account access','Draft']},
 {title:'Check exported files and received submissions',text:'Open downloaded PDF or Word documents and review the photos, captions, order, and page layout. Check the receiving workflow’s receipt for grouped submissions. Copying a link or opening a share sheet is not proof of delivery or approval.',terms:['PDF','Word','Caption','Receipt','Approval']},
 {title:'Report and retest an application problem',text:'Use Report Issue for a software problem, with the exact page, steps, expected result, actual result, and screenshot. Follow My Issue Reports or Testing Dashboard for repair requests. A retest is complete only when you repeat the requested steps and record what happened on your device.',terms:['App issue','Retest','Testing assignment']}
];
function render(){
 const root=shell();let items=scope==='page'?controls():general;
 items=items.map(i=>({...i,text:maintenanceText(i.text),terms:i.terms}));
 const words=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 const found=items.filter(i=>words.every(w=>(i.title+' '+i.text+' '+i.choices?.join(' ')+' '+i.terms.map(t=>maintenanceText(t)+' '+maintenanceText(catalog.terms[t])).join(' ')).toLowerCase().includes(w)));
 const sig=JSON.stringify([pageTitle(),context.edition,query,scope,items.map(i=>[i.title,i.text,i.choices])]);if(sig===signature)return;signature=sig;
 const expanded=new Set([...root.querySelectorAll('details[open]')].map(n=>n.dataset.helpTitle));
 const openTerms=new Set([...root.querySelectorAll('[data-term][aria-expanded="true"]')].map(n=>n.dataset.term));
 const focusedTerm=document.activeElement?.closest('#photoNotesHelp [data-term]')?.dataset.term;
 root.querySelector('#pnHelpPage').textContent=`${context.name} · ${pageTitle()}`;
 root.querySelector('#pnHelpCount').textContent=scope==='page'?`${items.length} page features, in page order${query?` · ${found.length} matches`:''}`:'PhotoNotes guidance';
 root.querySelector('#pnHelpResults').innerHTML=found.length?found.map((i,k)=>`<details class="pn-help-article" data-help-title="${esc(i.title)}" ${expanded.has(i.title)?'open':''}><summary>${scope==='page'?items.indexOf(i)+1+'. ':''}${esc(i.title)}</summary><p>${esc(i.text)}</p>${i.choices?.length?`<p><strong>Current choices:</strong> ${i.choices.map(esc).join('; ')}.</p>`:''}</details>`).join(''):'<p>No matching features. Try fewer words or clear the search.</p>';
 const terms=relevantTerms(items);
 root.querySelector('#pnHelpTermsList').innerHTML=terms.map((name,k)=>`<div class="pn-help-term"><button type="button" data-term="${esc(name)}" aria-expanded="${openTerms.has(name)}" aria-describedby="pnTerm${k}">${esc(maintenanceText(name))}</button><span id="pnTerm${k}" role="tooltip">${esc(maintenanceText(catalog.terms[name]))}</span></div>`).join('');
 if(focusedTerm)[...root.querySelectorAll('[data-term]')].find(n=>n.dataset.term===focusedTerm)?.focus();
 root.querySelectorAll('[data-pn-help-scope]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pnHelpScope===scope)));
 root.querySelector('#pnHelpReport').hidden=!context.reportIssue&&!document.getElementById('issueFab');
}
function open(){opened=true;document.body.classList.add('pn-help-open');const root=shell();root.querySelector('aside').inert=false;root.querySelector('aside').setAttribute('aria-hidden','false');root.querySelector('.pn-help-fab').setAttribute('aria-expanded','true');signature='';render();root.querySelector('#pnHelpSearch').focus();}
function close(focus=true){opened=false;document.body.classList.remove('pn-help-open');const root=shell();root.querySelectorAll('[data-term]').forEach(n=>n.setAttribute('aria-expanded','false'));root.querySelector('aside').inert=true;root.querySelector('aside').setAttribute('aria-hidden','true');root.querySelector('.pn-help-fab').setAttribute('aria-expanded','false');if(focus)root.querySelector('.pn-help-fab').focus();}
function mount(next){context={...context,...next};signature='';render();}
function reset(){context={edition:'public',page:'login',name:'Sign in'};query='';scope='page';if(opened)close(false);signature='';}
function schedule(){clearTimeout(timer);timer=setTimeout(()=>{if(opened||!document.getElementById('photoNotesHelp')){render();}},80);}
const observer=new MutationObserver(changes=>{if(changes.some(c=>!(c.target instanceof Element?c.target:c.target.parentElement)?.closest('#photoNotesHelp')))schedule();});
function start(){
 const standalone=location.pathname.includes('admin')?'Administration':location.pathname.includes('install')?'Installation':location.pathname.startsWith('/review/')?'Customer review':location.pathname.startsWith('/completion-photos/')?'Completion photos':null;
 if(standalone)context={edition:'public',page:standalone,name:standalone};
 shell();observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','aria-hidden','disabled','class','style','open'],characterData:true});
 render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
document.addEventListener('keydown',e=>{if(e.key==='Tab'&&opened){const els=[...document.querySelectorAll('#photoNotesHelp button,#photoNotesHelp input,#photoNotesHelp summary')].filter(n=>!hidden(n)&&n.getClientRects().length);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
 if(e.key==='Escape'&&opened){e.preventDefault();e.stopImmediatePropagation();const expanded=document.querySelector('#photoNotesHelp [data-term][aria-expanded="true"]');if(expanded){expanded.setAttribute('aria-expanded','false');expanded.focus();}else close();}},true);
window.PhotoNotesHelp={mount,reset,inspect:()=>controls().map(({node,...item})=>item),refresh:()=>{signature='';render();}};
})();
