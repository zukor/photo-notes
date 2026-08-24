const el = document.getElementById('app');
// Phones/tablets open to Capture (grab a photo fast); computers open to the Library (review the photos).
const IS_HANDHELD = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth < 768;
let state = { view: IS_HANDHELD ? 'capture' : 'organize', location: null, address: null, photoFile: null, kind: 'note', area: '', areas: [], groupId: null, imgv: 0, plan: 'free', ewrId: null, selectedIds: new Set() };

// Pro gating on the client. Mirrors isPro(user) on the server. Pro-only UI must
// not render at all for free users (no disabled teaser).
function isProClient() { return state.plan === 'pro'; }
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
  if (r.ok) { try { const me = await r.json(); state.plan = me.plan || 'free'; } catch (e) {} await loadAreas(); renderApp(); } else renderLogin();
}

function renderLogin() {
  el.innerHTML = `
    <div class="wrap">
      <div style="display:flex;justify-content:flex-end;margin-top:8px"><img src="/zukor-logo.svg" alt="Zukor AI" style="height:22px;width:auto;display:block" /></div>
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
  if (r.ok) { try { const d = await r.json(); state.plan = d.plan || 'free'; } catch (e) {} await loadAreas(); renderApp(); }
  else document.getElementById('loginErr').textContent = 'Wrong email or password. Try again.';
}

function renderApp() {
  el.innerHTML = `
    <div class="wrap">
      <div class="logoutbar" style="display:flex;flex-direction:column;align-items:flex-end;gap:3px">
        <img src="/zukor-logo.svg" alt="Zukor AI" style="height:22px;width:auto;display:block" />
        <button class="link" id="logout">Log out</button>
      </div>
      <div class="brandrow">
        <div class="brand ${isProClient() ? 'asphalt-pro-brand' : ''}">Photo Notes${isProClient() ? ' Asphalt Pro' : ''}</div>
      </div>
      <div class="tabs workflow-tabs" aria-label="Photo Notes workflow">
        <div class="tab ${state.view==='capture'?'on':''}" id="tabCapture">Capture</div>
        <div class="tab ${state.view==='organize'?'on':''}" id="tabOrganize">Organize</div>
        <div class="tab ${state.view==='edit'?'on':''}" id="tabEdit">Edit</div>
        <div class="tab ${state.view==='create'?'on':''}" id="tabCreate">Create</div>
        <div class="tab ${state.view==='send'?'on':''}" id="tabSend">Send</div>
      </div>
      <div id="body"></div>
      <div class="footer">&copy; ${new Date().getFullYear()} Zukor AI. All Rights Reserved.</div>
    </div>`;
  document.getElementById('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); renderLogin(); };
  document.getElementById('tabCapture').onclick = () => { state.view='capture'; renderApp(); };
  document.getElementById('tabOrganize').onclick = () => { state.view='organize'; renderApp(); };
  document.getElementById('tabEdit').onclick = () => { state.view='edit'; renderApp(); };
  document.getElementById('tabCreate').onclick = () => { state.view='create'; state.groupId=null; renderApp(); };
  document.getElementById('tabSend').onclick = () => { state.view='send'; renderApp(); };
  if (state.view === 'capture') renderCapture();
  else if (state.view === 'organize') renderList();
  else if (state.view === 'edit') renderEdit();
  else if (state.view === 'create') renderGroups();
  else if (state.view === 'send') renderSend();
  else if (state.view === 'map') renderMap();
  else { state.view = 'organize'; renderList(); }
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
    <button type="button" class="btn" id="dictate" style="margin-bottom:8px">Record Note</button>
    <textarea id="note" placeholder="Type what you're looking at, or tap Record Note"></textarea>

    ${isProClient() ? dimBlockHtml() : ''}

    <label>Select Topic</label>
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

  // Pro-only dimension fields
  if (isProClient()) wireDims();

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
    // Pro: pull dimension phrases out of the spoken text and prefill the fields.
    if (finalText && isProClient()) applyExtraction(base);
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

// ================= Pro dimension fields =================
// dims state is kept on state._dims so it survives renderCapture re-renders
// (e.g. after choosing a topic), just like state._note.
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
  if (!state.photoFile) { toast('Take or choose a photo first'); return; }
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
    fd.append('photo', state.photoFile);
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
  if (state.view === 'capture') { renderCapture(); }
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
let bgQueue = [];      // [{ fd, hadCoords, tries }]
let bgActive = 0;      // 1 while an upload is in flight, else 0
let bgDraining = false;
let bgOnlineHooked = false;

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
    el.textContent = total === 1 ? 'Uploading photo…' : `Uploading ${total} photos…`;
    el.style.background = '#111';
    el.style.display = 'block';
  } else {
    el.textContent = 'All photos uploaded';
    el.style.background = '#1b7a3d';
    setTimeout(() => { if (el && bgActive + bgQueue.length === 0) el.style.display = 'none'; }, 1600);
  }
}

function enqueueUpload(fd, hadCoords) {
  bgQueue.push({ fd, hadCoords: !!hadCoords, tries: 0 });
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
        const r = await fetch('/api/captures', { method: 'POST', credentials: 'same-origin', body: item.fd });
        if (!r.ok) throw new Error('http ' + r.status);
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
        if (item.tries < 6) {
          const delay = Math.min(45000, 2000 * Math.pow(2, item.tries - 1));
          setTimeout(() => { bgQueue.push(item); drainQueue(); }, delay);
        } else {
          toast('A photo could not upload. Check your connection.');
        }
      }
      bgIndicator();
    }
  } finally { bgDraining = false; }
}

function saveCapture() {
  const note = document.getElementById('note').value.trim();
  if (!state.photoFile && !note) { toast('Take a photo or add a note first'); return; }
  // Build the payload from the CURRENT state before we clear the form.
  const fd = new FormData();
  if (state.photoFile) fd.append('photo', state.photoFile);
  fd.append('note', note);
  fd.append('area_tags', JSON.stringify(state.area ? [state.area] : []));
  fd.append('kind', 'note');
  const hadCoords = !!state.location;
  if (state.location) { fd.append('latitude', state.location.lat); fd.append('longitude', state.location.lng); }
  if (state.address) fd.append('address', state.address);
  if (isProClient()) {
    const dm = collectDims(); Object.keys(dm).forEach(k => fd.append(k, dm[k]));
    if (state._measure) {
      fd.append('dim_source', 'photo_ai');
      fd.append('dim_confidence', state._measure.confidence || 'low');
      fd.append('dim_confirmed', String(!!state._measure.confirmed));
      fd.append('measure_reference', state._measure.reference || '');
      if (state._measure.raw) { try { fd.append('dim_ai', JSON.stringify(state._measure.raw)); } catch (e) {} }
    }
  }
  // Commit instantly: clear the form and hand the upload to the background.
  state.photoFile = null; state._note = ''; state.location = null; state.address = null;
  state._dims = freshDims(); state._measure = null;
  renderCapture();
  toast('Saved');
  enqueueUpload(fd, hadCoords);
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

// ---- Library (saved captures) ----
async function renderList() {
  const body = document.getElementById('body');
  body.className = 'workflow-organize';
  body.innerHTML = `
    <div class="workflow-intro"><strong>Organize your captures</strong><span>Choose photos, file them by topic, and place them in the order you need.</span></div>
    <label>Filter by Topic</label>
    <select id="filter">
      <option value="">All Topics</option>
      ${state.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}
    </select>
    <div class="row" style="margin-top:10px">
      <button class="btn secondary" id="selall">Select All</button>
      <button class="btn secondary" id="selnone">Clear</button>
    </div>
    ${isProClient() ? `<button class="btn secondary slim" id="classifybatch" style="margin-top:8px">Classify Selected (AI)</button><div class="status" id="classifyprog"></div>
    <button class="btn secondary slim" id="pairbtn" style="margin-top:8px">Pair as Before/After (select 2)</button>` : ''}

    <label>File Selected Under a Topic</label>
    <div class="row compact">
      <select id="bulktopic"><option value="">Choose Topic</option>${state.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
      <button class="btn secondary" id="applytopic">Apply</button>
    </div>
    <div class="row compact" style="margin-top:8px">
      <input id="organizenewtopic" type="text" placeholder="Create a new topic...">
      <button class="btn secondary" id="createtopic">Create</button>
    </div>

    <label style="margin-top:18px">Add Selected to a Document</label>
    <div class="row compact">
      <select id="groupsel" style="flex:1"><option value="">Choose Document</option></select>
      <button class="btn secondary" id="addtogroup">Add</button>
    </div>
    <input id="newgroupname" type="text" placeholder="...or type a new document title" style="margin-top:8px" />

    ${isProClient() ? `<button class="btn secondary slim" id="openmap">Organize on Map</button>` : ''}

    <div id="cards" style="margin-top:16px"></div>`;
  document.getElementById('filter').onchange = e => loadCards(e.target.value);
  document.getElementById('selall').onclick = () => document.querySelectorAll('.capchk').forEach(c => { c.checked = true; state.selectedIds.add(String(c.value)); });
  document.getElementById('selnone').onclick = () => { state.selectedIds.clear(); document.querySelectorAll('.capchk').forEach(c => c.checked = false); };
  document.getElementById('applytopic').onclick = applyTopicToSelected;
  document.getElementById('createtopic').onclick = createOrganizeTopic;
  document.getElementById('addtogroup').onclick = addSelectedToGroup;
  const cb = document.getElementById('classifybatch');
  if (cb) cb.onclick = classifySelected;
  const pb = document.getElementById('pairbtn');
  if (pb) pb.onclick = pairSelected;
  const om = document.getElementById('openmap'); if (om) om.onclick = () => { state.view = 'map'; renderApp(); };
  loadGroupOptions();
  loadCards('');
}

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

async function renderEdit() {
  const body = document.getElementById('body');
  body.className = 'workflow-edit';
  body.innerHTML = `
    <div class="workflow-intro"><strong>Edit your material</strong><span>Improve photos, add stamps and captions, correct notes, or remove unwanted captures.</span></div>
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
  const swap = confirm(`Before = capture #${before.id} (older), After = capture #${after.id}.\n\nOK to keep this order, or Cancel to swap Before/After.`);
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
  window._lastCards = rows;
  // Pro: pull pairs + proximity suggestions so we can render combined cards.
  let pairs = [], suggestions = [];
  if (isProClient()) {
    try { const pr = await api('/api/pairs'); if (pr.ok) pairs = await pr.json(); } catch (e) {}
    try { const sr = await api('/api/pairs/suggestions'); if (sr.ok) suggestions = await sr.json(); } catch (e) {}
  }
  const byId = {}; rows.forEach(c => { byId[c.id] = c; });
  const beforeOf = {}, afterOf = {};
  pairs.forEach(p => { beforeOf[p.before_id] = p; afterOf[p.after_id] = p; });
  if (!window._dismissedSug) window._dismissedSug = new Set();
  const visSug = suggestions.filter(s => byId[s.before_id] && byId[s.after_id] && !window._dismissedSug.has(s.before_id + '-' + s.after_id));
  let banner = '';
  if (visSug.length) {
    banner = `<div class="card" style="border-color:#1d4ed8"><div style="font-weight:bold">Possible before/after matches nearby</div>` +
      visSug.map(s => `<div class="row" style="margin-top:6px;align-items:center">
        <div class="meta" style="flex:2">#${s.before_id} and #${s.after_id}, ${s.meters} m apart</div>
        <button class="btn slim sugpair" data-b="${s.before_id}" data-a="${s.after_id}" style="flex:1">Pair</button>
        <button class="editlink sugdismiss" data-b="${s.before_id}" data-a="${s.after_id}">Dismiss</button>
      </div>`).join('') + `</div>`;
  }
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
  cards.innerHTML = banner + html.join('');
  wireCards(cards, rows);
  cards.querySelectorAll('.capchk').forEach(c => { c.checked = state.selectedIds.has(String(c.value)); });
  if (state._focusCapture) {
    const chk = cards.querySelector(`.capchk[value="${state._focusCapture}"]`);
    state._focusCapture = null;
    if (chk) { const card = chk.closest('.card'); if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.style.outline = '3px solid #1d4ed8'; setTimeout(() => { card.style.outline = ''; }, 2500); } }
  }
}

function captureCardHtml(c) {
  const when = new Date(c.created_at).toLocaleString([], { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const tags = (c.area_tags || []).map(t => `<span class="badge">${esc(t)}</span>`).join('');
  const kind = c.kind === 'task' ? `<span class="badge task">Task</span>` : '';
  const dims = isProClient() ? fmtDimsClient(c) : '';
  const classifyRow = isProClient()
    ? (c.defect_type
        ? `<div class="defectrow" style="margin:6px 0">${defectBadgeHtml(c)} <button class="editlink overridebtn" data-id="${c.id}">Change</button></div>`
        : `<div class="defectrow" style="margin:6px 0"><button class="btn secondary slim classifybtn" data-id="${c.id}">Classify (AI)</button></div>`)
    : '';
  return `<div class="card">
    <label style="display:flex;align-items:center;gap:8px;font-weight:bold;margin-bottom:8px;text-transform:none;letter-spacing:0;font-size:15px">
      <input type="checkbox" class="capchk" value="${c.id}" style="width:20px;height:20px"> Select
    </label>
    ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="capture" />` : ''}
    <div class="meta">${when}</div>
    <div class="rotaterow">${rotateButtons(c.id)}</div>
    <div class="addr">${esc(c.address || (c.latitude ? c.latitude.toFixed(5)+', '+c.longitude.toFixed(5) : 'No location'))}</div>
    <div class="meta">${kind}${tags}</div>
    ${classifyRow}
    ${dims ? `<div class="meta"><strong>Dimensions:</strong> ${esc(dims)}</div>` : ''}
    ${c.photo_path ? `<button class="btn secondary slim stampbtn" data-id="${c.id}">Add Stamps to Photo${(c.overlays && c.overlays.length) ? ' (' + c.overlays.length + ')' : ''}</button>` : ''}
    ${c.photo_path ? `<button class="btn secondary slim cropbtn" data-id="${c.id}">Crop Photo</button>` : ''}
    ${c.photo_original_path ? `<button class="btn secondary slim restorebtn" data-id="${c.id}">Restore Original Photo</button>` : ''}
    <div class="notewrap" data-id="${c.id}">
      <div class="notetext">${esc(c.note || '(no note)')}</div>
      <button class="btn secondary editnote" data-id="${c.id}" style="margin-top:6px">Edit Note</button>
    </div>
  </div>`;
}

// A combined before/after card: two photos side by side with labels + Unpair.
function pairCardHtml(before, after) {
  const side = (c, label) => {
    const dims = isProClient() ? fmtDimsClient(c) : '';
    const badge = isProClient() && c.defect_type ? defectBadgeHtml(c) : '';
    return `<div style="flex:1;min-width:0">
      <div style="font-weight:bold;font-size:13px">${label}</div>
      <label style="display:flex;align-items:center;gap:6px;text-transform:none;letter-spacing:0;font-size:13px;font-weight:bold">
        <input type="checkbox" class="capchk" value="${c.id}" style="width:18px;height:18px"> Select
      </label>
      ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="${label}" />` : ''}
      <div class="rotaterow">${rotateButtons(c.id)}</div>
      ${badge ? `<div style="margin:4px 0">${badge}</div>` : ''}
      ${dims ? `<div class="meta"><strong>Dimensions:</strong> ${esc(dims)}</div>` : ''}
      <div class="meta">${esc(c.note || '(no note)')}</div>
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
  cards.querySelectorAll('.editnote').forEach(b => b.onclick = () => startEditNote(parseInt(b.getAttribute('data-id'), 10), rows));
  cards.querySelectorAll('.classifybtn').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Classifying...';
    const d = await classifyOne(parseInt(b.getAttribute('data-id'), 10));
    if (d && d.ok) loadCards(document.getElementById('filter').value || '');
    else { b.disabled = false; b.textContent = 'Classify (AI)'; toast('Could not classify this photo'); }
  });
  cards.querySelectorAll('.overridebtn').forEach(b => b.onclick = () => startOverride(parseInt(b.getAttribute('data-id'), 10), rows));
  cards.querySelectorAll('.defbadge').forEach(b => b.onclick = () => startOverride(parseInt(b.getAttribute('data-id'), 10), rows));
  cards.querySelectorAll('.unpairbtn').forEach(b => b.onclick = () => unpair(parseInt(b.getAttribute('data-id'), 10)));
  cards.querySelectorAll('.sugpair').forEach(b => b.onclick = async () => {
    const r = await api('/api/pairs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ before_id: parseInt(b.getAttribute('data-b'), 10), after_id: parseInt(b.getAttribute('data-a'), 10) }) });
    if (r.ok) { toast('Paired'); loadCards(document.getElementById('filter').value || ''); } else toast('Pairing failed');
  });
  cards.querySelectorAll('.sugdismiss').forEach(b => b.onclick = () => { window._dismissedSug.add(b.getAttribute('data-b') + '-' + b.getAttribute('data-a')); loadCards(document.getElementById('filter').value || ''); });
  cards.querySelectorAll('.stampbtn').forEach(b => b.onclick = () => { const c = rows.find(r => r.id === parseInt(b.getAttribute('data-id'), 10)); if (c) renderStampEditor(c); });
  cards.querySelectorAll('.cropbtn').forEach(b => b.onclick = () => { const c = rows.find(r => r.id === parseInt(b.getAttribute('data-id'), 10)); if (c) renderCropEditor(c); });
  cards.querySelectorAll('.restorebtn').forEach(b => b.onclick = () => restoreOriginal(parseInt(b.getAttribute('data-id'), 10)));
}

// ================= Photo overlays / stamps editor =================
let editorCapture = null, editorOverlays = [], editorSel = -1;
const OVERLAY_FIELD_LABELS = { datetime: 'Date / Time', address: 'Address', gps: 'GPS', copyright: 'Copyright', topic: 'Topic', dims: 'Dimensions', defect: 'Defect', custom: 'Custom Text', rect: 'Box / Rectangle' };
const OVERLAY_FONT_CSS = { sans: 'Arial, Helvetica, sans-serif', serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", monospace', heavy: 'Impact, "Arial Black", sans-serif' };
function overlayTextClient(item, c) {
  switch (item.t) {
    case 'datetime': return new Date(c.created_at).toLocaleString();
    case 'address': return c.address || '';
    case 'gps': return (c.latitude != null && c.longitude != null) ? `${Number(c.latitude).toFixed(5)}, ${Number(c.longitude).toFixed(5)}` : '';
    case 'topic': return (c.area_tags || []).join(', ');
    case 'dims': return fmtDimsClient(c);
    case 'defect': return c.defect_type ? (defectLabelClient(c.defect_type) + (c.defect_severity ? ', ' + c.defect_severity : '')) : '';
    case 'copyright': return item.text || ('© ' + new Date().getFullYear());
    default: return item.text || '';
  }
}
function renderStampEditor(c) {
  editorCapture = c;
  editorOverlays = Array.isArray(c.overlays) ? JSON.parse(JSON.stringify(c.overlays)) : [];
  editorSel = editorOverlays.length ? 0 : -1;
  const body = document.getElementById('body');
  const addOpts = ['datetime', 'address', 'gps', 'copyright', 'topic', 'custom', 'rect'];
  if (isProClient()) { addOpts.push('dims', 'defect'); }
  body.innerHTML = `
    <button class="backlink" id="stampBack">‹ Back to Edit</button>
    <div class="formhead">Add Stamps to Photo</div>
    <div class="status">Tap Add, then drag each item on the photo or use a corner button. Style it below.</div>
    <div id="stampStage" style="position:relative;display:inline-block;max-width:100%;border:1px solid #000;border-radius:8px;overflow:hidden;touch-action:none">
      <img id="stampImg" src="${photoSrc(c.photo_path)}" alt="photo" style="display:block;max-width:100%;height:auto" />
    </div>
    <label style="margin-top:10px">Add Item</label>
    <div class="pill-group" id="stampAdd">
      ${addOpts.map(t => `<div class="pill" data-add="${t}">${OVERLAY_FIELD_LABELS[t]}</div>`).join('')}
    </div>
    <div id="stampCtl"></div>
    <div class="row" style="margin-top:14px">
      <button class="btn" id="stampSave">Save Stamps</button>
      <button class="btn secondary" id="stampCopy">Save Stamped Copy</button>
    </div>`;
  document.getElementById('stampBack').onclick = () => { state.view = 'edit'; renderEdit(); };
  document.getElementById('stampAdd').onclick = (e) => { const p = e.target.closest('[data-add]'); if (p) addOverlayItem(p.getAttribute('data-add')); };
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
  } else {
    item = { t, text: t === 'copyright' ? ('© ' + new Date().getFullYear() + ' Zukor AI. All Rights Reserved.') : (t === 'custom' ? 'Text' : ''), x: 4, y: 84, size: 5, color: '#ffffff', font: 'sans', outline: true };
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
    if (it.t === 'rect') {
      const box = document.createElement('div');
      box.className = 'ovitem ovrect' + (i === editorSel ? ' sel' : '');
      const bw = Math.max(1, (Number(it.thickness) || 0.6) / 100 * stW);
      box.style.cssText = `position:absolute;left:${it.x}%;top:${it.y}%;width:${it.w}%;height:${it.h}%;border:${bw}px solid ${it.color};box-sizing:border-box;cursor:move;touch-action:none;${i === editorSel ? 'outline:2px dashed #1d4ed8;outline-offset:2px;' : ''}`;
      box.dataset.i = i;
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
    d.style.cssText = `position:absolute;left:${it.x}%;top:${it.y}%;font-size:${Math.max(9, it.size / 100 * h)}px;color:${it.color};font-family:${OVERLAY_FONT_CSS[it.font] || OVERLAY_FONT_CSS.sans};font-weight:${it.font === 'heavy' ? '800' : 'normal'};white-space:nowrap;cursor:move;user-select:none;line-height:1;${it.outline ? 'text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000;' : ''}${i === editorSel ? 'outline:2px dashed #1d4ed8;outline-offset:2px;' : ''}`;
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
    const isRect = it.t === 'rect';
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
// Corner-resize for rectangle items: drag the bottom-right handle to set w/h.
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
  if (it.t === 'rect') {
    box.innerHTML = `
      <label style="margin-top:12px">Selected: Box / Rectangle</label>
      <div class="status">Drag the box to move it. Drag the blue corner dot to resize.</div>
      <label style="margin-top:8px">Color</label>
      <div class="pill-group" id="ovColors">${colors.map(col => `<div class="pill" data-col="${col}" style="background:${col};width:34px;height:28px;${it.color === col ? 'outline:3px solid #1d4ed8;' : ''}"></div>`).join('')}
        <input type="color" id="ovColorPick" value="${/^#[0-9a-fA-F]{6}$/.test(it.color) ? it.color : '#ff0000'}" style="width:44px;height:32px;padding:0;border:1px solid #000;border-radius:6px" />
      </div>
      <label style="margin-top:8px">Line Thickness</label>
      <input type="range" id="ovThick" min="0.2" max="3" step="0.1" value="${it.thickness || 0.6}" style="width:100%" />
      <button class="btn secondary slim" id="ovDelete" style="color:#c1121f;margin-top:8px">Delete This Box</button>`;
    const tq = q => box.querySelector(q);
    box.querySelectorAll('[data-col]').forEach(b => b.onclick = () => { it.color = b.getAttribute('data-col'); renderStampCtl(); drawOverlayItems(); });
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
    <input type="range" id="ovSize" min="2" max="14" step="0.5" value="${it.size}" style="width:100%" />
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
  btn.disabled = false; btn.textContent = 'Save Stamps';
  if (r.ok) { editorCapture.overlays = editorOverlays; toast('Stamps saved'); }
  else toast('Save failed');
}
async function saveStampedCopy() {
  const btn = document.getElementById('stampCopy'); btn.disabled = true; btn.textContent = 'Building...';
  // save first so the server has the latest overlays
  await api(`/api/captures/${editorCapture.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ overlays: editorOverlays }) });
  editorCapture.overlays = editorOverlays;
  try {
    const r = await api(`/api/captures/${editorCapture.id}/stamped?res=print`);
    if (!r.ok) throw new Error('bad');
    const blob = await r.blob(); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `photo-${editorCapture.id}-stamped.jpg`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast('Stamped copy ready');
  } catch (e) { toast('Could not build stamped copy'); }
  finally { btn.disabled = false; btn.textContent = 'Save Stamped Copy'; }
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
  body.innerHTML = `
    <div class="row compact">
      <select id="mapTopic" style="flex:1"><option value="">All Topics</option>${state.areas.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select>
      <select id="mapGroup" style="flex:1"><option value="">All Groups</option></select>
    </div>
    <div class="status" style="margin-top:4px">Satellite imagery can be one or more years old. Verify recent construction on site.</div>
    <div id="mapMeasureBar" style="margin-top:6px"></div>
    <div id="mapdiv" style="height:68vh;min-height:340px;margin-top:8px;border:1px solid #000;border-radius:8px"></div>`;
  await loadLeaflet();
  if (!window.L) { document.getElementById('mapdiv').innerHTML = '<p class="status">Map library could not load. Check your connection.</p>'; return; }
  mapObj = null; mapMarkers = []; mapZoneLayers = [];
  let cfg = {}; try { const c = await api('/api/config'); if (c.ok) cfg = await c.json(); } catch (e) {}
  window._mapCfg = cfg;
  const gsel = document.getElementById('mapGroup');
  try { const gr = await api('/api/groups'); if (gr.ok) { const gs = await gr.json(); gsel.innerHTML = '<option value="">All Groups</option>' + gs.map(g => `<option value="${g.id}">${esc(g.title || 'Untitled')}</option>`).join(''); } } catch (e) {}
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
    ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" style="width:100%;border-radius:4px" />` : ''}
    ${badge ? `<div style="margin:4px 0">${badge}</div>` : ''}
    <div style="font-weight:bold;font-size:13px;color:#000">${esc(c.address || 'No location')}</div>
    <div style="font-size:12px;color:#000">${esc(note)}${(c.note || '').length > 120 ? '…' : ''}</div>
    <button class="mapopen" data-id="${c.id}" style="margin-top:6px">Open in Library</button>
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
  if (d.mode === 'span') { const w = prompt('Pavement width in feet (a standard two-lane residential road is 24):', '24'); if (w == null) return; width = parseFloat(w); if (!isFinite(width) || width <= 0) { toast('Enter a valid width'); return; } }
  const gsel = document.getElementById('mapGroup'); const groupId = gsel ? gsel.value : '';
  let name, url, body;
  if (d.editId) {
    url = `/api/zones/${d.editId}`;
    body = { points: d.points }; if (width != null) body.width_ft = width;
  } else {
    name = prompt('Name this zone:', d.mode === 'polygon' ? 'Area' : 'Roadway'); if (name == null) return;
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
      <button class="zn-attach" data-id="${z.id}">Attach to group</button>
      <button class="zn-del" data-id="${z.id}">Delete</button>
    </div>
  </div>`;
}
function wireZonePopup(e, z) {
  const root = e.popup.getElement(); if (!root) return;
  const q = (c) => root.querySelector(c);
  const ed = q('.zn-edit'); if (ed) ed.onclick = () => { mapObj.closePopup(); startDraw(z.zone_type, z); };
  const rn = q('.zn-rename'); if (rn) rn.onclick = async () => {
    const name = prompt('Rename zone:', z.name); if (name == null) return;
    const r = await api(`/api/zones/${z.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (r.ok) { toast('Renamed'); loadZones(); } else toast('Rename failed');
  };
  const at = q('.zn-attach'); if (at) at.onclick = async () => {
    const gsel = document.getElementById('mapGroup'); const gid = gsel ? gsel.value : '';
    if (!gid) { toast('Pick a group in the filter above first, then Attach'); return; }
    const r = await api(`/api/zones/${z.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_id: gid }) });
    if (r.ok) { toast('Attached to group'); loadZones(); } else toast('Attach failed');
  };
  const dl = q('.zn-del'); if (dl) dl.onclick = async () => {
    if (!confirm('Delete this zone?')) return;
    const r = await api(`/api/zones/${z.id}/delete`, { method: 'POST' });
    if (r.ok) { toast('Zone deleted'); loadZones(); } else toast('Delete failed');
  };
}

// ---- Send: deliver individual captures or completed documents ----
async function renderSend() {
  const body = document.getElementById('body');
  body.className = 'workflow-send';
  body.innerHTML = `
    <div class="workflow-intro"><strong>Send your finished work</strong><span>Share photos directly, download a document, email it, upload it, or print it.</span></div>
    <div class="formhead">Send Selected Captures</div>
    <div class="status" id="sendSelection">Loading captures...</div>
    <div class="delivery-actions">
      <button class="btn" id="sharephotos">Share Photos</button>
      <button class="btn secondary" id="sendpdf">Send as PDF</button>
      <button class="btn secondary" id="sendword">Send as Word</button>
    </div>
    <div id="sendCaptures" class="send-capture-list"></div>
    <div class="formhead" style="margin-top:30px">Send a Document</div>
    <div id="sendDocs"><p class="status">Loading documents...</p></div>`;
  document.getElementById('sharephotos').onclick = shareSelectedPhotos;
  document.getElementById('sendpdf').onclick = () => deliverExport('pdf', null, true);
  document.getElementById('sendword').onclick = () => deliverExport('docx', null, true);
  loadSendCenter();
}

async function loadSendCenter() {
  const [cr, gr] = await Promise.all([api('/api/captures'), api('/api/groups')]);
  const captures = cr.ok ? await cr.json() : [];
  const groups = gr.ok ? await gr.json() : [];
  window._sendCaptures = captures;
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

async function deliverExport(action, groupId, selectedOnly) {
  const format = action === 'share' || action === 'print' ? 'pdf' : action;
  const ext = format === 'bundle' ? 'zip' : format;
  const name = `photo-notes.${ext}`;
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
        await navigator.share({ title: 'Photo Notes', text: 'Photo documentation', files: [file] }); return;
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
    const text = rows.map(c => [c.note, c.address, (c.area_tags || []).join(', ')].filter(Boolean).join('\n')).join('\n\n');
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
    document.getElementById('gtitle').value = '';
    document.getElementById('gdesc').value = '';
    state.selectedIds.clear();
    toast('Document created');
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
  if (!groups.length) { list.innerHTML = '<p class="empty">No documents yet. Select captures in Organize, then create your first document above.</p>'; return; }
  list.innerHTML = groups.map(g => `
    <div class="card">
      <div style="font-weight:bold;font-size:17px">${esc(g.title || 'Untitled group')}</div>
      ${g.description ? `<div style="margin:4px 0">${esc(g.description)}</div>` : ''}
      <div class="meta">${g.item_count} photo${g.item_count === 1 ? '' : 's'}${(isProClient() && g.score != null) ? ` <span class="scorechip" style="background:${scoreColor(g.score)}">Score ${g.score} · ${esc(g.band)}</span>` : ''}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn slim gopen" data-id="${g.id}">Open Document</button>
        <button class="btn secondary slim" data-id="${g.id}" data-del="1" style="color:#c1121f">Delete</button>
      </div>
    </div>`).join('');
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
  if (!confirm('Delete this document? The photos themselves are kept.')) return;
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
    <label>Title</label>
    <div id="titleview"></div>
    <label>Description</label>
    <div id="descview"></div>

    ${scoreHtml}

    <label style="margin-top:16px">Preview and Build <span style="font-weight:normal;text-transform:none;letter-spacing:0">(pick one or more formats)</span></label>
    <div class="pill-group" id="gfmts">
      <div class="pill" data-fmt="pdf">PDF</div>
      <div class="pill" data-fmt="docx">Word</div>
      <div class="pill" data-fmt="bundle">For AI (.zip)</div>
    </div>
    ${qualityBlock('gimgres', 'gimgfmt')}
    <div class="row">
      <button class="btn" id="gexport">Build Document</button>
      <button class="btn secondary" id="greverse">Reverse Order</button>
    </div>
    <button class="btn secondary slim" id="continueSend">Continue to Send</button>
    ${isProClient() ? `<label style="margin-top:16px">Proposal Report</label>
    <div class="row">
      <button class="btn secondary slim" id="proppdf">Proposal PDF</button>
      <button class="btn secondary slim" id="propdocx">Proposal Word</button>
    </div>` : ''}

    ${isProClient() ? `<label style="margin-top:16px">Extra Work Records</label>
    <div class="status">Document added scope, unexpected conditions, or customer-requested work.</div>
    <button class="btn slim" id="ewrNew" style="margin-top:6px">+ Extra Work Record</button>
    <div id="ewrList" style="margin-top:8px"></div>` : ''}

    <div id="gitems" style="margin-top:16px"></div>`;
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
  renderGroupItems();
  if (isProClient()) loadEwrList();
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
      <div class="meta">${esc(ewrReasonLabelC(e.reason_category))} · ${e.photo_count} photo${e.photo_count === 1 ? '' : 's'} · ${new Date(e.created_at).toLocaleDateString()}</div>
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
  const ios = isIOS(); ewrRecognizer = new SR(); ewrRecognizer.lang = 'en-US';
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
    <div class="meta">Created ${new Date(e.created_at).toLocaleString()} by ${esc(e.created_by || '')}</div>

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
    if (!confirm('Delete this Extra Work Record and its photos? This cannot be undone.')) return;
    const r = await api(`/api/ewr/${e.id}/delete`, { method: 'POST' });
    if (r.ok) { toast('Record deleted'); state.ewrId = null; renderGroups(); } else toast('Delete failed');
  };
  // photo grid
  const pbox = document.getElementById('ewrPhotos');
  if (!photos.length) pbox.innerHTML = '<p class="status">No photos yet. Add at least one.</p>';
  else pbox.innerHTML = photos.map(p => `
    <div class="card" style="padding:8px">
      <img src="${photoSrc(p.photo_path)}" alt="photo" />
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
    if (!confirm('Remove this photo?')) return;
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
      ${c.photo_path ? `<img src="${photoSrc(c.photo_path)}" alt="capture" />` : ''}
      <div class="rotaterow">${rotateButtons(c.id)}</div>
      <div class="addr">${esc(c.address || 'No location')}</div>
      ${isProClient() && fmtDimsClient(c) ? `<div class="meta"><strong>Dimensions:</strong> ${esc(fmtDimsClient(c))}</div>` : ''}
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
  btn.disabled = false; btn.textContent = 'Build Document';
  toast('Exported');
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
