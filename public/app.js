const AREAS = ['Roads', 'Maintenance', 'Walls', 'Security', 'Landscaping', 'Other'];
const el = document.getElementById('app');
let state = { view: 'capture', location: null, photoFile: null, kind: 'note', area: 'Roads' };

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
  if (r.ok) renderApp(); else renderLogin();
}

function renderLogin() {
  el.innerHTML = `
    <div class="wrap">
      <h1>Photo Notes</h1>
      <p class="sub">Photo documentation, by voice</p>
      <label for="pw">Password</label>
      <input id="pw" type="password" autocomplete="current-password" />
      <button class="btn" id="loginBtn">Sign in</button>
      <p class="status" id="loginErr"></p>
    </div>`;
  document.getElementById('loginBtn').onclick = doLogin;
  document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

async function doLogin() {
  const pw = document.getElementById('pw').value;
  const r = await api('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if (r.ok) renderApp();
  else document.getElementById('loginErr').textContent = 'Wrong password. Try again.';
}

function renderApp() {
  el.innerHTML = `
    <div class="wrap">
      <div class="topbar">
        <strong>Photo Notes</strong>
        <button class="link" id="logout">Log out</button>
      </div>
      <div class="tabs">
        <div class="tab ${state.view==='capture'?'on':''}" id="tabCapture">Capture</div>
        <div class="tab ${state.view==='list'?'on':''}" id="tabList">Captures</div>
      </div>
      <div id="body"></div>
    </div>`;
  document.getElementById('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); renderLogin(); };
  document.getElementById('tabCapture').onclick = () => { state.view='capture'; renderApp(); };
  document.getElementById('tabList').onclick = () => { state.view='list'; renderApp(); };
  if (state.view === 'capture') renderCapture(); else renderList();
}

function renderCapture() {
  const body = document.getElementById('body');
  body.innerHTML = `
    <label>Photo</label>
    <div class="photo-box">
      <input type="file" accept="image/*" capture="environment" id="photo" />
      <img id="preview" alt="preview" />
    </div>

    <label>Location</label>
    <div class="status" id="loc">Getting location...</div>
    <button class="btn secondary" id="relocate">Refresh location</button>

    <label>Note <span style="font-weight:normal">(tap the mic on your keyboard to dictate)</span></label>
    <textarea id="note" placeholder="Describe what you're looking at..."></textarea>

    <label>Area</label>
    <div class="pill-group" id="areas">
      ${AREAS.map(a => `<div class="pill ${state.area===a?'on':''}" data-area="${a}">${a}</div>`).join('')}
    </div>

    <label>Type</label>
    <div class="pill-group" id="kinds">
      <div class="pill ${state.kind==='note'?'on':''}" data-kind="note">Note</div>
      <div class="pill ${state.kind==='task'?'on':''}" data-kind="task">Task</div>
    </div>

    <button class="btn" id="save">Save capture</button>
  `;

  const photo = document.getElementById('photo');
  const preview = document.getElementById('preview');
  photo.onchange = () => {
    state.photoFile = photo.files[0] || null;
    if (state.photoFile) { preview.src = URL.createObjectURL(state.photoFile); preview.style.display = 'block'; }
  };

  document.getElementById('areas').onclick = (e) => {
    const a = e.target.getAttribute('data-area'); if (!a) return;
    state.area = a; renderCapture();
  };
  document.getElementById('kinds').onclick = (e) => {
    const k = e.target.getAttribute('data-kind'); if (!k) return;
    state.kind = k; renderCapture();
  };
  document.getElementById('relocate').onclick = getLocation;
  document.getElementById('save').onclick = saveCapture;

  // preserve any typed note across re-renders
  if (state._note) document.getElementById('note').value = state._note;
  document.getElementById('note').addEventListener('input', e => state._note = e.target.value);

  if (state.location) showLoc(); else getLocation();
}

function showLoc() {
  const l = document.getElementById('loc');
  if (!l) return;
  if (state.location) l.textContent = `Location set (${state.location.lat.toFixed(5)}, ${state.location.lng.toFixed(5)}). Address is added when you save.`;
}

function getLocation() {
  const l = document.getElementById('loc');
  if (l) l.textContent = 'Getting location...';
  if (!navigator.geolocation) { if (l) l.textContent = 'Location not available on this device.'; return; }
  navigator.geolocation.getCurrentPosition(
    pos => { state.location = { lat: pos.coords.latitude, lng: pos.coords.longitude }; showLoc(); },
    err => { if (l) l.textContent = 'Location blocked. Allow location for this site to tag captures.'; },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

async function saveCapture() {
  const btn = document.getElementById('save');
  const note = document.getElementById('note').value.trim();
  if (!state.photoFile && !note) { toast('Add a photo or a note first'); return; }
  btn.disabled = true; btn.textContent = 'Saving...';
  const fd = new FormData();
  if (state.photoFile) fd.append('photo', state.photoFile);
  fd.append('note', note);
  fd.append('area_tags', JSON.stringify([state.area]));
  fd.append('kind', state.kind);
  if (state.location) { fd.append('latitude', state.location.lat); fd.append('longitude', state.location.lng); }
  try {
    const r = await api('/api/captures', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('save failed');
    toast('Saved');
    state.photoFile = null; state._note = '';
    renderCapture();
  } catch (e) {
    toast('Save failed, try again');
  } finally {
    btn.disabled = false; btn.textContent = 'Save capture';
  }
}

async function renderList() {
  const body = document.getElementById('body');
  body.innerHTML = `
    <label>Filter by area</label>
    <select id="filter">
      <option value="">All areas</option>
      ${AREAS.map(a => `<option value="${a}">${a}</option>`).join('')}
    </select>
    <label>Export ${'<span style="font-weight:normal">(uses the filter above)</span>'}</label>
    <div class="row">
      <button class="btn secondary" onclick="doExport('pdf')">PDF</button>
      <button class="btn secondary" onclick="doExport('docx')">Word</button>
      <button class="btn secondary" onclick="doExport('bundle')">Claude bundle</button>
    </div>
    <div id="cards" style="margin-top:16px"></div>`;
  document.getElementById('filter').onchange = e => loadCards(e.target.value);
  loadCards('');
}

function doExport(kind) {
  const sel = document.getElementById('filter');
  const area = sel ? sel.value : '';
  window.location.href = `/api/export/${kind}` + (area ? `?area=${encodeURIComponent(area)}` : '');
}

async function loadCards(area) {
  const cards = document.getElementById('cards');
  cards.innerHTML = '<p class="status">Loading...</p>';
  const r = await api('/api/captures' + (area ? `?area=${encodeURIComponent(area)}` : ''));
  if (!r.ok) { cards.innerHTML = '<p class="status">Could not load.</p>'; return; }
  const rows = await r.json();
  if (!rows.length) { cards.innerHTML = '<p class="empty">No captures yet. Go grab one.</p>'; return; }
  cards.innerHTML = rows.map(c => {
    const when = new Date(c.created_at).toLocaleString();
    const tags = (c.area_tags || []).map(t => `<span class="badge">${t}</span>`).join('');
    const kind = c.kind === 'task' ? `<span class="badge task">Task</span>` : '';
    return `<div class="card">
      ${c.photo_path ? `<img src="${c.photo_path}" alt="capture" />` : ''}
      <div class="addr">${c.address || (c.latitude ? c.latitude.toFixed(5)+', '+c.longitude.toFixed(5) : 'No location')}</div>
      <div class="meta">${kind}${tags}</div>
      <div>${(c.note || '').replace(/</g,'&lt;')}</div>
      <div class="meta">${when}</div>
    </div>`;
  }).join('');
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(()=>{}));
}
boot();
