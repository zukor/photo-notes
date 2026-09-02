const el = document.getElementById('app');
// Phones/tablets open to Capture (grab a photo fast); computers open to the Library (review the photos).
const IS_HANDHELD = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 768;
let state = { view: IS_HANDHELD ? 'capture' : 'organize', location: null, address: null, photoFile: null, kind: 'note', area: '', areas: [], jobs: [], jobId: '', hoaCompany:null, hoaMembers:[], hoaUnread:0, communities:[], communityId:'', groups: null, groupId: null, imgv: 0, plan: 'free', proType:'paving', me: null, ewrId: null, selectedIds: new Set() };

// Pro gating on the client. Mirrors isPro(user) on the server. Pro-only UI must
// not render at all for free users (no disabled teaser).
function isProClient() { return state.plan === 'pro'; }
function isHoaClient(){return isProClient()&&state.proType==='hoa';}
function isConcreteClient(){return isProClient()&&state.proType==='concrete';}
function isPavingClient(){return isProClient()&&(state.proType==='paving'||state.proType==='asphalt');}
function isRooferClient(){return isProClient()&&state.proType==='roofer';}
function isRoadIssuesClient(){return !isProClient()&&state.proType==='roads';}
function productName(){return isRoadIssuesClient()?'Road Issue Reporter':isHoaClient()?'HOA Maintenance Pro':isConcreteClient()?'Concrete Pro':isRooferClient()?'Roofer Pro':isPavingClient()?'Paving Pro':'Photo Notes';}
function issueFabLabel(){return isRoadIssuesClient()?'Report Issue':'Report an Issue';}
function featureOn(name) { return isPavingClient() && (!state.me || !state.me.feature_access || state.me.feature_access[name] !== false); }
function measurementOn(){return isConcreteClient()||featureOn('measurements');}
function beforeAfterOn(){return isConcreteClient()||featureOn('before_after');}
function isMacClient() { return /Macintosh|MacIntel/.test(navigator.userAgent + ' ' + navigator.platform) && !isIOS(); }
let recognizer = null;
let dictationActive = false;
let dictationRestartTimer = null;
let dictationWatchdog = null;
let dictationGeneration = 0;
let captureLocationGeneration = 0;
let dictationBase = '';
let currentGroupItems = [];
let currentGroup = null;
let currentGroupPairs = [];
let deferredInstallPrompt = null;
let installOfferShown = false;
const INSTALL_PROMPT_KEY = 'pn_install_prompt_dismissed_v1';

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  maybeOfferInstall();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  localStorage.setItem(INSTALL_PROMPT_KEY, 'installed');
  const modal = document.getElementById('installPrompt');
  if (modal) modal.remove();
  toast('Photo Notes added to your phone');
});

function uiT(text) { return window.photoNotesI18n ? window.photoNotesI18n.t(text) : text; }
function uiLocale() { return window.photoNotesI18n && window.photoNotesI18n.getLanguage() === 'es' ? 'es-US' : undefined; }
function uiSpeechLanguage() { return window.photoNotesI18n && window.photoNotesI18n.getLanguage() === 'es' ? 'es-US' : 'en-US'; }

// Live title-case: capitalize the first letter of each word as the user types,
// keeping the caret in place.
function titleCaseInput(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    const pos = el.selectionStart;
    const v = el.value.replace(/\b\w/g, ch => ch.toUpperCase());
    if (v !== el.value) { el.value = v; try { el.setSelectionRange(pos, pos); } catch (e) {} }
  });
}

async function loadAreas() {
  const r = await api('/api/areas');
  state.areas = r.ok ? await r.json() : [];
  if (state.area && !state.areas.includes(state.area)) state.area = '';
}
async function loadJobs(){try{const r=await api('/api/jobs');state.jobs=r.ok?await r.json():[];if(state.jobId&&!state.jobs.some(j=>String(j.id)===String(state.jobId)))state.jobId='';}catch(e){state.jobs=[];}}
async function loadHoaContext(){if(!isHoaClient())return;try{const [a,b,m,n]=await Promise.all([api('/api/hoa/company'),api('/api/hoa/communities'),api('/api/hoa/members'),api('/api/hoa/notifications')]);state.hoaCompany=a.ok?await a.json():null;state.communities=b.ok?await b.json():[];state.hoaMembers=m.ok?await m.json():[];const notes=n.ok?await n.json():[];state.hoaUnread=notes.filter(x=>!x.read_at).length;if(!state.communityId&&state.communities.length)state.communityId=String(state.communities[0].id);}catch(e){state.communities=[];state.hoaMembers=[];}}

async function addArea() {
  const input = document.getElementById('newarea');
  const name = input.value.trim();
  if (!name) return;
  const r = await api('/api/areas', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (r.ok) { state.areas = await r.json(); state.area = name; toast('Topic added'); renderCapture(); }
  else toast('Could not add topic');
}

async function deleteArea(name) {
  if (!confirm(uiT(`Remove the "${name}" topic? Photos already tagged keep their label.`))) return;
  const r = await api('/api/areas/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (r.ok) { state.areas = await r.json(); if (state.area === name) state.area = ''; renderCapture(); }
  else toast('Could not remove topic');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function userInitials(user) {
  const source = String((user && (user.name || user.email)) || 'User').trim();
  const words = source.split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : source.slice(0, 2)).toUpperCase();
}

function photoSrc(p) { return p ? `${p}?v=${state.imgv}` : ''; }

const US_STATE_ABBR = {
  Alabama:'AL', Alaska:'AK', Arizona:'AZ', Arkansas:'AR', California:'CA', Colorado:'CO', Connecticut:'CT', Delaware:'DE', Florida:'FL', Georgia:'GA', Hawaii:'HI', Idaho:'ID', Illinois:'IL', Indiana:'IN', Iowa:'IA', Kansas:'KS', Kentucky:'KY', Louisiana:'LA', Maine:'ME', Maryland:'MD', Massachusetts:'MA', Michigan:'MI', Minnesota:'MN', Mississippi:'MS', Missouri:'MO', Montana:'MT', Nebraska:'NE', Nevada:'NV', 'New Hampshire':'NH', 'New Jersey':'NJ', 'New Mexico':'NM', 'New York':'NY', 'North Carolina':'NC', 'North Dakota':'ND', Ohio:'OH', Oklahoma:'OK', Oregon:'OR', Pennsylvania:'PA', 'Rhode Island':'RI', 'South Carolina':'SC', 'South Dakota':'SD', Tennessee:'TN', Texas:'TX', Utah:'UT', Vermont:'VT', Virginia:'VA', Washington:'WA', 'West Virginia':'WV', Wisconsin:'WI', Wyoming:'WY', 'District of Columbia':'DC'
};
function shareAddress(address) {
  let value = String(address || '').trim();
  for (const [name, abbr] of Object.entries(US_STATE_ABBR)) value = value.replace(new RegExp(`\\b${name}\\b`, 'g'), abbr);
  return value;
}

function qualityBlock(idres, idfmt) {
  return `
    <details style="margin-top:8px">
      <summary style="cursor:pointer;font-weight:bold;color:#000">Photo quality &amp; format</summary>
      <label style="margin-top:10px">Resolution</label>
      <select id="${idres}">
        <option value="standard" selected>Standard, up to 2048px (recommended)</option>
        <option value="print">Print quality, up to 3000px</option>
        <option value="full">Full resolution, original size</option>
        <option value="web">Web / small files, up to 1400px</option>
      </select>
      <label>File format</label>
      <select id="${idfmt}">
        <option value="jpeg" selected>JPEG, smaller files (recommended)</option>
        <option value="png">PNG, lossless, larger</option>
        <option value="webp">WebP, smallest, modern</option>
        <option value="original">Keep original file, no changes</option>
      </select>
      <p class="status" style="color:#000;margin-top:6px">Your originals stay full-resolution on the server. These only change what gets exported. Standard JPEG is best for uploading to an AI.</p>
    </details>`;
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'block';
  setTimeout(() => { t.style.display = 'none'; }, 2200);
}

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', ...opts });
  return r;
}

async function boot() {
  const r = await api('/api/me');
  if (r.ok) {
    try { const me = await r.json(); state.me = me; state.plan = me.plan || 'free'; state.proType=me.pro_type||'paving'; } catch (e) {}
    await Promise.all([loadAreas(),loadJobs(),loadHoaContext()]);
    restoreOfflineQueue();
    // Start loading documents as soon as the user signs in. By the time they
    // open Create, existing documents can be shown immediately instead of
    // appearing only after another action refreshes the list.
    prefetchGroups();
    renderApp();
    setTimeout(maybeOfferInstall, 700);
  } else renderLogin();
}

function isInstalledApp() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
}

function isPhoneInstallCandidate() {
  return IS_HANDHELD && window.innerWidth <= 700;
}

function dismissInstallOffer(value='dismissed') {
  localStorage.setItem(INSTALL_PROMPT_KEY, value);
  const modal = document.getElementById('installPrompt');
  if (modal) modal.remove();
}

function maybeOfferInstall() {
  if (!state.me || installOfferShown || isInstalledApp() || !isPhoneInstallCandidate()) return;
  if (localStorage.getItem(INSTALL_PROMPT_KEY)) return;
  const ios = isIOS();
  if (!ios && !deferredInstallPrompt) return;
  installOfferShown = true;
  const modal = document.createElement('div');
  modal.id = 'installPrompt';
  modal.className = 'install-prompt';
  modal.innerHTML = `<div class="install-prompt-card" role="dialog" aria-modal="true" aria-labelledby="installPromptTitle">
    <h2 id="installPromptTitle">Add Photo Notes to your phone?</h2>
    <p>${ios ? 'For one-tap access, open your browser’s Share menu, choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.' : 'Install an app icon so you can open Photo Notes directly from your phone’s Home screen.'}</p>
    <div class="install-prompt-actions">
      ${ios ? '<button class="btn" id="installGuideDone" type="button">Got It</button>' : '<button class="btn" id="installAppButton" type="button">Install App Icon</button>'}
      <button class="btn secondary" id="installNotNow" type="button">Not Now</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('installNotNow').onclick = () => dismissInstallOffer();
  if (ios) {
    document.getElementById('installGuideDone').onclick = () => dismissInstallOffer('instructions-seen');
  } else {
    document.getElementById('installAppButton').onclick = async () => {
      if (!deferredInstallPrompt) return dismissInstallOffer();
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice.catch(() => ({ outcome:'dismissed' }));
      dismissInstallOffer(choice.outcome === 'accepted' ? 'installed' : 'dismissed');
    };
  }
}

async function prefetchGroups() {
  try {
    const r = await api('/api/groups');
    if (r.ok) state.groups = await r.json();
  } catch (e) {}
}

function renderLogin() {
  el.innerHTML = `
    <div class="wrap">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px"><img src="/zukor-logo.svg" alt="Zukor AI" style="height:22px;width:auto;display:block" /><div class="language-switch" aria-label="Language"><button type="button" data-language="en">EN</button><span> </span><button type="button" data-language="es">ES</button></div></div>
      <div class="brand" style="margin-top:12px">Photo Notes</div>
      <p class="sub">Photo documentation, by voice</p>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username" inputmode="email" />
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" />
      <button class="btn" id="loginBtn">Sign In</button>
      <p class="status" id="loginErr"></p>
      <div class="footer">&copy; ${new Date().getFullYear()} Zukor AI. All Rights Reserved.</div>
    </div>`;
  document.getElementById('loginBtn').onclick = doLogin;
  document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('pw').focus(); });
}

async function doLogin() {
  const email = document.getElementById('email').value.trim();
  const pw = document.getElementById('pw').value;
  const r = await api('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw }),
  });
  if (r.ok) await boot();
  else document.getElementById('loginErr').textContent = 'Wrong email or password. Try again.';
}

function renderApp() {
  el.innerHTML = `
    <div class="wrap">
      <div class="app-header">
        <img class="zukor-corner-logo" src="/zukor-logo.svg" alt="Zukor AI" />
        <div class="brandrow">
          <div class="brand ${isProClient() ? 'pro-edition-brand' : ''} ${isRoadIssuesClient()?'road-issues-brand':''} ${isPavingClient()?'paving-pro-brand':''} ${isConcreteClient()?'concrete-pro-brand':''} ${isHoaClient()?'hoa-pro-brand':''} ${isRooferClient()?'roofer-pro-brand':''}" aria-label="${esc(isProClient()||isRoadIssuesClient()?productName():'Photo Notes AI')}">${isProClient()||isRoadIssuesClient()?'':'<span class="product-suite-name">Photo Notes</span>'}</div>
        </div>
        ${state.me&&state.me.role==='admin'?`<div class="edition-switcher" aria-label="Switch Photo Notes edition"><button data-edition="basic" class="${!isProClient()&&!isRoadIssuesClient()?'active':''}">PNAI</button><button data-edition="roads" class="${isRoadIssuesClient()?'active':''}">RIR</button><button data-edition="paving" class="${isPavingClient()?'active':''}">PP</button><button data-edition="hoa" class="${isHoaClient()?'active':''}">HMP</button><button data-edition="concrete" class="${isConcreteClient()?'active':''}">CP</button><button data-edition="roofer" class="${isRooferClient()?'active':''}">RP</button></div>`:''}
        <div class="header-controls">
          <div class="language-switch" aria-label="Language"><button type="button" data-language="en">EN</button><span> </span><button type="button" data-language="es">ES</button></div>
          <div class="account-menu-wrap">
            <button class="profile-button" id="profileButton" type="button" aria-label="Account menu" aria-expanded="false">${esc(userInitials(state.me))}</button>
            <div class="profile-menu" id="profileMenu" hidden>
              <div class="profile-name">${esc((state.me && state.me.name) || 'Photo Notes User')}</div>
              <div class="profile-email">${esc((state.me && state.me.email) || '')}</div>
              <div class="profile-plan">${isRoadIssuesClient()?'Road Issue Reporter':isProClient()?esc(productName()):'Basic Plan'}</div>
              ${state.me && state.me.role === 'admin' ? '<a href="/admin">Admin Dashboard</a>' : ''}
              <button type="button" id="signout">Sign Out</button>
            </div>
          </div>
        </div>
      </div>
      ${isRoadIssuesClient()?'':`<div class="tabs workflow-tabs ${isHoaClient()?'hoa-tabs':isConcreteClient()?'concrete-tabs':''}" aria-label="Photo Notes workflow">
        <div class="tab ${['capture','camera-tools','ticket','camera-reader','alignment'].includes(state.view)?'on':''}" id="tabCapture">Capture</div>
        <div class="tab ${['organize','hoa-visits','hoa-visit'].includes(state.view)?'on':''}" id="tabOrganize">Organize</div>
        <div class="tab ${['edit','hoa-assets','hoa-asset'].includes(state.view)?'on':''}" id="tabEdit">${isHoaClient()?'Assets':'Edit'}</div>
        <div class="tab ${['create','hoa-inspections'].includes(state.view)?'on':''}" id="tabCreate">${isHoaClient()?'Inspections':'Create'}</div>
        <div class="tab ${['send','hoa-maintenance'].includes(state.view)?'on':''}" id="tabSend">${isHoaClient()?'Records':'Send'}</div>
      </div>`}
      <div id="body"></div>
      <div class="footer">&copy; ${new Date().getFullYear()} Zukor AI. All Rights Reserved.</div>
    </div>
    ${!isProClient() ? `<button class="issue-fab ${isRoadIssuesClient()?'road-issue-fab':''}" id="issueFab" type="button" data-html2canvas-ignore="true" aria-label="${isRoadIssuesClient()?'Report issue':'Report an issue'}">${issueFabLabel()}</button>
    <div class="issue-modal" id="issueModal" hidden data-html2canvas-ignore="true">
      <div class="issue-dialog" role="dialog" aria-modal="true" aria-labelledby="issueTitle">
        <button class="issue-close" id="issueClose" type="button" aria-label="Close">×</button>
        <h2 id="issueTitle">Report an Issue</h2>
        <p class="status">Tell us what happened, what you expected, and what you were doing when it happened.</p>
        <div class="issue-shot-status" id="issueShotStatus">Capturing this page...</div>
        <label for="issueDescription">What went wrong?</label>
        <button class="btn" id="issueRecord" type="button">Speak Description</button>
        <textarea id="issueDescription" placeholder="Describe the problem in detail..."></textarea>
        <button class="btn" id="issueSend" type="button">Send Issue Report</button>
        <div class="status" id="issueStatus"></div>
      </div>
    </div>` : ''}`;
  const profileButton = document.getElementById('profileButton');
  const profileMenu = document.getElementById('profileMenu');
  profileButton.onclick = (e) => {
    e.stopPropagation();
    profileMenu.hidden = !profileMenu.hidden;
    profileButton.setAttribute('aria-expanded', String(!profileMenu.hidden));
  };
  document.onclick = (e) => {
    if (!e.target.closest('.account-menu-wrap')) {
      profileMenu.hidden = true;
      profileButton.setAttribute('aria-expanded', 'false');
    }
  };
  document.getElementById('signout').onclick = async () => { await api('/api/logout', { method: 'POST' }); state.me = null; renderLogin(); };
  document.querySelectorAll('[data-edition]').forEach(button=>button.onclick=async()=>{if(button.classList.contains('active'))return;document.querySelectorAll('[data-edition]').forEach(b=>b.disabled=true);const r=await api('/api/admin/switch-edition',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({edition:button.dataset.edition})});if(!r.ok){toast('Edition could not be switched');return renderApp();}state.view=button.dataset.edition==='roads'?'road-report':(IS_HANDHELD?'capture':'organize');state.photoFile=null;state._note='';await boot();toast('Edition switched');});
  const issueFab = document.getElementById('issueFab'); if (issueFab) issueFab.onclick = openIssueReporter;
  const tabCapture=document.getElementById('tabCapture');if(tabCapture)tabCapture.onclick = () => { state.view='capture'; renderApp(); };
  const tabOrganize=document.getElementById('tabOrganize');if(tabOrganize)tabOrganize.onclick = () => { state.view=isHoaClient()?'hoa-visits':'organize'; renderApp(); };
  const tabEdit=document.getElementById('tabEdit');if(tabEdit)tabEdit.onclick = () => { state.view=isHoaClient()?'hoa-assets':'edit'; renderApp(); };
  const tabCreate=document.getElementById('tabCreate');if(tabCreate)tabCreate.onclick = () => { state.view=isHoaClient()?'hoa-inspections':'create'; state.groupId=null; renderApp(); };
  const tabSend=document.getElementById('tabSend');if(tabSend)tabSend.onclick = () => { state.view=isHoaClient()?'hoa-maintenance':'send'; renderApp(); };
  if (isRoadIssuesClient()) { state.view='road-report'; renderRoadIssueReport(); }
  else if (state.view === 'capture') renderCapture();
  else if (state.view === 'camera-tools') renderCameraTools();
  else if (state.view === 'ticket') renderTicketScanner();
  else if (state.view === 'camera-reader') renderCameraReader();
  else if (state.view === 'alignment') renderAlignmentTool();
  else if (state.view === 'organize') isHoaClient()?renderHoaVisits():renderList();
  else if (state.view === 'edit') renderEdit();
  else if (state.view === 'create') renderGroups();
  else if (state.view === 'send') renderSend();
  else if (state.view === 'hoa-maintenance') renderHoaMaintenance();
  else if (state.view === 'hoa-visits') renderHoaVisits();
  else if (state.view === 'hoa-visit') renderHoaVisit(state.hoaVisitId);
  else if (state.view === 'hoa-assets') renderHoaAssets();
  else if (state.view === 'hoa-asset') renderHoaAsset(state.hoaAssetId);
  else if (state.view === 'hoa-inspections') renderHoaInspections();
  else if (state.view === 'hoa-communities') renderHoaCommunities();
  else if (state.view === 'hoa-dashboard') renderHoaDashboard();
  else if (state.view === 'hoa-reports') renderHoaReports();
  else if (state.view === 'concrete-report') renderConcreteReport();
  else if (state.view === 'map') renderMap();
  else { state.view = 'organize'; renderList(); }
  renderTensorHelp();
}

// ================= Tensor Man page help (Basic, desktop only) =================
const TENSOR_HELP_TOPICS = {
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
    ['PDF / Word / AI ZIP export', 'Export packages the chosen photos and their context for delivery or further work. Pick PDF for a finished document, Word for editing, or AI ZIP for a structured photo package.'],
    ['Export quality and format', 'Quality and format settings balance image clarity against file size. Use higher quality when small visual details are important to the reader.']
  ],
  send: [
    ['Share selected photos', 'Share sends the photos you selected in Organize through the options available on this device. Check the selection summary before sending.'],
    ['Customer approval package', 'An approval package creates a private, expiring review link for selected photos. The customer can approve the package or request changes.'],
    ['Send or save a document', 'You can send a finished PDF or Word document, or save it for delivery another way. The document keeps the photos and their supporting details together.'],
    ['Mac-to-Android messaging notice', 'Texting from a Mac to an Android phone may require Text Message Forwarding from your iPhone. The notice appears when that setup may affect delivery.']
  ]
};

function renderTensorHelp() {
  if (isProClient() || !TENSOR_HELP_TOPICS[state.view]) return;
  const page = state.view;
  try { if (localStorage.getItem(`pn_tensor_help_hidden_${page}`) === '1') return; } catch (e) {}
  const body = document.getElementById('body');
  if (!body || body.querySelector('.tensor-help-slot')) return;
  const topics = TENSOR_HELP_TOPICS[page];
  body.insertAdjacentHTML('afterbegin', `<div class="tensor-help-slot" data-html2canvas-ignore="true">
    <div class="tensor-help-widget">
      <button class="tensor-help-badge" type="button" aria-label="Help with this page" aria-expanded="false"><img src="/tensor-man-badge.png" srcset="/tensor-man-badge.png 1x, /tensor-man-badge@2x.png 2x" alt="" aria-hidden="true"><span>Tensor Man</span></button>
      <section class="tensor-help-panel" hidden aria-label="Tensor Man page help">
        <h2>Need help with this page?</h2>
        <div class="tensor-topic-list">${topics.map((topic, index)=>`<button type="button" data-tensor-topic="${index}">${esc(topic[0])}</button>`).join('')}</div>
        <div class="tensor-topic-answer" aria-live="polite" hidden></div>
        <button class="tensor-ask-toggle" type="button" aria-expanded="false">Ask Tensor Man something else <span aria-hidden="true">⌄</span></button>
        <form class="tensor-ask-form" hidden><label for="tensorAskInput">Question about Photo Notes</label><div><input id="tensorAskInput" type="text" autocomplete="off"><button type="submit">Send</button></div><p class="tensor-chat-status" aria-live="polite"></p></form>
        <div class="tensor-help-actions"><button type="button" data-tensor-close>Not now</button><button type="button" data-tensor-hide>Hide help on this page</button></div>
      </section>
    </div>
  </div>`);
  const widget = body.querySelector('.tensor-help-widget');
  const badge = widget.querySelector('.tensor-help-badge');
  const badgeArt = badge.querySelector('img');
  const panel = widget.querySelector('.tensor-help-panel');
  const setTensorArt = stateName => { badgeArt.src = `/tensor-man-${stateName}.png`; badgeArt.srcset = `/tensor-man-${stateName}.png 1x, /tensor-man-${stateName}@2x.png 2x`; };
  const closePanel = () => { panel.hidden = true; badge.setAttribute('aria-expanded', 'false'); setTensorArt('badge'); };
  badge.onmouseenter = () => setTensorArt('hover');
  badge.onmouseleave = () => setTensorArt(panel.hidden ? 'badge' : 'open');
  badge.onfocus = () => setTensorArt('hover');
  badge.onblur = () => setTensorArt(panel.hidden ? 'badge' : 'open');
  badge.onclick = () => { const opening = panel.hidden; panel.hidden = !opening; badge.setAttribute('aria-expanded', String(opening)); setTensorArt(opening ? 'open' : 'badge'); };
  widget.querySelectorAll('[data-tensor-topic]').forEach(button => button.onclick = () => {
    const answer = widget.querySelector('.tensor-topic-answer');
    widget.querySelectorAll('[data-tensor-topic]').forEach(item => item.classList.toggle('active', item === button));
    answer.textContent = topics[Number(button.dataset.tensorTopic)][1];
    answer.hidden = false;
  });
  const askToggle = widget.querySelector('.tensor-ask-toggle');
  const askForm = widget.querySelector('.tensor-ask-form');
  askToggle.onclick = () => { const opening = askForm.hidden; askForm.hidden = !opening; askToggle.setAttribute('aria-expanded', String(opening)); if (opening) askForm.querySelector('input').focus(); };
  askForm.onsubmit = event => { event.preventDefault(); askForm.querySelector('.tensor-chat-status').textContent = 'Chat help is coming soon.'; };
  widget.querySelector('[data-tensor-close]').onclick = closePanel;
  widget.querySelector('[data-tensor-hide]').onclick = () => { try { localStorage.setItem(`pn_tensor_help_hidden_${page}`, '1'); } catch (e) {} widget.closest('.tensor-help-slot').remove(); };
}

// ================= Basic issue reporter =================
let issueScreenshotBlob = null, issuePageName = '', issueRecognizer = null;
let issueDictationActive = false, issueDictationBase = '', issueDictationRestartTimer = null, issueDictationWatchdog = null;
const issuePageLabels = { capture:'Capture', organize:'Organize', edit:'Edit', create:'Create', send:'Send', map:'Job Site Map' };
async function openIssueReporter() {
  const fab=document.getElementById('issueFab'); if(fab){fab.disabled=true;fab.textContent='Capturing...';}
  issuePageName=issuePageLabels[state.view]||state.view||'Photo Notes'; issueScreenshotBlob=null;
  const send=document.getElementById('issueSend'),description=document.getElementById('issueDescription'),status=document.getElementById('issueStatus');
  if(send){send.disabled=false;send.textContent='Send Issue Report';}
  if(description)description.value='';
  if(status)status.textContent='';
  try {
    if(window.html2canvas){const canvas=await window.html2canvas(document.querySelector('.wrap'),{useCORS:true,allowTaint:false,backgroundColor:'#ffffff',scale:Math.min(window.devicePixelRatio||1,1.5),logging:false});issueScreenshotBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.78));}
  } catch(e){issueScreenshotBlob=null;}
  const modal=document.getElementById('issueModal'); if(!modal)return; modal.hidden=false;
  document.getElementById('issueShotStatus').textContent=issueScreenshotBlob?'✓ Screenshot of this page attached':'Screenshot unavailable; your description will still be saved';
  document.getElementById('issueClose').onclick=closeIssueReporter;
  document.getElementById('issueRecord').onclick=toggleIssueDictation;
  document.getElementById('issueSend').onclick=submitIssueReport;
  description.focus();
  if(fab){fab.disabled=false;fab.textContent=issueFabLabel();}
}
function closeIssueReporter(){issueDictationActive=false;if(issueDictationRestartTimer)clearTimeout(issueDictationRestartTimer);if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationRestartTimer=null;issueDictationWatchdog=null;if(issueRecognizer){try{issueRecognizer.stop();}catch(e){}}const m=document.getElementById('issueModal');if(m)m.hidden=true;issueScreenshotBlob=null;issueRecognizer=null;}
async function toggleIssueDictation(){
  const ta=document.getElementById('issueDescription'),btn=document.getElementById('issueRecord'),SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){ta.focus();toast('Use the microphone key on your keyboard to dictate');return;}
  if(issueDictationActive){issueDictationActive=false;if(issueDictationRestartTimer)clearTimeout(issueDictationRestartTimer);if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationRestartTimer=null;issueDictationWatchdog=null;if(issueRecognizer){try{issueRecognizer.stop();}catch(e){}}btn.textContent='Speak Description';btn.classList.remove('on');return;}
  // Safari owns the microphone permission prompt for webkitSpeechRecognition.
  // Opening getUserMedia immediately beforehand can leave iOS showing an active
  // microphone while returning no recognition results.
  if(!isIOS())try{if(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia){const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());}}catch(e){toast('Allow microphone access for this website, then try again');return;}
  issueDictationActive=true;issueDictationBase=ta.value.trim();if(issueDictationBase)issueDictationBase+=' ';btn.textContent='Recording... tap to stop';btn.classList.add('on');startIssueDictationSession(SR);
}
function startIssueDictationSession(SR){
  if(!issueDictationActive)return;
  const ta=document.getElementById('issueDescription'),session=new SR(),ios=isIOS();issueRecognizer=session;session.lang=uiSpeechLanguage();session.continuous=!ios;session.interimResults=!ios;let sessionText='';
  if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationWatchdog=setTimeout(()=>{if(issueRecognizer!==session||sessionText)return;issueDictationActive=false;try{session.stop();}catch(e){}const b=document.getElementById('issueRecord'),s=document.getElementById('issueStatus');if(b){b.textContent='Speak Description';b.classList.remove('on');}if(s)s.textContent='No speech was received. On iPhone, tap the text box and use the microphone on the keyboard, or try again.';},10000);
  session.onresult=e=>{if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationWatchdog=null;const parts=[];for(let i=0;i<e.results.length;i++)parts.push(e.results[i][0].transcript.trim());sessionText=parts.filter(Boolean).join(' ').trim();if(ta)ta.value=(issueDictationBase+sessionText).trimStart();};
  session.onerror=e=>{const err=e&&e.error;if(err==='not-allowed'||err==='service-not-allowed'){toast('Allow microphone access for this website, then try again');issueDictationActive=false;}else if(err==='audio-capture'||err==='network'){toast('Recording stopped. You can continue by typing or try again');issueDictationActive=false;}else if(err!=='aborted'&&err!=='no-speech'){toast('Recording stopped. You can continue by typing or try again');issueDictationActive=false;}};
  session.onend=()=>{if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationWatchdog=null;if(issueRecognizer===session)issueRecognizer=null;if(sessionText){issueDictationBase=(issueDictationBase+sessionText).trim();if(issueDictationBase)issueDictationBase+=' ';}if(issueDictationActive&&!ios){const b=document.getElementById('issueRecord');if(b)b.textContent='Listening... tap to stop';issueDictationRestartTimer=setTimeout(()=>startIssueDictationSession(SR),300);}else{issueDictationActive=false;const b=document.getElementById('issueRecord');if(b){b.textContent='Speak Description';b.classList.remove('on');}if(ios&&sessionText){const s=document.getElementById('issueStatus');if(s)s.textContent='Description added. Tap Speak Description to continue.';}}};
  try{session.start();}catch(e){issueDictationActive=false;issueRecognizer=null;const b=document.getElementById('issueRecord');if(b){b.textContent='Speak Description';b.classList.remove('on');}}
}
async function submitIssueReport(){
  issueDictationActive=false;if(issueDictationRestartTimer)clearTimeout(issueDictationRestartTimer);if(issueDictationWatchdog)clearTimeout(issueDictationWatchdog);issueDictationRestartTimer=null;issueDictationWatchdog=null;
  if(issueRecognizer){try{issueRecognizer.stop();}catch(e){}}
  const ta=document.getElementById('issueDescription'),description=ta.value.trim(),btn=document.getElementById('issueSend'),st=document.getElementById('issueStatus');
  if(!description){st.textContent='Please describe the problem before sending.';ta.focus();return;}
  btn.disabled=true;btn.textContent='Sending...';st.textContent='Saving your report...';
  try{const fd=new FormData();fd.append('description',description);fd.append('page_name',issuePageName);fd.append('page_url',location.href);fd.append('viewport',`${window.innerWidth} × ${window.innerHeight}`);fd.append('user_agent',navigator.userAgent);if(issueScreenshotBlob)fd.append('screenshot',issueScreenshotBlob,'issue-screen.jpg');const r=await api('/api/issues',{method:'POST',body:fd});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error();st.textContent=d.email_status==='sent'?`Issue #${d.id} sent. Thank you.`:`Issue #${d.id} saved. Thank you.`;btn.textContent='Sent';setTimeout(closeIssueReporter,1800);}catch(e){st.textContent='The report could not be sent. Check your connection and try again.';btn.disabled=false;btn.textContent='Send Issue Report';}
}

function areaChips() {
  const none=`<div class="pill ${state.area?'':'on'}" data-area="">No Topic</div>`;
  if (!state.areas.length) return none+'<p class="status">No topics yet. Add one below.</p>';
  return none+state.areas.map(a =>
    `<div class="pill ${state.area===a?'on':''}" data-area="${esc(a)}">${esc(a)} <span class="areax" data-del="${esc(a)}">&times;</span></div>`
  ).join('');
}
const HOA_AREAS=['Streets and Pavement','Sidewalks and Curbs','Drainage','Walls and Fencing','Gates and Access Control','Landscaping and Irrigation','Lighting and Electrical','Signs and Pavement Markings','Pools and Recreation','Clubhouse and Buildings','Mailboxes','Security','Trees','Utilities','General Appearance','Other'];

const ROAD_ISSUE_TYPES = ['Crack','Pothole','Curb','Water Pooling','Road Marking','Sign','Other Road Surface Issue'];
function renderRoadIssueReport() {
  const body=document.getElementById('body');
  body.className='workflow-road-report';
  body.innerHTML=`
    <label for="roadIssueType">Road Issue Type</label>
    <select id="roadIssueType">${ROAD_ISSUE_TYPES.map(type=>`<option value="${esc(type)}">${esc(type)}</option>`).join('')}</select>
    <label>Road Issue Photo</label>
    <button type="button" class="btn" id="takephoto">Take Photo</button>
    <input type="file" accept="image/*" capture="environment" id="photoCam" style="display:none">
    <div class="photo-box capture-preview" id="previewBox" style="display:none;margin-top:12px"><img id="preview" alt="Road issue photo preview" style="display:block"><div class="capture-preview-actions"><button type="button" class="btn secondary" id="retakePhoto">Retake Photo</button><button type="button" class="btn secondary" id="cancelPhoto">Cancel Photo</button></div></div>
    <div class="status" id="qualityStatus"></div>
    <div id="locwrap" style="display:none"><label>GPS Coordinates</label><div class="status" id="gps"></div><label>Address or Geographic Area</label><div class="status" id="addr"></div><button type="button" class="btn secondary slim" id="retryLocation">Retry location</button></div>
    <button type="button" class="btn road-send" id="roadIssueSend">Send</button>
    <div class="status" id="roadIssueStatus" aria-live="polite"></div>`;
  document.getElementById('takephoto').onclick=()=>{const input=document.getElementById('photoCam');input.value='';input.click();};
  document.getElementById('photoCam').onchange=e=>{if(e.target.files&&e.target.files[0])onPhotoChosen(e.target.files[0]);};
  document.getElementById('retakePhoto').onclick=retakeCapturePhoto;
  document.getElementById('cancelPhoto').onclick=cancelCapturePhoto;
  document.getElementById('retryLocation').onclick=()=>acquireLocation(true);
  document.getElementById('roadIssueSend').onclick=sendRoadIssueReport;
  if(state.photoFile){showCapturePreview(state.photoFile);document.getElementById('locwrap').style.display='block';if(state.location){document.getElementById('gps').textContent=`${state.location.lat.toFixed(5)}, ${state.location.lng.toFixed(5)}`;document.getElementById('addr').textContent=state.address||'Exact address not found';}else acquireLocation();}
}
async function sendRoadIssueReport(){
  const btn=document.getElementById('roadIssueSend'),status=document.getElementById('roadIssueStatus');
  if(!state.photoFile){toast('Take a road issue photo first');return;}
  if(!(await confirmPhotoQuality())){toast('Photo kept for retaking');return;}
  btn.disabled=true;btn.textContent='Sending...';status.textContent='Saving the report and sending the photo.';
  try{
    if(state._locationPromise)await state._locationPromise;
    const fd=new FormData();fd.append('issue_type',document.getElementById('roadIssueType').value);fd.append('photo',state.photoFile);
    if(state.location){fd.append('latitude',state.location.lat);fd.append('longitude',state.location.lng);}if(state.address)fd.append('address',state.address);
    const r=await api('/api/road-issues',{method:'POST',body:fd}),d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'send failed');
    captureLocationGeneration++;if(state._previewUrl)URL.revokeObjectURL(state._previewUrl);state._previewUrl=null;state.photoFile=null;state.location=null;state.address=null;state._locationPromise=null;state._qualityPromise=null;state._qualityResult=null;
    renderRoadIssueReport();const next=document.getElementById('roadIssueStatus');if(next)next.textContent=d.email_status==='sent'?`Road issue #${d.id} sent.`:`Road issue #${d.id} saved. Email delivery is pending.`;toast('Road issue sent');
  }catch(e){status.textContent='The road issue could not be sent. Check your connection and try again.';btn.disabled=false;btn.textContent='Send';}
}

function renderCapture() {
  const body = document.getElementById('body');
  body.innerHTML = `
    ${isHoaClient()?`<label>HOA / Community</label><select id="hoaCommunity"><option value="">Select Community</option>${state.communities.map(c=>`<option value="${c.id}" ${String(state.communityId)===String(c.id)?'selected':''}>${esc(c.name)}</option>`).join('')}</select>${!state.communities.length?'<p class="status">Create your first community under Assets before saving a maintenance record.</p>':''}<label>Issue Title</label><input id="hoaTitle" placeholder="Briefly identify the maintenance issue"><div class="row compact"><div style="flex:1"><label>Record Type</label><select id="hoaType"><option value="maintenance">Maintenance Issue</option><option value="information">Information Request</option><option value="inspection">Inspection Finding</option></select></div><div style="flex:1"><label>Priority</label><select id="hoaPriority"><option value="routine">Routine</option><option value="high">High</option><option value="emergency">Emergency</option><option value="monitor">Monitor</option></select></div></div>`:''}
    ${isConcreteClient()?`<div class="workflow-intro"><strong>Concrete Photo Evidence</strong><span>Identify what this photo proves. Add only the field context visible in or directly supported by the photo.</span></div><div class="organize-form-grid"><section class="organize-panel"><label>Concrete Element</label><select id="concreteElement"><option value="slab">Slab</option><option value="sidewalk">Sidewalk</option><option value="curb">Curb</option><option value="driveway">Driveway</option><option value="foundation">Foundation</option><option value="wall">Wall</option><option value="column">Column</option><option value="beam">Beam</option><option value="steps">Steps</option><option value="deck">Deck</option><option value="other">Other</option></select><label>Photo Stage</label><select id="concreteStage"><option value="existing_condition">Existing Condition</option><option value="pre_pour">Pre-Pour</option><option value="formwork">Formwork</option><option value="reinforcement">Reinforcement</option><option value="placement">Placement</option><option value="finishing">Finishing</option><option value="curing">Curing</option><option value="completed">Completed</option><option value="defect">Defect</option><option value="repair">Repair</option><option value="verification">Verification</option></select></section><section class="organize-panel"><label>Condition</label><select id="concreteCondition"><option value="not_assessed">Not Assessed</option><option value="acceptable">Acceptable</option><option value="monitor">Monitor</option><option value="repair_needed">Repair Needed</option><option value="unsafe">Unsafe</option></select><label>Observed Severity</label><select id="concreteSeverity"><option value="none">None</option><option value="minor">Minor</option><option value="moderate">Moderate</option><option value="severe">Severe</option><option value="critical">Critical</option></select></section></div><label>Exact Photo Location</label><input id="concreteLocation" placeholder="Grid line, elevation, room, station, or nearby landmark"><label>Mix / Specification Visible or Confirmed</label><input id="concreteMix" placeholder="Optional mix ID or specification tied to this photo">`:''}
    <label>Photo Note</label>
    <button type="button" class="btn" id="takephoto">Take Photo</button>
    <button type="button" class="btn secondary" id="choosephoto" style="margin-top:8px">Choose from library or files</button>
    ${isProClient() && ['ticket_scanner','camera_readers','before_after'].some(featureOn) ? `<button type="button" class="btn secondary" id="openCameraTools" style="margin-top:8px">Other Camera Tools</button>` : ''}
    <input type="file" accept="image/*" capture="environment" id="photoCam" style="display:none" />
    <input type="file" accept="image/*" id="photoLib" style="display:none" />
    <div class="photo-box capture-preview" id="previewBox" style="display:none;margin-top:12px"><img id="preview" alt="Selected photo preview" style="display:block" /><div class="capture-preview-actions"><button type="button" class="btn secondary" id="retakePhoto">Retake Photo</button><button type="button" class="btn secondary" id="cancelPhoto">Cancel Photo</button></div></div>
    <div class="status" id="qualityStatus"></div>

    <div id="locwrap" style="display:none">
      <label>GPS Coordinates</label>
      <div class="status" id="gps"></div>
      <label>Address</label>
      <div class="status" id="addr"></div>
      <button type="button" class="btn secondary slim" id="retryLocation">Retry location and address</button>
    </div>

    <label>Note</label>
    <button type="button" class="btn" id="dictate" style="margin-bottom:8px">Record Note</button>
    <div class="status" id="dictationStatus" aria-live="polite"></div>
    <textarea id="note" placeholder="Type what you're looking at, or tap Record Note"></textarea>

    ${isHoaClient()?`<label>Maintenance Category</label><select id="hoaArea">${HOA_AREAS.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select><div id="hoaDirectedWrap" style="display:none"><label>Directed To</label><input id="hoaDirected" placeholder="Person expected to answer"></div>`:`<label>Select Topic</label>
    <div class="pill-group" id="areas">${areaChips()}</div>
    <div class="row compact" style="margin-top:10px">
      <input type="text" id="newarea" placeholder="Add a topic..." />
      <button class="btn secondary" id="addarea">Add</button>
    </div>`}

    <button class="btn" id="save">Save</button>
  `;

  const cameraToolsButton = document.getElementById('openCameraTools');
  if (cameraToolsButton) cameraToolsButton.onclick = () => { state.view = 'camera-tools'; renderApp(); };

  document.getElementById('takephoto').onclick = () => { stopCaptureDictation(); const input=document.getElementById('photoCam');input.value='';input.click(); };
  document.getElementById('choosephoto').onclick = () => { stopCaptureDictation(); const input=document.getElementById('photoLib');input.value='';input.click(); };
  document.getElementById('photoCam').onchange = (e) => { if (e.target.files[0]) onPhotoChosen(e.target.files[0]); };
  document.getElementById('photoLib').onchange = (e) => { if (e.target.files[0]) onPhotoChosen(e.target.files[0]); };
  document.getElementById('retakePhoto').onclick = retakeCapturePhoto;
  document.getElementById('cancelPhoto').onclick = cancelCapturePhoto;
  document.getElementById('save').onclick = saveCapture;
  document.getElementById('retryLocation').onclick = () => acquireLocation(true);
  if(isHoaClient()){document.getElementById('hoaCommunity').onchange=e=>state.communityId=e.target.value;document.getElementById('hoaType').onchange=e=>document.getElementById('hoaDirectedWrap').style.display=e.target.value==='information'?'block':'none';}else{
  document.getElementById('addarea').onclick = addArea;
  document.getElementById('newarea').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } });
  document.getElementById('areas').onclick = (e) => {
    const del = e.target.getAttribute('data-del');
    if (del != null) { deleteArea(del); return; }
    const pill = e.target.closest('[data-area]');
    if (pill) { state.area = pill.getAttribute('data-area'); renderCapture(); }
  };}

  const dictateBtn = document.getElementById('dictate');
  if (dictateBtn) dictateBtn.onclick = toggleDictation;

  // preserve any typed note across re-renders
  if (state._note) document.getElementById('note').value = state._note;
  document.getElementById('note').addEventListener('input', e => state._note = e.target.value);

  // if a photo is already chosen (e.g. re-render after picking an area), keep it and its location visible
  if (state.photoFile) {
    const box = document.getElementById('previewBox');
    showCapturePreview(state.photoFile);
    box.style.display = 'block';
    document.getElementById('locwrap').style.display = 'block';
    if (state.location) {
      document.getElementById('gps').textContent = state.location.lat.toFixed(5) + ', ' + state.location.lng.toFixed(5);
      document.getElementById('addr').textContent = state.address || 'Address not found';
    } else {
      acquireLocation();
    }
  }
}

// ================= Paving Pro camera tools =================
function cameraToolCard(title, description, action, id) {
  return `<article class="camera-tool-card"><div><strong>${title}</strong><span>${description}</span></div><button class="btn secondary slim" id="${id}">${action}</button></article>`;
}
function renderCameraTools() {
  const body = document.getElementById('body');
  body.className = 'workflow-camera-tools';
  body.innerHTML = `
    <button class="backlink" id="toolsBack">‹ Back to Capture</button>
    <div class="workflow-intro"><strong>Camera Tools</strong><span>Choose what the camera needs to do. Source photos are retained for verification.</span></div>
    <section class="camera-tool-group">
      <div class="camera-tool-heading"><strong>Document Scanners</strong><span>Turn photographed documents into searchable, reviewable information.</span></div>
      <div class="camera-tool-grid">
        ${featureOn('ticket_scanner') ? cameraToolCard('Paving Delivery Ticket Scanner','Read asphalt and paving delivery-ticket details and calculate saved daily tonnage.','Scan Ticket','toolTicket') : ''}
        ${featureOn('camera_readers') ? cameraToolCard('Plan or Sketch Scanner','Read visible project, sheet, revision, scale, dimension, and field-note information without estimating missing details.','Scan Plan or Sketch','toolPlan') : ''}
        ${featureOn('camera_readers') ? cameraToolCard('Business Card Scanner','Read contact and company details from a photographed business card.','Scan Business Card','toolCard') : ''}
      </div>
    </section>
    <section class="camera-tool-group">
      <div class="camera-tool-heading"><strong>Equipment &amp; Material Scanners</strong><span>Record identifying information from equipment plates and construction-product labels.</span></div>
      <div class="camera-tool-grid">
        ${featureOn('camera_readers') ? cameraToolCard('Equipment Plate Scanner','Read manufacturer, model, serial number, year, and equipment specifications.','Scan Plate','toolEquipment') : ''}
        ${featureOn('camera_readers') ? cameraToolCard('Material Label Scanner','Read product, manufacturer, lot, quantity, dates, instructions, and visible warnings.','Scan Label','toolMaterial') : ''}
      </div>
    </section>
    <section class="camera-tool-group">
      <div class="camera-tool-heading"><strong>Instrument Readers</strong><span>Capture the displayed value while retaining a photograph of the instrument.</span></div>
      <div class="camera-tool-grid">
        ${featureOn('camera_readers') ? cameraToolCard('Gauge & Instrument Reader','Read gauges, scales, hour meters, thermometers, fuel displays, and other instruments.','Read Instrument','toolGauge') : ''}
      </div>
    </section>
    <section class="camera-tool-group">
      <div class="camera-tool-heading"><strong>Comparison Tools</strong><span>Create consistent visual records of work before and after completion.</span></div>
      <div class="camera-tool-grid">
        ${beforeAfterOn() ? cameraToolCard('Before & After Alignment','Use an earlier photo as a framing reference, compare the alignment, and save the pair.','Match Photos','toolAlignment') : ''}
      </div>
    </section>`;
  document.getElementById('toolsBack').onclick = () => { state.view='capture'; renderApp(); };
  const wire=(id,fn)=>{const b=document.getElementById(id);if(b)b.onclick=fn;};
  wire('toolTicket',() => { state.view='ticket'; renderApp(); });
  wire('toolEquipment',() => { cameraReaderType='equipment_plate'; state.view='camera-reader'; renderApp(); });
  wire('toolGauge',() => { cameraReaderType='gauge'; state.view='camera-reader'; renderApp(); });
  wire('toolPlan',() => { cameraReaderType='plan_sketch'; state.view='camera-reader'; renderApp(); });
  wire('toolMaterial',() => { cameraReaderType='material_label'; state.view='camera-reader'; renderApp(); });
  wire('toolCard',() => { cameraReaderType='business_card'; state.view='camera-reader'; renderApp(); });
  wire('toolAlignment',() => { state.view='alignment'; renderApp(); });
}

let cameraReaderType = 'equipment_plate', cameraReaderFile = null, cameraReaderDraft = null;
const readerConfigs = {
  equipment_plate: { title:'Equipment Plate Scanner', noun:'plate', captureLabel:'Plate', readLabel:'Read Plate', fields:[['manufacturer','Manufacturer'],['model','Model'],['serial_number','Serial Number'],['year','Year'],['equipment_type','Equipment Type'],['specifications','Other Specifications']] },
  gauge: { title:'Gauge & Instrument Reader', noun:'instrument', captureLabel:'Instrument', readLabel:'Read Instrument', fields:[['instrument_type','Instrument Type'],['reading','Displayed Reading'],['unit','Unit'],['equipment_name','Equipment Name or Number'],['observed_at','Displayed Date or Time'],['notes','Reading Notes']] },
  plan_sketch: { title:'Plan or Sketch Scanner', noun:'plan or sketch', captureLabel:'Plan or Sketch', readLabel:'Read Plan or Sketch', fields:[['project_name','Project Name'],['site_address','Site Address'],['sheet_title','Sheet Title'],['sheet_number','Sheet Number'],['revision_date','Revision Date'],['scale','Printed Scale'],['visible_dimensions','Visible Dimensions','textarea'],['visible_notes','Visible Notes','textarea']] },
  material_label: { title:'Material Label Scanner', noun:'material label', captureLabel:'Material Label', readLabel:'Read Label', fields:[['product_name','Product Name'],['manufacturer','Manufacturer'],['product_code','Product Code'],['lot_number','Lot Number'],['quantity','Quantity'],['manufactured_date','Manufactured Date'],['expiration_date','Expiration Date'],['instructions','Visible Instructions','textarea'],['warnings','Visible Warnings','textarea']] },
  business_card: { title:'Business Card Scanner', noun:'business card', captureLabel:'Business Card', readLabel:'Read Business Card', fields:[['name','Name'],['job_title','Job Title'],['company','Company'],['phone','Phone'],['email','Email'],['address','Address'],['website','Website']] },
};
function renderCameraReader() {
  const cfg = readerConfigs[cameraReaderType]; const body = document.getElementById('body');
  body.className = 'workflow-camera-tools'; cameraReaderFile = null; cameraReaderDraft = null;
  body.innerHTML = `
    <button class="backlink" id="readerBack">‹ Back to Camera Tools</button>
    <div class="workflow-intro"><strong>${cfg.title}</strong><span>Fill the frame with the ${cfg.noun}, keep the text or display sharp, and avoid glare. Review the reading before saving.</span></div>
    <section class="ticket-scan-panel"><div class="formhead">1. Photograph the ${cfg.captureLabel}</div>
      <div class="row"><button class="btn" id="readerTake">Take Photo</button><button class="btn secondary" id="readerChoose">Choose Existing Photo</button></div>
      <input type="file" accept="image/*" capture="environment" id="readerCam" style="display:none"><input type="file" accept="image/*" id="readerLib" style="display:none">
      <div class="photo-box" id="readerPreviewBox" style="display:none;margin-top:12px"><img id="readerPreview" alt="Source photo"></div>
      <button class="btn" id="readerRead" style="margin-top:12px" disabled>${cfg.readLabel}</button><div class="status" id="readerStatus"></div>
    </section><div id="readerReview"></div><div class="formhead" style="margin-top:28px">Saved ${cfg.title.replace('Scanner','Records').replace('Reader','Readings')}</div><div id="readerSaved"><p class="status">Loading...</p></div>`;
  document.getElementById('readerBack').onclick = () => { state.view='camera-tools'; renderApp(); };
  document.getElementById('readerTake').onclick = () => document.getElementById('readerCam').click();
  document.getElementById('readerChoose').onclick = () => document.getElementById('readerLib').click();
  const pick = e => { const f=e.target.files&&e.target.files[0]; if(!f)return; cameraReaderFile=f; document.getElementById('readerPreview').src=URL.createObjectURL(f); document.getElementById('readerPreviewBox').style.display='block'; document.getElementById('readerRead').disabled=false; document.getElementById('readerReview').innerHTML=''; document.getElementById('readerStatus').textContent='Ready to read.'; e.target.value=''; };
  document.getElementById('readerCam').onchange=pick; document.getElementById('readerLib').onchange=pick; document.getElementById('readerRead').onclick=scanCameraReader;
  loadCameraReadings();
}
async function scanCameraReader() {
  if(!cameraReaderFile)return; const cfg=readerConfigs[cameraReaderType], btn=document.getElementById('readerRead'), st=document.getElementById('readerStatus');
  btn.disabled=true; btn.textContent='Reading...'; st.textContent='Reading only the information visible in the photo.';
  try { const fd=new FormData(); fd.append('reading_type',cameraReaderType); fd.append('photo',cameraReaderFile); const r=await api('/api/camera-readings/scan',{method:'POST',body:fd}); const d=await r.json().catch(()=>({})); if(!r.ok||!d.reading)throw new Error(); cameraReaderDraft=d.reading; renderCameraReaderReview(); st.textContent=d.ai_read?'Reading complete. Correct anything needed, then save.':'Automatic reading was unsuccessful. Enter the visible information, then save.'; }
  catch(e){ st.textContent=`The ${cfg.noun} could not be read. Retake the photo closer, in even light, and avoid glare.`; btn.disabled=false; btn.textContent='Try Again'; }
}
function renderCameraReaderReview() {
  const cfg=readerConfigs[cameraReaderType], f=cameraReaderDraft.fields||{}, box=document.getElementById('readerReview');
  box.innerHTML=`<section class="ticket-review-panel"><div class="formhead">2. Review and Save</div><div class="status">AI confidence: <strong>${esc(cameraReaderDraft.confidence||'low')}</strong>. The photograph is the source of truth.</div><div class="ticket-form-grid">${cfg.fields.map(([key,label,kind])=>`<div>${kind==='textarea'?`<label for="cr_${key}">${label}</label><textarea id="cr_${key}">${esc(f[key]||'')}</textarea>`:ticketField('cr_'+key,label,f[key])}</div>`).join('')}</div><label for="cr_title">Record Name</label><input id="cr_title" value="${esc(cameraReaderDraft.title||'')}"><button class="btn" id="readerSave">Save Record</button></section>`;
  document.getElementById('readerSave').onclick=saveCameraReading;
}
async function saveCameraReading() {
  const cfg=readerConfigs[cameraReaderType], fields={}; cfg.fields.forEach(([key])=>fields[key]=document.getElementById('cr_'+key).value.trim()); const btn=document.getElementById('readerSave'); btn.disabled=true; btn.textContent='Saving...';
  const r=await api(`/api/camera-readings/${cameraReaderDraft.id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:document.getElementById('cr_title').value.trim(),fields})});
  if(r.ok){toast('Record saved');renderCameraReader();}else{toast('Record could not be saved');btn.disabled=false;btn.textContent='Save Record';}
}
async function loadCameraReadings() {
  const box=document.getElementById('readerSaved'); if(!box)return; try{const r=await api(`/api/camera-readings?type=${cameraReaderType}`);if(!r.ok)throw new Error();const rows=await r.json();box.innerHTML=rows.length?`<div class="camera-reading-list">${rows.map(x=>`<article class="card camera-reading-card">${x.photo_path?`<img src="${photoSrc(x.photo_path)}" alt="Source">`:''}<div><strong>${esc(x.title||'Untitled record')}</strong>${Object.entries(x.fields||{}).filter(([,v])=>v).slice(0,4).map(([k,v])=>`<div class="meta"><span>${esc(k.replaceAll('_',' '))}:</span> ${esc(v)}</div>`).join('')}</div></article>`).join('')}</div>`:'<p class="empty">No saved records yet.</p>'; }catch(e){box.innerHTML='<p class="status">Saved records could not be loaded.</p>';}
}

let alignmentBefore=null, alignmentAfterFile=null, alignmentCaptures=[], alignmentPairedIds=new Set();
async function renderAlignmentTool() {
  const body=document.getElementById('body'); body.className='workflow-camera-tools'; alignmentBefore=null; alignmentAfterFile=null;
  body.innerHTML=`<button class="backlink" id="alignBack">‹ Back to Camera Tools</button><div class="workflow-intro"><strong>Before &amp; After Alignment</strong><span>Select the original photo, use it as your framing reference, then compare the new photo before saving the pair.</span></div><section class="alignment-step"><div class="formhead">1. Choose the Before Photo</div><div id="alignBeforeList"><p class="status">Loading your photos...</p></div></section><section class="alignment-step" id="alignTakeStep" hidden><div class="formhead">2. Match the Framing</div><p class="status">Stand in the same location. Match the camera height, direction, horizon, and visible landmarks shown below.</p><img class="alignment-reference" id="alignReference" alt="Before-photo framing reference"><button class="btn" id="alignTake">Take After Photo</button><button class="btn secondary" id="alignChoose">Choose Existing Photo</button><input type="file" accept="image/*" capture="environment" id="alignCam" style="display:none"><input type="file" accept="image/*" id="alignLib" style="display:none"></section><section class="alignment-step" id="alignCompareStep" hidden><div class="formhead">3. Check the Alignment</div><div class="alignment-overlay"><img id="alignBeforeImage" alt="Before"><img id="alignAfterImage" alt="After"></div><label for="alignOpacity">Comparison Overlay</label><input id="alignOpacity" class="blue-range" type="range" min="0" max="100" value="50"><p class="status">Move the slider. Fixed objects should remain in the same position. Retake the after photo if they shift substantially.</p><label for="alignNote">After Photo Note</label><textarea id="alignNote" placeholder="Describe the completed work..."></textarea><div class="row"><button class="btn secondary" id="alignRetake">Retake</button><button class="btn" id="alignSave">Save Matched Pair</button></div></section>`;
  document.getElementById('alignBack').onclick=()=>{state.view='camera-tools';renderApp();};
  try{const [r,p]=await Promise.all([api('/api/captures'),api('/api/pairs')]);alignmentCaptures=r.ok?await r.json():[];const pairs=p.ok?await p.json():[];alignmentPairedIds=new Set();pairs.forEach(x=>{alignmentPairedIds.add(Number(x.before_id));alignmentPairedIds.add(Number(x.after_id));});renderAlignmentChoices();}catch(e){document.getElementById('alignBeforeList').innerHTML='<p class="status">Photos could not be loaded.</p>';}
}
function renderAlignmentChoices(){const box=document.getElementById('alignBeforeList');const photos=alignmentCaptures.filter(c=>c.photo_path&&!alignmentPairedIds.has(Number(c.id))).slice(0,30);box.innerHTML=photos.length?`<div class="alignment-choice-grid">${photos.map(c=>`<button class="alignment-choice" data-id="${c.id}"><span class="photo-title">${esc(c.photo_title||'Untitled photo')}</span><img src="${photoSrc(c.photo_path)}" alt=""><span><strong>GPS</strong><br>${esc(formatGpsClient(c))}<br><strong>Address</strong><br>${esc(c.address||'No address')}</span></button>`).join('')}</div>`:'<p class="empty">There are no unpaired project photos available. Save a new project photo first, then return here.</p>';box.querySelectorAll('.alignment-choice').forEach(b=>b.onclick=()=>chooseAlignmentBefore(Number(b.dataset.id)));}
function chooseAlignmentBefore(id){alignmentBefore=alignmentCaptures.find(c=>c.id===id);document.querySelectorAll('.alignment-choice').forEach(b=>b.classList.toggle('selected',Number(b.dataset.id)===id));document.getElementById('alignReference').src=photoSrc(alignmentBefore.photo_path);document.getElementById('alignTakeStep').hidden=false;document.getElementById('alignTake').onclick=()=>document.getElementById('alignCam').click();document.getElementById('alignChoose').onclick=()=>document.getElementById('alignLib').click();const pick=e=>{const f=e.target.files&&e.target.files[0];if(!f)return;alignmentAfterFile=f;showAlignmentComparison();e.target.value='';};document.getElementById('alignCam').onchange=pick;document.getElementById('alignLib').onchange=pick;document.getElementById('alignTakeStep').scrollIntoView({behavior:'smooth'});}
function showAlignmentComparison(){document.getElementById('alignBeforeImage').src=photoSrc(alignmentBefore.photo_path);document.getElementById('alignAfterImage').src=URL.createObjectURL(alignmentAfterFile);document.getElementById('alignCompareStep').hidden=false;const range=document.getElementById('alignOpacity'),after=document.getElementById('alignAfterImage');range.oninput=()=>after.style.opacity=String(Number(range.value)/100);after.style.opacity='.5';document.getElementById('alignRetake').onclick=()=>document.getElementById('alignCam').click();document.getElementById('alignSave').onclick=saveAlignedPair;document.getElementById('alignCompareStep').scrollIntoView({behavior:'smooth'});}
async function saveAlignedPair(){if(!alignmentBefore||!alignmentAfterFile)return;const btn=document.getElementById('alignSave');btn.disabled=true;btn.textContent='Saving...';try{const fd=new FormData();fd.append('photo',alignmentAfterFile);fd.append('note',document.getElementById('alignNote').value.trim());fd.append('kind','note');fd.append('area_tags',JSON.stringify(alignmentBefore.area_tags||[]));const loc=await getLocationOnce();if(loc){fd.append('latitude',loc.lat);fd.append('longitude',loc.lng);}const cr=await api('/api/captures',{method:'POST',body:fd});if(!cr.ok)throw new Error();const after=await cr.json();const pr=await api('/api/pairs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({before_id:alignmentBefore.id,after_id:after.id})});if(!pr.ok)throw new Error();toast('Before and after pair saved');state.view='organize';renderApp();}catch(e){toast('Matched pair could not be saved');btn.disabled=false;btn.textContent='Save Matched Pair';}}

// ================= Paving Pro ticket scanner =================
let ticketPhotoFile = null, ticketDraft = null;
function localDateValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function renderTicketScanner() {
  const body = document.getElementById('body');
  body.className = 'workflow-ticket';
  body.innerHTML = `
    <button class="backlink" id="ticketBack">‹ Back to Camera Tools</button>
    <div class="workflow-intro"><strong>Paving Delivery Ticket Scanner</strong><span>Take a clear, straight-on photo of the entire asphalt or paving-material delivery ticket. Review every field before saving.</span></div>
    <div class="ticket-scan-panel">
      <div class="formhead">1. Photograph the Ticket</div>
      <div class="row">
        <button type="button" class="btn" id="ticketTake">Take Ticket Photo</button>
        <button type="button" class="btn secondary" id="ticketChoose">Choose Existing Photo</button>
      </div>
      <input type="file" accept="image/*" capture="environment" id="ticketCam" style="display:none" />
      <input type="file" accept="image/*" id="ticketLib" style="display:none" />
      <div class="photo-box" id="ticketPreviewBox" style="display:none;margin-top:12px"><img id="ticketPreview" alt="Ticket preview" /></div>
      <button type="button" class="btn" id="ticketRead" style="margin-top:12px" disabled>Read Ticket</button>
      <div class="status" id="ticketScanStatus"></div>
    </div>
    <div id="ticketReview"></div>
    <div class="formhead" style="margin-top:28px">Today’s Saved Tickets</div>
    <div id="ticketToday"><p class="status">Loading tickets...</p></div>`;
  document.getElementById('ticketBack').onclick = () => { ticketPhotoFile = null; ticketDraft = null; state.view='camera-tools'; renderApp(); };
  document.getElementById('ticketTake').onclick = () => document.getElementById('ticketCam').click();
  document.getElementById('ticketChoose').onclick = () => document.getElementById('ticketLib').click();
  const pick = e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    ticketPhotoFile = file; ticketDraft = null;
    document.getElementById('ticketPreview').src = URL.createObjectURL(file);
    document.getElementById('ticketPreviewBox').style.display = 'block';
    document.getElementById('ticketRead').disabled = false;
    document.getElementById('ticketReview').innerHTML = '';
    document.getElementById('ticketScanStatus').textContent = 'Ready to read.';
    e.target.value = '';
  };
  document.getElementById('ticketCam').onchange = pick;
  document.getElementById('ticketLib').onchange = pick;
  document.getElementById('ticketRead').onclick = scanTicketPhoto;
  if (ticketDraft) renderTicketReview(ticketDraft);
  loadTodayTickets();
}

async function scanTicketPhoto() {
  if (!ticketPhotoFile) { toast('Take or choose a ticket photo first'); return; }
  const btn = document.getElementById('ticketRead');
  const status = document.getElementById('ticketScanStatus');
  btn.disabled = true; btn.textContent = 'Reading Ticket...';
  status.textContent = 'Reading the printed ticket details. This may take a moment.';
  try {
    const fd = new FormData(); fd.append('photo', ticketPhotoFile);
    const r = await api('/api/asphalt-tickets/scan', { method:'POST', body:fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ticket) throw new Error(d.error || 'scan failed');
    ticketDraft = d.ticket;
    renderTicketReview(ticketDraft);
    status.textContent = d.ai_read ? 'Ticket read. Check every field, correct anything needed, then save.' : 'The ticket could not be read automatically. Enter the details below, then save.';
  } catch (e) {
    status.textContent = 'The ticket could not be read. Retake it in good light with the full ticket visible.';
  } finally {
    btn.disabled = !!ticketDraft;
    btn.textContent = ticketDraft ? 'Ticket Read' : 'Try Reading Again';
  }
}

function ticketField(id, label, value, type='text', attrs='') {
  return `<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(value == null ? '' : value)}" ${attrs}/>`;
}
function renderTicketReview(t) {
  const box = document.getElementById('ticketReview');
  if (!box) return;
  box.innerHTML = `
    <section class="ticket-review-panel">
      <div class="formhead">2. Review and Save</div>
      <div class="status">AI confidence: <strong>${esc(t.confidence || 'low')}</strong>. The photographed ticket is the source of truth.</div>
      <label for="tkJobLink">Link Ticket Photo to Job</label><select id="tkJobLink"><option value="">No job selected</option>${state.jobs.map(job=>`<option value="${job.id}" ${String(t.job_id||'')===String(job.id)?'selected':''}>${esc(job.job_number?job.job_number+' - '+job.name:job.name)}</option>`).join('')}</select>
      <div class="ticket-form-grid">
        <div>${ticketField('tkNumber','Ticket Number',t.ticket_number)}${ticketField('tkDate','Ticket Date',t.ticket_date || localDateValue(),'date')}</div>
        <div>${ticketField('tkJob','Job Number',t.job_number)}${ticketField('tkTruck','Truck Number',t.truck_number)}</div>
        <div>${ticketField('tkPlant','Plant Name',t.plant_name)}${ticketField('tkPlantAddress','Plant Address',t.plant_address)}</div>
        <div>${ticketField('tkMix','Mix Description',t.mix_description)}${ticketField('tkMixCode','Mix Code',t.mix_code)}</div>
        <div>${ticketField('tkTons','Net Tons',t.net_tons,'number','step="0.01" inputmode="decimal"')}${ticketField('tkTemp','Dispatch Temperature (°F)',t.dispatch_temperature_f,'number','step="0.1" inputmode="decimal"')}</div>
        <div>${ticketField('tkDispatch','Dispatch Time',t.dispatch_time)}${ticketField('tkArrival','Arrival Time',t.arrival_time)}</div>
      </div>
      <button class="btn" id="ticketSave">Save Ticket</button>
    </section>`;
  document.getElementById('ticketSave').onclick = saveTicketReview;
}

async function saveTicketReview() {
  if (!ticketDraft) return;
  const value = id => document.getElementById(id).value.trim();
  const body = {
    ticket_number:value('tkNumber'), ticket_date:value('tkDate'), job_number:value('tkJob'), truck_number:value('tkTruck'),
    plant_name:value('tkPlant'), plant_address:value('tkPlantAddress'), mix_description:value('tkMix'), mix_code:value('tkMixCode'),
    net_tons:value('tkTons'), dispatch_temperature_f:value('tkTemp'), dispatch_time:value('tkDispatch'), arrival_time:value('tkArrival'),
    job_id:value('tkJobLink'),
  };
  const btn = document.getElementById('ticketSave'); btn.disabled = true; btn.textContent = 'Saving...';
  const r = await api(`/api/asphalt-tickets/${ticketDraft.id}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  if (r.ok) {
    toast('Ticket saved'); ticketPhotoFile = null; ticketDraft = null; renderTicketScanner();
  } else { toast('Ticket could not be saved'); btn.disabled = false; btn.textContent = 'Save Ticket'; }
}

async function loadTodayTickets() {
  const box = document.getElementById('ticketToday');
  if (!box) return;
  try {
    const r = await api(`/api/asphalt-tickets?date=${localDateValue()}`);
    if (!r.ok) throw new Error('bad');
    const d = await r.json(); const rows = d.tickets || [];
    box.innerHTML = `<div class="ticket-total"><span>Today’s Total</span><strong>${Number(d.total_tons || 0).toLocaleString(uiLocale(),{minimumFractionDigits:2,maximumFractionDigits:2})} tons</strong></div>` +
      (rows.length ? `<div class="ticket-list">${rows.map(t => `<article class="card ticket-card">${t.photo_path ? `<img src="${photoSrc(t.photo_path)}" alt="Ticket" />` : ''}<div><strong>Ticket ${esc(t.ticket_number || 'number not entered')}</strong><div>${esc(t.plant_name || 'Plant not entered')}</div><div class="meta">${esc(t.mix_description || t.mix_code || 'Mix not entered')} · ${esc(t.truck_number || 'No truck')}</div><div class="ticket-tons">${t.net_tons == null ? 'Tons not entered' : Number(t.net_tons).toFixed(2) + ' tons'}</div></div></article>`).join('')}</div>` : '<p class="empty">No tickets saved today.</p>');
  } catch (e) { box.innerHTML = '<p class="status">Today’s tickets could not be loaded.</p>'; }
}

function onPhotoChosen(file) {
  const replacing=!!state.photoFile;stopCaptureDictation();
  captureLocationGeneration++;
  if(replacing){state._note='';const note=document.getElementById('note');if(note)note.value='';}
  state.photoFile = file;
  state._qualityResult = null;
  state._qualityPromise = analyzePhotoQuality(file).then(result=>{
    if(state.photoFile!==file)return result;
    state._qualityResult=result;
    const status=document.getElementById('qualityStatus');
    if(status)status.textContent=result.warnings.length?`${uiT('Photo quality check')}: ${result.warnings.map(uiT).join('; ')}.`:uiT('Photo quality check passed.');
    return result;
  });
  state._locationPromise = null;
  showCapturePreview(file);
  document.getElementById('locwrap').style.display = 'block';
  acquireLocation();
}

function showCapturePreview(file){
  const box=document.getElementById('previewBox'),img=document.getElementById('preview');
  if(!box||!img||!file)return;
  if(state._previewUrl)URL.revokeObjectURL(state._previewUrl);
  state._previewUrl=URL.createObjectURL(file);img.src=state._previewUrl;box.style.display='block';
}
function retakeCapturePhoto(){
  stopCaptureDictation();
  const input=document.getElementById('photoCam');
  if(!input)return;input.value='';input.click();
}
function cancelCapturePhoto(){
  stopCaptureDictation();
  captureLocationGeneration++;
  if(state._previewUrl)URL.revokeObjectURL(state._previewUrl);
  state._previewUrl=null;state.photoFile=null;state._qualityResult=null;state._qualityPromise=null;state.location=null;state.address=null;state._locationPromise=null;
  for(const id of ['photoCam','photoLib']){const input=document.getElementById(id);if(input)input.value='';}
  const preview=document.getElementById('preview');if(preview)preview.removeAttribute('src');
  const box=document.getElementById('previewBox');if(box)box.style.display='none';
  const loc=document.getElementById('locwrap');if(loc)loc.style.display='none';
  const quality=document.getElementById('qualityStatus');if(quality)quality.textContent='';
  toast('Photo cancelled');
}

async function analyzePhotoQuality(file){
  try{
    const bitmap=await createImageBitmap(file),sourceWidth=bitmap.width,sourceHeight=bitmap.height;const max=256,scale=Math.min(1,max/Math.max(sourceWidth,sourceHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);if(bitmap.close)bitmap.close();
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;const lum=new Float32Array(canvas.width*canvas.height);let sum=0,dark=0,bright=0;
    for(let i=0,p=0;i<data.length;i+=4,p++){const l=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];lum[p]=l;sum+=l;if(l<35)dark++;if(l>245)bright++;}
    let edges=0,n=0;for(let y=1;y<canvas.height-1;y++){for(let x=1;x<canvas.width-1;x++){const p=y*canvas.width+x;edges+=Math.abs(lum[p-1]-lum[p+1])+Math.abs(lum[p-canvas.width]-lum[p+canvas.width]);n++;}}
    const mean=sum/lum.length,edge=n?edges/n:0,warnings=[];
    if(sourceWidth<900||sourceHeight<700)warnings.push('low resolution');
    if(mean<55||dark/lum.length>.55)warnings.push('too dark');
    if(mean>215||bright/lum.length>.45)warnings.push('overexposed');
    if(edge<13)warnings.push('possibly blurry');
    return {warnings,width:sourceWidth,height:sourceHeight,brightness:Math.round(mean),sharpness:Math.round(edge)};
  }catch(e){return {warnings:[],unavailable:true};}
}

async function confirmPhotoQuality(){
  if(!state.photoFile)return true;
  const result=state._qualityPromise?await state._qualityPromise:state._qualityResult;
  if(!result||!result.warnings||!result.warnings.length)return true;
  const warningList=result.warnings.map(uiT).join(', ');
  return confirm(uiT('Photo quality warning:')+' '+warningList+'.\n\n'+uiT('Choose OK to save this photo anyway, or Cancel to retake it.'));
}

function browserPosition(options) {
  return new Promise((resolve,reject) => navigator.geolocation.getCurrentPosition(resolve,reject,options));
}

function acquireLocation(force=false) {
  if (state._locationPromise && !force) return state._locationPromise;
  const gps = document.getElementById('gps');
  const addr = document.getElementById('addr');
  const retry = document.getElementById('retryLocation');
  if (force) { captureLocationGeneration++; state.location=null; state.address=null; state._locationPromise=null; }
  const generation = captureLocationGeneration;
  const photoForLocation = state.photoFile;
  const isCurrent = () => generation === captureLocationGeneration && state.photoFile === photoForLocation;
  if (gps) gps.textContent = 'Getting location...';
  if (addr) addr.textContent = 'Waiting for GPS coordinates...';
  if (retry) retry.disabled = true;
  if (!navigator.geolocation) {
    if (gps) gps.textContent = 'Location not available on this device.';
    if (addr) addr.textContent = 'You can still save the photo without an address.';
    if (retry) retry.disabled = false;
    state._locationPromise = Promise.resolve();
    return state._locationPromise;
  }
  state._locationPromise = (async () => {
    let pos;
    try {
      pos = await browserPosition({ enableHighAccuracy:true, timeout:12000, maximumAge:0 });
    } catch (firstError) {
      if (firstError && firstError.code === 1) throw firstError;
      // Android browsers can time out while enabling precise GPS immediately
      // after permission is granted. Retry with a recent/network location.
      pos = await browserPosition({ enableHighAccuracy:false, timeout:15000, maximumAge:60000 });
    }
    try {
      if (!isCurrent()) return;
      state.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (gps) gps.textContent = state.location.lat.toFixed(5) + ', ' + state.location.lng.toFixed(5);
      if (addr) addr.textContent = 'Looking up address...';
      try {
        const r = await api(`/api/geocode?lat=${state.location.lat}&lng=${state.location.lng}`);
        if (!isCurrent()) return;
        if (r.ok) { const d = await r.json(); if (!isCurrent()) return; state.address = d.address || null; if (addr) addr.textContent = d.address || 'Exact address not found. GPS coordinates will still be saved.'; }
        else if (addr) addr.textContent = 'Address lookup failed. GPS coordinates will still be saved.';
      } catch (e) { if (isCurrent() && addr) addr.textContent = 'Address lookup failed. GPS coordinates will still be saved.'; }
    } finally { if (isCurrent() && retry) retry.disabled=false; }
  })().catch(err => {
    if (!isCurrent()) return;
    if (gps) gps.textContent = err && err.code===1 ? 'Location permission is blocked for this site.' : 'Location timed out or is unavailable.';
    if (addr) addr.textContent = 'Tap Retry location and address, or save without an address.';
    if (retry) retry.disabled=false;
  });
  return state._locationPromise;
}

function cleanupDictation() {
  if (dictationRestartTimer) clearTimeout(dictationRestartTimer);
  if (dictationWatchdog) clearTimeout(dictationWatchdog);
  dictationRestartTimer = null;
  dictationWatchdog = null;
  dictationActive = false;
  recognizer = null;
  const btn = document.getElementById('dictate');
  if (btn) { btn.textContent = 'Record Note'; btn.classList.remove('on'); }
}

function stopCaptureDictation(){
  dictationGeneration++;
  if(dictationRestartTimer)clearTimeout(dictationRestartTimer);
  if(dictationWatchdog)clearTimeout(dictationWatchdog);
  dictationRestartTimer=null;dictationWatchdog=null;dictationActive=false;
  const current=recognizer;recognizer=null;if(current)try{current.stop();}catch(e){}
  const btn=document.getElementById('dictate');if(btn){btn.textContent='Record Note';btn.classList.remove('on');}
}

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function toggleDictation() {
  const noteEl = document.getElementById('note');
  const btn = document.getElementById('dictate');
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    // Only when the browser has no speech recognition at all: fall back to the
    // keyboard's own mic key so the person can still dictate.
    if (noteEl) noteEl.focus();
    toast('Tap the microphone key on your keyboard, then talk');
    return;
  }
  if (dictationActive) {
    stopCaptureDictation();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('This browser cannot access the microphone. Type the note or use the keyboard microphone');
    return;
  }
  if(!isIOS())try {
    // Ask for the site's microphone permission before starting Safari's speech
    // service. Safari can otherwise enter its recording state without ever
    // delivering words or showing the permission prompt.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
  } catch (e) {
    toast('Microphone access is off for Photo Notes. Allow it for this website, then tap Record Note again');
    return;
  }
  dictationActive = true;
  dictationBase = noteEl ? noteEl.value.trim() : '';
  if (dictationBase) dictationBase += ' ';
  if (btn) { btn.textContent = 'Recording... tap to stop'; btn.classList.add('on'); }
  const status=document.getElementById('dictationStatus');if(status)status.textContent=isIOS()?'Listening. On iPhone, words may appear after you pause.':'Listening...';
  startDictationSession(SR);
}

function startDictationSession(SR) {
  if (!dictationActive) return;
  const noteEl = document.getElementById('note');
  const session = new SR(), generation=++dictationGeneration, photoForSession=state.photoFile, ios=isIOS();
  recognizer = session;
  session.lang = uiSpeechLanguage();
  session.continuous = !ios;
  session.interimResults = true;
  let sessionText = '';
  if(dictationWatchdog)clearTimeout(dictationWatchdog);dictationWatchdog=setTimeout(()=>{if(generation!==dictationGeneration||sessionText)return;dictationActive=false;try{session.stop();}catch(e){}const status=document.getElementById('dictationStatus');if(status)status.textContent='No speech was received. On iPhone, tap the note box and use the keyboard microphone, or try Record Note again.';},10000);
  session.onresult = (ev) => {
    if(generation!==dictationGeneration||state.photoFile!==photoForSession||document.getElementById('note')!==noteEl)return;
    if(dictationWatchdog)clearTimeout(dictationWatchdog);dictationWatchdog=null;
    // Rebuild the current recognition session from its indexed result slots.
    // Android may revise a cumulative phrase and mark it final repeatedly;
    // appending each event produces duplicated/spammed words.
    const parts=[];
    for (let i=0;i<ev.results.length;i++) parts.push(ev.results[i][0].transcript.trim());
    sessionText=parts.filter(Boolean).join(' ').trim();
    if (noteEl) { noteEl.value=(dictationBase+sessionText).trimStart(); state._note=noteEl.value; }
    const status=document.getElementById('dictationStatus');if(status&&sessionText)status.textContent='Speech received.';
    if (isProClient()) applyExtraction(dictationBase+sessionText);
  };
  session.onerror = (e) => {
    const err = e && e.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      toast('Allow microphone access for this site, then tap Record Note again');
      dictationActive=false;
    } else if (err === 'no-speech') {
      // Android often ends a session before the user starts talking. onend
      // restarts it while the Record button remains active.
    } else if (err === 'audio-capture') {
      toast('The microphone is unavailable. Close any other app using it, then try again');
      dictationActive=false;
    } else if (err === 'network') {
      toast('Speech recognition could not connect. Check your internet connection and try again');
      dictationActive=false;
    } else if (err === 'aborted') {
      // Stopping after speech can report "aborted" on Safari even though the
      // final result has already been delivered. No error message is needed.
    } else {
      toast('Recording stopped unexpectedly. Tap Record Note to try again');
      dictationActive=false;
    }
  };
  session.onend = () => {
    if(generation!==dictationGeneration)return;
    if(dictationWatchdog)clearTimeout(dictationWatchdog);dictationWatchdog=null;
    if (recognizer === session) recognizer=null;
    if (sessionText) {
      dictationBase=(dictationBase+sessionText).trim();
      if (dictationBase) dictationBase+=' ';
    }
    if (dictationActive&&!ios) {
      const btn=document.getElementById('dictate');
      if (btn) btn.textContent='Listening... tap to stop';
      dictationRestartTimer=setTimeout(()=>startDictationSession(SR),300);
    } else cleanupDictation();
  };
  try { session.start(); }
  catch (e) { cleanupDictation(); toast('Recording could not start. Tap Record Note to try again'); }
}

// ================= Pro dimension fields =================
// Dimension state is used by the saved-capture measurement editor in Edit.
function freshDims() {
  return {
    length: '', lengthUnit: 'ft', width: '', widthUnit: 'ft', depth: '', shape: 'rectangle', area: '',
    areaOverridden: false,
    touched: { length: false, width: false, depth: false, shape: false, area: false },
    suggested: { length: false, width: false, depth: false },
  };
}
function getDims() { if (!state._dims) state._dims = freshDims(); return state._dims; }

function dimBlockHtml() {
  const d = getDims();
  const sug = (f) => d.suggested[f] ? ' suggested' : '';
  const anySug = d.suggested.length || d.suggested.width || d.suggested.depth;
  return `
    <label>Measure From Photo</label>
    <button type="button" class="btn secondary slim" id="measureBtn">Measure From Photo (AI)</button>
    <div class="status" id="measureHint">Lay the ruler flat on the pavement next to the damage and shoot from directly above.</div>
    <div id="measurePanel"></div>
    <div id="measureResult"></div>

    <label>Dimensions</label>
    <div class="row compact">
      <input type="text" inputmode="decimal" id="dimLength" class="dimfield${sug('length')}" placeholder="Length" value="${esc(d.length)}" style="flex:2" />
      <select id="dimLengthUnit" style="flex:1">
        <option value="ft"${d.lengthUnit === 'ft' ? ' selected' : ''}>ft</option>
        <option value="in"${d.lengthUnit === 'in' ? ' selected' : ''}>in</option>
      </select>
    </div>
    <div class="row compact" style="margin-top:8px">
      <input type="text" inputmode="decimal" id="dimWidth" class="dimfield${sug('width')}" placeholder="Width" value="${esc(d.width)}" style="flex:2" />
      <select id="dimWidthUnit" style="flex:1">
        <option value="ft"${d.widthUnit === 'ft' ? ' selected' : ''}>ft</option>
        <option value="in"${d.widthUnit === 'in' ? ' selected' : ''}>in</option>
      </select>
    </div>
    <div class="row compact" style="margin-top:8px">
      <input type="text" inputmode="decimal" id="dimDepth" class="dimfield${sug('depth')}" placeholder="Depth" value="${esc(d.depth)}" style="flex:2" />
      <span class="fieldval" style="flex:1;align-self:center">inches deep</span>
    </div>
    <label style="margin-top:10px">Shape</label>
    <select id="dimShape">
      <option value="rectangle"${d.shape === 'rectangle' ? ' selected' : ''}>Rectangle</option>
      <option value="circle"${d.shape === 'circle' ? ' selected' : ''}>Circle</option>
      <option value="irregular"${d.shape === 'irregular' ? ' selected' : ''}>Irregular</option>
    </select>
    <label style="margin-top:10px">Area (Sq Ft)</label>
    <input type="text" inputmode="decimal" id="dimArea" placeholder="Auto-calculated" value="${esc(d.area)}" />
    <div class="status" id="dimAreaHint" style="margin-top:4px">${anySug ? 'Highlighted values were filled in from your recording. Tap to confirm or edit.' : ''}</div>`;
}

function wireDims() {
  const d = getDims();
  const L = document.getElementById('dimLength');
  const W = document.getElementById('dimWidth');
  const Dp = document.getElementById('dimDepth');
  const LU = document.getElementById('dimLengthUnit');
  const WU = document.getElementById('dimWidthUnit');
  const Sh = document.getElementById('dimShape');
  const Ar = document.getElementById('dimArea');
  if (!L) return;
  // Manual edits mark a field as touched (never overwritten by extraction) and
  // clear its AI-suggested highlight.
  L.addEventListener('input', () => { d.length = L.value; d.touched.length = true; d.suggested.length = false; L.classList.remove('suggested'); d.areaOverridden = false; recalcArea(); refreshHint(); });
  W.addEventListener('input', () => { d.width = W.value; d.touched.width = true; d.suggested.width = false; W.classList.remove('suggested'); d.areaOverridden = false; recalcArea(); refreshHint(); });
  Dp.addEventListener('input', () => { d.depth = Dp.value; d.touched.depth = true; d.suggested.depth = false; Dp.classList.remove('suggested'); refreshHint(); });
  LU.addEventListener('change', () => { d.lengthUnit = LU.value; d.areaOverridden = false; recalcArea(); });
  WU.addEventListener('change', () => { d.widthUnit = WU.value; d.areaOverridden = false; recalcArea(); });
  Sh.addEventListener('change', () => { d.shape = Sh.value; d.touched.shape = true; d.areaOverridden = false; recalcArea(); });
  Ar.addEventListener('input', () => { d.area = Ar.value; d.touched.area = true; d.areaOverridden = true; });
  recalcArea();
  const mb = document.getElementById('measureBtn');
  if (mb) mb.onclick = openMeasurePanel;
  // if a measurement result is already in state (e.g. re-render), show it again
  if (state._measure) renderMeasureResult();
}

// ---- Measure from photo (Pro) ----
function openMeasurePanel() {
  if (!state.photoFile && !state._editMeasureCapture) { toast('Choose a saved photo first'); return; }
  const panel = document.getElementById('measurePanel');
  if (!panel) return;
  panel.innerHTML = `
    <div class="formhead" style="margin-top:8px">What reference is in the photo?</div>
    <div class="pill-group" id="refpills">
      <div class="pill on" data-ref="ruler_12in">12-inch Ruler</div>
      <div class="pill" data-ref="tape_25ft">25-foot Tape</div>
      <div class="pill" data-ref="other">Other</div>
    </div>
    <div id="reflenwrap" style="display:none;margin-top:8px">
      <div class="row compact">
        <input type="text" inputmode="decimal" id="reflen" placeholder="Reference length" style="flex:2" />
        <select id="reflenunit" style="flex:1"><option value="ft">ft</option><option value="in">in</option></select>
      </div>
    </div>
    <div class="row" style="margin-top:8px">
      <button class="btn slim" id="doMeasure">Measure</button>
      <button class="btn secondary slim" id="cancelMeasure">Cancel</button>
    </div>`;
  let ref = 'ruler_12in';
  const lenWrap = document.getElementById('reflenwrap');
  document.getElementById('refpills').onclick = (e) => {
    const p = e.target.closest('[data-ref]'); if (!p) return;
    ref = p.getAttribute('data-ref');
    document.querySelectorAll('#refpills .pill').forEach(x => x.classList.remove('on'));
    p.classList.add('on');
    // 25-foot tape and Other need a manually entered length
    if (ref === 'tape_25ft') { lenWrap.style.display = 'block'; const r = document.getElementById('reflen'); if (!r.value) r.value = '25'; document.getElementById('reflenunit').value = 'ft'; }
    else if (ref === 'other') { lenWrap.style.display = 'block'; }
    else { lenWrap.style.display = 'none'; }
  };
  document.getElementById('cancelMeasure').onclick = () => { panel.innerHTML = ''; };
  document.getElementById('doMeasure').onclick = () => runMeasure(ref);
}

async function runMeasure(ref) {
  const panel = document.getElementById('measurePanel');
  const resEl = document.getElementById('measureResult');
  let refLenIn = 12;
  if (ref === 'ruler_12in') refLenIn = 12;
  else {
    const v = parseFloat((document.getElementById('reflen') || {}).value);
    const unit = (document.getElementById('reflenunit') || {}).value || 'ft';
    if (!isFinite(v) || v <= 0) { toast('Enter the reference length'); return; }
    refLenIn = unit === 'ft' ? v * 12 : v;
  }
  const btn = document.getElementById('doMeasure');
  if (btn) { btn.disabled = true; btn.textContent = 'Measuring...'; }
  try {
    const fd = new FormData();
    if (state.photoFile) fd.append('photo', state.photoFile);
    else if (state._editMeasureCapture) fd.append('capture_id', String(state._editMeasureCapture.id));
    fd.append('reference_type', ref);
    fd.append('reference_length_in', String(refLenIn));
    const r = await api('/api/measure', { method: 'POST', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.ok === false) {
      resEl.innerHTML = `<div class="status">Could not measure from this photo right now. You can enter the dimensions by hand, and the record still saves normally.</div>`;
      if (panel) panel.innerHTML = '';
      return;
    }
    if (d.no_reference || (d.length_in == null && d.width_in == null)) {
      resEl.innerHTML = `<div class="status"><strong>No reference object found.</strong> ${esc(d.warning || 'Re-shoot with the ruler in frame.')}</div>`;
      if (panel) panel.innerHTML = '';
      return;
    }
    applyMeasurement(d, ref);
    if (panel) panel.innerHTML = '';
  } catch (e) {
    resEl.innerHTML = `<div class="status">Measurement service is unavailable. Enter dimensions by hand; the record still saves.</div>`;
    if (panel) panel.innerHTML = '';
  } finally { if (btn) { btn.disabled = false; btn.textContent = 'Measure'; } }
}

// Prefill dimension fields from an AI measurement, marked AI-estimated, never
// overwriting a value the user typed manually.
function applyMeasurement(d, ref) {
  const dm = getDims();
  const setF = (field, valIn, unitField) => {
    if (valIn == null || dm.touched[field]) return false;
    dm[field] = String(Math.round(Number(valIn) * 10) / 10);
    if (unitField) dm[unitField] = 'in';
    dm.suggested[field] = true;
    return true;
  };
  setF('length', d.length_in, 'lengthUnit');
  setF('width', d.width_in, 'widthUnit');
  setF('depth', d.depth_in, null);
  if (['rectangle', 'circle', 'irregular'].includes(d.shape) && !dm.touched.shape) dm.shape = d.shape;
  dm.areaOverridden = false;
  // measurement provenance for save + export gating
  state._measure = {
    source: 'photo_ai', reference: ref, confidence: d.confidence || 'low',
    warning: d.warning || null, raw: d.raw || d,
    confirmed: (d.confidence === 'high' || d.confidence === 'medium'),
  };
  // re-render the dim inputs so the suggested highlight + values show
  if (state._editMeasureCapture) renderSavedDimsEditor(state._editMeasureCapture);
}

function renderMeasureResult() {
  const resEl = document.getElementById('measureResult');
  const m = state._measure;
  if (!resEl || !m) return;
  const confColor = m.confidence === 'high' ? '#1b7a3d' : m.confidence === 'medium' ? '#b36b00' : '#b3261e';
  let html = `<div class="status" style="margin-top:6px"><strong style="color:${confColor}">AI estimate, ${esc(m.confidence)} confidence.</strong>`;
  if (m.warning) html += ` ${esc(m.warning)}`;
  html += ` Values are marked as suggestions. Edit any field to confirm it.</div>`;
  if (!m.confirmed) {
    html += `<label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:14px;font-weight:bold">
      <input type="checkbox" id="measureConfirm" style="width:20px;height:20px"> Confirm this low-confidence estimate for use in exports</label>`;
  }
  resEl.innerHTML = html;
  const cb = document.getElementById('measureConfirm');
  if (cb) cb.onchange = () => { if (state._measure) state._measure.confirmed = cb.checked; };
}

function refreshHint() {
  const d = getDims();
  const hint = document.getElementById('dimAreaHint');
  if (!hint) return;
  const anySug = d.suggested.length || d.suggested.width || d.suggested.depth;
  hint.textContent = anySug ? 'Highlighted values were filled in from your recording. Tap to confirm or edit.' : '';
}

function clientToInches(value, unit) {
  const v = parseFloat(value);
  if (!isFinite(v) || v <= 0) return null;
  return unit === 'ft' ? v * 12 : v;
}
function clientAreaSqft(lenIn, widIn, shape) {
  if (lenIn == null || widIn == null) return null;
  let f = 1;
  if (shape === 'circle') f = 0.785;
  else if (shape === 'irregular') f = 0.85;
  return (lenIn * widIn * f) / 144;
}
// Live recompute of the area field from length x width x shape, unless the user
// has manually overridden it (override persists until length/width/shape change).
function recalcArea() {
  const d = getDims();
  const Ar = document.getElementById('dimArea');
  if (d.areaOverridden) return;
  const lenIn = clientToInches(d.length, d.lengthUnit);
  const widIn = clientToInches(d.width, d.widthUnit);
  const a = clientAreaSqft(lenIn, widIn, d.shape);
  if (a == null) { d.area = ''; if (Ar) Ar.value = ''; return; }
  const rounded = a.toFixed(1);
  d.area = rounded;
  if (Ar) Ar.value = (d.shape === 'irregular' ? 'approx. ' : '') + rounded;
}

// ---- voice extraction ----
const DIM_NUMWORDS = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90 };
const DIM_NUM = '(\\d+(?:\\.\\d+)?|(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\\s-]*)+)';
const DIM_UNIT = '(feet|foot|ft|inches|inch|in)';
function dimWordToNum(str) {
  if (str == null) return null;
  str = String(str).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const parts = str.split(/[\s-]+/).filter(Boolean);
  let total = 0, any = false;
  for (const p of parts) {
    if (DIM_NUMWORDS[p] != null) { total += DIM_NUMWORDS[p]; any = true; }
    else if (p === 'and') { /* ignore */ }
    else return null;
  }
  return any ? total : null;
}
function dimNormUnit(u) { if (!u) return null; u = u.toLowerCase(); return /^(in|inch|inches)$/.test(u) ? 'in' : 'ft'; }

// Parse dimension phrases from a transcript. Returns { length, lengthUnit,
// width, widthUnit, depth } where present. Depth is always inches.
function extractDims(text) {
  const out = {};
  if (!text) return out;
  const t = String(text).toLowerCase();
  // "L by W (unit)" e.g. "three by two feet", "3x2 ft", "18 by 24 inches"
  let m = new RegExp(DIM_NUM + '\\s*(?:x|by|\\u00d7)\\s*' + DIM_NUM + '\\s*' + DIM_UNIT + '?', 'i').exec(t);
  if (m) {
    const l = dimWordToNum(m[1]); const w = dimWordToNum(m[2]); const u = dimNormUnit(m[3]) || 'ft';
    if (l != null) { out.length = l; out.lengthUnit = u; }
    if (w != null) { out.width = w; out.widthUnit = u; }
  }
  // "N unit wide"
  m = new RegExp(DIM_NUM + '\\s*' + DIM_UNIT + '?\\s*(?:wide|in width|width)', 'i').exec(t);
  if (m && out.width == null) { const v = dimWordToNum(m[1]); if (v != null) { out.width = v; out.widthUnit = dimNormUnit(m[2]) || 'ft'; } }
  // "N unit long"
  m = new RegExp(DIM_NUM + '\\s*' + DIM_UNIT + '?\\s*(?:long|in length|length)', 'i').exec(t);
  if (m && out.length == null) { const v = dimWordToNum(m[1]); if (v != null) { out.length = v; out.lengthUnit = dimNormUnit(m[2]) || 'ft'; } }
  // "N (unit) deep / thick" -> depth in inches (feet converted)
  m = new RegExp(DIM_NUM + '\\s*' + DIM_UNIT + '?\\s*(?:deep|in depth|depth|thick)', 'i').exec(t);
  if (m) { const v = dimWordToNum(m[1]); if (v != null) { const u = dimNormUnit(m[2]); out.depth = u === 'ft' ? v * 12 : v; } }
  return out;
}

// Apply extraction results to the dim fields. Never overwrites a manually-typed
// field; marks filled fields as AI-suggested.
function applyExtraction(text) {
  if (!isProClient()) return;
  const found = extractDims(text);
  const d = getDims();
  let changed = false;
  if (found.length != null && !d.touched.length) { d.length = String(found.length); d.lengthUnit = found.lengthUnit || d.lengthUnit; d.suggested.length = true; changed = true; }
  if (found.width != null && !d.touched.width) { d.width = String(found.width); d.widthUnit = found.widthUnit || d.widthUnit; d.suggested.width = true; changed = true; }
  if (found.depth != null && !d.touched.depth) { d.depth = String(found.depth); d.suggested.depth = true; changed = true; }
  if (!changed) return;
  d.areaOverridden = false;
  // reflect into the DOM if the fields are on screen
  const L = document.getElementById('dimLength'); if (L) { L.value = d.length; if (d.suggested.length) L.classList.add('suggested'); }
  const W = document.getElementById('dimWidth'); if (W) { W.value = d.width; if (d.suggested.width) W.classList.add('suggested'); }
  const Dp = document.getElementById('dimDepth'); if (Dp) { Dp.value = d.depth; if (d.suggested.depth) Dp.classList.add('suggested'); }
  const LU = document.getElementById('dimLengthUnit'); if (LU) LU.value = d.lengthUnit;
  const WU = document.getElementById('dimWidthUnit'); if (WU) WU.value = d.widthUnit;
  recalcArea();
  refreshHint();
}

function collectDims() {
  const d = getDims();
  return {
    dim_length: d.length || '', dim_length_unit: d.lengthUnit || 'ft',
    dim_width: d.width || '', dim_width_unit: d.widthUnit || 'ft',
    dim_depth: d.depth || '',
    dim_shape: d.shape || 'rectangle',
    // strip any "approx. " prefix so the server stores a clean number
    dim_area_sqft: String(d.area || '').replace(/[^0-9.]/g, ''),
  };
}

function dimsFromCapture(c) {
  const display = (valueIn, unit) => {
    const value = Number(valueIn);
    if (!isFinite(value) || value <= 0) return '';
    return trimNumC(unit === 'in' ? value : value / 12);
  };
  const d = freshDims();
  d.lengthUnit = c.dim_length_unit === 'in' ? 'in' : 'ft';
  d.widthUnit = c.dim_width_unit === 'in' ? 'in' : 'ft';
  d.length = display(c.dim_length_in, d.lengthUnit);
  d.width = display(c.dim_width_in, d.widthUnit);
  d.depth = c.dim_depth_in == null ? '' : trimNumC(Number(c.dim_depth_in));
  d.shape = ['rectangle', 'circle', 'irregular'].includes(c.dim_shape) ? c.dim_shape : 'rectangle';
  d.area = c.dim_area_sqft == null ? '' : trimNumC(Number(c.dim_area_sqft));
  d.areaOverridden = d.area !== '';
  return d;
}

function renderSavedDimsEditor(c) {
  state._editMeasureCapture = c;
  const body = document.getElementById('body');
  body.className = 'workflow-edit';
  body.innerHTML = `
    <button class="backlink" id="dimsBack">← Back to Edit</button>
    <div class="workflow-intro"><strong>Measure this photo</strong><span>Use AI with a visible reference object, or enter the dimensions yourself.</span></div>
    ${c.photo_path ? `<div class="photo-box"><img src="${photoSrc(c.photo_path)}" alt="capture" style="display:block" /></div>` : ''}
    ${dimBlockHtml()}
    <button class="btn" id="saveDims">Save Measurements</button>`;
  wireDims();
  document.getElementById('dimsBack').onclick = () => { state._editMeasureCapture = null; state._dims = null; state._measure = null; renderEdit(); };
  document.getElementById('saveDims').onclick = saveSavedDims;
}

async function saveSavedDims() {
  const c = state._editMeasureCapture;
  if (!c) return;
  const payload = collectDims();
  if (state._measure) {
    payload.dim_source = 'photo_ai';
    payload.dim_confidence = state._measure.confidence || 'low';
    payload.dim_confirmed = !!state._measure.confirmed;
    payload.measure_reference = state._measure.reference || '';
    payload.dim_ai = state._measure.raw || null;
  } else {
    payload.dim_source = 'manual';
    payload.dim_confirmed = true;
  }
  const btn = document.getElementById('saveDims');
  btn.disabled = true; btn.textContent = 'Saving...';
  const r = await api(`/api/captures/${c.id}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
  if (r.ok) {
    toast('Measurements saved');
    state._editMeasureCapture = null; state._dims = null; state._measure = null;
    renderEdit();
  } else {
    btn.disabled = false; btn.textContent = 'Save Measurements'; toast('Measurements could not be saved');
  }
}

// Read-only formatting of stored dims for saved cards (mirrors server fmtDims).
function trimNumC(n) { const r = Math.round(n * 100) / 100; return String(r); }
function fmtDimsClient(c) {
  if (c.dim_area_sqft == null && c.dim_length_in == null && c.dim_width_in == null) return '';
  const disp = (vin, unit) => { const v = Number(vin); if (!isFinite(v) || v <= 0) return ''; return unit === 'in' ? `${trimNumC(v)} in` : `${(v / 12).toFixed(1)} ft`; };
  const l = disp(c.dim_length_in, c.dim_length_unit); const w = disp(c.dim_width_in, c.dim_width_unit);
  const lw = [l, w].filter(Boolean);
  let line = lw.length ? lw.join(' x ') : '';
  if (c.dim_depth_in != null && isFinite(Number(c.dim_depth_in))) line = line ? `${line} x ${trimNumC(Number(c.dim_depth_in))} in deep` : `${trimNumC(Number(c.dim_depth_in))} in deep`;
  if (c.dim_area_sqft != null && isFinite(Number(c.dim_area_sqft))) { const a = `${Number(c.dim_area_sqft).toFixed(1)} sq ft`; const al = c.dim_shape === 'irregular' ? `approx. ${a}` : a; line = line ? `${line}, ${al}` : al; }
  return line;
}
// ================= end Pro dimension fields =================

// ---- background upload manager ----
// The record commits from the user's point of view the instant they tap Save:
// the form clears immediately and the photo finishes uploading behind the
// scenes. Uploads run one at a time (kind to slow connections), auto-retry with
// backoff, and resume when the device comes back online.
let bgQueue = [];      // [{ id, payload, hadCoords, tries }]
let bgActive = 0;      // 1 while an upload is in flight, else 0
let bgDraining = false;
let bgOnlineHooked = false;
let offlineQueueRestored = false;

function queueDb(){return new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(new Error('unavailable'));const r=indexedDB.open('photo-notes-offline',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('captures'))r.result.createObjectStore('captures',{keyPath:'id',autoIncrement:true});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function queueStore(payload,hadCoords){const db=await queueDb();return new Promise((resolve,reject)=>{const tx=db.transaction('captures','readwrite');const r=tx.objectStore('captures').add({payload,hadCoords:!!hadCoords,createdAt:Date.now()});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
async function queueDelete(id){if(id==null)return;try{const db=await queueDb();await new Promise((resolve,reject)=>{const tx=db.transaction('captures','readwrite');tx.objectStore('captures').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();}catch(e){}}
async function restoreOfflineQueue(){if(offlineQueueRestored)return;offlineQueueRestored=true;try{const db=await queueDb();const rows=await new Promise((resolve,reject)=>{const tx=db.transaction('captures','readonly');const r=tx.objectStore('captures').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});db.close();const known=new Set(bgQueue.map(x=>x.id));rows.forEach(row=>{if(!known.has(row.id))bgQueue.push({id:row.id,payload:row.payload,hadCoords:row.hadCoords,tries:0});});if(rows.length){toast(`${rows.length} offline capture${rows.length===1?'':'s'} ready to upload`);bgIndicator();drainQueue();}}catch(e){}}
function payloadFormData(p){const fd=new FormData();if(p.photo)fd.append('photo',p.photo,p.photoName||'offline-photo.jpg');fd.append('note',p.note||'');fd.append('area_tags',p.area_tags||'[]');fd.append('kind',p.kind||'note');if(p.job_id)fd.append('job_id',p.job_id);for(const k of ['hoa_community_id','hoa_title','hoa_item_type','hoa_priority','hoa_area','hoa_directed_to','hoa_budget_source','hoa_photo_stage','hoa_target_date'])if(p[k])fd.append(k,p[k]);if(p.latitude!=null)fd.append('latitude',p.latitude);if(p.longitude!=null)fd.append('longitude',p.longitude);if(p.address)fd.append('address',p.address);return fd;}

function bgIndicator() {
  let el = document.getElementById('bgstatus');
  const total = bgActive + bgQueue.length;
  if (!el) {
    if (total === 0) return;
    el = document.createElement('div');
    el.id = 'bgstatus';
    el.style.cssText = 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);background:#111;color:#fff;padding:9px 16px;border-radius:20px;font-weight:bold;font-size:14px;z-index:20;box-shadow:0 2px 8px rgba(0,0,0,.3)';
    document.body.appendChild(el);
  }
  if (total > 0) {
    const offline=typeof navigator!=='undefined'&&navigator.onLine===false;
    el.textContent = offline ? (total === 1 ? '1 photo saved offline' : `${total} photos saved offline`) : (total === 1 ? 'Uploading photo…' : `Uploading ${total} photos…`);
    el.style.background = '#111';
    el.style.display = 'block';
  } else {
    el.textContent = 'All photos uploaded';
    el.style.background = '#1b7a3d';
    setTimeout(() => { if (el && bgActive + bgQueue.length === 0) el.style.display = 'none'; }, 1600);
  }
}

async function enqueueUpload(payload, hadCoords) {
  let id=null;try{id=await queueStore(payload,hadCoords);}catch(e){}
  bgQueue.push({ id, payload, hadCoords: !!hadCoords, tries: 0 });
  if (!bgOnlineHooked) { window.addEventListener('online', drainQueue); bgOnlineHooked = true; }
  bgIndicator();
  drainQueue();
}

async function drainQueue() {
  if (bgDraining) return;
  bgDraining = true;
  try {
    while (bgQueue.length) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break; // wait for 'online'
      const item = bgQueue.shift();
      bgActive = 1; bgIndicator();
      try {
        const r = await fetch('/api/captures', { method: 'POST', credentials: 'same-origin', body: payloadFormData(item.payload) });
        if (!r.ok) throw new Error('http ' + r.status);
        const saved=await r.json().catch(()=>({}));
        if(saved.duplicate_matches&&saved.duplicate_matches.length)toast(`Possible duplicate found (${saved.duplicate_matches.length})`);
        else if(saved.maintenance_item)toast('Maintenance item saved');
        await queueDelete(item.id);
        bgActive = 0;
        // Refresh the Library if it is open so the new card appears...
        if (state.view === 'organize' || state.view === 'edit') {
          const flt = document.getElementById('filter');
          loadCards(flt ? (flt.value || '') : '');
          // ...and again shortly after, to pick up the background-filled address.
          if (item.hadCoords) setTimeout(() => { if (state.view === 'organize' || state.view === 'edit') { const f = document.getElementById('filter'); loadCards(f ? (f.value || '') : ''); } }, 3000);
        }
      } catch (e) {
        bgActive = 0;
        item.tries++;
        const delay = Math.min(120000, 2000 * Math.pow(2, Math.min(item.tries - 1, 6)));
        bgQueue.push(item);
        setTimeout(drainQueue, delay);
        if(item.tries===3)toast('Photo saved offline. Upload will continue automatically.');
        bgIndicator();
        break;
      }
      bgIndicator();
    }
  } finally { bgDraining = false; }
}

async function saveCapture() {
  stopCaptureDictation();
  const note = document.getElementById('note').value.trim();
  if (!state.photoFile && !note) { toast('Take a photo or add a note first'); return; }
  if(isHoaClient()&&!state.communityId){toast('Select an HOA or community');return;}
  if(isHoaClient()&&!document.getElementById('hoaTitle').value.trim()&&!note){toast('Enter an issue title or note');return;}
  if (!(await confirmPhotoQuality())) { toast('Photo kept for retaking'); return; }
  // Build the payload from the CURRENT state before we clear the form.
  const payload={photo:state.photoFile||null,photoName:state.photoFile&&state.photoFile.name||'offline-photo.jpg',note,area_tags:JSON.stringify(isHoaClient()?[document.getElementById('hoaArea').value]:(state.area?[state.area]:[])),kind:'note'};
  if(isHoaClient()){Object.assign(payload,{hoa_community_id:state.communityId,hoa_title:document.getElementById('hoaTitle').value.trim(),hoa_item_type:document.getElementById('hoaType').value,hoa_priority:document.getElementById('hoaPriority').value,hoa_area:document.getElementById('hoaArea').value,hoa_directed_to:(document.getElementById('hoaDirected')||{}).value||'',hoa_budget_source:'unassigned',hoa_photo_stage:'initial'});}
  if(isConcreteClient()){Object.assign(payload,{concrete_element:document.getElementById('concreteElement').value,concrete_stage:document.getElementById('concreteStage').value,concrete_condition:document.getElementById('concreteCondition').value,concrete_severity:document.getElementById('concreteSeverity').value,concrete_location:document.getElementById('concreteLocation').value.trim(),concrete_mix:document.getElementById('concreteMix').value.trim()});}
  const hadCoords = !!state.location;
  if (state.location) { payload.latitude=state.location.lat;payload.longitude=state.location.lng; }
  if (state.address) payload.address=state.address;
  // Commit instantly: clear the form and hand the upload to the background.
  captureLocationGeneration++;
  state.photoFile = null; state._note = ''; state.location = null; state.address = null; state._locationPromise = null;
  state._dims = freshDims(); state._measure = null;
  renderCapture();
  toast('Saved');
  void enqueueUpload(payload, hadCoords);
}

// ================= HOA Maintenance Pro =================
const HOA_STATUS_LABELS={new:'New',investigating:'Investigating',getting_pricing:'Getting Pricing',board_decision:'Board Decision Needed',on_hold:'On Hold',approved:'Approved',scheduled:'Scheduled',work_in_progress:'Work In Progress',waiting_vendor:'Waiting for Vendor',waiting_management:'Waiting for Management',waiting_board:'Waiting for Board',work_done:'Work Done',needs_review:'Needs Review',completed:'Completed',deferred:'Deferred',cancelled:'Cancelled'};
const HOA_PRIORITY_LABELS={emergency:'Emergency',high:'High',routine:'Routine',monitor:'Monitor'};
const HOA_TYPE_LABELS={maintenance:'Maintenance Issue',information:'Information Request',inspection:'Inspection Finding'};
function optsFrom(map,current){return Object.entries(map).map(([v,l])=>`<option value="${v}" ${v===current?'selected':''}>${l}</option>`).join('');}
async function renderHoaAssets(){await loadHoaContext();const body=document.getElementById('body');body.className='workflow-organize';body.innerHTML=`<div class="workflow-intro"><strong>Physical Asset Photo Registry</strong><span>Create a visual record of the things the community maintains, then add condition, damage, repair, and verification photos over time.</span></div><details class="pair-builder"><summary><span>Communities</span></summary><p class="status">Communities organize asset photos and inspection routes. This is not a general HOA directory.</p><label>Community Name</label><input id="haCommunityName"><label>Property Address</label><input id="haCommunityAddress"><button class="btn secondary" id="haAddCommunity">Add Community</button></details><details class="pair-builder" open><summary><span>Photograph a New Asset</span></summary><label>Community</label><select id="haCommunity"><option value="">Select Community</option>${state.communities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><label>Asset Name</label><input id="haName" placeholder="North entrance monument"><label>Asset Type</label><input id="haType" placeholder="Monument, light, gate, fence, playground..."><label>Exact Location</label><input id="haLocation" placeholder="North entrance, east side"><label>Current Condition</label><select id="haCondition"><option value="not_assessed">Not Assessed</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="critical">Critical</option></select><label>Required Identity Photo</label><input id="haPhoto" type="file" accept="image/*" capture="environment"><label>Photo Note</label><textarea id="haNote" placeholder="What identifies this asset or its current condition?"></textarea><button class="btn" id="haCreate">Save Asset Photo Record</button></details><div class="formhead">Asset Photo Records</div><label>Community</label><select id="haFilter"><option value="">All Communities</option>${state.communities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><div id="haList"><p class="status">Loading assets...</p></div>`;document.getElementById('haAddCommunity').onclick=async()=>{const name=document.getElementById('haCommunityName').value.trim();if(!name)return toast('Enter a community name');const r=await api('/api/hoa/communities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,address:document.getElementById('haCommunityAddress').value.trim()})});if(r.ok){toast('Community added');renderHoaAssets();}else toast('Community could not be added');};document.getElementById('haCreate').onclick=createHoaAsset;document.getElementById('haFilter').onchange=loadHoaAssets;loadHoaAssets();}
async function loadHoaAssets(){const box=document.getElementById('haList');if(!box)return;const id=(document.getElementById('haFilter')||{}).value||'',r=await api('/api/hoa/assets'+(id?'?community_id='+encodeURIComponent(id):''));if(!r.ok){box.innerHTML='<p class="status">Assets could not be loaded.</p>';return;}const rows=await r.json();box.innerHTML=rows.length?rows.map(a=>`<article class="card asset-card">${a.photo_path?`<img src="${photoSrc(a.photo_path)}" alt="${esc(a.name)}">`:''}<strong>${esc(a.name)}</strong><div>${esc(a.asset_type)} · ${esc(String(a.condition).replace('_',' '))}</div><div class="meta">${esc(a.community_name)} · ${esc(a.location_description||'Location not entered')} · ${a.photo_count} photo${a.photo_count===1?'':'s'}</div><button class="btn secondary slim" data-asset="${a.id}">Open Photo History</button></article>`).join(''):'<p class="empty">No physical assets have been photographed yet.</p>';box.querySelectorAll('[data-asset]').forEach(b=>b.onclick=()=>{state.hoaAssetId=Number(b.dataset.asset);state.view='hoa-asset';renderApp();});}
async function createHoaAsset(){const file=document.getElementById('haPhoto').files[0],community=document.getElementById('haCommunity').value,name=document.getElementById('haName').value.trim();if(!community||!name||!file)return toast('Select a community, name the asset, and take its identity photo');const fd=new FormData();fd.append('community_id',community);fd.append('name',name);fd.append('asset_type',document.getElementById('haType').value.trim());fd.append('location_description',document.getElementById('haLocation').value.trim());fd.append('condition',document.getElementById('haCondition').value);fd.append('note',document.getElementById('haNote').value.trim());fd.append('photo',file);const btn=document.getElementById('haCreate');btn.disabled=true;btn.textContent='Saving Photo...';const r=await api('/api/hoa/assets',{method:'POST',body:fd});if(r.ok){const a=await r.json();toast('Asset photo record saved');state.hoaAssetId=a.id;state.view='hoa-asset';renderApp();}else{toast('Asset could not be saved');btn.disabled=false;btn.textContent='Save Asset Photo Record';}}
async function renderHoaAsset(id){const r=await api(`/api/hoa/assets/${id}`);if(!r.ok){toast('Asset could not be loaded');state.view='hoa-assets';return renderApp();}const d=await r.json(),a=d.asset,body=document.getElementById('body');body.innerHTML=`<button class="backlink" id="haBack">← Back to Assets</button><div class="workflow-intro"><strong>${esc(a.name)}</strong><span>${esc(a.community_name)} · ${esc(a.asset_type)} · ${esc(a.location_description||'Location not entered')}</span></div><div class="formhead">Photo-Based Condition History</div><div class="organize-form-grid">${d.photos.map(p=>`<article class="card"><strong>${esc(p.photo_type)}</strong><div class="photo-title">${esc(p.photo_title||'Untitled photo')}</div><img src="${photoSrc(p.photo_path)}" alt="Asset documentation">${photoLocationHtml(p)}<div class="meta">${new Date(p.created_at).toLocaleString(uiLocale())}</div>${p.note?`<div>${esc(p.note)}</div>`:''}</article>`).join('')}</div><details class="pair-builder" open><summary><span>Add Current Condition Photo</span></summary><label>Photo Purpose</label><select id="hapType"><option value="condition">Condition Update</option><option value="damage">Damage</option><option value="repair">Repair Progress</option><option value="verification">Repair Verification</option><option value="identity">Updated Identity Photo</option></select><label>Current Condition</label><select id="hapCondition"><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option><option value="critical">Critical</option><option value="not_assessed">Not Assessed</option></select><input id="hapPhoto" type="file" accept="image/*" capture="environment"><label>Photo Note</label><textarea id="hapNote"></textarea><button class="btn" id="hapAdd">Add Photo to Asset History</button></details>`;document.getElementById('hapCondition').value=a.condition;document.getElementById('haBack').onclick=()=>{state.view='hoa-assets';renderApp();};document.getElementById('hapAdd').onclick=()=>addHoaAssetPhoto(id);}
async function addHoaAssetPhoto(id){const file=document.getElementById('hapPhoto').files[0];if(!file)return toast('Take or choose a photo');const fd=new FormData();fd.append('photo',file);fd.append('photo_type',document.getElementById('hapType').value);fd.append('condition',document.getElementById('hapCondition').value);fd.append('note',document.getElementById('hapNote').value.trim());const r=await api(`/api/hoa/assets/${id}/photos`,{method:'POST',body:fd});if(r.ok){toast('Photo added to asset history');renderHoaAsset(id);}else toast('Photo could not be added');}

async function renderHoaInspections(){await loadHoaContext();const [rr,ar]=await Promise.all([api('/api/hoa/routes'),api('/api/hoa/assets')]),routes=rr.ok?await rr.json():[],assets=ar.ok?await ar.json():[],body=document.getElementById('body');body.innerHTML=`<div class="workflow-intro"><strong>Photo Inspection Routes</strong><span>Define where to go and which photographic views must be captured. Each route becomes a guided Property Visit.</span></div><details class="pair-builder" open><summary><span>Create an Inspection Route</span></summary><label>Community</label><select id="hirCommunity"><option value="">Select Community</option>${state.communities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><label>Route Name</label><input id="hirName" placeholder="Monthly common-area inspection"><label>Route Instructions</label><textarea id="hirInstructions" placeholder="Start at the north entrance and walk clockwise."></textarea><label>Inspection Stops</label><p class="status">Enter one stop per line. Use a vertical bar to add required views, for example: North monument | overview, close-up, opposite side</p><textarea id="hirStops" rows="8" placeholder="North entrance monument | overview, close-up&#10;Pool gate | front, latch, hinges&#10;Playground | overview, equipment close-ups"></textarea><button class="btn" id="hirCreate">Create Photo Route</button></details><div class="formhead">Available Routes</div><div>${routes.length?routes.map(r=>`<article class="card"><strong>${esc(r.name)}</strong><div>${esc(r.community_name)}</div><div class="meta">${r.stop_count} photographic stop${r.stop_count===1?'':'s'}</div><button class="btn" data-start-route="${r.id}">Start Property Visit</button></article>`).join(''):'<p class="empty">No inspection routes have been created yet.</p>'}</div>`;document.getElementById('hirCreate').onclick=createHoaRoute;body.querySelectorAll('[data-start-route]').forEach(b=>b.onclick=()=>startHoaVisit(Number(b.dataset.startRoute)));}
async function createHoaRoute(){const raw=document.getElementById('hirStops').value.split(/\n/).map(x=>x.trim()).filter(Boolean),stops=raw.map(line=>{const [name,views]=line.split('|');return{name:name.trim(),required_views:(views||'overview').split(',').map(v=>v.trim()).filter(Boolean)};});const body={community_id:document.getElementById('hirCommunity').value,name:document.getElementById('hirName').value.trim(),instructions:document.getElementById('hirInstructions').value.trim(),stops};if(!body.community_id||!body.name||!stops.length)return toast('Select a community, name the route, and add at least one stop');const r=await api('/api/hoa/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(r.ok){toast('Photo inspection route created');renderHoaInspections();}else toast('Route could not be created');}
async function startHoaVisit(routeId){const r=await api('/api/hoa/visits',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({route_id:routeId})});if(!r.ok)return toast('Property visit could not be started');const visit=await r.json();state.hoaVisitId=visit.id;state.view='hoa-visit';renderApp();}
async function renderHoaVisits(){const r=await api('/api/hoa/visits'),rows=r.ok?await r.json():[],body=document.getElementById('body');body.innerHTML=`<div class="workflow-intro"><strong>Property Maintenance Visit Mode</strong><span>Follow a photo inspection route, see the next required location, and document every stop before leaving the property.</span></div><button class="btn" id="hvNew">Start a Guided Property Visit</button><div class="formhead">Property Visits</div>${rows.length?rows.map(v=>`<article class="card"><strong>${esc(v.route_name||'Property Visit')}</strong><div>${esc(v.community_name)}</div><div class="meta">${v.completed_stops}/${v.total_stops} stops photographed · ${v.status==='completed'?'Completed':'In Progress'} · ${new Date(v.started_at).toLocaleString(uiLocale())}</div><button class="btn secondary slim" data-visit="${v.id}">${v.status==='completed'?'Review Photos':'Continue Visit'}</button></article>`).join(''):'<p class="empty">No property visits yet. Create a photo inspection route, then start the visit.</p>'}`;document.getElementById('hvNew').onclick=()=>{state.view='hoa-inspections';renderApp();};body.querySelectorAll('[data-visit]').forEach(b=>b.onclick=()=>{state.hoaVisitId=Number(b.dataset.visit);state.view='hoa-visit';renderApp();});}
async function renderHoaVisit(id){const r=await api(`/api/hoa/visits/${id}`);if(!r.ok){toast('Visit could not be loaded');state.view='hoa-visits';return renderApp();}const v=await r.json(),body=document.getElementById('body'),next=v.stops.find(s=>s.status!=='complete');body.innerHTML=`<button class="backlink" id="hvBack">← Back to Visits</button><div class="workflow-intro"><strong>${esc(v.route_name||'Property Visit')}</strong><span>${esc(v.community_name)} · ${v.status==='completed'?'Visit complete':'Continue to the next photographic stop'}</span></div><div class="visit-progress"><strong>${v.stops.filter(s=>s.status==='complete').length} of ${v.stops.length} stops documented</strong></div>${next?`<section class="visit-next"><div class="formhead">Next Stop: ${esc(next.name)}</div>${next.instructions?`<p>${esc(next.instructions)}</p>`:''}<p><strong>Required views:</strong> ${next.required_views.map(esc).join(', ')}</p><p class="status">Take all required views now. You can select several photos at once.</p><input id="hvsPhotos" type="file" accept="image/*" capture="environment" multiple><label>Inspection Note</label><textarea id="hvsNote"></textarea><button class="btn" id="hvsComplete">Save Photos &amp; Complete This Stop</button></section>`:'<div class="success-box"><strong>Property visit complete.</strong><p>Every required stop has photographic documentation.</p></div>'}<div class="formhead">Visit Checklist</div>${v.stops.map(s=>`<div class="checklist-row ${s.status==='complete'?'done':''}"><strong>${s.status==='complete'?'✓':'○'} ${esc(s.name)}</strong><span>${s.status==='complete'?s.capture_ids.length+' photo(s)':'Pending'}</span></div>`).join('')}`;document.getElementById('hvBack').onclick=()=>{state.view='hoa-visits';renderApp();};if(next)document.getElementById('hvsComplete').onclick=()=>completeHoaVisitStop(v.id,next.id);}
async function completeHoaVisitStop(visitId,stopId){const files=[...document.getElementById('hvsPhotos').files];if(!files.length)return toast('Take at least one required photo');const fd=new FormData();files.forEach(f=>fd.append('photos',f));fd.append('note',document.getElementById('hvsNote').value.trim());const btn=document.getElementById('hvsComplete');btn.disabled=true;btn.textContent='Saving Photos...';const r=await api(`/api/hoa/visits/${visitId}/stops/${stopId}`,{method:'POST',body:fd});if(r.ok){toast('Inspection stop documented');renderHoaVisit(visitId);}else{toast('Photos could not be saved');btn.disabled=false;btn.textContent='Save Photos & Complete This Stop';}}
async function renderHoaMaintenance(){const body=document.getElementById('body');body.className='workflow-organize';body.innerHTML=`<div class="workflow-intro"><strong>Maintenance</strong><span>Track every issue from the first photo through completed work and final review.</span></div><div id="hoaSummary" class="statrow"></div><div class="organize-form-grid"><section class="organize-panel"><label>Community</label><select id="hoaFilterCommunity"><option value="">All Communities</option>${state.communities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><label>Status</label><select id="hoaFilterStatus"><option value="">All Open Statuses</option>${optsFrom(HOA_STATUS_LABELS,'')}</select></section><section class="organize-panel"><label>Priority</label><select id="hoaFilterPriority"><option value="">All Priorities</option>${optsFrom(HOA_PRIORITY_LABELS,'')}</select><label>Record Type</label><select id="hoaFilterType"><option value="">All Types</option>${optsFrom(HOA_TYPE_LABELS,'')}</select></section></div><div class="row compact"><input id="hoaSearch" type="search" placeholder="Search titles, notes, communities, or categories"><button class="btn secondary" id="hoaSearchBtn">Search</button></div><label style="text-transform:none;letter-spacing:0"><input id="hoaShowClosed" type="checkbox" style="width:auto"> Show completed and cancelled</label><div id="hoaItems"><p class="status">Loading maintenance items...</p></div>`;['hoaFilterCommunity','hoaFilterStatus','hoaFilterPriority','hoaFilterType','hoaShowClosed'].forEach(id=>document.getElementById(id).onchange=loadHoaItems);document.getElementById('hoaSearchBtn').onclick=loadHoaItems;document.getElementById('hoaSearch').onkeydown=e=>{if(e.key==='Enter')loadHoaItems();};loadHoaSummary();loadHoaItems();}
async function loadHoaSummary(){const box=document.getElementById('hoaSummary');if(!box)return;const r=await api('/api/hoa/dashboard');if(!r.ok)return;const d=await r.json();box.innerHTML=`${[['open','Open'],['emergency','Emergency'],['high','High Priority'],['overdue','Overdue'],['board_needed','Board Needed'],['needs_review','Needs Review']].map(([k,l])=>`<div class="stat"><strong>${d[k]||0}</strong><span>${l}</span></div>`).join('')}`;}
async function loadHoaItems(){const box=document.getElementById('hoaItems');if(!box)return;const p=new URLSearchParams(),val=id=>(document.getElementById(id)||{}).value||'';for(const [id,key] of [['hoaFilterCommunity','community_id'],['hoaFilterStatus','status'],['hoaFilterPriority','priority'],['hoaFilterType','type'],['hoaSearch','q']])if(val(id))p.set(key,val(id));if((document.getElementById('hoaShowClosed')||{}).checked)p.set('closed','1');const r=await api('/api/hoa/items?'+p);if(!r.ok){box.innerHTML='<p class="status">Maintenance items could not be loaded.</p>';return;}const rows=await r.json();box.innerHTML=rows.length?rows.map(hoaItemCard).join(''):'<p class="empty">No maintenance items match this view.</p>';box.querySelectorAll('[data-hoa-item]').forEach(b=>b.onclick=()=>renderHoaItem(Number(b.dataset.hoaItem)));}
function hoaItemCard(i){const priority=i.priority||'routine';return `<article class="card" style="border-left:6px solid ${priority==='emergency'?'#b3261e':priority==='high'?'#e18a00':priority==='monitor'?'#6b7280':'#2455d9'}">${i.photo_path?`<img src="${photoSrc(i.photo_path)}" alt="Maintenance issue">`:''}<div class="row"><div><strong>${esc(i.title)}</strong><div class="meta">${esc(i.community_name)} · ${esc(i.area)}</div></div><span class="badge">${HOA_PRIORITY_LABELS[priority]}</span></div><div class="meta">${HOA_TYPE_LABELS[i.item_type]||i.item_type} · ${HOA_STATUS_LABELS[i.status]||i.status}${i.target_date?' · Due '+new Date(i.target_date+'T12:00:00').toLocaleDateString(uiLocale()):''}</div><div>${esc(i.description||'')}</div><div class="meta">${i.primary_assignee?'Assigned to '+esc(i.primary_assignee):'Not yet assigned'} · ${String(i.budget_source||'unassigned').replace('_',' ')}</div><button class="btn secondary slim" data-hoa-item="${i.id}">Open Maintenance Record</button></article>`;}
async function renderHoaItem(id){const r=await api(`/api/hoa/items/${id}`);if(!r.ok){toast('Maintenance record could not be loaded');return;}const d=await r.json(),i=d.item,body=document.getElementById('body');body.innerHTML=`<button class="backlink" id="hoaItemBack">← Back to Maintenance</button><div class="workflow-intro"><strong>${esc(i.title)}</strong><span>${esc(i.community_name)} · Reported ${new Date(i.created_at).toLocaleString(uiLocale())}</span></div>${i.photo_path?`<div class="photo-box"><img src="${photoSrc(i.photo_path)}" alt="Maintenance issue" style="display:block"></div>`:''}<div class="organize-form-grid"><section class="organize-panel"><label>Title</label><input id="hiTitle" value="${esc(i.title)}"><label>Description</label><textarea id="hiDescription">${esc(i.description||'')}</textarea><label>Category</label><select id="hiArea">${HOA_AREAS.map(a=>`<option ${a===i.area?'selected':''}>${esc(a)}</option>`).join('')}</select><label>Primary Assignee</label><input id="hiAssignee" value="${esc(i.primary_assignee||'')}"><label>Directed To</label><input id="hiDirected" value="${esc(i.directed_to||'')}"></section><section class="organize-panel"><label>Status</label><select id="hiStatus">${optsFrom(HOA_STATUS_LABELS,i.status)}</select><label>Priority</label><select id="hiPriority">${optsFrom(HOA_PRIORITY_LABELS,i.priority)}</select><label>Target Completion Date</label><input id="hiTarget" type="date" value="${i.target_date?String(i.target_date).slice(0,10):''}"><label>Budget Source</label><select id="hiBudget"><option value="unassigned">Unassigned</option><option value="operating" ${i.budget_source==='operating'?'selected':''}>Operating Budget</option><option value="reserve" ${i.budget_source==='reserve'?'selected':''}>Reserve Budget</option><option value="board_determination" ${i.budget_source==='board_determination'?'selected':''}>Board Determination Needed</option></select><div class="row compact"><div><label>Estimated Cost</label><input id="hiEstimated" type="number" step="0.01" value="${i.estimated_cost||''}"></div><div><label>Actual Cost</label><input id="hiActual" type="number" step="0.01" value="${i.actual_cost||''}"></div></div><label>Board Approval</label><select id="hiApproval"><option value="not_required">Not Required</option><option value="requested">Requested</option><option value="agenda">On Meeting Agenda</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="deferred">Deferred</option><option value="more_information">More Information Requested</option></select><label>Vendor or Completed By</label><input id="hiCompletedBy" value="${esc(i.completed_by||'')}" placeholder="Required before completion"><label>Completion Date</label><input id="hiCompletion" type="date" value="${i.completion_date?String(i.completion_date).slice(0,10):''}"></section></div><button class="btn" id="hoaItemSave">Save Maintenance Record</button><div class="formhead">Activity History</div><div>${d.history.map(h=>`<div style="border-bottom:1px solid #ddd;padding:8px 0"><strong>${esc(h.action==='created'?'Created':'Updated')}</strong><div class="meta">${esc(h.user_name||'System')} · ${new Date(h.created_at).toLocaleString(uiLocale())}${h.detail&&h.detail.fields?' · '+esc(h.detail.fields.join(', ')):''}</div></div>`).join('')}</div>`;document.getElementById('hiApproval').value=i.board_approval;document.getElementById('hoaItemBack').onclick=renderHoaMaintenance;document.getElementById('hoaItemSave').onclick=()=>saveHoaItem(id);}
const renderHoaItemCore=renderHoaItem;
renderHoaItem=async function(id){await renderHoaItemCore(id);const r=await api(`/api/hoa/items/${id}`);if(!r.ok)return;const d=await r.json(),body=document.getElementById('body'),oldPhoto=body.querySelector('.photo-box');if(oldPhoto)oldPhoto.remove();const intro=body.querySelector('.workflow-intro');if(!intro)return;const photos=d.photos||[],before=photos.find(p=>['initial','inspection'].includes(p.photo_stage))||photos[0],after=[...photos].reverse().find(p=>['completed_work','final_verification'].includes(p.photo_stage)),comparison=before&&after&&before.id!==after.id?`<div class="formhead">Before & After Maintenance Evidence</div><div class="evidence-comparison"><article class="card"><strong>Original Condition</strong><img src="${photoSrc(before.photo_path)}" alt="Original maintenance condition">${photoLocationHtml(before)}${before.note?`<div>${esc(before.note)}</div>`:''}</article><article class="card"><strong>Completed / Verified</strong><img src="${photoSrc(after.photo_path)}" alt="Completed maintenance work">${photoLocationHtml(after)}${after.note?`<div>${esc(after.note)}</div>`:''}</article></div>`:'';intro.insertAdjacentHTML('afterend',`${comparison}<div class="formhead">Photo Documentation Timeline</div><div class="organize-form-grid">${photos.map(p=>`<article class="card"><strong>${esc(String(p.photo_stage||'photo').replaceAll('_',' '))}</strong>${p.photo_path?`<img src="${photoSrc(p.photo_path)}" alt="Maintenance documentation">`:''}${photoLocationHtml(p)}<div class="meta">${new Date(p.created_at).toLocaleString(uiLocale())}</div>${p.note?`<div>${esc(p.note)}</div>`:''}</article>`).join('')}</div><details class="pair-builder"><summary><span>Add Documentation Photo</span></summary><label>Photo Stage</label><select id="hoaPhotoStage"><option value="inspection">Inspection</option><option value="work_in_progress">Work In Progress</option><option value="completed_work">Completed Work</option><option value="final_verification">Final Verification</option><option value="follow_up">Follow-Up Monitoring</option></select><input id="hoaItemPhoto" type="file" accept="image/*" capture="environment"><label>Photo Note</label><textarea id="hoaItemPhotoNote"></textarea><button class="btn" id="hoaAddPhoto">Add Photo to Timeline</button></details><details class="pair-builder"><summary><span>Request Completion Photos</span></summary><p class="status">Create a private 14-day link. A contractor or other outside person can photograph the completed work without receiving access to Photo Notes.</p><label>Recipient Name</label><input id="hoaCompletionName" placeholder="Person completing the work"><button class="btn" id="hoaCompletionCreate">Create Photo Submission Link</button><div id="hoaCompletionResult"></div></details>`);document.getElementById('hoaAddPhoto').onclick=()=>addHoaItemPhoto(id);document.getElementById('hoaCompletionCreate').onclick=()=>createHoaCompletionRequest(id);};
async function createHoaCompletionRequest(id){const r=await api(`/api/hoa/items/${id}/completion-request`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipient_name:document.getElementById('hoaCompletionName').value.trim()})}),d=await r.json().catch(()=>({}));if(!r.ok)return toast('Photo request link could not be created');const box=document.getElementById('hoaCompletionResult');box.innerHTML=`<label>Private Photo Link</label><div class="row compact"><input id="hoaCompletionUrl" readonly value="${esc(d.url)}"><button class="btn secondary" id="hoaCompletionCopy">Copy Link</button></div><p class="status">Send this link to the person who will photograph the completed work.</p>`;document.getElementById('hoaCompletionCopy').onclick=async()=>{await navigator.clipboard.writeText(d.url);toast('Photo link copied');};}
async function addHoaItemPhoto(id){const file=document.getElementById('hoaItemPhoto').files[0];if(!file){toast('Choose a photo first');return;}const fd=new FormData();fd.append('photo',file);fd.append('photo_stage',document.getElementById('hoaPhotoStage').value);fd.append('note',document.getElementById('hoaItemPhotoNote').value.trim());const btn=document.getElementById('hoaAddPhoto');btn.disabled=true;btn.textContent='Uploading...';const r=await api(`/api/hoa/items/${id}/photos`,{method:'POST',body:fd});if(r.ok){toast('Documentation photo added');renderHoaItem(id);}else{toast('Photo could not be added');btn.disabled=false;btn.textContent='Add Photo to Timeline';}}
async function saveHoaItem(id){const v=x=>document.getElementById(x).value,body={title:v('hiTitle'),description:v('hiDescription'),area:v('hiArea'),primary_assignee:v('hiAssignee'),directed_to:v('hiDirected'),status:v('hiStatus'),priority:v('hiPriority'),target_date:v('hiTarget'),budget_source:v('hiBudget'),estimated_cost:v('hiEstimated'),actual_cost:v('hiActual'),board_approval:v('hiApproval'),completed_by:v('hiCompletedBy'),completion_date:v('hiCompletion')};const r=await api(`/api/hoa/items/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),d=await r.json().catch(()=>({}));if(!r.ok){toast(d.error==='completed by required'?'Enter Vendor or Completed By before completing':'Maintenance record could not be saved');return;}toast('Maintenance record saved');renderHoaItem(id);}
async function renderHoaCommunities(){await loadHoaContext();const body=document.getElementById('body');body.innerHTML=`<div class="workflow-intro"><strong>Communities</strong><span>Manage the HOAs and neighborhoods served by ${esc(state.hoaCompany&&state.hoaCompany.name||'your management company')}.</span></div><details class="pair-builder"><summary><span>Management Company &amp; Team</span></summary><label>Management Company Name</label><div class="row compact"><input id="hcCompanyName" value="${esc(state.hoaCompany&&state.hoaCompany.name||'')}"><button class="btn secondary" id="hcSaveCompany">Save</button></div><div class="formhead">Team Members</div>${state.hoaMembers.map(m=>`<div class="card"><strong>${esc(m.name)}</strong><div class="meta">${esc(m.email)} · ${esc(m.company_role)}</div></div>`).join('')}<label>Add Existing HOA Maintenance Pro User</label><div class="row compact"><input id="hcMemberEmail" type="email" placeholder="Employee email"><button class="btn secondary" id="hcAddMember">Add</button></div></details><details class="pair-builder" open><summary><span>Add a Community</span></summary><label>Community Name</label><input id="hcName"><label>Full Address</label><input id="hcAddress"><label>Community Manager</label><input id="hcManager"><button class="btn" id="hcCreate">Add Community</button></details><div>${state.communities.length?state.communities.map(c=>`<article class="card"><strong>${esc(c.name)}</strong><div>${esc(c.address||'No address entered')}</div><div class="meta">Manager: ${esc(c.manager_name||'Not assigned')} · ${c.open_items||0} open maintenance items</div></article>`).join(''):'<p class="empty">No communities have been added yet.</p>'}</div>`;document.getElementById('hcSaveCompany').onclick=async()=>{const r=await api('/api/hoa/company',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:document.getElementById('hcCompanyName').value.trim()})});if(r.ok){toast('Company name saved');await loadHoaContext();renderHoaCommunities();}else toast('Company name could not be saved');};document.getElementById('hcAddMember').onclick=async()=>{const email=document.getElementById('hcMemberEmail').value.trim();const r=await api('/api/hoa/members',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})}),d=await r.json().catch(()=>({}));if(r.ok){toast('Team member added');await loadHoaContext();renderHoaCommunities();}else toast(d.error||'Team member could not be added');};document.getElementById('hcCreate').onclick=async()=>{const name=document.getElementById('hcName').value.trim();if(!name){toast('Enter a community name');return;}const r=await api('/api/hoa/communities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,address:document.getElementById('hcAddress').value.trim(),manager_name:document.getElementById('hcManager').value.trim()})});if(r.ok){toast('Community added');await loadHoaContext();renderHoaCommunities();}else toast('Community could not be added');};}
async function renderHoaDashboard(){const body=document.getElementById('body');body.innerHTML=`<div class="workflow-intro"><strong>Management Dashboard</strong><span>Urgent work and accountability across every community.</span></div><div id="hoaDashStats" class="statrow"></div><div class="formhead">Notifications</div><button class="btn secondary slim" id="hoaReadAll">Mark All Read</button><div id="hoaNotifications"><p class="status">Loading notifications...</p></div>`;const [dr,nr]=await Promise.all([api('/api/hoa/dashboard'),api('/api/hoa/notifications')]);if(dr.ok){const d=await dr.json();document.getElementById('hoaDashStats').innerHTML=[['mine','Assigned to Me'],['emergency','Emergency'],['high','High Priority'],['overdue','Overdue'],['board_needed','Board Needed'],['needs_review','Needs Review'],['open','All Open']].map(([k,l])=>`<div class="stat"><strong>${d[k]||0}</strong><span>${l}</span></div>`).join('');}if(nr.ok){const n=await nr.json();document.getElementById('hoaNotifications').innerHTML=n.length?n.map(x=>`<div class="card ${x.read_at?'':'notification-unread'}"><strong>${esc(x.message)}</strong><div class="meta">${new Date(x.created_at).toLocaleString(uiLocale())}</div></div>`).join(''):'<p class="empty">No notifications yet.</p>';}document.getElementById('hoaReadAll').onclick=async()=>{await api('/api/hoa/notifications/read',{method:'POST'});renderHoaDashboard();};}
async function renderHoaReports(){const body=document.getElementById('body');body.innerHTML=`<div class="workflow-intro"><strong>Maintenance Reports</strong><span>Create board-ready reports in which every finding is backed by a property photo.</span></div><div class="row"><button class="btn secondary" id="hoaReportPdf">Board Photo Report PDF</button><button class="btn secondary" id="hoaReportWord">Board Photo Report Word</button><button class="btn secondary" id="hoaPrintReport">Print Current Report</button></div><label>Community</label><select id="hrCommunity"><option value="">All Communities</option>${state.communities.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><label>Budget Source</label><select id="hrBudget"><option value="">All Budget Sources</option><option value="operating">Operating</option><option value="reserve">Reserve</option><option value="board_determination">Board Determination Needed</option><option value="unassigned">Unassigned</option></select><label style="text-transform:none;letter-spacing:0"><input id="hrClosed" type="checkbox" style="width:auto"> Include completed work</label><div id="hoaReportItems"></div>`;for(const id of ['hrCommunity','hrBudget','hrClosed'])document.getElementById(id).onchange=loadHoaReport;document.getElementById('hoaReportPdf').onclick=()=>exportHoaBoardReport('pdf');document.getElementById('hoaReportWord').onclick=()=>exportHoaBoardReport('docx');document.getElementById('hoaPrintReport').onclick=()=>window.print();loadHoaReport();}
async function loadHoaReport(){const p=new URLSearchParams(),community=document.getElementById('hrCommunity').value,budget=document.getElementById('hrBudget').value;if(community)p.set('community_id',community);if(budget)p.set('budget',budget);if(document.getElementById('hrClosed').checked)p.set('closed','1');const r=await api('/api/hoa/items?'+p),box=document.getElementById('hoaReportItems');if(!r.ok)return;const rows=await r.json();box.innerHTML=`<div class="formhead">${rows.length} Maintenance Items</div>${rows.map(hoaItemCard).join('')}`;box.querySelectorAll('[data-hoa-item]').forEach(b=>b.onclick=()=>renderHoaItem(Number(b.dataset.hoaItem)));}
async function exportHoaBoardReport(format){const p=new URLSearchParams({doc:format}),community=document.getElementById('hrCommunity').value,budget=document.getElementById('hrBudget').value;if(community)p.set('community_id',community);if(budget)p.set('budget',budget);if(document.getElementById('hrClosed').checked)p.set('closed','1');const button=document.getElementById(format==='docx'?'hoaReportWord':'hoaReportPdf');button.disabled=true;button.textContent='Preparing...';try{const r=await api('/api/hoa/report?'+p);if(!r.ok)throw new Error();const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`hoa-board-photo-maintenance-report.${format}`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Board photo report ready');}catch(e){toast('Board photo report could not be created');}finally{button.disabled=false;button.textContent=format==='docx'?'Board Photo Report Word':'Board Photo Report PDF';}}

// ---- rotate + note editing (shared) ----
async function rotatePhoto(id, dir) {
  try {
    const r = await api(`/api/captures/${id}/rotate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir }),
    });
    if (!r.ok) throw new Error('bad');
    state.imgv++; // bust the image cache so the rotated photo shows
    if (state.view === 'create' && state.groupId) renderGroupDetail(state.groupId);
    else loadCards(document.getElementById('filter') ? (document.getElementById('filter').value || '') : '');
  } catch (e) { toast('Rotate failed'); }
}

function rotateButtons(id) {
  return `
    <button class="iconbtn rotccw" data-id="${id}" title="Rotate left 90°">↺ 90°</button>
    <button class="iconbtn rotcw" data-id="${id}" title="Rotate right 90°">↻ 90°</button>
    <button class="iconbtn flipphoto" data-id="${id}" title="Flip photo horizontally">↔ Flip</button>`;
}
function wireRotate(container) {
  container.querySelectorAll('.rotccw').forEach(b => b.onclick = () => rotatePhoto(parseInt(b.getAttribute('data-id'), 10), 'ccw'));
  container.querySelectorAll('.rotcw').forEach(b => b.onclick = () => rotatePhoto(parseInt(b.getAttribute('data-id'), 10), 'cw'));
  container.querySelectorAll('.flipphoto').forEach(b => b.onclick = () => rotatePhoto(parseInt(b.getAttribute('data-id'), 10), 'flip'));
}

async function saveNote(id, text, after) {
  const r = await api(`/api/captures/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: text }),
  });
  if (r.ok) { toast('Note saved'); if (after) after(); }
  else toast('Save failed');
}

async function editCaptureAddress(c) {
  const next = prompt(uiT('Enter the complete address, including street number, city, state, and ZIP:'), c.address || '');
  if (next == null) return;
  const address = next.trim();
  if (!address) { toast('Enter a complete address'); return; }
  const r = await api(`/api/captures/${c.id}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ address }),
  });
  if (r.ok) { toast('Address saved'); loadCards((document.getElementById('filter') || {}).value || ''); }
  else toast('Address could not be saved');
}

// ---- Library (saved captures) ----
async function renderList() {
  const body = document.getElementById('body');
  body.className = 'workflow-organize';
  body.innerHTML = `
    <div class="workflow-intro organize-intro"><strong>Organize your Photo Notes</strong><span>Find the photos you need, select them, and choose what you want to do with them.</span></div>

    <section class="organize-workspace-section organize-context-section">
      <div class="organize-step-head"><span class="organize-step-number">1</span><div><h2>Choose a job</h2><p>Show Photo Notes from one job, review its timeline, or create a new job.</p></div></div>
      <details class="pair-builder organize-job-builder" open><summary><span>Job controls</span><span class="pair-expand">Open or close</span></summary>
        <div class="organize-form-grid"><section class="organize-panel"><label>Current Job</label><select id="jobFilter"><option value="">All Jobs</option>${state.jobs.map(j=>`<option value="${j.id}">${esc(j.job_number?j.job_number+' — '+j.name:j.name)} (${j.photo_count||0})</option>`).join('')}</select><button class="btn secondary slim" id="timelineBtn" type="button">View Job Timeline</button>${isPavingClient()?`<div id="pavingReadiness" class="evidence-readiness">Choose a job to check its photo evidence.</div><div class="row compact" style="margin-top:8px"><button class="btn secondary slim" id="pavingJobPdf" type="button">Job Evidence PDF</button><button class="btn secondary slim" id="pavingJobWord" type="button">Job Evidence Word</button></div>`:''}</section>
        <section class="organize-panel"><label>Create a New Job</label><input id="newJobName" placeholder="Job name"><div class="row compact"><input id="newJobNumber" placeholder="Job number"><input id="newJobCustomer" placeholder="Customer"></div><input id="newJobAddress" placeholder="Job address"><button class="btn secondary slim" id="createJobBtn" type="button">Create Job</button></section></div>
      </details>
    </section>

    <section class="organize-workspace-section organize-search-section">
      <div class="organize-step-head"><span class="organize-step-number">2</span><div><h2>Find Photo Notes</h2><p>Filter by topic or search the details saved with each photo.</p></div></div>
      <div class="organize-search-grid">
        <div><label>Filter by Topic</label><select id="filter"><option value="">All Topics</option>${state.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div>
        <div class="organize-search-box"><label>Search Photo Notes</label><div class="row compact"><input id="photoSearch" type="search" placeholder="Notes, jobs, customers, addresses, topics, dates, or defects"><button class="btn" id="photoSearchBtn" type="button">Search</button><button class="btn secondary" id="photoSearchClear" type="button">Clear</button></div></div>
      </div>
      <details class="organize-search-filters"><summary>More search filters</summary><div class="row compact"><input id="searchFrom" type="date" title="From date"><input id="searchTo" type="date" title="To date"></div><label style="text-transform:none;letter-spacing:0"><input id="searchMissingAddress" type="checkbox" style="width:auto"> Missing address only</label></details>
      <div class="status" id="photoSearchStatus"></div>
    </section>

    <section class="organize-workspace-section organize-actions-section">
      <div class="organize-step-head"><span class="organize-step-number">3</span><div><h2>Work with selected Photo Notes</h2><p>Select photos in the library below, then use only the action you need.</p></div></div>
      <div class="organize-selection-toolbar" aria-label="Photo Note selection controls">
        <strong>Selection</strong>
        <div class="organize-action-row"><button class="btn secondary" id="selall">Select All</button><button class="btn secondary" id="selnone">Clear Selection</button><button class="btn secondary" id="compareSelected">Compare 2 Photos</button>${featureOn('measurements') ? `<button class="btn secondary" id="classifybatch">Classify Selected (AI)</button>` : ''}</div>
      </div>
      ${beforeAfterOn() ? `<div class="status" id="classifyprog"></div><details class="pair-builder"><summary><span>Before &amp; After Photos</span><span class="pair-expand">Create a comparison</span></summary><p>When work is complete, select one photo from before the job and one photo from after the job. The older photo will be marked Before by default.</p><button class="btn secondary slim" id="pairbtn">Create Pair From 2 Selected Photos</button></details>` : ''}

    <div class="organize-form-grid organize-batch-grid">
      <section class="organize-panel">
        <label>File Selected Under a Topic</label>
        <div class="row compact">
          <select id="bulktopic"><option value="">Choose Topic</option>${state.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
          <button class="btn secondary" id="applytopic">Add Topic</button>
          <button class="btn secondary" id="replacetopic">Replace Topics</button>
        </div>
        <div class="row compact" style="margin-top:8px">
          <input id="organizenewtopic" type="text" placeholder="Create a new topic...">
          <button class="btn secondary" id="createtopic">Create</button>
        </div>
      </section>

      <section class="organize-panel">
        <label>Add Selected to a Document</label>
        <div class="row compact">
          <select id="groupsel" style="flex:1"><option value="">Choose Document</option></select>
          <button class="btn secondary" id="addtogroup">Add</button>
        </div>
        <input id="newgroupname" type="text" placeholder="...or type a new document title" style="margin-top:8px" />
      </section>

      <section class="organize-panel">
        <label>Apply Batch Changes</label>
        <select id="batchJob"><option value="">Move to Job...</option>${state.jobs.map(j=>`<option value="${j.id}">${esc(j.name)}</option>`).join('')}</select>
        <select id="batchTemplate" style="margin-top:8px"><option value="">Apply Annotation Template...</option><option value="date_address">Date + Address</option><option value="evidence">Evidence Details</option><option value="copyright">Copyright Only</option></select>
        <button class="btn secondary slim" id="runBatch" type="button">Apply Batch Changes</button>
      </section>
    </div>
    </section>

    ${featureOn('measurements') ? `<div class="organize-footer-actions"><button class="btn secondary" id="openmap">Open Job Site Map</button></div>` : ''}

    <div class="organize-library-heading"><div><span class="organize-library-kicker">Your library</span><h2>Current Photo Notes</h2></div><p>Saved Photo Notes appear here. Select any photos you want to organize or compare.</p></div>
    <div id="cards"></div>`;
  document.getElementById('filter').onchange = e => runSmartSearch();
  const runSearch=()=>runSmartSearch();
  document.getElementById('photoSearchBtn').onclick=runSearch;
  document.getElementById('photoSearch').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();runSearch();}};
  document.getElementById('photoSearchClear').onclick=()=>{document.getElementById('photoSearch').value='';document.getElementById('searchFrom').value='';document.getElementById('searchTo').value='';document.getElementById('searchMissingAddress').checked=false;runSmartSearch();};
  document.getElementById('selall').onclick = () => document.querySelectorAll('.capchk').forEach(c => { c.checked = true; state.selectedIds.add(String(c.value)); });
  document.getElementById('selnone').onclick = () => { state.selectedIds.clear(); document.querySelectorAll('.capchk').forEach(c => c.checked = false); };
  document.getElementById('applytopic').onclick = applyTopicToSelected;
  document.getElementById('replacetopic').onclick = replaceTopicsOnSelected;
  document.getElementById('createtopic').onclick = createOrganizeTopic;
  document.getElementById('addtogroup').onclick = addSelectedToGroup;
  document.getElementById('createJobBtn').onclick=createJob;
  document.getElementById('jobFilter').onchange=()=>{runSmartSearch();loadPavingReadiness();};
  document.getElementById('timelineBtn').onclick=showSelectedJobTimeline;
  const pavingPdf=document.getElementById('pavingJobPdf');if(pavingPdf)pavingPdf.onclick=()=>exportPavingJobEvidence('pdf');
  const pavingWord=document.getElementById('pavingJobWord');if(pavingWord)pavingWord.onclick=()=>exportPavingJobEvidence('docx');
  document.getElementById('compareSelected').onclick=compareSelectedPhotos;
  document.getElementById('runBatch').onclick=runBatchChanges;
  const cb = document.getElementById('classifybatch');
  if (cb) cb.onclick = classifySelected;
  const pb = document.getElementById('pairbtn');
  if (pb) pb.onclick = pairSelected;
  const om = document.getElementById('openmap'); if (om) om.onclick = () => { state.view = 'map'; renderApp(); };
  loadGroupOptions();
  loadCards('');
}

function selectedCaptureIds(){return Array.from(state.selectedIds).map(Number).filter(Number.isInteger);}
function runSmartSearch(){
  const area=(document.getElementById('filter')||{}).value||'',q=(document.getElementById('photoSearch')||{}).value||'',job=(document.getElementById('jobFilter')||{}).value||'',from=(document.getElementById('searchFrom')||{}).value||'',to=(document.getElementById('searchTo')||{}).value||'',missing=!!((document.getElementById('searchMissingAddress')||{}).checked);
  loadCards(area,q.trim(),{job,from,to,missing});
}
async function exportPavingJobEvidence(format){const id=(document.getElementById('jobFilter')||{}).value;if(!id){toast('Choose a job first');return;}const button=document.getElementById(format==='docx'?'pavingJobWord':'pavingJobPdf');if(button){button.disabled=true;button.textContent='Preparing...';}try{const r=await api(`/api/paving/jobs/${id}/report?doc=${format}`);if(!r.ok)throw new Error();const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`paving-job-evidence.${format==='docx'?'docx':'pdf'}`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Paving job evidence report ready');}catch(e){toast('Paving job report could not be created');}finally{if(button){button.disabled=false;button.textContent=format==='docx'?'Job Evidence Word':'Job Evidence PDF';}}}
async function loadPavingReadiness(){const box=document.getElementById('pavingReadiness'),id=(document.getElementById('jobFilter')||{}).value;if(!box)return;if(!id){box.textContent='Choose a job to check its photo evidence.';return;}const r=await api(`/api/paving/jobs/${id}/completeness`);if(!r.ok){box.textContent='Photo evidence readiness could not be checked.';return;}const d=await r.json();box.innerHTML=`<strong>Photo evidence readiness: ${d.complete}/${d.total}</strong>${d.checks.map(x=>`<div class="${x.complete?'evidence-ok':'evidence-missing'}">${x.complete?'✓':'○'} ${esc(x.label)}</div>`).join('')}`;}
async function createJob(){const name=document.getElementById('newJobName').value.trim();if(!name){toast('Enter a job name');return;}const body={name,job_number:document.getElementById('newJobNumber').value.trim(),customer:document.getElementById('newJobCustomer').value.trim(),address:document.getElementById('newJobAddress').value.trim()};const r=await api('/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok){toast('Job could not be created');return;}const job=await r.json();await loadJobs();state.jobId=String(job.id);toast('Job created');renderList();}
async function showSelectedJobTimeline(){const id=(document.getElementById('jobFilter')||{}).value;if(!id){toast('Choose a job first');return;}const r=await api(`/api/jobs/${id}/timeline`);if(!r.ok){toast('Timeline could not be loaded');return;}const d=await r.json(),body=document.getElementById('body');body.innerHTML=`<button class="backlink" id="timelineBack">← Back to Organize</button><div class="workflow-intro"><strong>${esc(d.job.name)} Timeline</strong><span>${esc([d.job.job_number,d.job.customer,d.job.address].filter(Boolean).join(' · '))}</span></div><div class="row"><span class="badge">${esc(d.job.status)}</span><button class="btn secondary slim" id="jobStatusBtn">${d.job.status==='active'?'Mark Job Complete':'Reopen Job'}</button></div><div>${d.captures.length?d.captures.map((c,i)=>`<div style="display:grid;grid-template-columns:90px 1fr;gap:12px;border-left:3px solid #2455d9;padding:0 0 20px 16px"><div><strong>${new Date(c.created_at).toLocaleDateString(uiLocale())}</strong><div class="meta">${new Date(c.created_at).toLocaleTimeString(uiLocale(),{hour:'numeric',minute:'2-digit'})}</div></div><div class="card" style="margin:0"><div class="photo-title">${esc(c.photo_title||'Untitled photo')}</div>${c.photo_path?`<img src="${photoSrc(c.photo_path)}" alt="Timeline photo">`:''}${photoLocationHtml(c)}<div>${esc(c.note||'(no note)')}</div></div></div>`).join(''):'<p class="empty">No photos are assigned to this job yet.</p>'}</div>`;document.getElementById('timelineBack').onclick=renderList;document.getElementById('jobStatusBtn').onclick=async()=>{const u=await api(`/api/jobs/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:d.job.status==='active'?'completed':'active'})});if(u.ok){toast('Job status updated');await loadJobs();renderList();}else toast('Job status could not be updated');};}
const ANNOTATION_TEMPLATES={date_address:[{t:'datetime',x:4,y:4,size:3,color:'#ffffff',font:'sans',outline:true},{t:'address',x:4,y:11,size:3,color:'#ffffff',font:'sans',outline:true}],evidence:[{t:'datetime',x:4,y:4,size:2.5,color:'#ffffff',font:'sans',outline:true},{t:'address',x:4,y:10,size:2.5,color:'#ffffff',font:'sans',outline:true},{t:'gps',x:4,y:16,size:2.5,color:'#ffffff',font:'sans',outline:true},{t:'copyright',x:4,y:92,size:2.2,color:'#ffffff',font:'sans',outline:true}],copyright:[{t:'copyright',x:4,y:92,size:2.2,color:'#ffffff',font:'sans',outline:true}]};
async function runBatchChanges(){const ids=selectedCaptureIds();if(!ids.length){toast('Select at least one capture');return;}const job=document.getElementById('batchJob').value,template=document.getElementById('batchTemplate').value,body={ids};if(job)body.job_id=Number(job);if(template)body.overlays=ANNOTATION_TEMPLATES[template];if(!job&&!template){toast('Choose a batch change');return;}const r=await api('/api/captures/batch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok){toast('Batch changes failed');return;}toast(`Updated ${d.updated} photos`);await loadJobs();runSmartSearch();}
function compareSelectedPhotos(){const ids=selectedCaptureIds();if(ids.length!==2){toast('Select exactly two photos to compare');return;}const rows=window._lastCards||[],a=rows.find(x=>x.id===ids[0]),b=rows.find(x=>x.id===ids[1]);if(!a?.photo_path||!b?.photo_path){toast('Both selections must have photos');return;}const m=document.createElement('div');m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:90;padding:16px;overflow:auto';m.innerHTML=`<section style="max-width:900px;margin:auto;background:white;border-radius:12px;padding:16px"><div class="row"><strong>Photo Comparison &amp; Alignment</strong><button class="iconbtn" id="cmpClose">×</button></div><p class="status">Use side-by-side view for details or the overlay slider to check whether fixed objects line up.</p><div id="cmpSide" class="row" style="align-items:flex-start"><img src="${photoSrc(a.photo_path)}" style="width:50%;max-height:65vh;object-fit:contain"><img src="${photoSrc(b.photo_path)}" style="width:50%;max-height:65vh;object-fit:contain"></div><div id="cmpOverlay" style="display:none;position:relative;max-width:700px;margin:auto"><img src="${photoSrc(a.photo_path)}" style="width:100%;display:block"><img id="cmpTop" src="${photoSrc(b.photo_path)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.5"></div><label>View</label><div class="row"><button class="btn secondary" id="cmpSideBtn">Side by Side</button><button class="btn secondary" id="cmpOverlayBtn">Overlay</button></div><label>Overlay Opacity</label><input id="cmpOpacity" type="range" min="0" max="100" value="50"></section>`;document.body.appendChild(m);m.querySelector('#cmpClose').onclick=()=>m.remove();m.onclick=e=>{if(e.target===m)m.remove();};m.querySelector('#cmpSideBtn').onclick=()=>{m.querySelector('#cmpSide').style.display='flex';m.querySelector('#cmpOverlay').style.display='none';};m.querySelector('#cmpOverlayBtn').onclick=()=>{m.querySelector('#cmpSide').style.display='none';m.querySelector('#cmpOverlay').style.display='block';};m.querySelector('#cmpOpacity').oninput=e=>m.querySelector('#cmpTop').style.opacity=Number(e.target.value)/100;}

async function createOrganizeTopic() {
  const input = document.getElementById('organizenewtopic');
  const name = input ? input.value.trim() : '';
  if (!name) { toast('Type a topic name'); return; }
  const r = await api('/api/areas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
  if (!r.ok) { toast('Could not create topic'); return; }
  state.areas = await r.json();
  renderList();
  const sel = document.getElementById('bulktopic'); if (sel) sel.value = name;
  toast('Topic created');
}

async function applyTopicToSelected() {
  const topic = (document.getElementById('bulktopic') || {}).value || '';
  const ids = Array.from(state.selectedIds);
  if (!topic) { toast('Choose a topic'); return; }
  if (!ids.length) { toast('Select at least one capture'); return; }
  const rows = window._lastCards || [];
  let done = 0;
  for (const id of ids) {
    const c = rows.find(x => String(x.id) === String(id));
    const tags = Array.from(new Set([].concat(c && c.area_tags || [], topic)));
    const r = await api(`/api/captures/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ area_tags: tags }) });
    if (r.ok) done++;
  }
  toast(`Filed ${done} capture${done === 1 ? '' : 's'} under ${topic}`);
  loadCards((document.getElementById('filter') || {}).value || '');
}

async function replaceTopicsOnSelected() {
  const topic=(document.getElementById('bulktopic')||{}).value||'',ids=Array.from(state.selectedIds);
  if(!topic){toast('Choose a topic');return;}
  if(!ids.length){toast('Select at least one capture');return;}
  let done=0;
  for(const id of ids){const r=await api(`/api/captures/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area_tags:[topic]})});if(r.ok)done++;}
  toast(`Changed ${done} photo${done===1?'':'s'} to ${topic}`);
  loadCards((document.getElementById('filter')||{}).value||'');
}

async function renderEdit() {
  const body = document.getElementById('body');
  body.className = 'workflow-edit';
  body.innerHTML = `
    <div class="workflow-intro"><strong>Edit your material</strong><span>Measure or mark up photos, correct notes, or remove unwanted captures.</span></div>
    <label>Filter by Topic</label>
    <select id="filter"><option value="">All Topics</option>${state.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
    <div class="row" style="margin-top:10px"><button class="btn secondary" id="selall">Select All</button><button class="btn secondary" id="selnone">Clear</button></div>
    <div class="row" style="margin-top:8px"><button class="btn secondary" id="fixaddr">Fix Addresses</button><button class="btn" id="delbtn" style="background:#b3261e">Delete Selected</button></div>
    <div id="cards" style="margin-top:16px"></div>`;
  document.getElementById('filter').onchange = e => loadCards(e.target.value);
  document.getElementById('selall').onclick = () => document.querySelectorAll('.capchk').forEach(c => { c.checked = true; state.selectedIds.add(String(c.value)); });
  document.getElementById('selnone').onclick = () => { state.selectedIds.clear(); document.querySelectorAll('.capchk').forEach(c => c.checked = false); };
  document.getElementById('fixaddr').onclick = doFixAddresses;
  document.getElementById('delbtn').onclick = doDeleteSelected;
  loadCards('');
}

async function pairSelected() {
  const ids = Array.from(document.querySelectorAll('.capchk:checked')).map(x => parseInt(x.value, 10));
  if (ids.length !== 2) { toast('Select exactly two captures to pair'); return; }
  const rows = window._lastCards || [];
  const a = rows.find(r => r.id === ids[0]) || { id: ids[0] };
  const b = rows.find(r => r.id === ids[1]) || { id: ids[1] };
  // older capture defaults to Before
  const at = new Date(a.created_at || 0).getTime(), bt = new Date(b.created_at || 0).getTime();
  let before = at <= bt ? a : b, after = at <= bt ? b : a;
  const swap = confirm(uiT(`Before = capture #${before.id} (older), After = capture #${after.id}.\n\nOK to keep this order, or Cancel to swap Before/After.`));
  if (!swap) { const t = before; before = after; after = t; }
  const r = await api('/api/pairs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ before_id: before.id, after_id: after.id }),
  });
  if (r.ok) { toast('Paired'); loadCards(document.getElementById('filter').value || ''); }
  else { const d = await r.json().catch(() => ({})); toast(d.error || 'Pairing failed'); }
}

async function unpair(captureId) {
  const r = await api('/api/pairs/unpair', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capture_id: captureId }),
  });
  if (r.ok) { toast('Unpaired'); loadCards(document.getElementById('filter').value || ''); }
  else toast('Unpair failed');
}

// ---- AI defect classification (Pro) ----
const DEFECT_OPTIONS = [
  ['pothole', 'Pothole'], ['alligator_cracking', 'Alligator Cracking'],
  ['transverse_cracking', 'Transverse Cracking'], ['longitudinal_cracking', 'Longitudinal Cracking'],
  ['rutting', 'Rutting'], ['raveling', 'Raveling'], ['edge_cracking', 'Edge Cracking'],
  ['joint_failure','Joint Failure'], ['utility_cut_failure','Utility Cut Failure'],
  ['surface_deformation','Surface Deformation'], ['drainage_damage','Drainage Damage'], ['base_failure','Base Failure'],
  ['other', 'Other'], ['none', 'No Defect'],
];
function defectLabelClient(t) { const f = DEFECT_OPTIONS.find(o => o[0] === t); return f ? f[1] : 'Other'; }
function severityColorClient(s) { return s === 'high' ? '#b3261e' : s === 'medium' ? '#b36b00' : s === 'low' ? '#1b7a3d' : '#444444'; }
function defectBadgeHtml(c) {
  if (!c.defect_type) return '';
  const label = defectLabelClient(c.defect_type);
  if (c.defect_type === 'none') {
    return `<span class="defbadge" data-id="${c.id}" style="background:#444444">${esc(label)}</span>`;
  }
  const color = severityColorClient(c.defect_severity);
  const sev = c.defect_severity ? ' - ' + c.defect_severity : '';
  return `<span class="defbadge" data-id="${c.id}" style="background:${color}">${esc(label)}${esc(sev)}</span>`;
}

async function classifyOne(id) {
  const r = await api(`/api/captures/${id}/classify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const d = await r.json().catch(() => ({}));
  return d;
}

async function classifySelected() {
  const ids = Array.from(document.querySelectorAll('.capchk:checked')).map(x => parseInt(x.value, 10));
  if (!ids.length) { toast('Select at least one capture'); return; }
  const prog = document.getElementById('classifyprog');
  const btn = document.getElementById('classifybatch');
  btn.disabled = true;
  let done = 0, failed = 0;
  for (const id of ids) {
    if (prog) prog.textContent = `Classifying ${done + 1} of ${ids.length}...`;
    try { const d = await classifyOne(id); if (d && d.ok) done++; else failed++; }
    catch (e) { failed++; }
  }
  if (prog) prog.textContent = `Classified ${done} of ${ids.length}` + (failed ? `, ${failed} could not be classified` : '');
  btn.disabled = false;
  loadCards(document.getElementById('filter').value || '');
}

function startOverride(id, rows) {
  const badge = document.querySelector(`.defbadge[data-id="${id}"]`) || document.querySelector(`.classifybtn[data-id="${id}"]`);
  if (!badge) return;
  const row = rows.find(r => r.id === id) || {};
  const wrap = document.createElement('div');
  wrap.style.marginTop = '6px';
  wrap.innerHTML = `
    <div class="row compact">
      <select class="ovtype" style="flex:2">${DEFECT_OPTIONS.map(o => `<option value="${o[0]}"${row.defect_type === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>
      <select class="ovsev" style="flex:1">
        <option value="low"${row.defect_severity === 'low' ? ' selected' : ''}>Low</option>
        <option value="medium"${row.defect_severity === 'medium' ? ' selected' : ''}>Medium</option>
        <option value="high"${row.defect_severity === 'high' ? ' selected' : ''}>High</option>
      </select>
    </div>
    <div class="row" style="margin-top:6px">
      <button class="btn slim ovsave">Save</button>
      <button class="btn secondary slim ovcancel">Cancel</button>
    </div>`;
  badge.parentNode.appendChild(wrap);
  wrap.querySelector('.ovcancel').onclick = () => wrap.remove();
  wrap.querySelector('.ovsave').onclick = async () => {
    const defect_type = wrap.querySelector('.ovtype').value;
    const severity = wrap.querySelector('.ovsev').value;
    const r = await api(`/api/captures/${id}/classify-set`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defect_type, severity }),
    });
    if (r.ok) { toast('Updated'); loadCards(document.getElementById('filter').value || ''); }
    else toast('Update failed');
  };
}

async function loadGroupOptions() {
  const sel = document.getElementById('groupsel');
  if (!sel) return;
  const r = await api('/api/groups');
  const groups = r.ok ? await r.json() : [];
  sel.innerHTML = '<option value="">Choose Document</option>' +
    groups.map(g => `<option value="${g.id}">${esc(g.title || 'Untitled')} (${g.item_count})</option>`).join('');
}

async function addSelectedToGroup() {
  const ids = Array.from(document.querySelectorAll('.capchk:checked')).map(x => x.value);
  if (!ids.length) { toast('Select at least one capture'); return; }
  const newName = document.getElementById('newgroupname').value.trim();
  const sel = document.getElementById('groupsel');
  try {
    if (newName) {
      const r = await api('/api/groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newName, ids }),
      });
      if (!r.ok) throw new Error('bad');
      toast(`Document created with ${ids.length} photo${ids.length > 1 ? 's' : ''}`);
      document.getElementById('newgroupname').value = '';
      loadGroupOptions();
    } else if (sel.value) {
      const r = await api(`/api/groups/${sel.value}/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error('bad');
      toast(`Added ${ids.length} to document`);
      loadGroupOptions();
    } else {
      toast('Pick a document or type a new title');
    }
  } catch (e) { toast('Could not add to document'); }
}

async function doExportSelected() {
  const ids = Array.from(document.querySelectorAll('.capchk:checked')).map(x => x.value);
  const fmts = Array.from(document.querySelectorAll('#fmts .pill.on')).map(x => x.getAttribute('data-fmt'));
  if (!ids.length) { toast('Select at least one capture'); return; }
  if (!fmts.length) { toast('Pick at least one format'); return; }
  const names = { pdf: 'photonotes.pdf', docx: 'photonotes.docx', bundle: 'photonotes-bundle.zip' };
  const imgRes = (document.getElementById('imgres') || {}).value || 'standard';
  const imgFmt = (document.getElementById('imgfmt') || {}).value || 'jpeg';
  const btn = document.getElementById('exportbtn');
  btn.disabled = true; btn.textContent = 'Preparing Downloads...';
  for (const f of fmts) {
    try {
      const r = await api(`/api/export/${f}?ids=${ids.join(',')}&res=${imgRes}&fmt=${imgFmt}`);
      if (!r.ok) throw new Error('bad');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = names[f];
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      await new Promise(res => setTimeout(res, 500));
    } catch (e) { toast('Download failed for ' + f); }
  }
  btn.disabled = false; btn.textContent = 'Export';
  toast('Exported');
}

async function doDeleteSelected() {
  const ids = Array.from(document.querySelectorAll('.capchk:checked')).map(x => x.value);
  if (!ids.length) { toast('Select at least one capture'); return; }
  if (!confirm(uiT(`Delete ${ids.length} capture${ids.length > 1 ? 's' : ''}? This can't be undone.`))) return;
  const btn = document.getElementById('delbtn');
  btn.disabled = true; btn.textContent = 'Deleting...';
  try {
    const r = await api('/api/captures/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!r.ok) throw new Error('bad');
    toast('Deleted');
    loadCards(document.getElementById('filter').value || '');
  } catch (e) { toast('Delete failed'); }
  finally { btn.disabled = false; btn.textContent = 'Delete Selected'; }
}

async function doFixAddresses() {
  const checked = Array.from(document.querySelectorAll('.capchk:checked')).map(x => x.value);
  const btn = document.getElementById('fixaddr');
  btn.disabled = true; btn.textContent = 'Fixing...';
  try {
    const body = checked.length ? { ids: checked } : {};
    const r = await api('/api/regeocode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('bad');
    const d = await r.json();
    const parts = [`Corrected ${d.updated} address${d.updated === 1 ? '' : 'es'}`];
    if (d.unchanged) parts.push(`${d.unchanged} already matched`);
    if (d.unresolved) parts.push(`${d.unresolved} could not be resolved`);
    toast(parts.join('. '));
    await loadCards(document.getElementById('filter').value || '');
  } catch (e) { toast('Fix addresses failed'); }
  finally { btn.disabled = false; btn.textContent = 'Fix Addresses'; }
}

async function loadCards(area, query = '', filters = {}) {
  const cards = document.getElementById('cards');
  if (!cards) return;
  cards.innerHTML = '<p class="status">Loading...</p>';
  const smart=query||filters.job||filters.from||filters.to||filters.missing;
  const params=new URLSearchParams();if(query)params.set('q',query);if(filters.job)params.set('job_id',filters.job);if(filters.from)params.set('from',filters.from);if(filters.to)params.set('to',filters.to);if(filters.missing)params.set('missing_address','1');
  const r = await api(smart ? `/api/captures/search?${params}` : '/api/captures' + (area ? `?area=${encodeURIComponent(area)}` : ''));
  if (!r.ok) { cards.innerHTML = '<p class="status">Could not load.</p>'; return; }
  let rows = await r.json();
  if(smart&&area)rows=rows.filter(c=>(c.area_tags||[]).includes(area));
  const searchStatus=document.getElementById('photoSearchStatus');if(searchStatus)searchStatus.textContent=query?`${rows.length} matching photo${rows.length===1?'':'s'}`:'';
  if (!rows.length) { cards.innerHTML = '<p class="empty">No captures yet. Go grab one.</p>'; return; }
  window._lastCards = rows;
  // Pro: pull only pairs the user deliberately created so we can render them
  // as combined before/after cards. Never suggest pairs automatically.
  let pairs = [];
  if (isProClient() && state.view === 'organize') {
    try { const pr = await api('/api/pairs'); if (pr.ok) pairs = await pr.json(); } catch (e) {}
  }
  const byId = {}; rows.forEach(c => { byId[c.id] = c; });
  const beforeOf = {}, afterOf = {};
  pairs.forEach(p => { beforeOf[p.before_id] = p; afterOf[p.after_id] = p; });
  const consumed = new Set();
  const html = [];
  for (const c of rows) {
    if (consumed.has(c.id)) continue;
    const ab = beforeOf[c.id];
    if (ab && byId[ab.after_id] && !consumed.has(ab.after_id)) { html.push(pairCardHtml(c, byId[ab.after_id])); consumed.add(c.id); consumed.add(ab.after_id); continue; }
    const aa = afterOf[c.id];
    if (aa && byId[aa.before_id] && !consumed.has(aa.before_id)) { html.push(pairCardHtml(byId[aa.before_id], c)); consumed.add(c.id); consumed.add(aa.before_id); continue; }
    html.push(captureCardHtml(c));
    consumed.add(c.id);
  }
  cards.innerHTML = html.join('');
  wireCards(cards, rows);
  cards.querySelectorAll('.capchk').forEach(c => { c.checked = state.selectedIds.has(String(c.value)); });
  if (state._focusCapture) {
    const chk = cards.querySelector(`.capchk[value="${state._focusCapture}"]`);
    state._focusCapture = null;
    if (chk) { const card = chk.closest('.card'); if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.style.outline = '3px solid #1d4ed8'; setTimeout(() => { card.style.outline = ''; }, 2500); } }
  }
}

function formatGpsClient(c){
  return c&&c.latitude!=null&&c.longitude!=null?`${Number(c.latitude).toFixed(5)}, ${Number(c.longitude).toFixed(5)}`:'Not available';
}
function photoLocationHtml(c,addressFallback='No address'){
  return `<div class="photo-location"><div class="photo-location-label">GPS</div><div class="photo-gps">${esc(formatGpsClient(c))}</div><div class="photo-location-label">Address</div><div class="addr">${esc(c&&c.address||addressFallback)}</div></div>`;
}
function captureCardHtml(c) {
  const when = new Date(c.created_at).toLocaleString(uiLocale(), { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const tags = (c.area_tags || []).map(t => `<span class="badge">${esc(t)}</span>`).join('');
  const kind = c.kind === 'task' ? `<span class="badge task">Task</span>` : '';
  const dims = measurementOn() ? fmtDimsClient(c) : '';
  const classifyRow = featureOn('measurements')
    ? (c.defect_type
        ? `<div class="defectrow" style="margin:6px 0">${defectBadgeHtml(c)} <button class="editlink overridebtn" data-id="${c.id}">Change</button></div>`
        : `<div class="defectrow" style="margin:6px 0"><button class="btn secondary slim classifybtn" data-id="${c.id}">Classify (AI)</button></div>`)
    : '';
  const measureRow = measurementOn() && state.view === 'edit' && c.photo_path
    ? `<button class="btn secondary slim editdims" data-id="${c.id}">Measurements</button>` : '';
  const supporting=(c.supporting_photos||[]).map(p=>`<div class="meta"><strong>${p.reference_type==='specification'?'Specification':'Batch ticket'}:</strong> linked photo</div>`).join(''),concreteRow=isConcreteClient()&&c.concrete_element?`<div class="concrete-evidence"><strong>${esc(String(c.concrete_element).replaceAll('_',' '))}</strong> · ${esc(String(c.concrete_stage||'photo').replaceAll('_',' '))}${c.concrete_condition?` · ${esc(String(c.concrete_condition).replaceAll('_',' '))}`:''}${c.concrete_severity&&c.concrete_severity!=='none'?` · ${esc(c.concrete_severity)} severity`:''}${c.concrete_location?`<div>${esc(c.concrete_location)}</div>`:''}${c.concrete_mix?`<div>Mix/spec: ${esc(c.concrete_mix)}</div>`:''}${supporting}</div>${c.concrete_stage!=='batch_ticket'?`<label class="btn secondary slim concrete-ticket-label">Attach Batch Ticket / Spec Photo<input class="concrete-ticket-file" data-id="${c.id}" type="file" accept="image/*" capture="environment" hidden></label>`:''}`:'';
  const titleAction=state.view==='edit'?(c.photo_title?'Change Photo Title':'Add Photo Title'):(state.view==='organize'&&!c.photo_title?'Add Photo Title':'');
  const topicAction=['organize','edit'].includes(state.view)?`<button class="editlink edittopics" data-id="${c.id}" type="button">Change Topics</button>`:'';
  return `<div class="card">
    <label style="display:flex;align-items:center;gap:8px;font-weight:bold;margin-bottom:8px;text-transform:none;letter-spacing:0;font-size:15px">
      <input type="checkbox" class="capchk" value="${c.id}" style="width:20px;height:20px"> Select
    </label>
    <div class="phototitlewrap" data-id="${c.id}">
      <div class="photo-title">${esc(c.photo_title || 'Untitled photo')}</div>
      ${titleAction?`<button class="editlink edittitle" data-id="${c.id}" type="button">${titleAction}</button>`:''}
    </div>
    ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="capture" />` : ''}
    <div class="meta">${when}</div>
    ${c.job_name?`<div class="badge">${esc(c.job_number?c.job_number+' — '+c.job_name:c.job_name)}</div>`:''}
    <div class="rotaterow">${rotateButtons(c.id)}</div>
    ${photoLocationHtml(c)}
    ${state.view === 'edit' ? `<button class="editlink editaddress" data-id="${c.id}" style="padding-left:0">Edit Address</button>` : ''}
    <div class="topicwrap" data-id="${c.id}"><div class="meta">${kind}${tags||'<span class="badge">No Topic</span>'}</div>${topicAction}</div>
    ${concreteRow}
    ${classifyRow}
    ${dims ? `<div class="meta"><strong>Dimensions:</strong> ${esc(dims)}</div>` : ''}
    ${measureRow}
    ${c.photo_path ? `<button class="btn secondary slim stampbtn" data-id="${c.id}">Mark Up Photo${(c.overlays && c.overlays.length) ? ' (' + c.overlays.length + ')' : ''}</button>` : ''}
    ${c.photo_path ? `<button class="btn secondary slim cropbtn" data-id="${c.id}">Crop Photo</button>` : ''}
    <button class="btn secondary slim evidencebtn" data-id="${c.id}">Photo History</button>
    ${c.photo_original_path ? `<button class="btn secondary slim restorebtn" data-id="${c.id}">Restore Original Photo</button>` : ''}
    <div class="notewrap photo-notes-panel" data-id="${c.id}">
      <div class="photo-notes-heading">Notes</div>
      <div class="notetext photo-notes-box">${esc(c.note || 'No notes added.')}</div>
      <button class="btn secondary editnote" data-id="${c.id}" style="margin-top:6px">Edit Note</button>
    </div>
  </div>`;
}

async function renderConcreteReport(){const body=document.getElementById('body');body.className='workflow-organize';body.innerHTML=`<div class="workflow-intro"><strong>Concrete Photo Evidence Report</strong><span>Review photographed conditions, defects, repairs, verification, and batch tickets linked to placement photos.</span></div><label>Project</label><select id="concreteReportJob"><option value="">All Projects</option>${state.jobs.map(j=>`<option value="${j.id}">${esc(j.job_number?j.job_number+' — '+j.name:j.name)}</option>`).join('')}</select><div id="concreteReportStats" class="statrow"></div><div id="concreteReadiness" class="evidence-readiness"></div><div class="row"><button class="btn secondary" id="concreteReportPdf">Photo Evidence PDF</button><button class="btn secondary" id="concreteReportWord">Photo Evidence Word</button><button class="btn secondary" id="concretePrint">Print Photo Report</button></div><div id="concreteReportPhotos"><p class="status">Loading photo evidence...</p></div>`;document.getElementById('concreteReportJob').onchange=loadConcreteReport;document.getElementById('concreteReportPdf').onclick=()=>exportConcreteReport('pdf');document.getElementById('concreteReportWord').onclick=()=>exportConcreteReport('docx');document.getElementById('concretePrint').onclick=()=>window.print();loadConcreteReport();}
async function loadConcreteReport(){const job=(document.getElementById('concreteReportJob')||{}).value||'',r=await api('/api/concrete/report'+(job?'?job_id='+encodeURIComponent(job):'')),box=document.getElementById('concreteReportPhotos');if(!r.ok){box.innerHTML='<p class="status">Concrete photo report could not be loaded.</p>';return;}const d=await r.json();document.getElementById('concreteReportStats').innerHTML=[['total','Photos'],['defects','Defect Photos'],['repair_needed','Needs Repair'],['verification','Verification Photos'],['critical','Critical']].map(([k,l])=>`<div class="stat"><strong>${d.counts[k]||0}</strong><span>${l}</span></div>`).join('');const c=d.completeness||{checks:[],complete:0,total:0};document.getElementById('concreteReadiness').innerHTML=`<strong>Photo evidence readiness: ${c.complete}/${c.total}</strong>${c.checks.map(x=>`<div class="${x.complete?'evidence-ok':'evidence-missing'}">${x.complete?'✓':'○'} ${esc(x.label)}</div>`).join('')}`;box.innerHTML=d.photos.length?d.photos.map(c=>captureCardHtml(c)).join(''):'<p class="empty">No concrete photo evidence has been captured yet.</p>';wireCards(box,d.photos);}
async function exportConcreteReport(format){const p=new URLSearchParams({doc:format}),job=(document.getElementById('concreteReportJob')||{}).value;if(job)p.set('job_id',job);const button=document.getElementById(format==='docx'?'concreteReportWord':'concreteReportPdf');button.disabled=true;button.textContent='Preparing...';try{const r=await api('/api/concrete/report?'+p);if(!r.ok)throw new Error();const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`concrete-photo-evidence-report.${format}`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);toast('Concrete photo evidence report ready');}catch(e){toast('Concrete report could not be created');}finally{button.disabled=false;button.textContent=format==='docx'?'Photo Evidence Word':'Photo Evidence PDF';}}

async function showEvidence(id){
  try{
    const r=await api(`/api/captures/${id}/evidence`);if(!r.ok)throw new Error();const d=await r.json();
    const labels={captured:'Original capture saved',details_updated:'Details updated',photo_rotated:'Photo rotated',photo_flipped:'Photo flipped',photo_cropped:'Photo cropped',original_restored:'Original photo restored'};
    const hash=d.evidence&&d.evidence.original_sha256||'';
    const modal=document.createElement('div');modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.58);z-index:80;padding:18px;overflow:auto';
    const fileStatus=d.fingerprint_verified===true?'Original photo matches':d.fingerprint_verified===false?'Original photo does not match':'File check unavailable';
    modal.innerHTML=`<section style="max-width:620px;margin:30px auto;background:#fff;border-radius:12px;padding:18px;color:#000"><div style="display:flex;justify-content:space-between;gap:12px"><div class="brand" style="font-size:21px">Photo History</div><button class="iconbtn" id="evidenceClose" aria-label="Close">×</button></div><p class="helper">See when this photo note was saved and what was changed later. Your private note text is not shown in this history.</p><div class="card"><strong>Original photo saved</strong><div class="muted">${fEvidenceDate(d.evidence&&d.evidence.captured_at||d.capture.created_at)}</div><div class="muted" style="margin-top:7px">Photo size: ${d.evidence?formatEvidenceBytes(d.evidence.original_bytes):'Unknown'}</div><div class="muted">Location saved: ${d.capture.latitude!=null&&d.capture.longitude!=null?'Yes':'No'} · Address saved: ${d.capture.address?'Yes':'No'}</div><div class="muted" style="margin-top:7px"><strong>${fileStatus}</strong></div><details style="margin-top:10px"><summary>Technical file details</summary><div class="muted" style="margin-top:7px">SHA-256 file ID</div><div style="font-family:monospace;word-break:break-all;margin-top:5px">${esc(hash||'Not available for this older photo')}</div><div class="muted" style="margin-top:7px">Original backup: ${d.original_preserved?'Preserved':'Not currently needed'}</div></details></div><h3 style="font-size:16px">Changes</h3>${d.history.length?`<div>${d.history.map(h=>`<div style="border-bottom:1px solid #ddd;padding:8px 0"><strong>${esc(labels[h.action]||h.action)}</strong><div class="muted">${fEvidenceDate(h.created_at)}${h.detail&&Array.isArray(h.detail.fields)&&h.detail.fields.length?' · '+esc(h.detail.fields.join(', ')):''}</div></div>`).join('')}</div>`:'<p class="helper">No change history is available for this older photo.</p>'}</section>`;
    document.body.appendChild(modal);modal.querySelector('#evidenceClose').onclick=()=>modal.remove();modal.onclick=e=>{if(e.target===modal)modal.remove();};
  }catch(e){toast('Photo history could not be loaded');}
}
function fEvidenceDate(value){try{return new Date(value).toLocaleString(uiLocale());}catch(e){return '—';}}
function formatEvidenceBytes(n){n=Number(n)||0;if(n<1024)return n+' B';if(n<1048576)return (n/1024).toFixed(1)+' KB';return (n/1048576).toFixed(1)+' MB';}

function openPhotoViewer(src,title='Photo'){
  const old=document.getElementById('photoViewerModal');if(old)old.remove();
  const modal=document.createElement('div');modal.id='photoViewerModal';modal.className='photo-viewer-modal';modal.setAttribute('data-html2canvas-ignore','true');
  modal.innerHTML=`<section class="photo-viewer-dialog" role="dialog" aria-modal="true" aria-labelledby="photoViewerTitle"><div class="photo-viewer-head"><strong id="photoViewerTitle">${esc(title||'Photo')}</strong><button class="iconbtn" id="photoViewerClose" aria-label="Close photo viewer">×</button></div><p class="status">Viewing only. Drag the photo with a finger or mouse, or use the controls below.</p><div class="photo-viewer-viewport"><img src="${esc(src)}" alt="${esc(title||'Photo')}" draggable="false"></div><div class="photo-viewer-controls"><button class="btn secondary slim" data-view-action="zoom-in">Zoom In</button><button class="btn secondary slim" data-view-action="zoom-out">Zoom Out</button><button class="btn secondary slim" data-view-action="left">Move Left</button><button class="btn secondary slim" data-view-action="right">Move Right</button><button class="btn secondary slim" data-view-action="up">Move Up</button><button class="btn secondary slim" data-view-action="down">Move Down</button></div><button class="btn secondary" id="photoViewerReset">Reset Photo</button></section>`;
  document.body.appendChild(modal);
  const viewport=modal.querySelector('.photo-viewer-viewport'),img=viewport.querySelector('img');let scale=1,x=0,y=0,drag=null,pinch=null;
  const paint=()=>{img.style.transform=`translate(${x}px, ${y}px) scale(${scale})`;};
  const zoom=factor=>{scale=Math.max(1,Math.min(5,scale*factor));if(scale===1){x=0;y=0;}paint();};
  const reset=()=>{scale=1;x=0;y=0;paint();};
  modal.querySelectorAll('[data-view-action]').forEach(b=>b.onclick=()=>{switch(b.dataset.viewAction){case'zoom-in':zoom(1.3);break;case'zoom-out':zoom(1/1.3);break;case'left':x-=50;break;case'right':x+=50;break;case'up':y-=50;break;case'down':y+=50;break;}paint();});
  viewport.onpointerdown=e=>{if(e.pointerType==='touch'&&e.isPrimary===false)return;drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,x,y};viewport.setPointerCapture(e.pointerId);};
  viewport.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;x=drag.x+e.clientX-drag.startX;y=drag.y+e.clientY-drag.startY;paint();};
  const endDrag=e=>{if(drag&&drag.id===e.pointerId)drag=null;};viewport.onpointerup=endDrag;viewport.onpointercancel=endDrag;
  viewport.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?1.15:1/1.15);},{passive:false});
  viewport.addEventListener('touchstart',e=>{if(e.touches.length===2){const [a,b]=e.touches;pinch={distance:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),scale};}},{passive:true});
  viewport.addEventListener('touchmove',e=>{if(e.touches.length!==2||!pinch)return;e.preventDefault();const [a,b]=e.touches,distance=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);scale=Math.max(1,Math.min(5,pinch.scale*(distance/pinch.distance)));paint();},{passive:false});
  viewport.addEventListener('touchend',()=>{pinch=null;},{passive:true});
  const close=()=>{document.removeEventListener('keydown',onKey);modal.remove();},onKey=e=>{if(e.key==='Escape')close();};
  modal.querySelector('#photoViewerClose').onclick=close;modal.querySelector('#photoViewerReset').onclick=reset;modal.onclick=e=>{if(e.target===modal)close();};document.addEventListener('keydown',onKey);paint();
}

function installPhotoViewerButtons(root=document){
  root.querySelectorAll('.card img').forEach(img=>{if(img.closest('.photo-viewer-modal')||img.nextElementSibling?.classList.contains('photo-viewer-button'))return;const button=document.createElement('button');button.type='button';button.className='btn secondary slim photo-viewer-button';button.textContent='View & Zoom';button.onclick=e=>{e.stopPropagation();const card=img.closest('.card'),title=card&&card.querySelector('.photo-title');openPhotoViewer(img.currentSrc||img.src,title&&title.textContent||img.alt||'Photo');};img.insertAdjacentElement('afterend',button);img.style.cursor='zoom-in';img.onclick=()=>button.click();});
}
const photoViewerObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1){installPhotoViewerButtons(node.matches&&node.matches('.card')?node:node);}});
photoViewerObserver.observe(document.body,{childList:true,subtree:true});

// A combined before/after card: two photos side by side with labels + Unpair.
function pairCardHtml(before, after) {
  const side = (c, label) => {
    const dims = measurementOn() ? fmtDimsClient(c) : '';
    const badge = isProClient() && c.defect_type ? defectBadgeHtml(c) : '';
    const titleAction=state.view==='edit'?(c.photo_title?'Change Photo Title':'Add Photo Title'):(state.view==='organize'&&!c.photo_title?'Add Photo Title':'');
    const tags=(c.area_tags||[]).map(t=>`<span class="badge">${esc(t)}</span>`).join('')||'<span class="badge">No Topic</span>';
    return `<div style="flex:1;min-width:0">
      <div style="font-weight:bold;font-size:13px">${label}</div>
      <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:bold">
        <input type="checkbox" class="capchk" value="${c.id}" style="width:18px;height:18px"> Select
      </label>
      <div class="phototitlewrap" data-id="${c.id}"><div class="photo-title">${esc(c.photo_title||'Untitled photo')}</div>${titleAction?`<button class="editlink edittitle" data-id="${c.id}" type="button">${titleAction}</button>`:''}</div>
      ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="${label}" />` : ''}
      <div class="rotaterow">${rotateButtons(c.id)}</div>
      ${badge ? `<div style="margin:4px 0">${badge}</div>` : ''}
      ${photoLocationHtml(c)}
      ${state.view === 'edit' ? `<button class="editlink editaddress" data-id="${c.id}" style="padding-left:0">Edit Address</button>` : ''}
      <div class="topicwrap" data-id="${c.id}"><div class="meta">${tags}</div><button class="editlink edittopics" data-id="${c.id}" type="button">Change Topics</button></div>
      ${dims ? `<div class="meta"><strong>Dimensions:</strong> ${esc(dims)}</div>` : ''}
      ${measurementOn() && state.view === 'edit' && c.photo_path ? `<button class="btn secondary slim editdims" data-id="${c.id}">Measurements</button>` : ''}
      <button class="btn secondary slim evidencebtn" data-id="${c.id}">Photo History</button>
      <div class="photo-notes-panel"><div class="photo-notes-heading">Notes</div><div class="photo-notes-box">${esc(c.note || 'No notes added.')}</div></div>
    </div>`;
  };
  return `<div class="card">
    <div style="font-weight:bold;margin-bottom:6px">${esc(before.address || after.address || 'No location')} <span class="badge">Before / After</span></div>
    <div class="row" style="gap:12px;align-items:flex-start">${side(before, 'BEFORE')}${side(after, 'AFTER')}</div>
    <button class="btn secondary slim unpairbtn" data-id="${before.id}" style="margin-top:8px">Unpair</button>
  </div>`;
}

function wireCards(cards, rows) {
  cards.querySelectorAll('.capchk').forEach(c => c.onchange = () => { if (c.checked) state.selectedIds.add(String(c.value)); else state.selectedIds.delete(String(c.value)); });
  wireRotate(cards);
  cards.querySelectorAll('.edittitle').forEach(b => b.onclick = () => startEditPhotoTitle(parseInt(b.getAttribute('data-id'), 10), rows));
  cards.querySelectorAll('.edittopics').forEach(b => b.onclick = () => startEditTopics(parseInt(b.getAttribute('data-id'), 10), rows));
  cards.querySelectorAll('.editnote').forEach(b => b.onclick = () => startEditNote(parseInt(b.getAttribute('data-id'), 10), rows));
  cards.querySelectorAll('.editaddress').forEach(b => {
    b.onclick = () => { const c = rows.find(r => r.id === parseInt(b.getAttribute('data-id'), 10)); if (c) editCaptureAddress(c); };
  });
  cards.querySelectorAll('.editdims').forEach(b => b.onclick = () => {
    const c = rows.find(r => r.id === parseInt(b.getAttribute('data-id'), 10));
    if (c) { state._dims = dimsFromCapture(c); state._measure = null; renderSavedDimsEditor(c); }
  });
  cards.querySelectorAll('.classifybtn').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Classifying...';
    const d = await classifyOne(parseInt(b.getAttribute('data-id'), 10));
    if (d && d.ok) loadCards(document.getElementById('filter').value || '');
    else { b.disabled = false; b.textContent = 'Classify (AI)'; toast('Could not classify this photo'); }
  });
  cards.querySelectorAll('.overridebtn').forEach(b => b.onclick = () => startOverride(parseInt(b.getAttribute('data-id'), 10), rows));
  cards.querySelectorAll('.defbadge').forEach(b => b.onclick = () => startOverride(parseInt(b.getAttribute('data-id'), 10), rows));
  cards.querySelectorAll('.unpairbtn').forEach(b => b.onclick = () => unpair(parseInt(b.getAttribute('data-id'), 10)));
  cards.querySelectorAll('.stampbtn').forEach(b => b.onclick = () => { const c = rows.find(r => r.id === parseInt(b.getAttribute('data-id'), 10)); if (c) renderStampEditor(c); });
  cards.querySelectorAll('.cropbtn').forEach(b => b.onclick = () => { const c = rows.find(r => r.id === parseInt(b.getAttribute('data-id'), 10)); if (c) renderCropEditor(c); });
  cards.querySelectorAll('.evidencebtn').forEach(b=>b.onclick=()=>showEvidence(Number(b.dataset.id)));
  cards.querySelectorAll('.restorebtn').forEach(b => b.onclick = () => restoreOriginal(parseInt(b.getAttribute('data-id'), 10)));
  cards.querySelectorAll('.concrete-ticket-file').forEach(input=>input.onchange=()=>attachConcreteTicket(Number(input.dataset.id),input));
}

async function attachConcreteTicket(id,input){const file=input.files&&input.files[0];if(!file)return;const label=input.closest('label'),old=label.firstChild.textContent;label.firstChild.textContent='Uploading...';input.disabled=true;try{const fd=new FormData();fd.append('photo',file);const r=await api(`/api/concrete/captures/${id}/ticket`,{method:'POST',body:fd});if(!r.ok)throw new Error();toast('Batch ticket photo linked');if(state.view==='concrete-report')loadConcreteReport();else loadCards((document.getElementById('filter')||{}).value||'');}catch(e){toast('Batch ticket photo could not be linked');input.disabled=false;label.firstChild.textContent=old;}}

// ================= Photo overlays / stamps editor =================
let editorCapture = null, editorOverlays = [], editorSel = -1;
const OVERLAY_FIELD_LABELS = { datetime: 'Date / Time', address: 'Address', gps: 'GPS', copyright: 'Copyright', topic: 'Topic', dims: 'Dimensions', defect: 'Defect', custom: 'Custom Text', rect: 'Box / Rectangle', arrow: 'Arrow' };
const OVERLAY_FONT_CSS = { sans: 'Arial, Helvetica, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", monospace', heavy: 'Impact, "Arial Black", sans-serif' };
function overlayTextClient(item, c) {
  switch (item.t) {
    case 'datetime': return new Date(c.created_at).toLocaleString(uiLocale());
    case 'address': return c.address || '';
    case 'gps': return (c.latitude != null && c.longitude != null) ? `${Number(c.latitude).toFixed(5)}, ${Number(c.longitude).toFixed(5)}` : '';
    case 'topic': return (c.area_tags || []).length ? `Topic: ${(c.area_tags || []).join(', ')}` : '';
    case 'dims': return fmtDimsClient(c);
    case 'defect': return c.defect_type ? ('Defect: ' + defectLabelClient(c.defect_type) + (c.defect_severity ? ', ' + c.defect_severity : '')) : '';
    case 'copyright': return item.text || ('© ' + new Date().getFullYear());
    default: return item.text || '';
  }
}
function renderStampEditor(c) {
  editorCapture = c;
  editorOverlays = Array.isArray(c.overlays) ? JSON.parse(JSON.stringify(c.overlays)) : [];
  editorOverlays.forEach(it => {
    if (it.t !== 'rect' && it.t !== 'arrow') it.size = Math.max(0.5, Math.min(3, Number(it.size) || 1.25));
  });
  editorSel = editorOverlays.length ? 0 : -1;
  const body = document.getElementById('body');
  const addOpts = ['datetime', 'address', 'gps', 'copyright'];
  if ((c.area_tags || []).length) addOpts.push('topic');
  addOpts.push('custom', 'rect', 'arrow');
  if (isProClient()) {
    if (fmtDimsClient(c)) addOpts.push('dims');
    if (c.defect_type) addOpts.push('defect');
  }
  body.innerHTML = `
    <button class="backlink" id="stampBack">‹ Back to Edit</button>
    <div class="formhead">Mark Up Photo</div>
    <div class="status">Add labels, text, boxes, or arrows. Drag each item where you want it, then adjust its appearance below.</div>
    <div id="stampStage" style="position:relative;display:inline-block;max-width:100%;border:1px solid #000;border-radius:8px;overflow:hidden;touch-action:none">
      <img id="stampImg" src="${photoSrc(c.photo_path)}" alt="photo" style="display:block;max-width:100%;height:auto" />
    </div>
    <label style="margin-top:10px">Add Item</label>
    <div class="pill-group" id="stampAdd">
      ${addOpts.map(t => `<div class="pill" data-add="${t}">${OVERLAY_FIELD_LABELS[t]}</div>`).join('')}
    </div>
    <div class="status" style="margin-top:6px">Topic and Defect are available after they have been assigned to this photo.</div>
    <label>Annotation Template</label><div class="row compact"><select id="singleTemplate"><option value="date_address">Date + Address</option><option value="evidence">Evidence Details</option><option value="copyright">Copyright Only</option></select><button class="btn secondary" id="applySingleTemplate">Apply Template</button></div>
    <div id="stampCtl"></div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="stampSave">Save Changes</button>
      <button class="btn secondary" id="stampCopy">Download Marked Photo</button>
    </div>
    <div class="status" style="margin-top:8px"><strong>Save Changes</strong> keeps the markings with this photo in Photo Notes. <strong>Download Marked Photo</strong> saves a separate JPEG with the markings permanently visible.</div>
    <button class="backlink" id="stampBackBottom" style="margin-top:18px">‹ Back to Edit</button>`;
  const backToEdit = () => { state.view = 'edit'; renderEdit(); };
  document.getElementById('stampBack').onclick = backToEdit;
  document.getElementById('stampBackBottom').onclick = backToEdit;
  document.getElementById('stampAdd').onclick = (e) => { const p = e.target.closest('[data-add]'); if (p) addOverlayItem(p.getAttribute('data-add')); };
  document.getElementById('applySingleTemplate').onclick=()=>{editorOverlays=JSON.parse(JSON.stringify(ANNOTATION_TEMPLATES[document.getElementById('singleTemplate').value]||[]));editorSel=editorOverlays.length?0:-1;drawOverlayItems();renderStampCtl();toast('Template applied');};
  document.getElementById('stampSave').onclick = saveOverlays;
  document.getElementById('stampCopy').onclick = saveStampedCopy;
  const img = document.getElementById('stampImg');
  if (img.complete) drawOverlayItems(); else img.onload = drawOverlayItems;
  renderStampCtl();
}
function stageSize() {
  const st = document.getElementById('stampStage');
  return st ? { w: st.clientWidth, h: st.clientHeight } : { w: 1, h: 1 };
}
function addOverlayItem(t) {
  let item;
  if (t === 'rect') {
    // Box annotation. Geometry + thickness in percent so preview == burn.
    item = { t: 'rect', x: 30, y: 30, w: 40, h: 30, color: '#ff0000', thickness: 0.6 };
  } else if (t === 'arrow') {
    item = { t: 'arrow', x: 25, y: 25, w: 40, h: 30, color: '#ff0000', thickness: 0.8, dir: 'se' };
  } else {
    item = { t, text: t === 'copyright' ? ('© ' + new Date().getFullYear() + ' Zukor AI. All Rights Reserved.') : (t === 'custom' ? 'Text' : ''), x: 4, y: 84, size: 1.25, color: '#ffffff', font: 'sans', outline: true };
  }
  editorOverlays.push(item);
  editorSel = editorOverlays.length - 1;
  drawOverlayItems();
  renderStampCtl();
}
function drawOverlayItems() {
  const st = document.getElementById('stampStage');
  if (!st) return;
  st.querySelectorAll('.ovitem').forEach(n => n.remove());
  const { w: stW, h } = stageSize();
  editorOverlays.forEach((it, i) => {
    if (it.t === 'rect' || it.t === 'arrow') {
      const box = document.createElement('div');
      box.className = 'ovitem ovrect' + (i === editorSel ? ' sel' : '');
      const bw = Math.max(1, (Number(it.thickness) || 0.6) / 100 * stW);
      const border = it.t === 'rect' ? `border:${bw}px solid ${it.color};` : '';
      box.style.cssText = `position:absolute;left:${it.x}%;top:${it.y}%;width:${it.w}%;height:${it.h}%;${border}box-sizing:border-box;cursor:move;touch-action:none;${i === editorSel ? 'outline:2px dashed #1d4ed8;outline-offset:2px;' : ''}`;
      box.dataset.i = i;
      if (it.t === 'arrow') {
        const ends = { se:[0,0,100,100], nw:[100,100,0,0], ne:[0,100,100,0], sw:[100,0,0,100] }[it.dir] || [0,0,100,100];
        box.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none"><defs><marker id="arrowPreview${i}" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5 Z" fill="${it.color}"/></marker></defs><line x1="${ends[0]}" y1="${ends[1]}" x2="${ends[2]}" y2="${ends[3]}" stroke="${it.color}" stroke-width="${Math.max(1, bw)}" vector-effect="non-scaling-stroke" marker-end="url(#arrowPreview${i})"/></svg>`;
      }
      startDrag(box, i);
      if (i === editorSel) {
        const handle = document.createElement('div');
        handle.className = 'ovhandle';
        handle.style.cssText = 'position:absolute;right:-9px;bottom:-9px;width:20px;height:20px;background:#1d4ed8;border:2px solid #fff;border-radius:50%;cursor:nwse-resize;touch-action:none';
        startResize(handle, i);
        box.appendChild(handle);
      }
      st.appendChild(box);
      return;
    }
    const txt = overlayTextClient(it, editorCapture) || OVERLAY_FIELD_LABELS[it.t] || 'Text';
    const d = document.createElement('div');
    d.className = 'ovitem' + (i === editorSel ? ' sel' : '');
    d.style.cssText = `position:absolute;left:${it.x}%;top:${it.y}%;font-size:${Math.max(4, it.size / 100 * h)}px;color:${it.color};font-family:${OVERLAY_FONT_CSS[it.font] || OVERLAY_FONT_CSS.sans};font-weight:${it.font === 'heavy' ? '800' : 'normal'};white-space:nowrap;cursor:move;user-select:none;line-height:1;${it.outline ? 'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;' : ''}${i === editorSel ? 'outline:2px dashed #1d4ed8;outline-offset:2px;' : ''}`;
    d.textContent = txt;
    d.dataset.i = i;
    startDrag(d, i);
    st.appendChild(d);
  });
}
function startDrag(el, i) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('ovhandle')) return; // resize handle owns this
    e.preventDefault();
    editorSel = i; renderStampCtl(); drawOverlayItems();
    const st = document.getElementById('stampStage');
    const rect0 = st.getBoundingClientRect();
    const it = editorOverlays[i];
    // Preserve where inside the item the user grabbed, so it doesn't jump.
    const grabX = (e.clientX - rect0.left) / rect0.width * 100 - (Number(it.x) || 0);
    const grabY = (e.clientY - rect0.top) / rect0.height * 100 - (Number(it.y) || 0);
    const isRect = it.t === 'rect' || it.t === 'arrow';
    const move = (ev) => {
      const rect = st.getBoundingClientRect();
      let x = (ev.clientX - rect.left) / rect.width * 100 - grabX;
      let y = (ev.clientY - rect.top) / rect.height * 100 - grabY;
      const maxX = isRect ? Math.max(0, 100 - (Number(it.w) || 0)) : 96;
      const maxY = isRect ? Math.max(0, 100 - (Number(it.h) || 0)) : 96;
      it.x = Math.max(0, Math.min(maxX, x));
      it.y = Math.max(0, Math.min(maxY, y));
      const node = st.querySelector(`.ovitem[data-i="${i}"]`);
      if (node) { node.style.left = it.x + '%'; node.style.top = it.y + '%'; }
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}
// Corner-resize for box and arrow items: drag the bottom-right handle to set w/h.
function startResize(handle, i) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const st = document.getElementById('stampStage');
    const it = editorOverlays[i];
    const move = (ev) => {
      const rect = st.getBoundingClientRect();
      const px = (ev.clientX - rect.left) / rect.width * 100;
      const py = (ev.clientY - rect.top) / rect.height * 100;
      it.w = Math.max(3, Math.min(100 - it.x, px - it.x));
      it.h = Math.max(3, Math.min(100 - it.y, py - it.y));
      const node = st.querySelector(`.ovitem[data-i="${i}"]`);
      if (node) { node.style.width = it.w + '%'; node.style.height = it.h + '%'; }
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}
function renderStampCtl() {
  const box = document.getElementById('stampCtl');
  if (!box) return;
  if (editorSel < 0 || !editorOverlays[editorSel]) { box.innerHTML = '<div class="status">No item selected. Add one above.</div>'; return; }
  const it = editorOverlays[editorSel];
  const colors = ['#ffffff', '#000000', '#ff0000', '#c1121f', '#1d4ed8', '#f2c200', '#1b7a3d'];
  if (it.t === 'rect' || it.t === 'arrow') {
    const isArrow = it.t === 'arrow';
    box.innerHTML = `
      <label style="margin-top:12px">Selected: ${isArrow ? 'Arrow' : 'Box / Rectangle'}</label>
      <div class="status">Drag the ${isArrow ? 'arrow' : 'box'} to move it. Drag the blue corner dot to resize.</div>
      ${isArrow ? `<label style="margin-top:8px">Direction</label><div class="row compact"><button class="btn secondary slim" data-dir="se">↘</button><button class="btn secondary slim" data-dir="sw">↙</button><button class="btn secondary slim" data-dir="ne">↗</button><button class="btn secondary slim" data-dir="nw">↖</button></div>` : ''}
      <label style="margin-top:8px">Color</label>
      <div class="pill-group" id="ovColors">${colors.map(col => `<div class="pill" data-col="${col}" style="background:${col};width:34px;height:28px;${it.color === col ? 'outline:3px solid #1d4ed8;' : ''}"></div>`).join('')}
        <input type="color" id="ovColorPick" value="${/^#[0-9a-fA-F]{6}$/.test(it.color) ? it.color : '#ff0000'}" style="width:44px;height:32px;padding:0;border:1px solid #000;border-radius:6px" />
      </div>
      <label style="margin-top:8px">Line Thickness</label>
      <input type="range" class="stamp-slider" id="ovThick" min="0.2" max="3" step="0.1" value="${it.thickness || 0.6}" />
      <button class="btn secondary slim" id="ovDelete" style="color:#c1121f;margin-top:8px">Delete This ${isArrow ? 'Arrow' : 'Box'}</button>`;
    const tq = q => box.querySelector(q);
    box.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { it.color = b.getAttribute('data-col'); renderStampCtl(); drawOverlayItems(); });
    box.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { it.dir = b.getAttribute('data-dir'); drawOverlayItems(); });
    tq('#ovColorPick').oninput = () => { it.color = tq('#ovColorPick').value; drawOverlayItems(); };
    tq('#ovThick').oninput = () => { it.thickness = parseFloat(tq('#ovThick').value); drawOverlayItems(); };
    tq('#ovDelete').onclick = () => { editorOverlays.splice(editorSel, 1); editorSel = editorOverlays.length ? 0 : -1; drawOverlayItems(); renderStampCtl(); };
    return;
  }
  box.innerHTML = `
    <label style="margin-top:12px">Selected: ${OVERLAY_FIELD_LABELS[it.t]}</label>
    ${(it.t === 'custom' || it.t === 'copyright') ? `<input type="text" id="ovText" value="${esc(it.text || '')}" placeholder="Text" />` : ''}
    <label style="margin-top:8px">Position (corners)</label>
    <div class="row compact">
      <button class="btn secondary slim" data-pos="tl">Top L</button>
      <button class="btn secondary slim" data-pos="tr">Top R</button>
      <button class="btn secondary slim" data-pos="bl">Bot L</button>
      <button class="btn secondary slim" data-pos="br">Bot R</button>
    </div>
    <label style="margin-top:8px">Font</label>
    <select id="ovFont">
      <option value="sans"${it.font === 'sans' ? ' selected' : ''}>Sans (Arial)</option>
      <option value="serif"${it.font === 'serif' ? ' selected' : ''}>Serif (Georgia)</option>
      <option value="mono"${it.font === 'mono' ? ' selected' : ''}>Mono (Courier)</option>
      <option value="heavy"${it.font === 'heavy' ? ' selected' : ''}>Heavy (Impact)</option>
    </select>
    <label style="margin-top:8px">Color</label>
    <div class="pill-group" id="ovColors">${colors.map(col => `<div class="pill" data-col="${col}" style="background:${col};width:34px;height:28px;${it.color === col ? 'outline:3px solid #1d4ed8;' : ''}"></div>`).join('')}
      <input type="color" id="ovColorPick" value="${/^#[0-9a-fA-F]{6}$/.test(it.color) ? it.color : '#ffffff'}" style="width:44px;height:32px;padding:0;border:1px solid #000;border-radius:6px" />
    </div>
    <label style="margin-top:8px">Size</label>
    <input type="range" class="stamp-slider" id="ovSize" min="0.5" max="3" step="0.1" value="${it.size}" />
    <label style="display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-weight:bold;font-size:14px;margin-top:8px">
      <input type="checkbox" id="ovOutline" ${it.outline ? 'checked' : ''} style="width:20px;height:20px"> Outline for legibility
    </label>
    <button class="btn secondary slim" id="ovDelete" style="color:#c1121f;margin-top:8px">Delete This Item</button>`;
  const t = q => box.querySelector(q);
  if (t('#ovText')) t('#ovText').addEventListener('input', () => { it.text = t('#ovText').value; drawOverlayItems(); });
  box.querySelectorAll('[data-pos]').forEach(b => b.onclick = () => {
    const p = b.getAttribute('data-pos');
    it.x = (p === 'tl' || p === 'bl') ? 4 : 55;
    it.y = (p === 'tl' || p === 'tr') ? 4 : 86;
    drawOverlayItems();
  });
  t('#ovFont').onchange = () => { it.font = t('#ovFont').value; drawOverlayItems(); };
  box.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { it.color = b.getAttribute('data-col'); renderStampCtl(); drawOverlayItems(); });
  t('#ovColorPick').oninput = () => { it.color = t('#ovColorPick').value; drawOverlayItems(); };
  t('#ovSize').oninput = () => { it.size = parseFloat(t('#ovSize').value); drawOverlayItems(); };
  t('#ovOutline').onchange = () => { it.outline = t('#ovOutline').checked; drawOverlayItems(); };
  t('#ovDelete').onclick = () => { editorOverlays.splice(editorSel, 1); editorSel = editorOverlays.length ? 0 : -1; drawOverlayItems(); renderStampCtl(); };
}
async function saveOverlays() {
  const btn = document.getElementById('stampSave'); btn.disabled = true; btn.textContent = 'Saving...';
  const r = await api(`/api/captures/${editorCapture.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ overlays: editorOverlays }),
  });
  btn.disabled = false; btn.textContent = 'Save Changes';
  if (r.ok) { editorCapture.overlays = editorOverlays; toast('Changes saved'); }
  else toast('Save failed');
}
async function saveStampedCopy() {
  const btn = document.getElementById('stampCopy'); btn.disabled = true; btn.textContent = 'Preparing Download...';
  // save first so the server has the latest overlays
  await api(`/api/captures/${editorCapture.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overlays: editorOverlays }) });
  editorCapture.overlays = editorOverlays;
  try {
    const r = await api(`/api/captures/${editorCapture.id}/stamped?res=print`);
    if (!r.ok) throw new Error('bad');
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `photo-${editorCapture.id}-stamped.jpg`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Marked photo downloaded');
  } catch (e) { toast('Could not download marked photo'); }
  finally { btn.disabled = false; btn.textContent = 'Download Marked Photo'; }
}

// ================= Photo crop editor =================
// Non-destructive: applying a crop keeps the original so it can be restored.
let cropCapture = null, cropBox = null; // cropBox = {x,y,w,h} in % of the image
function renderCropEditor(c) {
  cropCapture = c;
  cropBox = { x: 10, y: 10, w: 80, h: 80 };
  const body = document.getElementById('body');
  body.innerHTML = `
    <button class="backlink" id="cropBack">‹ Back to Edit</button>
    <div class="formhead">Crop Photo</div>
    <div class="status">Drag the box to move it. Drag any corner to resize. Everything outside the box is trimmed off. Your original is kept and can be restored.</div>
    <div id="cropStage" style="position:relative;display:inline-block;max-width:100%;border:1px solid #000;border-radius:8px;overflow:hidden;touch-action:none">
      <img id="cropImg" src="${photoSrc(c.photo_path)}" alt="photo" style="display:block;max-width:100%;height:auto" />
    </div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="cropApply">Apply Crop</button>
      <button class="btn secondary" id="cropCancel">Cancel</button>
    </div>`;
  document.getElementById('cropBack').onclick = () => { state.view = 'edit'; renderEdit(); };
  document.getElementById('cropCancel').onclick = () => { state.view = 'edit'; renderEdit(); };
  document.getElementById('cropApply').onclick = applyCrop;
  const img = document.getElementById('cropImg');
  if (img.complete) drawCropBox(); else img.onload = drawCropBox;
}
function drawCropBox() {
  const st = document.getElementById('cropStage');
  if (!st) return;
  st.querySelectorAll('.cropui').forEach(n => n.remove());
  // Dark mask outside the crop box (four bands) so the kept area stands out.
  const b = cropBox;
  const bands = [
    { left: 0, top: 0, width: 100, height: b.y },
    { left: 0, top: b.y + b.h, width: 100, height: Math.max(0, 100 - b.y - b.h) },
    { left: 0, top: b.y, width: b.x, height: b.h },
    { left: b.x + b.w, top: b.y, width: Math.max(0, 100 - b.x - b.w), height: b.h },
  ];
  bands.forEach(bd => {
    const m = document.createElement('div');
    m.className = 'cropui cropmask';
    m.style.cssText = `position:absolute;left:${bd.left}%;top:${bd.top}%;width:${bd.width}%;height:${bd.height}%;background:rgba(0,0,0,0.5);pointer-events:none`;
    st.appendChild(m);
  });
  const box = document.createElement('div');
  box.className = 'cropui cropbox';
  box.style.cssText = `position:absolute;left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%;border:2px solid #fff;box-shadow:0 0 0 1px #000;box-sizing:border-box;cursor:move;touch-action:none`;
  startCropDrag(box);
  ['tl', 'tr', 'bl', 'br'].forEach(corner => {
    const hd = document.createElement('div');
    hd.className = 'cropui crophandle';
    const pos = {
      tl: 'left:-11px;top:-11px', tr: 'right:-11px;top:-11px',
      bl: 'left:-11px;bottom:-11px', br: 'right:-11px;bottom:-11px',
    }[corner];
    hd.style.cssText = `position:absolute;${pos};width:22px;height:22px;background:#1d4ed8;border:2px solid #fff;border-radius:50%;cursor:nwse-resize;touch-action:none`;
    startCropResize(hd, corner);
    box.appendChild(hd);
  });
  st.appendChild(box);
}
function startCropDrag(el) {
  el.addEventListener('pointerdown', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('crophandle')) return;
    e.preventDefault();
    const st = document.getElementById('cropStage');
    const r0 = st.getBoundingClientRect();
    const grabX = (e.clientX - r0.left) / r0.width * 100 - cropBox.x;
    const grabY = (e.clientY - r0.top) / r0.height * 100 - cropBox.y;
    const move = (ev) => {
      const r = st.getBoundingClientRect();
      let x = (ev.clientX - r.left) / r.width * 100 - grabX;
      let y = (ev.clientY - r.top) / r.height * 100 - grabY;
      cropBox.x = Math.max(0, Math.min(100 - cropBox.w, x));
      cropBox.y = Math.max(0, Math.min(100 - cropBox.h, y));
      drawCropBox();
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}
function startCropResize(handle, corner) {
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const st = document.getElementById('cropStage');
    const MIN = 8; // smallest crop, percent
    const move = (ev) => {
      const r = st.getBoundingClientRect();
      const px = Math.max(0, Math.min(100, (ev.clientX - r.left) / r.width * 100));
      const py = Math.max(0, Math.min(100, (ev.clientY - r.top) / r.height * 100));
      const x2 = cropBox.x + cropBox.w, y2 = cropBox.y + cropBox.h;
      if (corner === 'tl') {
        const nx = Math.min(px, x2 - MIN), ny = Math.min(py, y2 - MIN);
        cropBox.x = nx; cropBox.y = ny; cropBox.w = x2 - nx; cropBox.h = y2 - ny;
      } else if (corner === 'tr') {
        const ny = Math.min(py, y2 - MIN), nx2 = Math.max(px, cropBox.x + MIN);
        cropBox.y = ny; cropBox.h = y2 - ny; cropBox.w = nx2 - cropBox.x;
      } else if (corner === 'bl') {
        const nx = Math.min(px, x2 - MIN), ny2 = Math.max(py, cropBox.y + MIN);
        cropBox.x = nx; cropBox.w = x2 - nx; cropBox.h = ny2 - cropBox.y;
      } else { // br
        cropBox.w = Math.max(MIN, px - cropBox.x); cropBox.h = Math.max(MIN, py - cropBox.y);
      }
      drawCropBox();
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
}
async function applyCrop() {
  const btn = document.getElementById('cropApply');
  btn.disabled = true; btn.textContent = 'Cropping...';
  try {
    const r = await api(`/api/captures/${cropCapture.id}/crop`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cropBox),
    });
    if (!r.ok) throw new Error('crop failed');
    state.imgv++; // bust the image cache so the cropped photo shows
    toast('Photo cropped. Original saved.');
    state.view = 'edit'; renderEdit();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Apply Crop';
    toast('Crop failed, try again');
  }
}
async function restoreOriginal(id) {
  try {
    const r = await api(`/api/captures/${id}/restore-original`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    if (!r.ok) throw new Error('bad');
    state.imgv++;
    toast('Original photo restored');
    loadCards(document.getElementById('filter') ? (document.getElementById('filter').value || '') : '');
  } catch (e) { toast('Restore failed'); }
}

function startEditNote(id, rows) {
  const wrap = document.querySelector(`.notewrap[data-id="${id}"]`);
  if (!wrap) return;
  const row = rows.find(r => r.id === id);
  const current = row ? (row.note || '') : '';
  wrap.innerHTML = `
    <textarea class="editarea">${esc(current)}</textarea>
    <div class="row" style="margin-top:6px">
      <button class="btn savenote">Save</button>
      <button class="btn secondary cancelnote">Cancel</button>
    </div>`;
  const ta = wrap.querySelector('.editarea');
  ta.focus();
  wrap.querySelector('.cancelnote').onclick = () => loadCards(document.getElementById('filter').value || '');
  wrap.querySelector('.savenote').onclick = () => saveNote(id, ta.value, () => loadCards(document.getElementById('filter').value || ''));
}

function startEditPhotoTitle(id, rows) {
  const wrap = document.querySelector(`.phototitlewrap[data-id="${id}"]`);
  if (!wrap) return;
  const row = rows.find(r => r.id === id);
  const current = row ? (row.photo_title || '') : '';
  wrap.innerHTML = `<label for="photoTitle${id}">Photo Title</label><input id="photoTitle${id}" class="photo-title-input" maxlength="200" value="${esc(current)}" placeholder="Add a short descriptive title"><div class="row compact"><button class="btn slim savephototitle" type="button">Save Title</button><button class="btn secondary slim cancelphototitle" type="button">Cancel</button></div>`;
  const input = wrap.querySelector('.photo-title-input');
  titleCaseInput(input); input.focus(); input.select();
  wrap.querySelector('.cancelphototitle').onclick = () => loadCards((document.getElementById('filter')||{}).value||'');
  wrap.querySelector('.savephototitle').onclick = async () => {
    const value=input.value.trim();
    if(!value){toast('Enter a photo title');return;}
    const r=await api(`/api/captures/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({photo_title:value})});
    if(r.ok){toast('Photo title saved');loadCards((document.getElementById('filter')||{}).value||'');}
    else toast('Photo title could not be saved');
  };
  input.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();wrap.querySelector('.savephototitle').click();}if(e.key==='Escape')wrap.querySelector('.cancelphototitle').click();};
}

function startEditTopics(id, rows) {
  const wrap=document.querySelector(`.topicwrap[data-id="${id}"]`);if(!wrap)return;
  const row=rows.find(r=>r.id===id),current=new Set(row&&row.area_tags||[]);
  wrap.innerHTML=`<fieldset class="topic-editor"><legend>Topics for this photo</legend>${state.areas.map(a=>`<label><input type="checkbox" value="${esc(a)}" ${current.has(a)?'checked':''}> ${esc(a)}</label>`).join('')}<div class="row compact"><button class="btn slim savetopics" type="button">Save Topics</button><button class="btn secondary slim canceltopics" type="button">Cancel</button></div></fieldset>`;
  wrap.querySelector('.canceltopics').onclick=()=>loadCards((document.getElementById('filter')||{}).value||'');
  wrap.querySelector('.savetopics').onclick=async()=>{const area_tags=Array.from(wrap.querySelectorAll('input:checked')).map(x=>x.value);const r=await api(`/api/captures/${id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({area_tags})});if(r.ok){toast('Photo topics saved');loadCards((document.getElementById('filter')||{}).value||'');}else toast('Photo topics could not be saved');};
}

// ---- Map (Pro): satellite view of captures + measurement zones ----
let mapObj = null, mapMarkers = [], mapZoneLayers = [];
function loadLeaflet() {
  return new Promise((resolve) => {
    if (window.L) return resolve();
    if (!document.getElementById('leafletcss')) {
      const css = document.createElement('link'); css.id = 'leafletcss'; css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
    }
    const s = document.createElement('script'); s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => resolve(); s.onerror = () => resolve(); document.head.appendChild(s);
  });
}
async function renderMap() {
  const body = document.getElementById('body');
  body.className = 'workflow-organize';
  body.innerHTML = `
    <div class="workflow-intro"><strong>Job Site Map</strong><span>See where saved photos were taken, filter them by topic or document, and measure pavement areas or roadway spans for takeoffs.</span></div>
    <div class="row map-filter-row">
      <div>
        <label for="mapTopic" style="margin-top:0">Filter by Topic</label>
        <select id="mapTopic"><option value="">All Topics</option>${state.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
      </div>
      <div>
        <label for="mapGroup" style="margin-top:0">Filter by Document</label>
        <select id="mapGroup"><option value="">All Documents</option></select>
      </div>
    </div>
    <div class="status" style="margin-top:4px">Satellite imagery can be one or more years old. Verify recent construction on site.</div>
    <label style="margin-top:14px">Optional Takeoff Tools</label>
    <div class="status">Trace a pavement area or measure a roadway span directly on the satellite map.</div>
    <div id="mapMeasureBar" style="margin-top:6px"></div>
    <div id="mapdiv" style="height:68vh;min-height:340px;margin-top:8px;border:1px solid #000;border-radius:8px"></div>`;
  await loadLeaflet();
  if (!window.L) { document.getElementById('mapdiv').innerHTML = '<p class="status">Map library could not load. Check your connection.</p>'; return; }
  mapObj = null; mapMarkers = []; mapZoneLayers = [];
  let cfg = {}; try { const c = await api('/api/config'); if (c.ok) cfg = await c.json(); } catch (e) {}
  window._mapCfg = cfg;
  const gsel = document.getElementById('mapGroup');
  try { const gr = await api('/api/groups'); if (gr.ok) { const gs = await gr.json(); gsel.innerHTML = '<option value="">All Documents</option>' + gs.map(g => `<option value="${g.id}">${esc(g.title || 'Untitled')}</option>`).join(''); } } catch (e) {}
  const div = document.getElementById('mapdiv');
  mapObj = L.map(div).setView([29.5, -98.5], 12);
  if (cfg.mapbox_token) {
    L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}@2x?access_token=${cfg.mapbox_token}`, { tileSize: 512, zoomOffset: -1, maxZoom: 22, attribution: '&copy; Mapbox &copy; Maxar' }).addTo(mapObj);
  } else {
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 21, attribution: 'Tiles &copy; Esri, Maxar, Earthstar Geographics' }).addTo(mapObj);
  }
  mapObj.on('popupopen', (e) => {
    const btn = e.popup.getElement().querySelector('.mapopen');
    if (btn) btn.onclick = () => openCaptureInLibrary(parseInt(btn.getAttribute('data-id'), 10));
  });
  document.getElementById('mapTopic').onchange = refreshPins;
  gsel.onchange = refreshPins;
  if (typeof initMeasureUI === 'function') initMeasureUI();
  await refreshPins();
  if (typeof loadZones === 'function') await loadZones();
}
async function refreshPins() {
  if (!mapObj) return;
  mapMarkers.forEach(m => mapObj.removeLayer(m)); mapMarkers = [];
  const topic = document.getElementById('mapTopic').value;
  const groupId = document.getElementById('mapGroup').value;
  let caps = [];
  if (groupId) { try { const r = await api(`/api/groups/${groupId}`); if (r.ok) { const d = await r.json(); caps = d.items || []; } } catch (e) {} if (topic) caps = caps.filter(c => (c.area_tags || []).includes(topic)); }
  else { try { const r = await api('/api/captures' + (topic ? `?area=${encodeURIComponent(topic)}` : '')); if (r.ok) caps = await r.json(); } catch (e) {} }
  const pts = [];
  for (const c of caps) {
    if (c.latitude == null || c.longitude == null) continue;
    const color = c.defect_type ? severityColorClient(c.defect_severity) : '#444444';
    const m = L.circleMarker([c.latitude, c.longitude], { radius: 8, color: '#000', weight: 1, fillColor: color, fillOpacity: 0.9 });
    m.bindPopup(mapPopupHtml(c));
    m.addTo(mapObj); mapMarkers.push(m); pts.push([c.latitude, c.longitude]);
  }
  if (pts.length) { try { mapObj.fitBounds(pts, { padding: [30, 30], maxZoom: 19 }); } catch (e) {} }
}
function mapPopupHtml(c) {
  const note = (c.note || '').slice(0, 120);
  const badge = (isProClient() && c.defect_type) ? defectBadgeHtml(c) : '';
  return `<div style="max-width:210px">
    <div class="photo-title">${esc(c.photo_title||'Untitled photo')}</div>
    ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" style="width:100%;border-radius:4px" />` : ''}
    ${badge ? `<div style="margin:4px 0">${badge}</div>` : ''}
    ${photoLocationHtml(c,'No location')}
    <div style="font-size:12px;color:#000">${esc(note)}${(c.note || '').length > 120 ? '…' : ''}</div>
    <button class="mapopen" data-id="${c.id}" style="margin-top:6px">Open in Organize</button>
  </div>`;
}
function openCaptureInLibrary(id) {
  state._focusCapture = id;
  state.view = 'organize';
  renderApp();
}

// ---- Measurement zones (Pro): draw + save on the Map ----
function clientProject(points) {
  const n = points.length; let la = 0, lo = 0;
  points.forEach(p => { la += p.lat; lo += p.lng; });
  const lat0 = la / n, lng0 = lo / n, R = 6371000, rad = d => d * Math.PI / 180;
  return points.map(p => ({ x: R * rad(p.lng - lng0) * Math.cos(rad(lat0)), y: R * rad(p.lat - lat0) }));
}
function clientPolygonAreaSqft(points) {
  if (points.length < 3) return null;
  const pl = clientProject(points); let a = 0;
  for (let i = 0; i < pl.length; i++) { const j = (i + 1) % pl.length; a += pl[i].x * pl[j].y - pl[j].x * pl[i].y; }
  return Math.abs(a) / 2 * 10.7639;
}
function clientHaversineFt(a, b) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) * 3.28084;
}
function clientSpanLengthFeet(points) {
  if (points.length < 2) return null;
  let ft = 0; for (let i = 0; i < points.length - 1; i++) ft += clientHaversineFt(points[i], points[i + 1]);
  return ft;
}
function initMeasureUI() {
  const bar = document.getElementById('mapMeasureBar');
  if (!bar) return;
  bar.innerHTML = `<div class="row compact">
      <button class="btn secondary slim" id="drawArea">Trace Area</button>
      <button class="btn secondary slim" id="drawSpan">Measure Span</button>
      <button class="btn secondary slim" id="drawCancel" style="display:none">Cancel</button>
      <button class="btn slim" id="drawFinish" style="display:none">Finish</button>
    </div>
    <div class="status" id="drawReadout"></div>`;
  document.getElementById('drawArea').onclick = () => startDraw('polygon');
  document.getElementById('drawSpan').onclick = () => startDraw('span');
  document.getElementById('drawCancel').onclick = cancelDraw;
  document.getElementById('drawFinish').onclick = finishDraw;
}
function startDraw(mode, existing) {
  cancelDraw();
  window._draw = { mode, points: [], markers: [], poly: null, line: null, editId: (existing && existing.id) || null };
  document.getElementById('drawCancel').style.display = '';
  document.getElementById('drawFinish').style.display = '';
  document.getElementById('drawArea').style.display = 'none';
  document.getElementById('drawSpan').style.display = 'none';
  document.getElementById('drawReadout').textContent = mode === 'polygon'
    ? 'Tap the map to drop area corners. Drag a corner to adjust. Tap Finish to close.'
    : 'Tap points along the road centerline, then Finish and enter width.';
  mapObj.on('click', onDrawClick);
  if (existing && Array.isArray(existing.points)) { existing.points.forEach(p => addVertex(L.latLng(p.lat, p.lng))); }
}
function addVertex(latlng) {
  const d = window._draw; if (!d) return;
  d.points.push({ lat: latlng.lat, lng: latlng.lng });
  const mk = L.marker(latlng, { draggable: true }); mk.addTo(mapObj);
  mk.on('drag', (ev) => { const idx = d.markers.indexOf(mk); const ll = ev.target.getLatLng(); d.points[idx] = { lat: ll.lat, lng: ll.lng }; redrawDraw(); });
  d.markers.push(mk);
  redrawDraw();
}
function onDrawClick(e) { addVertex(e.latlng); }
function redrawDraw() {
  const d = window._draw; if (!d) return;
  const latlngs = d.points.map(p => [p.lat, p.lng]);
  const ro = document.getElementById('drawReadout');
  if (d.mode === 'polygon') {
    if (d.poly) mapObj.removeLayer(d.poly);
    d.poly = L.polygon(latlngs, { color: '#1f4d2e', weight: 2, fillColor: '#1f4d2e', fillOpacity: 0.25 }).addTo(mapObj);
    const a = clientPolygonAreaSqft(d.points);
    if (ro) ro.textContent = d.points.length < 3 ? `${d.points.length} corner(s)` : `Area: ${a ? Math.round(a).toLocaleString() : '—'} sq ft (${d.points.length} corners)`;
  } else {
    if (d.line) mapObj.removeLayer(d.line);
    d.line = L.polyline(latlngs, { color: '#1f4d2e', weight: 3 }).addTo(mapObj);
    const len = clientSpanLengthFeet(d.points);
    if (ro) ro.textContent = d.points.length < 2 ? `${d.points.length} point(s)` : `Length: ${len ? Math.round(len).toLocaleString() : '—'} ft`;
  }
}
async function finishDraw() {
  const d = window._draw; if (!d) return;
  if (d.mode === 'polygon' && d.points.length < 3) { toast('Add at least 3 corners'); return; }
  if (d.mode === 'span' && d.points.length < 2) { toast('Add at least 2 points'); return; }
  let width = null;
  if (d.mode === 'span') { const w = prompt(uiT('Pavement width in feet (a standard two-lane residential road is 24):'), '24'); if (w == null) return; width = parseFloat(w); if (!isFinite(width) || width <= 0) { toast('Enter a valid width'); return; } }
  const gsel = document.getElementById('mapGroup'); const groupId = gsel ? gsel.value : '';
  let name, url, body;
  if (d.editId) {
    url = `/api/zones/${d.editId}`;
    body = { points: d.points }; if (width != null) body.width_ft = width;
  } else {
    name = prompt(uiT('Name this zone:'), uiT(d.mode === 'polygon' ? 'Area' : 'Roadway')); if (name == null) return;
    url = '/api/zones';
    body = { name: name.trim() || 'Zone', zone_type: d.mode, points: d.points, width_ft: width, group_id: groupId || null };
  }
  const r = await api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const res = await r.json().catch(() => ({}));
  if (r.ok) { toast('Zone saved'); cancelDraw(); await loadZones(); } else { toast(res.error || 'Could not save zone'); }
}
function cancelDraw() {
  const d = window._draw;
  if (d && mapObj) { d.markers.forEach(m => mapObj.removeLayer(m)); if (d.poly) mapObj.removeLayer(d.poly); if (d.line) mapObj.removeLayer(d.line); }
  window._draw = null;
  if (mapObj) mapObj.off('click', onDrawClick);
  ['drawCancel', 'drawFinish'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  ['drawArea', 'drawSpan'].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = ''; });
  const ro = document.getElementById('drawReadout'); if (ro) ro.textContent = '';
}
async function loadZones() {
  if (!mapObj) return;
  mapZoneLayers.forEach(l => mapObj.removeLayer(l)); mapZoneLayers = [];
  const gsel = document.getElementById('mapGroup'); const groupId = gsel ? gsel.value : '';
  let zones = [];
  try { const r = await api('/api/zones' + (groupId ? `?group=${groupId}` : '')); if (r.ok) zones = await r.json(); } catch (e) {}
  for (const z of zones) {
    const pts = (z.points || []).map(p => [p.lat, p.lng]);
    if (!pts.length) continue;
    const layer = z.zone_type === 'polygon'
      ? L.polygon(pts, { color: '#1f4d2e', weight: 2, fillColor: '#1f4d2e', fillOpacity: 0.25 })
      : L.polyline(pts, { color: '#1f4d2e', weight: 4, opacity: 0.75 });
    layer.addTo(mapObj); mapZoneLayers.push(layer);
    let defc = '—';
    try { const dr = await api(`/api/zones/${z.id}/defects`); if (dr.ok) { const dd = await dr.json(); defc = dd.count; } } catch (e) {}
    layer.bindPopup(zonePopupHtml(z, defc));
    layer.on('popupopen', (e) => wireZonePopup(e, z));
  }
}
function zonePopupHtml(z, defc) {
  const len = z.length_ft != null ? Math.round(z.length_ft).toLocaleString() + ' ft' : '—';
  const area = z.area_sqft != null ? Math.round(z.area_sqft).toLocaleString() + ' sq ft' : '—';
  return `<div style="min-width:190px">
    <div style="font-weight:bold;color:#000">${esc(z.name)}</div>
    <div style="font-size:12px;color:#000">${z.zone_type === 'polygon' ? 'approx length ' : ''}${len}, ${area}, ${defc} defects</div>
    <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
      <button class="zn-edit" data-id="${z.id}">Edit points</button>
      <button class="zn-rename" data-id="${z.id}">Rename</button>
      <button class="zn-attach" data-id="${z.id}">Attach to document</button>
      <button class="zn-del" data-id="${z.id}">Delete</button>
    </div>
  </div>`;
}
function wireZonePopup(e, z) {
  const root = e.popup.getElement(); if (!root) return;
  const q = (c) => root.querySelector(c);
  const ed = q('.zn-edit'); if (ed) ed.onclick = () => { mapObj.closePopup(); startDraw(z.zone_type, z); };
  const rn = q('.zn-rename'); if (rn) rn.onclick = async () => {
    const name = prompt(uiT('Rename zone:'), z.name); if (name == null) return;
    const r = await api(`/api/zones/${z.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (r.ok) { toast('Renamed'); loadZones(); } else toast('Rename failed');
  };
  const at = q('.zn-attach'); if (at) at.onclick = async () => {
    const gsel = document.getElementById('mapGroup'); const gid = gsel ? gsel.value : '';
    if (!gid) { toast('Choose a document in the filter above first, then Attach'); return; }
    const r = await api(`/api/zones/${z.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_id: gid }) });
    if (r.ok) { toast('Attached to document'); loadZones(); } else toast('Attach failed');
  };
  const dl = q('.zn-del'); if (dl) dl.onclick = async () => {
    if (!confirm(uiT('Delete this zone?'))) return;
    const r = await api(`/api/zones/${z.id}/delete`, { method: 'POST' });
    if (r.ok) { toast('Zone deleted'); loadZones(); } else toast('Delete failed');
  };
}

// ---- Send: deliver individual captures or completed documents ----
async function renderSend() {
  const body = document.getElementById('body');
  body.className = 'workflow-send';
  body.innerHTML = `
    <div class="workflow-intro"><strong>Send your finished work</strong><span>Share the original photos, or download a PDF, Word document, or AI-ready package.</span></div>
    <div class="formhead">Share or Download Selected Captures</div>
    ${isMacClient() ? `<div class="share-requirement"><strong>Texting an Android phone from this Mac?</strong><span>Your iPhone must have Settings → Apps → Messages → Text Message Forwarding enabled for this Mac, plus MMS or RCS messaging.</span></div>` : ''}
    <div class="send-selection-bar">
      <div class="status" id="sendSelection">Loading captures...</div>
      <div class="send-selection-actions">
        <button class="btn secondary slim" id="selectAllSendCaptures" type="button">Select All</button>
        <button class="btn secondary slim" id="clearSendSelection" type="button">Clear All</button>
      </div>
    </div>
    <div class="delivery-actions">
      <button class="btn" id="sharephotos">Share Photos</button>
      <select id="sendformat" aria-label="Download format"><option value="pdf">PDF</option><option value="docx">Word</option><option value="bundle">Markdown + Photos</option></select>
      <button class="btn secondary" id="senddocument">Download</button>
    </div>
    <div id="sendCaptures" class="send-capture-list"></div>
    <div class="formhead" style="margin-top:30px">Customer Approval Package</div>
    <p class="status">Create a private, expiring review link for the selected photos. The customer can approve them or request changes.</p>
    <input id="approvalTitle" placeholder="Review title"><textarea id="approvalMessage" placeholder="Message to customer (optional)"></textarea>
    <button class="btn" id="createApproval">Create Customer Review Link</button><div id="approvalResult"></div><div id="approvalList"></div>
    <div class="formhead" style="margin-top:30px">Send a Document</div>
    <div id="sendDocs"><p class="status">Loading documents...</p></div>
    <div id="billingOffers"></div>`;
  document.getElementById('sharephotos').onclick = shareSelectedPhotos;
  document.getElementById('senddocument').onclick = () => deliverExport(document.getElementById('sendformat').value, null, false);
  document.getElementById('selectAllSendCaptures').onclick = selectAllSendCaptures;
  document.getElementById('clearSendSelection').onclick = clearSendSelection;
  document.getElementById('createApproval').onclick=createApprovalPackage;
  loadSendCenter();
  loadApprovalPackages();
  loadBillingOffers();
}

async function loadBillingOffers(){const box=document.getElementById('billingOffers');if(!box)return;try{const r=await api('/api/billing/config');if(!r.ok)return;const d=await r.json(),offers=Object.entries(d.offers||{});if(!d.checkout_enabled||!offers.length){box.innerHTML='';return;}box.innerHTML=`<div class="formhead" style="margin-top:30px">Payments</div><p class="status">Pay securely on Stripe’s hosted checkout page.</p>${offers.map(([slug,o])=>`<div class="card delivery-card"><div><strong>${esc(o.label)}</strong><div class="meta">Provided by ${esc(o.dba)}</div></div><button class="btn slim billing-checkout" data-offer="${esc(slug)}">Pay with Stripe</button></div>`).join('')}`;box.querySelectorAll('.billing-checkout').forEach(button=>button.onclick=()=>startStripeCheckout(button));}catch(e){box.innerHTML='';}}
async function startStripeCheckout(button){button.disabled=true;button.textContent='Opening Stripe...';try{const r=await api('/api/billing/checkout',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':`checkout-${Date.now()}-${crypto.randomUUID()}`},body:JSON.stringify({offer:button.dataset.offer,quantity:1})}),d=await r.json();if(!r.ok||!d.url)throw new Error();location.assign(d.url);}catch(e){toast('Stripe checkout could not be opened');button.disabled=false;button.textContent='Pay with Stripe';}}

async function createApprovalPackage(){const ids=Array.from(state.selectedIds).map(Number);if(!ids.length){toast('Select at least one capture');return;}const title=document.getElementById('approvalTitle').value.trim()||'Photo Review',message=document.getElementById('approvalMessage').value.trim();const r=await api('/api/approvals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids,title,message})});const d=await r.json().catch(()=>({}));if(!r.ok){toast(d.error||'Review link could not be created');return;}const box=document.getElementById('approvalResult');box.innerHTML=`<div class="card"><strong>Customer review link ready</strong><input id="approvalUrl" readonly value="${esc(d.url)}"><button class="btn secondary slim" id="copyApproval">Copy Link</button><div class="meta">Expires in 14 days</div></div>`;document.getElementById('copyApproval').onclick=async()=>{try{await navigator.clipboard.writeText(d.url);toast('Link copied');}catch(e){document.getElementById('approvalUrl').select();}};loadApprovalPackages();}
async function loadApprovalPackages(){const box=document.getElementById('approvalList');if(!box)return;const r=await api('/api/approvals');if(!r.ok)return;const rows=await r.json();box.innerHTML=rows.length?`<div class="formhead">Recent Customer Reviews</div>${rows.slice(0,10).map(x=>`<div class="card"><strong>${esc(x.title)}</strong> <span class="badge">${esc(x.status.replace('_',' '))}</span><div class="meta">${x.photo_count} photo${x.photo_count===1?'':'s'} · expires ${new Date(x.expires_at).toLocaleDateString(uiLocale())}</div>${x.customer_name?`<div>Response from ${esc(x.customer_name)}${x.customer_comment?`: ${esc(x.customer_comment)}`:''}</div>`:''}<button class="btn secondary slim copyExistingApproval" data-url="${esc(location.origin+'/review/'+x.token)}">Copy Link</button></div>`).join('')}`:'';box.querySelectorAll('.copyExistingApproval').forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(b.dataset.url);toast('Link copied');}catch(e){}});}

async function loadSendCenter() {
  const [cr, gr] = await Promise.all([api('/api/captures'), api('/api/groups')]);
  const captures = cr.ok ? await cr.json() : [];
  const groups = gr.ok ? await gr.json() : [];
  window._sendCaptures = captures;
  window._sendGroups = groups;
  const capBox = document.getElementById('sendCaptures');
  const visible = captures.slice(0, 40);
  capBox.innerHTML = visible.length ? visible.map(c => `
    <label class="send-capture-row">
      <input type="checkbox" class="sendchk" value="${c.id}" ${state.selectedIds.has(String(c.id)) ? 'checked' : ''}>
      ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="">` : '<span class="send-no-photo">Note</span>'}
      <span><strong>${esc((c.area_tags || []).join(', ') || 'Unfiled')}</strong><small>${esc(c.note || 'No caption')}</small></span>
    </label>`).join('') : '<p class="empty">Nothing has been captured yet.</p>';
  capBox.querySelectorAll('.sendchk').forEach(c => c.onchange = () => { if (c.checked) state.selectedIds.add(String(c.value)); else state.selectedIds.delete(String(c.value)); updateSendCount(); });
  updateSendCount();
  const docs = document.getElementById('sendDocs');
  docs.innerHTML = groups.length ? groups.map(g => `
    <div class="card delivery-card">
      <div><strong>${esc(g.title || 'Untitled document')}</strong><div class="meta">${g.item_count} photo${g.item_count === 1 ? '' : 's'}</div></div>
      <div class="delivery-grid">
        <button class="btn slim" data-deliver="share" data-group="${g.id}">Share PDF</button>
        <button class="btn secondary slim" data-deliver="print" data-group="${g.id}">Print</button>
        <button class="btn secondary slim" data-deliver="pdf" data-group="${g.id}">Save PDF</button>
        <button class="btn secondary slim" data-deliver="docx" data-group="${g.id}">Save Word</button>
        <button class="btn secondary slim" data-deliver="bundle" data-group="${g.id}">AI ZIP</button>
      </div>
    </div>`).join('') : '<p class="empty">Create a document first, or send selected captures above.</p>';
  docs.querySelectorAll('[data-deliver]').forEach(b => b.onclick = () => deliverExport(b.getAttribute('data-deliver'), b.getAttribute('data-group'), false));
}

function updateSendCount() {
  const n = state.selectedIds.size;
  const s = document.getElementById('sendSelection');
  if (s) s.textContent = n ? `${n} capture${n === 1 ? '' : 's'} selected. Change the selection below or return to Organize.` : 'Select one or more captures below, or return to Organize.';
  const clear = document.getElementById('clearSendSelection');
  if (clear) clear.disabled = !n;
  const selectAll = document.getElementById('selectAllSendCaptures');
  const available = (window._sendCaptures || []).filter(capture => capture && capture.id != null);
  if (selectAll) selectAll.disabled = !available.length || available.every(capture => state.selectedIds.has(String(capture.id)));
}

function selectAllSendCaptures() {
  (window._sendCaptures || []).forEach(capture => {
    if (capture && capture.id != null) state.selectedIds.add(String(capture.id));
  });
  document.querySelectorAll('.sendchk').forEach(checkbox => { checkbox.checked = true; });
  updateSendCount();
  toast('All captures selected');
}

function clearSendSelection() {
  state.selectedIds.clear();
  document.querySelectorAll('.sendchk').forEach(checkbox => { checkbox.checked = false; });
  updateSendCount();
  toast('Selection cleared');
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function exportBlob(format, groupId) {
  const ids = Array.from(state.selectedIds);
  if (!groupId && !ids.length) throw new Error('Select at least one capture');
  const q = groupId ? `group=${groupId}` : `ids=${ids.join(',')}`;
  const r = await api(`/api/export/${format}?${q}&res=standard&fmt=jpeg`);
  if (!r.ok) throw new Error('Could not build document');
  return r.blob();
}

function safeSharedFileName(action, groupId, ext) {
  let base = '';
  if (groupId) {
    const group = (window._sendGroups || []).find(g => String(g.id) === String(groupId));
    base = group && group.title ? group.title : 'Document';
  } else {
    const selected = (window._sendCaptures || []).filter(c => state.selectedIds.has(String(c.id)));
    base = selected.length === 1
      ? (shareAddress(selected[0].address) || 'Photo')
      : `${selected.length || ''} Photos`.trim();
  }
  base = String(base).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'Document';
  return `${base}.${ext}`;
}

async function deliverExport(action, groupId, selectedOnly) {
  const format = action === 'share' || action === 'print' ? 'pdf' : action;
  const ext = format === 'bundle' ? 'zip' : format;
  const name = safeSharedFileName(action, groupId, ext);
  try {
    const blob = await exportBlob(format, groupId);
    if (action === 'print') {
      const url = URL.createObjectURL(blob); const w = window.open(url, '_blank');
      if (w) setTimeout(() => { try { w.print(); } catch (e) {} }, 900);
      else downloadBlob(blob, name);
      return;
    }
    if (action === 'share' || selectedOnly) {
      const file = new File([blob], name, { type: blob.type || (format === 'pdf' ? 'application/pdf' : 'application/octet-stream') });
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({ files: [file] }); return;
      }
    }
    downloadBlob(blob, name);
    toast('File ready. Attach it to email, text, or upload it to Drive.');
  } catch (e) { if (!(e && e.name === 'AbortError')) toast(e.message || 'Send failed'); }
}

async function shareSelectedPhotos() {
  const rows = (window._sendCaptures || []).filter(c => state.selectedIds.has(String(c.id)));
  if (!rows.length) { toast('Select at least one capture'); return; }
  try {
    const files = [];
    for (const c of rows) {
      if (!c.photo_path) continue;
      const r = await fetch(c.photo_path, { credentials: 'same-origin' });
      if (r.ok) { const b = await r.blob(); files.push(new File([b], `photo-${c.id}.${b.type.includes('png') ? 'png' : 'jpg'}`, { type: b.type || 'image/jpeg' })); }
    }
    // A shared photo starts with the job-site address, followed by its note.
    // Topics are organizational metadata and do not belong in the message.
    const text = rows.map(c => [shareAddress(c.address), c.note].filter(Boolean).join('\n')).join('\n\n');
    if (navigator.share && files.length && (!navigator.canShare || navigator.canShare({ files }))) { await navigator.share({ title: 'Photo Notes', text, files }); return; }
    await deliverExport('share', null, true);
  } catch (e) { if (!(e && e.name === 'AbortError')) toast('Could not share photos'); }
}

// ---- Create (ordered documents, stored as groups) ----
async function renderGroups() {
  if (state.ewrId != null) { renderEwrDetail(); return; }
  if (state.groupId) { renderGroupDetail(state.groupId); return; }
  const body = document.getElementById('body');
  body.className = 'workflow-create';
  body.innerHTML = `
    <div class="workflow-intro"><strong>Create a document</strong><span>Build an ordered report from organized captures. PDF and Word documents include the title, description, photos, captions, dates, topics, and locations.</span></div>
    <div class="formhead">Start a New Document</div>
    <input id="gtitle" type="text" placeholder="Document Title" style="font-size:18px;font-weight:bold" />
    <textarea id="gdesc" placeholder="Subtitle or description (optional)" style="min-height:60px;margin-top:8px"></textarea>
    <div class="status">${state.selectedIds.size ? `${state.selectedIds.size} selected capture${state.selectedIds.size === 1 ? '' : 's'} will be added.` : 'You can create an empty document, then add captures from Organize.'}</div>
    <button class="btn slim" id="gcreate">Create Document</button>

    <div class="formhead" style="margin-top:30px">Your Documents</div>
    <div id="glist"></div>`;
  document.getElementById('gcreate').onclick = createGroup;
  titleCaseInput(document.getElementById('gtitle'));
  loadGroups();
}

async function createGroup() {
  const title = document.getElementById('gtitle').value.trim() || 'Untitled group';
  const description = document.getElementById('gdesc').value.trim();
  const btn = document.getElementById('gcreate');
  btn.disabled = true;
  try {
    const r = await api('/api/groups', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, ids: Array.from(state.selectedIds) }),
    });
    if (!r.ok) throw new Error('bad');
    const created = await r.json();
    state.selectedIds.clear();
    state.groups = null;
    state.groupId = created.id;
    toast('Document created. Add or review its contents below.');
    await renderGroups();
  } catch (e) { toast('Could not create group'); }
  finally { btn.disabled = false; }
}

async function loadGroups() {
  const list = document.getElementById('glist');
  if (!list) return;
  if (Array.isArray(state.groups)) renderGroupCards(list, state.groups);
  else list.innerHTML = '<p class="status">Loading your documents...</p>';
  const r = await api('/api/groups');
  if (!r.ok) { list.innerHTML = '<p class="status">Could not load.</p>'; return; }
  const groups = await r.json();
  state.groups = groups;
  // The user may have changed sections while this request was running.
  if (!list.isConnected) return;
  renderGroupCards(list, groups);
}

function renderGroupCards(list, groups) {
  if (!groups.length) { list.innerHTML = '<p class="empty">No documents yet. Select captures in Organize, then create your first document above.</p>'; return; }
  list.innerHTML = groups.map(g => `
    <article class="card document-card">
      <div style="font-weight:bold;font-size:17px">${esc(g.title || 'Untitled group')}</div>
      ${g.description ? `<div style="margin:4px 0">${esc(g.description)}</div>` : ''}
      <div class="meta">${g.item_count} photo${g.item_count === 1 ? '' : 's'}${(isProClient() && g.score != null) ? ` <span class="scorechip" style="background:${scoreColor(g.score)}">Score ${g.score} · ${esc(g.band)}</span>` : ''}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn slim gopen" data-id="${g.id}">Edit Document</button>
        <button class="btn secondary slim" data-id="${g.id}" data-del="1" style="color:#c1121f">Delete</button>
      </div>
    </article>`).join('');
  list.querySelectorAll('.gopen').forEach(b => b.onclick = () => { state.groupId = parseInt(b.getAttribute('data-id'), 10); renderGroups(); });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = () => deleteGroup(parseInt(b.getAttribute('data-id'), 10)));
}

// Condition-score color: green good -> red failed (pins/badges only, never text).
function scoreColor(score) {
  if (score == null) return '#444444';
  if (score >= 86) return '#1b7a3d';
  if (score >= 71) return '#2f7d32';
  if (score >= 56) return '#b36b00';
  if (score >= 41) return '#c1121f';
  if (score >= 26) return '#8a1a12';
  return '#5a0f0a';
}

async function deleteGroup(id) {
  if (!confirm(uiT('Delete this document? The photos themselves are kept.'))) return;
  const r = await api(`/api/groups/${id}/delete`, { method: 'POST' });
  if (r.ok) { toast('Document deleted'); loadGroups(); } else toast('Delete failed');
}

async function renderGroupDetail(id) {
  const body = document.getElementById('body');
  body.innerHTML = '<p class="status">Loading...</p>';
  const r = await api(`/api/groups/${id}`);
  if (!r.ok) { body.innerHTML = '<p class="status">Could not load group.</p>'; return; }
  const data = await r.json();
  currentGroup = data.group;
  currentGroupItems = data.items || [];
  currentGroupPairs = data.pairs || [];
  const score = data.score || null;
  const zsum = data.zones || null;
  let scoreHtml = '';
  if (isProClient() && score) {
    if (score.score == null) {
      scoreHtml = `<div class="card" style="text-align:center"><div class="fieldval">Not yet scored</div><div class="meta">Classify captures in this site to generate a condition score.</div></div>`;
    } else {
      scoreHtml = `<div class="card" style="text-align:center">
        <div style="font-size:40px;font-weight:800;color:${scoreColor(score.score)}">${score.score}</div>
        <div style="font-size:18px;font-weight:bold">${esc(score.band)}</div>
        <div class="meta">Score based on ${score.classified} of ${score.total} captures classified${score.unclassified ? ` (${score.unclassified} not yet classified)` : ''}.</div>
        ${zsum && zsum.zones > 0
          ? `<div class="meta" style="margin-top:6px"><strong>Measured:</strong> ${Math.round(zsum.length_ft).toLocaleString()} ft, ${Math.round(zsum.area_sqft).toLocaleString()} sq ft, ${zsum.defects} matched defects</div>`
          : `<div class="meta" style="margin-top:6px"><button class="editlink" id="gotoMap">Measure this site on the Map</button></div>`}
      </div>`;
    }
  }
  body.innerHTML = `
    <button class="backlink" id="gback">‹ All Documents</button>
    <div class="workflow-intro"><strong>Build Your Document</strong><span>Review the title, arrange the photos and captions, then download the finished document when it looks right.</span></div>
    <div class="formhead">1. Document Details</div>
    <label>Title</label>
    <div id="titleview"></div>
    <label>Subtitle or Description</label>
    <div id="descview"></div>

    ${scoreHtml}

    <div class="formhead" style="margin-top:24px">2. Document Contents</div>
    <div class="status">These photos and captions are the document preview. Edit captions, change their order, or remove anything you do not want included.</div>
    <div id="gpairpreview"></div>
    <div id="gitems" style="margin-top:12px"></div>
    <button class="btn secondary slim" id="greverse" style="margin-top:10px">Reverse Photo Order</button>

    <div class="formhead" style="margin-top:28px">3. Download Finished Document</div>
    <label style="margin-top:8px">Formats</label>
    <div class="status">Choose one or more file types.</div>
    <div class="pill-group" id="gfmts">
      <div class="pill" data-fmt="pdf">PDF</div>
      <div class="pill" data-fmt="docx">Word</div>
      <div class="pill" data-fmt="bundle">For AI (.zip)</div>
    </div>
    ${qualityBlock('gimgres', 'gimgfmt')}
    <button class="btn" id="gexport">Download Selected Formats</button>
    <button class="btn secondary slim" id="continueSend">More Sharing Options</button>
    ${isProClient() ? `<label style="margin-top:16px">Proposal Report</label>
    <div class="row">
      <button class="btn secondary slim" id="proppdf">Proposal PDF</button>
      <button class="btn secondary slim" id="propdocx">Proposal Word</button>
    </div>` : ''}

    ${featureOn('extra_work') ? `<label style="margin-top:16px">Extra Work Records</label>
    <div class="status">Document added scope, unexpected conditions, or customer-requested work.</div>
    <button class="btn slim" id="ewrNew" style="margin-top:6px">+ Extra Work Record</button>
    <div id="ewrList" style="margin-top:8px"></div>` : ''}

    `;
  document.getElementById('gback').onclick = () => { state.groupId = null; renderGroups(); };
  document.getElementById('greverse').onclick = reverseItems;
  document.getElementById('gexport').onclick = groupExport;
  document.getElementById('continueSend').onclick = () => { state.view = 'send'; renderApp(); };
  document.getElementById('gfmts').onclick = (e) => { const p = e.target.closest('.pill'); if (p) p.classList.toggle('on'); };
  const pp = document.getElementById('proppdf'); if (pp) pp.onclick = () => exportProposal('pdf');
  const pw = document.getElementById('propdocx'); if (pw) pw.onclick = () => exportProposal('docx');
  const gm = document.getElementById('gotoMap'); if (gm) gm.onclick = () => { state.view = 'map'; state.groupId = null; renderApp(); };
  const en = document.getElementById('ewrNew'); if (en) en.onclick = () => { state.ewrId = 'new'; renderGroups(); };
  renderTitleView();
  renderDescView();
  renderGroupPairPreview();
  renderGroupItems();
  if (featureOn('extra_work')) loadEwrList();
}

// ---- Extra Work Records (Pro) ----
const EWR_REASON_OPTS = [
  ['unforeseen_site_condition', 'Unforeseen site condition'], ['failed_base_or_subbase', 'Failed base or sub-base'],
  ['additional_damaged_area', 'Additional damaged area found'], ['drainage_or_water_issue', 'Drainage or water issue'],
  ['customer_requested_addition', 'Customer-requested addition'], ['additional_repair_or_patching', 'Additional repair or patching'],
  ['access_obstruction_or_site_prep', 'Access, obstruction, or site-preparation issue'], ['safety_issue', 'Safety issue'], ['other', 'Other'],
];
const EWR_STATUS_OPTS = [
  ['documented', 'Documented'], ['sent_for_review', 'Sent for review'], ['approved', 'Approved'],
  ['declined', 'Declined'], ['completed', 'Completed'], ['closed_no_action', 'Closed / no action'],
];
const EWR_METHOD_OPTS = [['', '(method)'], ['in_person', 'In person'], ['phone', 'Phone call'], ['text', 'Text message'], ['email', 'Email'], ['other', 'Other']];
function ewrReasonLabelC(r) { const f = EWR_REASON_OPTS.find(o => o[0] === r); return f ? f[1] : ''; }
function ewrStatusLabelC(s) { const f = EWR_STATUS_OPTS.find(o => o[0] === s); return f ? f[1] : 'Documented'; }
function ewrStatusColor(s) { return s === 'approved' || s === 'completed' ? '#1b7a3d' : s === 'declined' ? '#b3261e' : s === 'sent_for_review' ? '#b36b00' : '#444444'; }

async function loadEwrList() {
  const box = document.getElementById('ewrList');
  if (!box) return;
  let rows = [];
  try { const r = await api(`/api/ewr?group=${state.groupId}`); if (r.ok) rows = await r.json(); } catch (e) {}
  if (!rows.length) { box.innerHTML = '<p class="status">No extra work records yet for this job.</p>'; return; }
  box.innerHTML = rows.map(e => `
    <div class="card" style="padding:10px">
      <div style="font-weight:bold">EWR-${String(e.id).padStart(4, '0')} <span class="defbadge" style="background:${ewrStatusColor(e.status)};cursor:default">${esc(ewrStatusLabelC(e.status))}</span></div>
      <div class="meta">${esc(ewrReasonLabelC(e.reason_category))} · ${e.photo_count} photo${e.photo_count === 1 ? '' : 's'} · ${new Date(e.created_at).toLocaleDateString(uiLocale())}</div>
      <button class="btn secondary slim ewropen" data-id="${e.id}" style="margin-top:6px">Open</button>
    </div>`).join('');
  box.querySelectorAll('.ewropen').forEach(b => b.onclick = () => { state.ewrId = parseInt(b.getAttribute('data-id'), 10); renderGroups(); });
}

let ewrRecognizer = null;
function cleanupEwrDict(btn) { ewrRecognizer = null; if (btn) { btn.textContent = 'Record Voice Note'; btn.classList.remove('on'); } }
function dictateInto(el, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { el.focus(); toast('Tap the microphone key on your keyboard, then talk'); return; }
  if (ewrRecognizer) { try { ewrRecognizer.stop(); } catch (e) {} return; }
  const ios = isIOS(); ewrRecognizer = new SR(); ewrRecognizer.lang = uiSpeechLanguage();
  ewrRecognizer.continuous = ios ? false : true; ewrRecognizer.interimResults = ios ? false : true;
  let base = el.value; if (base && !base.endsWith(' ')) base += ' ';
  if (btn) { btn.textContent = 'Recording... tap to stop'; btn.classList.add('on'); }
  ewrRecognizer.onresult = (ev) => { let fin = '', intr = ''; for (let i = ev.resultIndex; i < ev.results.length; i++) { const t = ev.results[i][0].transcript; if (ev.results[i].isFinal) fin += t; else intr += t; } if (fin) base += fin + ' '; el.value = (base + intr).trimStart(); };
  ewrRecognizer.onerror = () => cleanupEwrDict(btn);
  ewrRecognizer.onend = () => cleanupEwrDict(btn);
  try { ewrRecognizer.start(); } catch (e) { cleanupEwrDict(btn); }
}
function getLocationOnce() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  });
}

async function renderEwrDetail() {
  const body = document.getElementById('body');
  if (state.ewrId === 'new') { renderEwrCreate(body); return; }
  body.innerHTML = '<p class="status">Loading...</p>';
  let data;
  try { const r = await api(`/api/ewr/${state.ewrId}`); if (!r.ok) { body.innerHTML = '<p class="status">Could not load record.</p>'; return; } data = await r.json(); }
  catch (e) { body.innerHTML = '<p class="status">Could not load record.</p>'; return; }
  renderEwrView(body, data);
}

function reasonSelectHtml(id, val) {
  return `<select id="${id}">${EWR_REASON_OPTS.map(o => `<option value="${o[0]}"${val === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`;
}
function methodSelectHtml(id, val) {
  return `<select id="${id}">${EWR_METHOD_OPTS.map(o => `<option value="${o[0]}"${(val || '') === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>`;
}

function renderEwrCreate(body) {
  window._ewrNewPhotos = window._ewrNewPhotos || [];
  body.innerHTML = `
    <button class="backlink" id="ewrBack">‹ Back to Job</button>
    <div class="brand" style="font-size:20px">Extra Work Record</div>

    <label>Reason For Extra Work</label>
    ${reasonSelectHtml('ewrReason', 'unforeseen_site_condition')}
    <div id="ewrOtherWrap" style="display:none;margin-top:8px">
      <input type="text" id="ewrOther" placeholder="Describe the reason" />
    </div>

    <label>Customer / Client (optional)</label>
    <input type="text" id="ewrCustomer" placeholder="Customer or client name" />

    <label>What Was Found, What Is Needed, And Why?</label>
    <button type="button" class="btn secondary" id="ewrDictate" style="margin-bottom:8px">Record Voice Note</button>
    <textarea id="ewrDesc" placeholder="Describe the condition and the added work..."></textarea>

    <label>Photos <span style="font-weight:normal;text-transform:none;letter-spacing:0">(at least one required)</span></label>
    <div class="status">Capture wide shots for context and close-ups for detail.</div>
    <div class="row" style="margin-top:6px">
      <button type="button" class="btn secondary slim" id="ewrTake">Take Photo</button>
      <button type="button" class="btn secondary slim" id="ewrChoose">Choose Photo</button>
    </div>
    <input type="file" accept="image/*" capture="environment" id="ewrCam" style="display:none" />
    <input type="file" accept="image/*" id="ewrLib" style="display:none" />
    <div id="ewrThumbs" class="row" style="flex-wrap:wrap;gap:8px;margin-top:8px"></div>

    <label>Customer / GC Notification (optional)</label>
    <input type="text" id="ewrNname" placeholder="Name of person notified" />
    <input type="text" id="ewrNcompany" placeholder="Company or role" style="margin-top:8px" />
    <div class="row compact" style="margin-top:8px">${methodSelectHtml('ewrNmethod', '')}</div>
    <textarea id="ewrNnotes" placeholder="What was communicated" style="min-height:60px;margin-top:8px"></textarea>

    <button class="btn" id="ewrSave" style="margin-top:16px">Save Record</button>
    <div class="status">Track the record’s status according to your company’s normal approval process.</div>`;
  document.getElementById('ewrBack').onclick = () => { state.ewrId = null; window._ewrNewPhotos = []; renderGroups(); };
  const reason = document.getElementById('ewrReason');
  const otherWrap = document.getElementById('ewrOtherWrap');
  reason.onchange = () => { otherWrap.style.display = reason.value === 'other' ? 'block' : 'none'; };
  document.getElementById('ewrDictate').onclick = (e) => dictateInto(document.getElementById('ewrDesc'), e.currentTarget);
  document.getElementById('ewrTake').onclick = () => document.getElementById('ewrCam').click();
  document.getElementById('ewrChoose').onclick = () => document.getElementById('ewrLib').click();
  const onPick = (e) => { if (e.target.files[0]) { window._ewrNewPhotos.push(e.target.files[0]); renderEwrThumbs(); } e.target.value = ''; };
  document.getElementById('ewrCam').onchange = onPick;
  document.getElementById('ewrLib').onchange = onPick;
  document.getElementById('ewrSave').onclick = saveNewEwr;
  renderEwrThumbs();
}
function renderEwrThumbs() {
  const box = document.getElementById('ewrThumbs'); if (!box) return;
  const ph = window._ewrNewPhotos || [];
  box.innerHTML = ph.map((f, i) => `<div style="position:relative"><img src="${URL.createObjectURL(f)}" style="width:90px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #000" /><button class="ewrrm" data-i="${i}" style="position:absolute;top:-6px;right:-6px;background:#b3261e;color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-weight:bold">×</button></div>`).join('');
  box.querySelectorAll('.ewrrm').forEach(b => b.onclick = () => { window._ewrNewPhotos.splice(parseInt(b.getAttribute('data-i'), 10), 1); renderEwrThumbs(); });
}
async function saveNewEwr() {
  const reason = document.getElementById('ewrReason').value;
  const otherText = document.getElementById('ewrOther') ? document.getElementById('ewrOther').value.trim() : '';
  if (reason === 'other' && !otherText) { toast('Describe the "other" reason'); return; }
  const photos = window._ewrNewPhotos || [];
  if (!photos.length) { toast('Add at least one photo before saving'); return; }
  const btn = document.getElementById('ewrSave'); btn.disabled = true; btn.textContent = 'Saving...';
  const loc = await getLocationOnce();
  const bodyData = {
    group_id: state.groupId,
    reason_category: reason,
    reason_other_text: otherText || null,
    customer: document.getElementById('ewrCustomer').value.trim() || null,
    description_text: document.getElementById('ewrDesc').value.trim() || null,
    notified_person_name: document.getElementById('ewrNname').value.trim() || null,
    notified_person_company: document.getElementById('ewrNcompany').value.trim() || null,
    notification_method: document.getElementById('ewrNmethod').value || null,
    notification_notes: document.getElementById('ewrNnotes').value.trim() || null,
  };
  if (loc) { bodyData.latitude = loc.lat; bodyData.longitude = loc.lng; }
  try {
    const r = await api('/api/ewr', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bodyData) });
    const d = await r.json();
    if (!r.ok || !d.record) throw new Error(d.error || 'save failed');
    const id = d.record.id;
    for (const f of photos) {
      const fd = new FormData(); fd.append('photo', f);
      if (loc) { fd.append('latitude', loc.lat); fd.append('longitude', loc.lng); }
      try { await api(`/api/ewr/${id}/photo`, { method: 'POST', body: fd }); } catch (e) {}
    }
    window._ewrNewPhotos = [];
    toast('Extra Work Record saved to this job');
    state.ewrId = id; renderGroups();
  } catch (e) { toast(e.message || 'Save failed'); btn.disabled = false; btn.textContent = 'Save Record'; }
}

function renderEwrView(body, data) {
  const e = data.record, photos = data.photos || [], group = data.group;
  body.innerHTML = `
    <button class="backlink" id="ewrBack">‹ Back to Job</button>
    <div class="brand" style="font-size:20px">Extra Work Record</div>
    <div style="font-weight:bold">EWR-${String(e.id).padStart(4, '0')}</div>
    <div class="meta">${group ? 'Job: ' + esc(group.title || 'Untitled') + ' · ' : ''}${esc(e.address || '')}</div>
    <div class="meta">Created ${new Date(e.created_at).toLocaleString(uiLocale())} by ${esc(e.created_by || '')}</div>

    <label>Status</label>
    <select id="ewrStatus">${EWR_STATUS_OPTS.map(o => `<option value="${o[0]}"${e.status === o[0] ? ' selected' : ''}>${o[1]}</option>`).join('')}</select>
    <div class="status">Record approval status according to your company’s existing process. This does not replace required written approvals or contract procedures.</div>

    <label>Reason For Extra Work</label>
    ${reasonSelectHtml('ewrReason', e.reason_category)}
    <div id="ewrOtherWrap" style="display:${e.reason_category === 'other' ? 'block' : 'none'};margin-top:8px">
      <input type="text" id="ewrOther" placeholder="Describe the reason" value="${esc(e.reason_other_text || '')}" />
    </div>

    <label>Customer / Client</label>
    <input type="text" id="ewrCustomer" value="${esc(e.customer || '')}" placeholder="Customer or client name" />

    <label>Description</label>
    <button type="button" class="btn secondary" id="ewrDictate" style="margin-bottom:8px">Record Voice Note</button>
    <textarea id="ewrDesc" placeholder="Describe the condition and the added work...">${esc(e.description_text || '')}</textarea>

    <label>Customer / GC Notification</label>
    <input type="text" id="ewrNname" value="${esc(e.notified_person_name || '')}" placeholder="Name of person notified" />
    <input type="text" id="ewrNcompany" value="${esc(e.notified_person_company || '')}" placeholder="Company or role" style="margin-top:8px" />
    <div class="row compact" style="margin-top:8px">${methodSelectHtml('ewrNmethod', e.notification_method)}</div>
    <textarea id="ewrNnotes" placeholder="What was communicated" style="min-height:60px;margin-top:8px">${esc(e.notification_notes || '')}</textarea>

    <button class="btn" id="ewrSaveEdit" style="margin-top:14px">Save Changes</button>

    <label style="margin-top:16px">Photos</label>
    <div class="row" style="margin-top:6px">
      <button type="button" class="btn secondary slim" id="ewrTake">Take Photo</button>
      <button type="button" class="btn secondary slim" id="ewrChoose">Choose Photo</button>
    </div>
    <input type="file" accept="image/*" capture="environment" id="ewrCam" style="display:none" />
    <input type="file" accept="image/*" id="ewrLib" style="display:none" />
    <div id="ewrPhotos" style="margin-top:8px"></div>

    <div class="row" style="margin-top:18px">
      <button class="btn secondary" id="ewrExport">Export PDF</button>
      <button class="btn" id="ewrDelete" style="background:#b3261e">Delete Record</button>
    </div>`;
  document.getElementById('ewrBack').onclick = () => { state.ewrId = null; renderGroups(); };
  const reason = document.getElementById('ewrReason');
  const otherWrap = document.getElementById('ewrOtherWrap');
  reason.onchange = () => { otherWrap.style.display = reason.value === 'other' ? 'block' : 'none'; };
  document.getElementById('ewrDictate').onclick = (ev) => dictateInto(document.getElementById('ewrDesc'), ev.currentTarget);
  document.getElementById('ewrStatus').onchange = async (ev) => {
    const r = await api(`/api/ewr/${e.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: ev.target.value }) });
    toast(r.ok ? 'Status updated' : 'Update failed');
  };
  document.getElementById('ewrSaveEdit').onclick = async () => {
    const b = {
      reason_category: reason.value,
      reason_other_text: document.getElementById('ewrOther') ? document.getElementById('ewrOther').value : '',
      customer: document.getElementById('ewrCustomer').value,
      description_text: document.getElementById('ewrDesc').value,
      notified_person_name: document.getElementById('ewrNname').value,
      notified_person_company: document.getElementById('ewrNcompany').value,
      notification_method: document.getElementById('ewrNmethod').value,
      notification_notes: document.getElementById('ewrNnotes').value,
    };
    const r = await api(`/api/ewr/${e.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    toast(r.ok ? 'Saved' : 'Save failed');
  };
  const addPhoto = async (file) => {
    const fd = new FormData(); fd.append('photo', file);
    const loc = await getLocationOnce(); if (loc) { fd.append('latitude', loc.lat); fd.append('longitude', loc.lng); }
    const r = await api(`/api/ewr/${e.id}/photo`, { method: 'POST', body: fd });
    if (r.ok) { toast('Photo added'); renderEwrDetail(); } else toast('Upload failed');
  };
  document.getElementById('ewrTake').onclick = () => document.getElementById('ewrCam').click();
  document.getElementById('ewrChoose').onclick = () => document.getElementById('ewrLib').click();
  document.getElementById('ewrCam').onchange = (ev) => { if (ev.target.files[0]) addPhoto(ev.target.files[0]); };
  document.getElementById('ewrLib').onchange = (ev) => { if (ev.target.files[0]) addPhoto(ev.target.files[0]); };
  document.getElementById('ewrExport').onclick = async () => {
    try {
      const r = await api(`/api/ewr/${e.id}/export`);
      if (!r.ok) throw new Error('bad');
      const blob = await r.blob(); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `extra-work-record-${e.id}.pdf`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast('PDF ready');
    } catch (er) { toast('Export failed'); }
  };
  document.getElementById('ewrDelete').onclick = async () => {
    if (!confirm(uiT('Delete this Extra Work Record and its photos? This cannot be undone.'))) return;
    const r = await api(`/api/ewr/${e.id}/delete`, { method: 'POST' });
    if (r.ok) { toast('Record deleted'); state.ewrId = null; renderGroups(); } else toast('Delete failed');
  };
  // photo grid
  const pbox = document.getElementById('ewrPhotos');
  if (!photos.length) pbox.innerHTML = '<p class="status">No photos yet. Add at least one.</p>';
  else pbox.innerHTML = photos.map(p => `
    <div class="card" style="padding:8px">
      <img src="${photoSrc(p.photo_path)}" alt="photo" />
      ${photoLocationHtml(p)}
      <input type="text" class="ewrcap" data-pid="${p.id}" value="${esc(p.caption || '')}" placeholder="Caption (optional)" style="margin-top:6px" />
      <div class="row" style="margin-top:6px">
        <button class="btn secondary slim ewrcapsave" data-pid="${p.id}">Save Caption</button>
        <button class="btn secondary slim ewrphotodel" data-pid="${p.id}" style="color:#c1121f">Remove</button>
      </div>
    </div>`).join('');
  pbox.querySelectorAll('.ewrcapsave').forEach(b => b.onclick = async () => {
    const pid = b.getAttribute('data-pid');
    const cap = pbox.querySelector(`.ewrcap[data-pid="${pid}"]`).value;
    // caption lives on the photo; update via a dedicated tiny endpoint reusing photo table
    const r = await api(`/api/ewr/${e.id}/photo/${pid}/caption`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ caption: cap }) });
    toast(r.ok ? 'Caption saved' : 'Save failed');
  });
  pbox.querySelectorAll('.ewrphotodel').forEach(b => b.onclick = async () => {
    if (!confirm(uiT('Remove this photo?'))) return;
    const r = await api(`/api/ewr/${e.id}/photo/${b.getAttribute('data-pid')}/delete`, { method: 'POST' });
    if (r.ok) renderEwrDetail(); else toast('Remove failed');
  });
}

function renderTitleView() {
  const box = document.getElementById('titleview');
  if (!box) return;
  box.innerHTML = `<span class="fieldval big">${esc(currentGroup.title || 'Untitled group')}</span><button class="editlink" id="editTitle">Edit</button>`;
  document.getElementById('editTitle').onclick = editTitle;
}
function editTitle() {
  const box = document.getElementById('titleview');
  box.innerHTML = `
    <input type="text" id="gdtitle" value="${esc(currentGroup.title || '')}" style="font-size:18px;font-weight:bold" />
    <div style="margin-top:6px"><button class="btn slim" id="saveTitle">Save</button><button class="editlink" id="cancelTitle">Cancel</button></div>`;
  const inp = document.getElementById('gdtitle');
  titleCaseInput(inp); inp.focus();
  document.getElementById('saveTitle').onclick = saveTitle;
  document.getElementById('cancelTitle').onclick = renderTitleView;
}
async function saveTitle() {
  const v = document.getElementById('gdtitle').value.trim() || 'Untitled group';
  const r = await api(`/api/groups/${currentGroup.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: v }),
  });
  if (r.ok) { currentGroup.title = v; toast('Saved'); renderTitleView(); } else toast('Save failed');
}

function renderDescView() {
  const box = document.getElementById('descview');
  if (!box) return;
  const d = currentGroup.description;
  box.innerHTML = `<span class="fieldval">${d ? esc(d) : 'No description'}</span><button class="editlink" id="editDesc">Edit</button>`;
  document.getElementById('editDesc').onclick = editDesc;
}
function editDesc() {
  const box = document.getElementById('descview');
  box.innerHTML = `
    <textarea id="gddesc" style="min-height:60px">${esc(currentGroup.description || '')}</textarea>
    <div style="margin-top:6px"><button class="btn slim" id="saveDesc">Save</button><button class="editlink" id="cancelDesc">Cancel</button></div>`;
  document.getElementById('gddesc').focus();
  document.getElementById('saveDesc').onclick = saveDesc;
  document.getElementById('cancelDesc').onclick = renderDescView;
}
async function saveDesc() {
  const v = document.getElementById('gddesc').value.trim();
  const r = await api(`/api/groups/${currentGroup.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: v }),
  });
  if (r.ok) { currentGroup.description = v; toast('Saved'); renderDescView(); } else toast('Save failed');
}

function renderGroupItems() {
  const box = document.getElementById('gitems');
  if (!box) return;
  const items = currentGroupItems;
  if (!items.length) { box.innerHTML = '<p class="empty">No photos in this document yet. Go to Organize, select some, and use "Add Selected to a Document".</p>'; return; }
  box.innerHTML = items.map((c, i) => `
    <div class="card">
      <div class="meta">#${i + 1}</div>
      <div class="photo-title">${esc(c.photo_title||'Untitled photo')}</div>
      ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="capture" />` : ''}
      <div class="rotaterow">${rotateButtons(c.id)}</div>
      ${photoLocationHtml(c,'No location')}
      ${isProClient() && fmtDimsClient(c) ? `<div class="meta"><strong>Dimensions:</strong> ${esc(fmtDimsClient(c))}</div>` : ''}
      <label style="margin-top:8px">Photo Caption</label>
      <textarea class="gcaption" data-i="${i}" style="min-height:70px">${esc(c.note || '')}</textarea>
      <button class="btn secondary slim gsavecaption" data-i="${i}" style="margin-top:6px">Save Caption</button>
      <div class="row" style="margin-top:8px">
        <button class="btn secondary gup" data-i="${i}">↑ Up</button>
        <button class="btn secondary gdown" data-i="${i}">↓ Down</button>
        <button class="btn" data-i="${i}" data-rm="1" style="background:#b3261e">Remove</button>
      </div>
    </div>`).join('');
  wireRotate(box);
  box.querySelectorAll('.gsavecaption').forEach(b => b.onclick = async () => {
    const i = parseInt(b.getAttribute('data-i'), 10);
    const item = currentGroupItems[i];
    const field = box.querySelector(`.gcaption[data-i="${i}"]`);
    if (!item || !field) return;
    b.disabled = true; b.textContent = 'Saving...';
    const r = await api(`/api/captures/${item.id}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ note:field.value }) });
    if (r.ok) { item.note = field.value; toast('Caption saved'); }
    else toast('Caption could not be saved');
    b.disabled = false; b.textContent = 'Save Caption';
  });
  box.querySelectorAll('.gup').forEach(b => b.onclick = () => moveItem(parseInt(b.getAttribute('data-i'), 10), -1));
  box.querySelectorAll('.gdown').forEach(b => b.onclick = () => moveItem(parseInt(b.getAttribute('data-i'), 10), 1));
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeItem(parseInt(b.getAttribute('data-i'), 10)));
}

function renderGroupPairPreview() {
  const box = document.getElementById('gpairpreview');
  if (!box) return;
  const byId = new Map(currentGroupItems.map((item) => [Number(item.id), item]));
  const pairs = currentGroupPairs.map((pair) => ({ pair, before: byId.get(Number(pair.before_id)), after: byId.get(Number(pair.after_id)) })).filter((entry) => entry.before && entry.after);
  if (!pairs.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="formhead" style="margin-top:18px">Before &amp; After Evidence</div>
    <div class="status">Matched photos stay together in PDF, Word, and proposal exports.</div>
    ${pairs.map(({ before, after }) => `<article class="card before-after-preview">
      <div class="before-after-column"><strong>BEFORE</strong><div class="photo-title">${esc(before.photo_title||'Untitled photo')}</div><img src="${photoSrc(before.photo_path)}" alt="Before photo">${photoLocationHtml(before)}<div>${esc(before.note || '(no caption)')}</div><div class="meta">${new Date(before.created_at).toLocaleDateString(uiLocale())}</div></div>
      <div class="before-after-column"><strong>AFTER</strong><div class="photo-title">${esc(after.photo_title||'Untitled photo')}</div><img src="${photoSrc(after.photo_path)}" alt="After photo">${photoLocationHtml(after)}<div>${esc(after.note || '(no caption)')}</div><div class="meta">${new Date(after.created_at).toLocaleDateString(uiLocale())}</div></div>
    </article>`).join('')}`;
}

function moveItem(i, dir) {
  const arr = currentGroupItems;
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  renderGroupItems();
  persistOrder();
}

function reverseItems() {
  currentGroupItems.reverse();
  renderGroupItems();
  persistOrder();
}

async function persistOrder() {
  const order = currentGroupItems.map(c => c.id);
  await api(`/api/groups/${state.groupId}/reorder`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
}

async function removeItem(i) {
  const c = currentGroupItems[i];
  if (!c) return;
  const r = await api(`/api/groups/${state.groupId}/remove`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [c.id] }),
  });
  if (r.ok) { currentGroupItems.splice(i, 1); renderGroupItems(); toast('Removed'); }
  else toast('Remove failed');
}

async function groupExport() {
  const fmts = Array.from(document.querySelectorAll('#gfmts .pill.on')).map(x => x.getAttribute('data-fmt'));
  if (!fmts.length) { toast('Pick at least one format'); return; }
  const imgRes = (document.getElementById('gimgres') || {}).value || 'standard';
  const imgFmt = (document.getElementById('gimgfmt') || {}).value || 'jpeg';
  const names = { pdf: 'group.pdf', docx: 'group.docx', bundle: 'group-bundle.zip' };
  const btn = document.getElementById('gexport');
  btn.disabled = true; btn.textContent = 'Exporting...';
  for (const f of fmts) {
    try {
      const r = await api(`/api/export/${f}?group=${state.groupId}&res=${imgRes}&fmt=${imgFmt}`);
      if (!r.ok) throw new Error('bad');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = names[f];
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      await new Promise(res => setTimeout(res, 500));
    } catch (e) { toast('Export failed for ' + f); }
  }
  btn.disabled = false; btn.textContent = 'Download Selected Formats';
  toast('Download ready');
}

async function exportProposal(doc) {
  const imgRes = (document.getElementById('gimgres') || {}).value || 'standard';
  const imgFmt = (document.getElementById('gimgfmt') || {}).value || 'jpeg';
  const btn = document.getElementById(doc === 'pdf' ? 'proppdf' : 'propdocx');
  if (btn) { btn.disabled = true; btn.textContent = 'Building...'; }
  try {
    const r = await api(`/api/export/proposal?group=${state.groupId}&doc=${doc}&res=${imgRes}&fmt=${imgFmt}`);
    if (!r.ok) throw new Error('bad');
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = doc === 'pdf' ? 'proposal.pdf' : 'proposal.docx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Proposal ready');
  } catch (e) { toast('Proposal export failed'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = doc === 'pdf' ? 'Proposal PDF' : 'Proposal Word'; } }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
boot();
