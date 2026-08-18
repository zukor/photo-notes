const el = document.getElementById('app');
// Phones/tablets open to Capture (grab a photo fast); computers open to the Library (review the photos).
const IS_HANDHELD = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 768;
let state = { view: IS_HANDHELD ? 'capture' : 'list', location: null, address: null, photoFile: null, kind: 'note', area: '', areas: [], groupId: null, imgv: 0 };
let recognizer = null;
let currentGroupItems = [];
let currentGroup = null;

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
  if (!state.area || !state.areas.includes(state.area)) state.area = state.areas[0] || '';
}

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
  if (!confirm(`Remove the "${name}" topic? Photos already tagged keep their label.`)) return;
  const r = await api('/api/areas/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (r.ok) { state.areas = await r.json(); if (state.area === name) state.area = state.areas[0] || ''; renderCapture(); }
  else toast('Could not remove topic');
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function photoSrc(p) { return p ? `${p}?v=${state.imgv}` : ''; }

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
  if (r.ok) { await loadAreas(); renderApp(); } else renderLogin();
}

function renderLogin() {
  el.innerHTML = `
    <div class="wrap">
      <div class="brand" style="margin-top:24px">Photo Notes</div>
      <p class="sub">Photo documentation, by voice</p>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="username" inputmode="email" />
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" />
      <button class="btn" id="loginBtn">Sign In</button>
      <p class="status" id="loginErr"></p>
      <div class="footer">&copy; ${new Date().getFullYear()} Zukor AI</div>
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
  if (r.ok) { await loadAreas(); renderApp(); }
  else document.getElementById('loginErr').textContent = 'Wrong email or password. Try again.';
}

function renderApp() {
  el.innerHTML = `
    <div class="wrap">
      <div class="logoutbar"><button class="link" id="logout">Log out</button></div>
      <div class="brand">Photo Notes</div>
      <div class="tabs">
        <div class="tab ${state.view==='capture'?'on':''}" id="tabCapture">Capture</div>
        <div class="tab ${state.view==='list'?'on':''}" id="tabList">Library</div>
        <div class="tab ${state.view==='groups'?'on':''}" id="tabGroups">Groups</div>
      </div>
      <div id="body"></div>
      <div class="footer">&copy; ${new Date().getFullYear()} Zukor AI</div>
    </div>`;
  document.getElementById('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); renderLogin(); };
  document.getElementById('tabCapture').onclick = () => { state.view='capture'; renderApp(); };
  document.getElementById('tabList').onclick = () => { state.view='list'; renderApp(); };
  document.getElementById('tabGroups').onclick = () => { state.view='groups'; state.groupId=null; renderApp(); };
  if (state.view === 'capture') renderCapture();
  else if (state.view === 'groups') renderGroups();
  else renderList();
}

function areaChips() {
  if (!state.areas.length) return '<p class="status">No topics yet. Add one below.</p>';
  return state.areas.map(a =>
    `<div class="pill ${state.area===a?'on':''}" data-area="${esc(a)}">${esc(a)} <span class="areax" data-del="${esc(a)}">&times;</span></div>`
  ).join('');
}

function renderCapture() {
  const body = document.getElementById('body');
  body.innerHTML = `
    <label>Photo</label>
    <button type="button" class="btn" id="takephoto">Take Photo</button>
    <button type="button" class="btn secondary" id="choosephoto" style="margin-top:8px">Choose from library or files</button>
    <input type="file" accept="image/*" capture="environment" id="photoCam" style="display:none" />
    <input type="file" accept="image/*" id="photoLib" style="display:none" />
    <div class="photo-box" id="previewBox" style="display:none;margin-top:12px"><img id="preview" alt="preview" style="display:block" /></div>

    <div id="locwrap" style="display:none">
      <label>GPS Coordinates</label>
      <div class="status" id="gps"></div>
      <label>Address</label>
      <div class="status" id="addr"></div>
    </div>

    <label>Note</label>
    <button type="button" class="btn secondary" id="dictate" style="margin-bottom:8px">Record Note</button>
    <textarea id="note" placeholder="Describe what you're looking at, or tap Record Note..."></textarea>

    <label>Topic</label>
    <div class="pill-group" id="areas">${areaChips()}</div>
    <div class="row compact" style="margin-top:10px">
      <input type="text" id="newarea" placeholder="Add a topic..." />
      <button class="btn secondary" id="addarea">Add</button>
    </div>

    <button class="btn" id="save">Save</button>
  `;

  document.getElementById('takephoto').onclick = () => document.getElementById('photoCam').click();
  document.getElementById('choosephoto').onclick = () => document.getElementById('photoLib').click();
  document.getElementById('photoCam').onchange = (e) => { if (e.target.files[0]) onPhotoChosen(e.target.files[0]); };
  document.getElementById('photoLib').onchange = (e) => { if (e.target.files[0]) onPhotoChosen(e.target.files[0]); };
  document.getElementById('save').onclick = saveCapture;
  document.getElementById('addarea').onclick = addArea;
  document.getElementById('newarea').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addArea(); } });

  document.getElementById('areas').onclick = (e) => {
    const del = e.target.getAttribute('data-del');
    if (del != null) { deleteArea(del); return; }
    const pill = e.target.closest('[data-area]');
    if (pill) { state.area = pill.getAttribute('data-area'); renderCapture(); }
  };

  const dictateBtn = document.getElementById('dictate');
  if (dictateBtn) dictateBtn.onclick = toggleDictation;

  // preserve any typed note across re-renders
  if (state._note) document.getElementById('note').value = state._note;
  document.getElementById('note').addEventListener('input', e => state._note = e.target.value);

  // if a photo is already chosen (e.g. re-render after picking an area), keep it and its location visible
  if (state.photoFile) {
    const box = document.getElementById('previewBox');
    document.getElementById('preview').src = URL.createObjectURL(state.photoFile);
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

function onPhotoChosen(file) {
  state.photoFile = file;
  const box = document.getElementById('previewBox');
  document.getElementById('preview').src = URL.createObjectURL(file);
  box.style.display = 'block';
  document.getElementById('locwrap').style.display = 'block';
  acquireLocation();
}

function acquireLocation() {
  const gps = document.getElementById('gps');
  const addr = document.getElementById('addr');
  if (gps) gps.textContent = 'Getting location...';
  if (addr) addr.textContent = '';
  if (!navigator.geolocation) { if (gps) gps.textContent = 'Location not available on this device.'; return; }
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      state.location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (gps) gps.textContent = state.location.lat.toFixed(5) + ', ' + state.location.lng.toFixed(5);
      if (addr) addr.textContent = 'Looking up address...';
      try {
        const r = await api(`/api/geocode?lat=${state.location.lat}&lng=${state.location.lng}`);
        if (r.ok) { const d = await r.json(); state.address = d.address || null; if (addr) addr.textContent = d.address || 'Address not found'; }
        else if (addr) addr.textContent = 'Address lookup failed';
      } catch (e) { if (addr) addr.textContent = 'Address lookup failed'; }
    },
    (err) => { if (gps) gps.textContent = 'Location blocked. Allow location for this site to tag photos.'; },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

function cleanupDictation() {
  recognizer = null;
  const btn = document.getElementById('dictate');
  if (btn) { btn.textContent = 'Record Note'; btn.classList.remove('on'); }
}

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function toggleDictation() {
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
  if (recognizer) { try { recognizer.stop(); } catch (e) {} return; }
  const ios = isIOS();
  recognizer = new SR();
  recognizer.lang = 'en-US';
  // iPhone/iPad Safari hangs with continuous or interim results on; it only
  // reliably delivers one final transcript per start. Desktop/Android handle
  // live continuous dictation, so keep that richer behavior there.
  recognizer.continuous = ios ? false : true;
  recognizer.interimResults = ios ? false : true;
  let base = noteEl ? noteEl.value : '';
  if (base && !base.endsWith(' ')) base += ' ';
  if (btn) { btn.textContent = 'Recording... tap to stop'; btn.classList.add('on'); }
  recognizer.onresult = (ev) => {
    let finalText = '', interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) finalText += t; else interim += t;
    }
    if (finalText) base += finalText + ' ';
    if (noteEl) { noteEl.value = (base + interim).trimStart(); state._note = noteEl.value; }
  };
  recognizer.onerror = (e) => {
    const err = e && e.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      toast('Allow microphone access for this site, then tap Record Note again');
    } else if (err === 'no-speech') {
      toast('Did not catch that. Tap Record Note and speak again');
    } else {
      toast('Recording could not start. Check that Dictation is on in Settings');
    }
    cleanupDictation();
  };
  recognizer.onend = () => { cleanupDictation(); };
  try { recognizer.start(); } catch (e) { cleanupDictation(); }
}

async function saveCapture() {
  const btn = document.getElementById('save');
  const note = document.getElementById('note').value.trim();
  if (!state.photoFile && !note) { toast('Take a photo or add a note first'); return; }
  btn.disabled = true; btn.textContent = 'Saving...';
  const fd = new FormData();
  if (state.photoFile) fd.append('photo', state.photoFile);
  fd.append('note', note);
  fd.append('area_tags', JSON.stringify(state.area ? [state.area] : []));
  fd.append('kind', 'note');
  if (state.location) { fd.append('latitude', state.location.lat); fd.append('longitude', state.location.lng); }
  if (state.address) fd.append('address', state.address);
  try {
    const r = await api('/api/captures', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('save failed');
    toast('Saved');
    state.photoFile = null; state._note = ''; state.location = null; state.address = null;
    renderCapture();
  } catch (e) {
    toast('Save failed, try again');
  } finally {
    btn.disabled = false; btn.textContent = 'Save';
  }
}

// ---- rotate + note editing (shared) ----
async function rotatePhoto(id, dir) {
  try {
    const r = await api(`/api/captures/${id}/rotate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir }),
    });
    if (!r.ok) throw new Error('bad');
    state.imgv++; // bust the image cache so the rotated photo shows
    if (state.view === 'groups' && state.groupId) renderGroupDetail(state.groupId);
    else loadCards(document.getElementById('filter') ? (document.getElementById('filter').value || '') : '');
  } catch (e) { toast('Rotate failed'); }
}

function rotateButtons(id) {
  return `
    <button class="iconbtn rotccw" data-id="${id}" title="Rotate left 90°">↺ 90°</button>
    <button class="iconbtn rotcw" data-id="${id}" title="Rotate right 90°">↻ 90°</button>`;
}
function wireRotate(container) {
  container.querySelectorAll('.rotccw').forEach(b => b.onclick = () => rotatePhoto(parseInt(b.getAttribute('data-id'), 10), 'ccw'));
  container.querySelectorAll('.rotcw').forEach(b => b.onclick = () => rotatePhoto(parseInt(b.getAttribute('data-id'), 10), 'cw'));
}

async function saveNote(id, text, after) {
  const r = await api(`/api/captures/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: text }),
  });
  if (r.ok) { toast('Note saved'); if (after) after(); }
  else toast('Save failed');
}

// ---- Library (saved captures) ----
async function renderList() {
  const body = document.getElementById('body');
  body.innerHTML = `
    <label>Filter</label>
    <select id="filter">
      <option value="">All Topics</option>
      ${state.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}
    </select>
    <div class="row" style="margin-top:10px">
      <button class="btn secondary" id="selall">Select All</button>
      <button class="btn secondary" id="selnone">Clear</button>
    </div>

    <label>Export <span style="font-weight:normal;text-transform:none;letter-spacing:0">(pick one or more)</span></label>
    <div class="pill-group" id="fmts">
      <div class="pill" data-fmt="pdf">PDF</div>
      <div class="pill" data-fmt="docx">Word</div>
      <div class="pill" data-fmt="bundle">For AI (.zip)</div>
    </div>
    ${qualityBlock('imgres', 'imgfmt')}
    <button class="btn" id="exportbtn">Export</button>

    <label style="margin-top:18px">Add Selected to a Group</label>
    <div class="row compact">
      <select id="groupsel" style="flex:1"><option value="">Choose Group</option></select>
      <button class="btn secondary" id="addtogroup">Add</button>
    </div>
    <input id="newgroupname" type="text" placeholder="...or type a new group name" style="margin-top:8px" />

    <div class="row" style="margin-top:22px">
      <button class="btn secondary" id="fixaddr">Fix Addresses</button>
      <button class="btn" id="delbtn" style="background:#b3261e">Delete Selected</button>
    </div>

    <div id="cards" style="margin-top:16px"></div>`;
  document.getElementById('filter').onchange = e => loadCards(e.target.value);
  document.getElementById('selall').onclick = () => document.querySelectorAll('.capchk').forEach(c => c.checked = true);
  document.getElementById('selnone').onclick = () => document.querySelectorAll('.capchk').forEach(c => c.checked = false);
  document.getElementById('fmts').onclick = (e) => { const p = e.target.closest('.pill'); if (p) p.classList.toggle('on'); };
  document.getElementById('exportbtn').onclick = doExportSelected;
  document.getElementById('delbtn').onclick = doDeleteSelected;
  document.getElementById('fixaddr').onclick = doFixAddresses;
  document.getElementById('addtogroup').onclick = addSelectedToGroup;
  loadGroupOptions();
  loadCards('');
}

async function loadGroupOptions() {
  const sel = document.getElementById('groupsel');
  if (!sel) return;
  const r = await api('/api/groups');
  const groups = r.ok ? await r.json() : [];
  sel.innerHTML = '<option value="">Choose Group</option>' +
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
      toast(`Group created with ${ids.length} photo${ids.length > 1 ? 's' : ''}`);
      document.getElementById('newgroupname').value = '';
      loadGroupOptions();
    } else if (sel.value) {
      const r = await api(`/api/groups/${sel.value}/add`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) throw new Error('bad');
      toast(`Added ${ids.length} to group`);
      loadGroupOptions();
    } else {
      toast('Pick a group or type a new name');
    }
  } catch (e) { toast('Could not add to group'); }
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
  btn.disabled = true; btn.textContent = 'Exporting...';
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
    } catch (e) { toast('Export failed for ' + f); }
  }
  btn.disabled = false; btn.textContent = 'Export';
  toast('Exported');
}

async function doDeleteSelected() {
  const ids = Array.from(document.querySelectorAll('.capchk:checked')).map(x => x.value);
  if (!ids.length) { toast('Select at least one capture'); return; }
  if (!confirm(`Delete ${ids.length} capture${ids.length > 1 ? 's' : ''}? This can't be undone.`)) return;
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
    toast(`Updated ${d.updated} of ${d.total}`);
    loadCards(document.getElementById('filter').value || '');
  } catch (e) { toast('Fix addresses failed'); }
  finally { btn.disabled = false; btn.textContent = 'Fix Addresses'; }
}

async function loadCards(area) {
  const cards = document.getElementById('cards');
  if (!cards) return;
  cards.innerHTML = '<p class="status">Loading...</p>';
  const r = await api('/api/captures' + (area ? `?area=${encodeURIComponent(area)}` : ''));
  if (!r.ok) { cards.innerHTML = '<p class="status">Could not load.</p>'; return; }
  const rows = await r.json();
  if (!rows.length) { cards.innerHTML = '<p class="empty">No captures yet. Go grab one.</p>'; return; }
  cards.innerHTML = rows.map(c => {
    const when = new Date(c.created_at).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    const tags = (c.area_tags || []).map(t => `<span class="badge">${esc(t)}</span>`).join('');
    const kind = c.kind === 'task' ? `<span class="badge task">Task</span>` : '';
    return `<div class="card">
      <label style="display:flex;align-items:center;gap:8px;font-weight:bold;margin-bottom:8px;text-transform:none;letter-spacing:0;font-size:15px">
        <input type="checkbox" class="capchk" value="${c.id}" style="width:20px;height:20px"> Select
      </label>
      ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="capture" />` : ''}
      <div class="meta">${when}</div>
      <div class="rotaterow">${rotateButtons(c.id)}</div>
      <div class="addr">${esc(c.address || (c.latitude ? c.latitude.toFixed(5)+', '+c.longitude.toFixed(5) : 'No location'))}</div>
      <div class="meta">${kind}${tags}</div>
      <div class="notewrap" data-id="${c.id}">
        <div class="notetext">${esc(c.note || '(no note)')}</div>
        <button class="btn secondary editnote" data-id="${c.id}" style="margin-top:6px">Edit Note</button>
      </div>
    </div>`;
  }).join('');
  wireRotate(cards);
  cards.querySelectorAll('.editnote').forEach(b => b.onclick = () => startEditNote(parseInt(b.getAttribute('data-id'), 10), rows));
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

// ---- Groups ----
async function renderGroups() {
  if (state.groupId) { renderGroupDetail(state.groupId); return; }
  const body = document.getElementById('body');
  body.innerHTML = `
    <div class="formhead">Create New Group</div>
    <input id="gtitle" type="text" placeholder="Group Title" style="font-size:18px;font-weight:bold" />
    <textarea id="gdesc" placeholder="Description (optional)" style="min-height:60px;margin-top:8px"></textarea>
    <button class="btn slim" id="gcreate">Create</button>

    <div class="formhead" style="margin-top:30px">Current Groups</div>
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
      body: JSON.stringify({ title, description }),
    });
    if (!r.ok) throw new Error('bad');
    document.getElementById('gtitle').value = '';
    document.getElementById('gdesc').value = '';
    toast('Group created');
    loadGroups();
  } catch (e) { toast('Could not create group'); }
  finally { btn.disabled = false; }
}

async function loadGroups() {
  const list = document.getElementById('glist');
  if (!list) return;
  list.innerHTML = '<p class="status">Loading...</p>';
  const r = await api('/api/groups');
  if (!r.ok) { list.innerHTML = '<p class="status">Could not load.</p>'; return; }
  const groups = await r.json();
  if (!groups.length) { list.innerHTML = '<p class="empty">No groups yet. Create one above, then add photos from the Library tab.</p>'; return; }
  list.innerHTML = groups.map(g => `
    <div class="card">
      <div style="font-weight:bold;font-size:17px">${esc(g.title || 'Untitled group')}</div>
      ${g.description ? `<div style="margin:4px 0">${esc(g.description)}</div>` : ''}
      <div class="meta">${g.item_count} photo${g.item_count === 1 ? '' : 's'}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn slim gopen" data-id="${g.id}">Open</button>
        <button class="btn secondary slim" data-id="${g.id}" data-del="1" style="color:#c1121f">Delete</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('.gopen').forEach(b => b.onclick = () => { state.groupId = parseInt(b.getAttribute('data-id'), 10); renderGroups(); });
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = () => deleteGroup(parseInt(b.getAttribute('data-id'), 10)));
}

async function deleteGroup(id) {
  if (!confirm('Delete this group? The photos themselves are kept.')) return;
  const r = await api(`/api/groups/${id}/delete`, { method: 'POST' });
  if (r.ok) { toast('Group deleted'); loadGroups(); } else toast('Delete failed');
}

async function renderGroupDetail(id) {
  const body = document.getElementById('body');
  body.innerHTML = '<p class="status">Loading...</p>';
  const r = await api(`/api/groups/${id}`);
  if (!r.ok) { body.innerHTML = '<p class="status">Could not load group.</p>'; return; }
  const data = await r.json();
  currentGroup = data.group;
  currentGroupItems = data.items || [];
  body.innerHTML = `
    <button class="backlink" id="gback">‹ All Groups</button>
    <label>Title</label>
    <div id="titleview"></div>
    <label>Description</label>
    <div id="descview"></div>

    <label style="margin-top:16px">Export This Group <span style="font-weight:normal;text-transform:none;letter-spacing:0">(pick one or more)</span></label>
    <div class="pill-group" id="gfmts">
      <div class="pill" data-fmt="pdf">PDF</div>
      <div class="pill" data-fmt="docx">Word</div>
      <div class="pill" data-fmt="bundle">For AI (.zip)</div>
    </div>
    ${qualityBlock('gimgres', 'gimgfmt')}
    <div class="row">
      <button class="btn" id="gexport">Export Group</button>
      <button class="btn secondary" id="greverse">Reverse Order</button>
    </div>

    <div id="gitems" style="margin-top:16px"></div>`;
  document.getElementById('gback').onclick = () => { state.groupId = null; renderGroups(); };
  document.getElementById('greverse').onclick = reverseItems;
  document.getElementById('gexport').onclick = groupExport;
  document.getElementById('gfmts').onclick = (e) => { const p = e.target.closest('.pill'); if (p) p.classList.toggle('on'); };
  renderTitleView();
  renderDescView();
  renderGroupItems();
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
  if (!items.length) { box.innerHTML = '<p class="empty">No photos in this group yet. Go to Library, select some, and use "Add Selected to a Group".</p>'; return; }
  box.innerHTML = items.map((c, i) => `
    <div class="card">
      <div class="meta">#${i + 1}</div>
      ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="capture" />` : ''}
      <div class="rotaterow">${rotateButtons(c.id)}</div>
      <div class="addr">${esc(c.address || 'No location')}</div>
      <div>${esc(c.note || '(no note)')}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn secondary gup" data-i="${i}">↑ Up</button>
        <button class="btn secondary gdown" data-i="${i}">↓ Down</button>
        <button class="btn" data-i="${i}" data-rm="1" style="background:#b3261e">Remove</button>
      </div>
    </div>`).join('');
  wireRotate(box);
  box.querySelectorAll('.gup').forEach(b => b.onclick = () => moveItem(parseInt(b.getAttribute('data-i'), 10), -1));
  box.querySelectorAll('.gdown').forEach(b => b.onclick = () => moveItem(parseInt(b.getAttribute('data-i'), 10), 1));
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeItem(parseInt(b.getAttribute('data-i'), 10)));
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
  btn.disabled = false; btn.textContent = 'Export Group';
  toast('Exported');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
boot();
