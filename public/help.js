/* Desktop help. Static guidance works without a help service or paid calls. */
(() => {
'use strict';
const core = {
  capture: [
    ['Take or import a photo', 'Use Capture to take a new business photo or import one you already have. The photo is the main record; notes and details add useful context to it.'],
    ['Voice notes', 'Record a short spoken note while the details are fresh. Photo Notes turns it into text attached to the photo so you can review and search it later.'],
    ['Location, topics, and jobs', 'Location records where the photo was taken when permission is available. Topics and jobs help you file the photo with the right work without changing the original image.'],
    ['Photo quality check', 'The quality check warns you about common problems such as a blurry or dark photo before you save. You can still choose to keep the photo when it is the best evidence available.'],
    ['Offline save / waiting to upload', 'If the connection is unavailable, Photo Notes can hold the capture on this device until it can upload. Keep the page open long enough to see that the photo was saved or is waiting to upload.']
  ],
  organize: [
    ['Library cards and selection', 'Library cards show the photo and its most useful details together. Select cards when you want to edit, compare, create, or send a specific set of photos.'],
    ['Topics and jobs', 'Topics group photos by subject, while jobs group them by a piece of work or customer. They make a growing photo library easier to find and reuse.'],
    ['Smart search', 'Smart search looks across photo notes, addresses, jobs, customers, topics, dates, and other saved details. Use it when you remember the work but not where the photo was filed.'],
    ['Photo comparison', 'Photo comparison places selected photos together so changes are easier to see. It is useful for before-and-after evidence or checking progress over time.'],
    ['Batch templates', 'Batch templates apply the same useful structure to several selected photos. They reduce repeated entry while keeping each photo as its own record.']
  ],
  edit: [
    ['Rotate / flip / crop', 'Use these tools to correct the view or focus attention on the useful part of a photo. Photo Notes keeps the original so you can return to it.'],
    ['Markup and annotation templates', 'Markup adds arrows, shapes, or labels that make visible evidence easier to understand. Templates help you reuse a consistent annotation style.'],
    ['Fix addresses', 'Fix Addresses retries missing location descriptions for selected photos that have usable coordinates. It does not change the photo itself.'],
    ['Evidence fingerprint / verification', 'Verification records a digital fingerprint of the original file and its history. It helps show whether the original photo still matches the file first received.'],
    ['Restore original photo', 'Restore Original removes saved visual edits and returns to the first uploaded image. Notes and other record details remain available.']
  ],
  create: [
    ['Document setup', 'Create turns selected photos into an ordered business document. Add a clear title and short description so the reader knows what the photos document.'],
    ['Photo order and captions', 'Arrange photos in the sequence that tells the clearest story. Captions explain why each image matters without replacing the visible evidence.'],
    ['PDF, Word, or Markdown + Photos', 'Choose PDF for a finished document, Word for editing, or Markdown + Photos for a ZIP file containing an AI-readable Markdown document and its photos.'],
    ['Export quality and format', 'Quality and format settings balance image clarity against file size. Use higher quality when small visual details are important to the reader.']
  ],
  send: [
    ['Share selected photos', 'Share sends the photos you selected in Organize through the options available on this device. Check the selection summary before sending.'],
    ['Customer approval package', 'An approval package creates a private, expiring review link for selected photos. The customer can approve the package or request changes.'],
    ['Send or save a document', 'You can send a finished PDF or Word document, or save it for delivery another way. The document keeps the photos and their supporting details together.'],
    ['Mac-to-Android messaging notice', 'Texting from a Mac to an Android phone may require Text Message Forwarding from your iPhone. The notice appears when that setup may affect delivery.']
  ]
};
const all = ['basic','pro','contractor','roads','paving','hoa','concrete','roofer'];
const pro = ['pro','contractor','paving','concrete','roofer'];
const articles = [];
function add(category, editions, page, title, text) { articles.push({id:articles.length,category,editions,page,title,text}); }
Object.entries(core).forEach(([page, topics]) => topics.forEach(([title,text]) => add(page[0].toUpperCase()+page.slice(1),page==='capture'?(title==='Location, topics, and jobs'?all.filter(e=>!['basic','roads'].includes(e)):all.filter(e=>e!=='roads')):pro,page,title,text)));
add('Getting started',all,'','Start with a photo','The photo is your evidence. Take or choose a clear photo, add a title and a note explaining what matters, check its location, then save. Review the save status before leaving the page. Use the topics below for the tools available in your current version.');
add('Getting started',all,'','Versions and account access','The version selector at the top of the page lists the versions enabled for your account. Finish saving your current photo before switching. Basic focuses on capture and sending the current photo. Pro adds Organize, Edit, Create, and Send. Industry versions add their own photo workflows. Contact your administrator if a version is missing.');
add('Getting started',all,'','Use this help panel','Search by a task, tool, or problem, or choose a category. Open a question to read its answer. This page shows guidance for your current workspace. All topics shows everything available for this version. You can keep working with help open. Close help with the × button, the yellow question mark, or Escape. Help is available in desktop windows at least 1,100 pixels wide with a mouse or trackpad.');
add('Capture',all.filter(e=>e!=='roads'),'capture','Save and send the current photo','Take or import a photo, review the preview, and enter your note. Use Save Photo Notes to save the capture. Use Send Photo Notes to prepare the current capture for sharing, then choose an available destination. Check the preview before completing the share. Closing or canceling the share sheet does not mean the message was delivered.');
add('Capture',all.filter(e=>e!=='roads'),'capture','Titles, topics, and location','Give the photo a short, specific title. Select a topic to group related evidence. Allow location access when prompted, then review the displayed GPS and address. An imported image may not contain usable location information. Confirm the location before relying on it in a report.');
add('Organize',pro,'organize','Find photos and work with a selection','Open Organize and search using a note, title, job, address, or date. Apply the available filters to narrow the library. Select the photos you want to work with before opening Edit, Create, or Send. Check the selected count so unrelated photos are not included. Open a photo to inspect it at a larger size.');
add('Organize',pro,'organize','Jobs and timelines','Create or select a job and associate the relevant photos with it. Add the customer, job number, and address where available. Open the job timeline to review its photographic record over time. Keep photo titles and notes specific enough to explain each stage of the work.');
add('Edit',pro,'edit','Edit a photo and review its history','Select a photo in Organize, then open Edit. Choose a tool, make the change, and save it before moving on. Use Photo Details & History to review the original evidence and recorded changes. Use Restore Original when you need to undo saved visual edits, and review the result.');
add('Create',pro,'create','Build a document step by step','Select the photos in Organize, open Create, and set the document title. Review the photo order, captions, and supporting details in the preview. Adjust the content before exporting. Choose PDF for distribution, Word for further editing, or Markdown + Photos to use the text and image files together. Open the downloaded file to confirm its contents.');
add('Create',pro,'create','Company logo and Word templates','Use the company branding and template controls in the document workflow to add your logo or import a Word template. Review the generated preview after applying the template, especially photo placement, captions, and page breaks. Export and check the final file before sharing it.');
add('Send',pro,'send','Downloads, printing, and share options','Review the selected photos or finished document in Send. Use an available share destination, save the file, or print it. Browser and operating-system share options vary. If the destination you need is absent, download the file and attach it directly in your email or messaging application.');
add('Send',pro,'send','Review an approval link before sharing','Prepare the selected photos as a customer approval package. Check the recipient-facing preview and expiration settings before copying or sending the link. Review the recorded approval or requested changes in the app. Creating a link alone does not mean the customer received or approved it.');
add('Paving tools',['paving'],'capture','Classify pavement evidence','Photograph the pavement clearly and select the reason for the photo. Review the suggested defect classification and severity, correcting them when needed. Add job and location context before saving. Tool availability depends on your account. AI suggestions need your review.');
add('Paving tools',['paving'],'ticket','Scan a paving delivery ticket','Open the delivery ticket scanner in Camera Tools. Photograph the entire ticket straight on, with readable text and no glare. Review the extracted ticket fields, correct errors, and choose the right job before saving. Use saved tickets and daily tonnage to review the deliveries documented by those tickets.');
add('Paving tools',['paving'],'camera-reader','Read a display or document with the camera','Choose the appropriate reader in Camera Tools. Fill the frame with the display or document and keep it sharp. Review the extracted reading and units, correct any error, then save. Retake the photo if the source is not legible.');
add('Paving tools',['paving'],'map','Map, measurement zones, and extra work','Use the job-site map to review located photos and the available area or roadway zones. Check measurement references and units before using estimates. For extra work, attach the relevant photos to an Extra Work Record and explain what changed. Review evidence readiness before exporting a job report.');
add('Measurement and comparison',['paving','concrete'],'alignment','Capture a matched before-and-after pair','Open Before & After Alignment and choose an unpaired before photo. Match the camera location, height, direction, and landmarks when taking the after photo. Move the comparison overlay slider to check alignment. Retake when needed, add the after-photo note, and use Save Matched Pair.');
add('Measurement and comparison',['paving','concrete'],'edit','Measure a photo','Open the measurement controls for a photo. Use a clearly visible reference object for assisted measurement or enter dimensions yourself. Check the units and dimensions against the site. Perspective and uncertain reference sizes can affect estimates. Save reviewed dimensions with the photo.');
add('Concrete tools',['concrete'],'capture','Document concrete work by stage','Choose the concrete element and photo stage, such as pre-pour, reinforcement, placement, curing, defect, or repair. Add the exact location, condition, severity, and relevant mix or specification details. Keep the photo focused on the stage being documented, and review the fields before saving.');
add('Concrete tools',['concrete'],'concrete-report','Build a concrete evidence report','Review the project photo summary and readiness checklist. Link relevant batch-ticket or specification photos, check dimensions and comparison photos, and fill gaps in the evidence. Export the concrete PDF or Word report and review it. Use Create for a more flexible general photo document.');
add('HOA workflows',['hoa'],'hoa-visits','Organize a community photo visit','Choose the community and document a visit with photos and notes. Identify the maintenance issue, information request, or inspection being recorded. Add a clear title, category, priority, and location so the next person can understand the evidence.');
add('HOA workflows',['hoa'],'hoa-assets','Create and update an asset photo record','Open Assets, select the community, and enter the asset name, type, exact location, and current condition. Add the required identity photo and save the record. Open an existing asset to add condition, damage, repair-progress, or verification photos to its history.');
add('HOA workflows',['hoa'],'hoa-inspections','Record inspection evidence','Open Inspections and choose the relevant community or asset. Add photos and notes showing the condition you inspected. Review findings and link maintenance follow-up where available. A checked item should be supported by the corresponding photo evidence.');
add('HOA workflows',['hoa'],'hoa-maintenance','Track maintenance through final review','Open Records to review maintenance evidence and status. Add original-condition, work-in-progress, completed-work, and final-review photos as work advances. Review assignment, target date, approval, and cost fields. Use completion photo request links when appropriate, then verify the returned evidence before closing the work.');
add('HOA workflows',['hoa'],'hoa-reports','Prepare a board photo report','Review the community records, photo timelines, and before-and-after evidence. Confirm the status and supporting details, then export a board-ready PDF or Word report. Inspect the file before distribution. The dashboard and notifications help identify records needing attention.');
add('Road reporting',['roads'],'road-report','Photograph and send a road issue','Choose the road issue type, take a photo with the camera, and inspect the preview. Retake or cancel if needed. Review the location and use Send to submit the road report. Read the resulting status. The red Report Issue button is for a problem with the application itself.');
add('Troubleshooting',all,'','Photo waiting to upload or connection lost','A pending capture is stored in this browser until upload is confirmed. Keep Photo Notes open and reconnect. Use Pending Photos, when shown, to inspect waiting captures. Do not clear browser data or uninstall while photos are pending. If signed out, reconnect and sign in to the same account. Check that the waiting status clears before assuming the upload finished.');
add('Troubleshooting',all,'','Camera, microphone, or location blocked','Open your browser site permissions for Photo Notes and allow the permission needed for your task. Check the operating system privacy settings as well. Retry the action after granting access. If dictation is unavailable, type your note. If a camera cannot be used, use photo import where your version supports it.');
add('Troubleshooting',all,'','A file will not download or share','Wait for file preparation to finish. Check the browser downloads list and download permissions. Try saving the file first and opening it from Downloads. A canceled share is not a completed delivery. If an export repeatedly fails, report the format, version, and steps used.');
add('Troubleshooting',all,'my-issues','Report a problem and follow its repair','Use Report Issue to describe what you did, what you expected, and what happened. Review the screenshot and mark the relevant area before submitting. Open My Issue Reports or Testing Hub from the account menu to follow progress. When a repair is ready, repeat the supplied steps and report whether it is fixed on your device.');
add('Testing',all,'my-assignment','Complete a testing assignment','Open My Testing Assignment from the account menu. Perform each listed check before marking it complete. Use Report Issue for defects and screenshots. Add overall notes to the assignment, then submit once all required checks are complete. Submission records completion of the assignment, not proof that every behavior passed.');
const eligible = matchMedia('(min-width: 1100px) and (any-hover: hover) and (any-pointer: fine)');
const phone = /Android.*Mobile|iPhone|iPod/i.test(navigator.userAgent);
let context = null, opened = false, query = '', category = '', currentOnly = false;
const escape = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function reset() { context=null; opened=false; query=''; category=''; currentOnly=false; document.getElementById('desktopHelp')?.remove(); document.body.classList.remove('desktop-help-open'); }
function close(focus=true) { opened=false; document.body.classList.remove('desktop-help-open'); const root=document.getElementById('desktopHelp'); if(!root)return; root.querySelector('aside').inert=true; root.querySelector('aside').setAttribute('aria-hidden','true'); root.querySelector('.help-fab').setAttribute('aria-expanded','false'); if(focus)root.querySelector('.help-fab').focus(); }
function relevant(article) { return article.page===context.page || (context.page.startsWith('hoa-') && article.category==='HOA workflows') || (context.page==='camera-tools' && ['Paving tools','Measurement and comparison'].includes(article.category)); }
function results() {
 const root=document.getElementById('desktopHelp'); if(!root)return;
 const terms=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const found=articles.filter(a=>a.editions.includes(context.edition)&&(!category||a.category===category)&&(!currentOnly||relevant(a))&&terms.every(t=>(a.title+' '+a.text+' '+a.category).toLocaleLowerCase().includes(t)));
 root.querySelector('#helpCount').textContent=`${found.length} ${found.length===1?'topic':'topics'}`;
 root.querySelector('#helpResults').innerHTML=found.length?found.map(a=>`<details class="help-article"><summary>${escape(a.title)}</summary><p>${escape(a.text)}</p></details>`).join(''):'<p>No matching topics. Try fewer words, choose All categories, or open All topics.</p>';
 root.querySelectorAll('[data-help-scope]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.helpScope==='page')===currentOnly)));
}
function mount(next) {
 if(context?.edition!==next.edition) {query='';category='';currentOnly=false;}
 context=next; document.getElementById('desktopHelp')?.remove();
 if(!eligible.matches||phone) {opened=false;document.body.classList.remove('desktop-help-open');return;}
 const categories=[...new Set(articles.filter(a=>a.editions.includes(context.edition)).map(a=>a.category))];
 document.getElementById('app').insertAdjacentHTML('beforeend',`<div id="desktopHelp" data-html2canvas-ignore="true">
 <button class="help-fab" type="button" aria-label="Open Photo Notes help" title="Photo Notes help" aria-controls="helpDrawer" aria-expanded="${opened}"><span aria-hidden="true">?</span></button>
 <aside id="helpDrawer" class="help-drawer" aria-labelledby="helpTitle" aria-hidden="${!opened}" ${opened?'':'inert'}>
 <header><div><h2 id="helpTitle">Photo Notes Help</h2><p>${escape(context.name)}</p></div><button id="helpClose" type="button" aria-label="Close help">×</button></header>
 <div class="help-search"><label for="helpSearch">Search help</label><div><input id="helpSearch" type="search" placeholder="Try photos, PDF, or offline" value="${escape(query)}"><button id="helpClear" type="button">Clear</button></div>
 <label for="helpCategory">Browse topics</label><select id="helpCategory"><option value="">All categories</option>${categories.map(c=>`<option ${category===c?'selected':''}>${escape(c)}</option>`).join('')}</select>
 <nav aria-label="Help topics"><button type="button" data-help-scope="page">This page</button><button type="button" data-help-scope="all">All topics</button></nav></div>
 <div class="help-reading"><p id="helpCount" role="status" aria-live="polite"></p><div id="helpResults"></div></div>
 <footer><button type="button" id="helpReport">Report an app problem</button><p>Include the steps and a screenshot.</p></footer></aside></div>`);
 const root=document.getElementById('desktopHelp');
 root.querySelector('.help-fab').onclick=()=>{if(opened)return close();opened=true;document.body.classList.add('desktop-help-open');root.querySelector('aside').inert=false;root.querySelector('aside').setAttribute('aria-hidden','false');root.querySelector('.help-fab').setAttribute('aria-expanded','true');root.querySelector('#helpSearch').focus();};
 root.querySelector('#helpClose').onclick=()=>close();
 root.querySelector('#helpSearch').oninput=e=>{query=e.target.value;results();};
 root.querySelector('#helpClear').onclick=()=>{query='';category='';currentOnly=false;root.querySelector('#helpSearch').value='';root.querySelector('#helpCategory').value='';results();root.querySelector('#helpSearch').focus();};
 root.querySelector('#helpCategory').onchange=e=>{category=e.target.value;currentOnly=false;results();};
 root.querySelectorAll('[data-help-scope]').forEach(b=>b.onclick=()=>{currentOnly=b.dataset.helpScope==='page';category='';query='';root.querySelector('#helpSearch').value='';root.querySelector('#helpCategory').value='';results();});
 root.querySelector('#helpReport').onclick=()=>{close(false);context.reportIssue();};
 document.body.classList.toggle('desktop-help-open',opened);results();
}
eligible.addEventListener('change',()=>{if(context)mount(context);});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened&&!document.querySelector('dialog[open], #issueModal:not([hidden])')) {event.preventDefault();close();}});
window.PhotoNotesHelp={mount,reset};
})();
