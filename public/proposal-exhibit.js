/* Proposal exhibit uses saved document photos. Draft settings remain on this device. */
(() => {
'use strict';
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
window.PhotoNotesExhibit = {open({group,items,photoSrc,userId}) {
 const key=`proposal-exhibit:${userId}:${group.id}`;
 let saved;try{saved=JSON.parse(localStorage.getItem(key));}catch(_){}
 if(!saved || typeof saved!=='object' || !Array.isArray(saved.fields) || !Array.isArray(saved.boxes))saved=null;
 const draft=Object.assign({orientation:'portrait',count:2,header:group.title,footer:'',reference:'',fields:['title','note','address','date'],boxes:[]},saved||{});
 const panel=document.createElement('section');panel.id='exhibit-editor';panel.style='background:white;color:black;padding:16px;border:2px solid black;margin:16px 0;text-align:left';
 panel.innerHTML=`<style>#exhibit-editor p,#exhibit-editor label,#exhibit-editor legend,#exhibit-editor input,#exhibit-editor select,#exhibit-editor textarea{color:#000;text-align:left}#exhibit-editor input,#exhibit-editor select,#exhibit-editor textarea{background:#fff}#exhibit-editor .btn{color:#000;background:#fff;border:1px solid #000}#exhibit-editor fieldset{min-width:0}#exhibit-editor input[type=checkbox]{width:auto}</style><h2>Proposal Exhibit</h2><p>Uses this document's saved photos and order. Long notes continue onto additional pages. Draft settings save on this device only.</p>
 <label for="exhibit-reference">Exhibit / proposal reference</label><input id="exhibit-reference">
 <label for="exhibit-orientation">Layout</label><select id="exhibit-orientation"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
 <label for="exhibit-count">Maximum PhotoNotes per page</label><select id="exhibit-count">${[1,2,3,4].map(n=>`<option>${n}</option>`).join('')}</select>
 <label for="exhibit-header">Header</label><textarea id="exhibit-header"></textarea><label for="exhibit-footer">Footer</label><textarea id="exhibit-footer"></textarea>
 <fieldset><legend>Include photo details</legend>${['title','note','address','gps','date','topics','dimensions'].map(f=>`<label style="display:inline-block;margin:8px"><input type="checkbox" id="exhibit-field-${f}" value="${f}"> ${f==='gps'?'GPS':f[0].toUpperCase()+f.slice(1)}</label>`).join('')}</fieldset>
 <p>Text boxes use page coordinates in inches from the top left. Keep them clear of photos and notes. Preview every page before printing.</p><button class="btn secondary" id="exhibit-add">Add Text Box</button><div id="exhibit-boxes"></div>
 <button class="btn" id="exhibit-preview">Update Preview / Save Draft</button><button class="btn secondary" id="exhibit-print" disabled>Print / Save as PDF</button><button class="btn secondary" id="exhibit-close">Close</button><p id="exhibit-status" role="status"></p><iframe title="Proposal exhibit preview" id="exhibit-frame" style="width:100%;height:650px;background:white;border:1px solid black"></iframe>`;
 document.getElementById('exhibit-editor')?.remove();document.getElementById('documentPreview').before(panel);
 const $=id=>panel.querySelector('#exhibit-'+id);
 ['reference','orientation','count','header','footer'].forEach(f=>$(f).value=draft[f]);
 draft.fields.forEach(f=>{if($('field-'+f))$('field-'+f).checked=true;});
 const boxes=()=>{ $('boxes').innerHTML=draft.boxes.map((b,i)=>`<fieldset><legend>Text Box ${i+1}</legend><label>Text<textarea data-exhibit-box="${i}" data-key="text">${escape(b.text)}</textarea></label>${[['page','Page',1,999],['x','Left (inches)',0,10],['y','Top (inches)',0,10],['width','Width (inches)',.5,10]].map(([k,l,min,max])=>`<label>${l}<input type="number" step="${k==='page'?1:.1}" min="${min}" max="${max}" value="${b[k]}" data-exhibit-box="${i}" data-key="${k}"></label>`).join('')}<button class="btn secondary" data-exhibit-remove="${i}">Remove Text Box</button></fieldset>`).join('');$('boxes').querySelectorAll('[data-exhibit-box]').forEach(el=>el.oninput=()=>{draft.boxes[el.dataset.exhibitBox][el.dataset.key]=el.dataset.key==='text'?el.value:Number(el.value);$('print').disabled=true;});$('boxes').querySelectorAll('[data-exhibit-remove]').forEach(el=>el.onclick=()=>{draft.boxes.splice(Number(el.dataset.exhibitRemove),1);boxes();$('print').disabled=true;});};
 boxes();$('add').onclick=()=>{draft.boxes.push({text:'',page:1,x:.5,y:1,width:2});boxes();$('print').disabled=true;};
 panel.querySelectorAll('input,select,textarea').forEach(el=>el.addEventListener('input',()=>$('print').disabled=true));
 $('close').onclick=()=>panel.remove();
 $('preview').onclick=async()=>{
  const controls=Array.from(panel.querySelectorAll('input,select,textarea,button')).filter(el=>el!==$('close'));
  controls.forEach(el=>el.disabled=true);
  try {
  $('print').disabled=true;
  ['reference','orientation','count','header','footer'].forEach(f=>draft[f]=$(f).value);
  draft.fields=Array.from(panel.querySelectorAll('[id^="exhibit-field-"]:checked'),e=>e.value);
  const landscape=draft.orientation==='landscape',pw=landscape?11:8.5,ph=landscape?8.5:11;
  if(draft.boxes.some(b=>!Number.isInteger(b.page)||b.page<1||b.page>999||!Number.isFinite(b.x)||!Number.isFinite(b.y)||!Number.isFinite(b.width)||b.x<0||b.y<0||b.width<.5||b.x+b.width>pw||b.y>ph-1)){ $('status').textContent='Text box coordinates must fit inside the page.';return; }
  try{localStorage.setItem(key,JSON.stringify(draft));$('status').textContent='Draft saved on this device. Building preview...';}catch(_){$('status').textContent='Device storage unavailable. Keep this editor open.';}
  const frame=$('frame');frame.srcdoc=`<!doctype html><html><head><style>@page{size:letter ${draft.orientation};margin:0}*{box-sizing:border-box}body{margin:0;color:black;font:11pt Arial,Helvetica,sans-serif;text-align:left}.page{width:${pw}in;height:${ph}in;padding:.5in;position:relative;break-after:page;overflow:visible;background:white;border:1px solid black;margin:12px auto}.page:last-child{break-after:auto}header{height:.7in;white-space:pre-wrap;overflow-wrap:anywhere}footer{position:absolute;bottom:.25in;height:.3in;left:.5in;right:.5in;display:flex;justify-content:space-between;font-size:9pt;gap:12px;white-space:pre-wrap;overflow-wrap:anywhere}footer span:first-child{flex:1}footer span:last-child{white-space:nowrap}.content{height:${ph-1.65}in}.photo{margin:0 0 12px;display:flow-root;overflow-wrap:anywhere;white-space:pre-wrap}.photo img{width:42%;height:2in;object-fit:contain;float:left;margin:0 12px 8px 0}.box{position:absolute;white-space:pre-wrap;overflow-wrap:anywhere;background:white;border:1px solid black;padding:6px}@media print{.page{margin:0;border:0}}</style></head><body></body></html>`;
  await new Promise(resolve=>frame.onload=resolve);
  const doc=frame.contentDocument;let page,content,n=0;
  const newPage=()=>{page=doc.createElement('section');page.className='page';page.innerHTML=`<header><strong>${escape(draft.header)}</strong><br>${escape(draft.reference)}</header><main class="content"></main><footer><span>${escape(draft.footer)}</span><span>Page ${doc.body.children.length+1}</span></footer>`;doc.body.append(page);content=page.querySelector('main');n=0;};newPage();
  if(page.querySelector('footer').scrollHeight>page.querySelector('footer').clientHeight){$('status').textContent='Shorten the footer to fit the footer area.';return;}
  if(page.querySelector('header').scrollHeight>page.querySelector('header').clientHeight){$('status').textContent='Shorten the header or exhibit reference to fit the header area.';return;}
  for(const [index,item] of items.entries()){
   if(n>=Number(draft.count))newPage();
   const details={title:item.photo_title,note:item.note,address:item.address,gps:item.latitude!=null&&item.longitude!=null?`${item.latitude}, ${item.longitude}`:'',date:item.created_at?new Date(item.created_at).toLocaleString():'',topics:Array.isArray(item.area_tags)?item.area_tags.join(', '):'',dimensions:typeof fmtDimsClient==='function'?fmtDimsClient(item):''};
   let article=doc.createElement('article');article.className='photo';article.innerHTML=`<strong>Photo ${index+1}</strong>\n${item.photo_path?`<img src="${escape(photoSrc(item))}" alt="Photo ${index+1}">`:''}`;content.append(article);
   for(const image of article.querySelectorAll('img')){await new Promise(resolve=>{if(image.complete)resolve();else{const timeout=setTimeout(resolve,15000);const done=()=>{clearTimeout(timeout);resolve();};image.onload=done;image.onerror=done;}});if(!image.naturalWidth){$('status').textContent='A photo failed to load. Reopen the document and retry.';return;}}
   if(content.scrollHeight>content.clientHeight&&n){article.remove();newPage();content.append(article);}n++;
   for(const field of draft.fields){if(!details[field])continue;const words=String(details[field]).split(/(\s+)/).flatMap(word=>word.length>80?Array.from(word):[word]);let line=doc.createElement('div');article.append(line);
    for(const word of words){const previous=line.textContent;line.textContent+=word;if(content.scrollHeight>content.clientHeight){line.textContent=previous;newPage();const continuation=doc.createElement('article');continuation.className='photo';continuation.innerHTML=`<strong>Photo ${index+1} (continued)</strong>`;content.append(continuation);line=doc.createElement('div');continuation.append(line);line.textContent=word;article=continuation;n=1;}}
   }
  }
  while(doc.body.children.length<Math.max(1,...draft.boxes.map(b=>b.page)))newPage();
  let boxOverflow=false;
  draft.boxes.forEach(b=>{const box=doc.createElement('div');box.className='box';box.style=`left:${b.x}in;top:${b.y}in;width:${b.width}in`;box.textContent=b.text;doc.body.children[b.page-1].append(box);if(box.offsetTop+box.offsetHeight>doc.body.children[b.page-1].clientHeight)boxOverflow=true;});
  if(boxOverflow){$('status').textContent='A text box extends below its page. Move it upward, widen it, or shorten its text.';return;}
  $('status').textContent=`${doc.body.children.length} pages. Review text boxes for overlap. In Print choose Letter, the matching orientation, and turn off browser headers and footers.`;$('print').disabled=false;
 } catch(error){$('status').textContent='Preview could not be built. Please try again.';}
  finally{controls.forEach(el=>{if(el!==$('print'))el.disabled=false;});}
 };
 $('print').onclick=()=>{$('frame').contentWindow.focus();$('frame').contentWindow.print();};
 panel.scrollIntoView({behavior:'smooth'});
}};
})();
