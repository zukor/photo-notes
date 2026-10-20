/* Property Manager Pro indoor locations: floor plans per property, and building, floor, suite, room and a floor plan
   pin on each photo. Uses the app's globals (api, esc, toast, state). */
const floorPlanCache = {};
function indoorTextClient(c = {}) {
  const parts = [];
  if (c.indoor_building) parts.push(/building/i.test(c.indoor_building) ? c.indoor_building : 'Building ' + c.indoor_building);
  if (c.indoor_floor) parts.push(/floor|level|basement|roof/i.test(c.indoor_floor) ? c.indoor_floor : 'Floor ' + c.indoor_floor);
  if (c.indoor_suite) parts.push(/suite|unit|space/i.test(c.indoor_suite) ? c.indoor_suite : 'Suite ' + c.indoor_suite);
  if (c.indoor_room) parts.push(c.indoor_room);
  return parts.join(', ');
}
async function floorPlansFor(community, fresh = false) {
  if (!community) return [];
  if (!fresh && floorPlanCache[community]) return floorPlanCache[community];
  try { const r = await api('/api/property/floor-plans?community_id=' + encodeURIComponent(community)); floorPlanCache[community] = r.ok ? await r.json() : []; } catch (e) { floorPlanCache[community] = []; }
  return floorPlanCache[community];
}
// Indoor location fields shown in a dialog or on Capture. v holds indoor_* values and the floor plan pin.
function indoorFieldsHtml(prefix, v, plans) {
  const f = (k, label, ph) => `<div><label for="${prefix}${k}">${label}</label><input type="text" data-indoor-field="${k}" id="${prefix}${k}" maxlength="120" placeholder="${ph}" value="${esc(v['indoor_' + k.toLowerCase()] || '')}"></div>`;
  return `<div class="fp-grid">${f('Building', 'Building', 'For example, B or Tower 1')}${f('Floor', 'Floor', 'For example, 2 or Basement')}${f('Suite', 'Suite or Unit', 'For example, 210')}${f('Room', 'Room or Spot', 'For example, Mechanical room')}</div>`
    + `<label for="${prefix}Plan">Floor Plan</label><select data-indoor-plan id="${prefix}Plan"><option value="">${plans.length ? 'No floor plan pin' : 'No floor plans for this property yet'}</option>${plans.map(p => `<option value="${p.id}" ${Number(v.floor_plan_id) === p.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`
    + `<div class="row compact"><button type="button" class="btn secondary slim" data-indoor-pin id="${prefix}Pin" ${v.floor_plan_id ? '' : 'disabled'}>${v.floor_plan_x != null ? 'Move Pin on Floor Plan' : 'Pin on Floor Plan'}</button></div><p class="status" id="${prefix}PinStatus">${v.floor_plan_x != null ? 'Pin placed.' : ''}</p>`;
}
function wireIndoorFields(prefix, v, plans) {
  const $ = id => document.getElementById(prefix + id);
  const read = () => { for (const k of ['Building', 'Floor', 'Suite', 'Room']) v['indoor_' + k.toLowerCase()] = $(k).value.trim(); };
  for (const k of ['Building', 'Floor', 'Suite', 'Room']) $(k).oninput = read;
  $('Plan').onchange = () => { const id = Number($('Plan').value) || null; if (id !== Number(v.floor_plan_id || 0)) { v.floor_plan_x = null; v.floor_plan_y = null; } v.floor_plan_id = id; const p = plans.find(x => x.id === id); if (p) { if (p.building && !$('Building').value) $('Building').value = p.building; if (!$('Floor').value) $('Floor').value = p.floor; read(); } $('Pin').disabled = !id; $('Pin').textContent = 'Pin on Floor Plan'; $('PinStatus').textContent = ''; };
  $('Pin').onclick = () => { const p = plans.find(x => x.id === Number(v.floor_plan_id)); if (!p) return; floorPlanPinDialog({ plan: p, x: v.floor_plan_x, y: v.floor_plan_y, onSave: (x, y) => { v.floor_plan_x = x; v.floor_plan_y = y; $('PinStatus').textContent = x == null ? 'Pin removed.' : 'Pin placed.'; $('Pin').textContent = x == null ? 'Pin on Floor Plan' : 'Move Pin on Floor Plan'; } }); };
  read();
}
const indoorPayload = v => ({ indoor_building: v.indoor_building || '', indoor_floor: v.indoor_floor || '', indoor_suite: v.indoor_suite || '', indoor_room: v.indoor_room || '', floor_plan_id: v.floor_plan_id || '', floor_plan_x: v.floor_plan_x == null ? '' : String(v.floor_plan_x), floor_plan_y: v.floor_plan_y == null ? '' : String(v.floor_plan_y) });

// ---- Capture: Indoor Location for the photo being taken ----
async function floorPlanCaptureControl(anchor, community) {
  if (state.proType !== 'property' || !anchor) return;
  document.getElementById('fpCaptureWrap')?.remove();
  const v = state._indoor = state._indoor || {};
  if (v.community && String(v.community) !== String(community)) { v.floor_plan_id = null; v.floor_plan_x = null; v.floor_plan_y = null; }
  v.community = community;
  const plans = await floorPlansFor(community);
  if (!anchor.isConnected || String(state.communityId || '') !== String(community || '')) return;
  document.getElementById('fpCaptureWrap')?.remove();
  const wrap = document.createElement('details'); wrap.id = 'fpCaptureWrap'; wrap.className = 'pair-builder fp-capture';
  if (indoorTextClient(v) || v.floor_plan_x != null) wrap.open = true;
  wrap.innerHTML = `<summary><span>Indoor Location${indoorTextClient(v) ? ': ' + esc(indoorTextClient(v)) : ''}</span></summary><p class="status">Inside a building, GPS is not reliable. Add where the photo was taken so someone else can find it.</p>${indoorFieldsHtml('fpCap', v, plans)}`;
  (document.getElementById('paCaptureAreaWrap') || anchor).insertAdjacentElement('afterend', wrap);
  wireIndoorFields('fpCap', v, plans);
}
// Read for the save; the pin belongs to one photo, while building, floor, suite and room carry over to the next photo.
function takeCaptureIndoor() {
  const v = state._indoor; if (state.proType !== 'property' || !v || !document.getElementById('fpCaptureWrap')) return {};
  const out = indoorPayload(v); v.floor_plan_x = null; v.floor_plan_y = null; return out;
}

// ---- Pin dialog: tap the floor plan to place the pin. readOnly shows a saved pin. ----
function floorPlanPinDialog({ plan, x = null, y = null, readOnly = false, title, caption, onSave }) {
  document.getElementById('fpDialog')?.remove();
  const opener = document.activeElement;
  let px = x == null ? null : Number(x), py = y == null ? null : Number(y), zoom = 1;
  const d = document.createElement('div'); d.id = 'fpDialog'; d.className = 'fp-dialog'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-labelledby', 'fpDialogTitle');
  d.innerHTML = `<div class="fp-panel"><h2 id="fpDialogTitle">${esc(title || (readOnly ? 'Floor Plan' : 'Pin on Floor Plan'))}</h2><p>${esc(plan.label || '')}${caption ? ' · ' + esc(caption) : ''}</p>${readOnly ? '' : '<p class="status">Tap the floor plan where the photo was taken. Zoom in for a more exact spot.</p>'}
    <div class="row compact"><button type="button" class="btn secondary slim" id="fpZoomOut" aria-label="Zoom out">Zoom Out</button><button type="button" class="btn secondary slim" id="fpZoomIn" aria-label="Zoom in">Zoom In</button></div>
    <div class="fp-stage" id="fpStage"><div class="fp-inner" id="fpInner"><img id="fpImg" src="${esc(plan.photo_path || plan.plan_url)}" alt="Floor plan ${esc(plan.label || '')}"><span class="fp-pin" id="fpPin" hidden aria-hidden="true"></span></div></div>
    <div class="row compact">${readOnly ? '' : '<button type="button" class="btn" id="fpSave">Save Pin</button><button type="button" class="btn secondary" id="fpClear">Remove Pin</button>'}<button type="button" class="btn secondary" id="fpClose">${readOnly ? 'Close' : 'Cancel'}</button></div></div>`;
  document.body.appendChild(d);
  const $ = id => d.querySelector('#' + id), pin = $('fpPin');
  const draw = () => { pin.hidden = px == null; if (px != null) { pin.style.left = (px * 100) + '%'; pin.style.top = (py * 100) + '%'; } $('fpInner').style.width = (zoom * 100) + '%'; };
  const close = () => { d.remove(); opener?.focus?.(); };
  if (!readOnly) $('fpImg').onclick = e => { const r = $('fpImg').getBoundingClientRect(); px = Math.min(1, Math.max(0, Math.round((e.clientX - r.left) / r.width * 100000) / 100000)); py = Math.min(1, Math.max(0, Math.round((e.clientY - r.top) / r.height * 100000) / 100000)); draw(); };
  $('fpZoomIn').onclick = () => { zoom = Math.min(4, zoom + 1); draw(); if (px != null) setTimeout(() => { const s = $('fpStage'); s.scrollLeft = px * s.scrollWidth - s.clientWidth / 2; s.scrollTop = py * s.scrollHeight - s.clientHeight / 2; }, 0); };
  $('fpZoomOut').onclick = () => { zoom = Math.max(1, zoom - 1); draw(); };
  $('fpClose').onclick = close;
  if (!readOnly) { $('fpSave').onclick = () => { if (px == null) { toast('Tap the floor plan to place the pin'); return; } onSave?.(px, py); close(); }; $('fpClear').onclick = () => { onSave?.(null, null); close(); }; }
  d.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  draw(); $('fpClose').focus();
}

// ---- Existing photos: view and edit the indoor location ----
async function openIndoorView(captureId) {
  const r = await api(`/api/captures/${captureId}/indoor`); if (!r.ok) { toast('Indoor location could not load'); return; }
  const d = await r.json(); if (!d.plan) { toast(d.text || 'No floor plan pin on this photo'); return; }
  floorPlanPinDialog({ plan: d.plan, x: d.floor_plan_x, y: d.floor_plan_y, readOnly: true, title: 'Where the Photo Was Taken', caption: d.text });
}
async function openIndoorEditor(captureId, onSaved) {
  const r = await api(`/api/captures/${captureId}/indoor`); if (!r.ok) { toast('Indoor location could not load'); return; }
  const d = await r.json(), v = { ...d }, community = d.property_community_id || (d.plan && d.plan.community_id) || state.communityId;
  const plans = await floorPlansFor(community, true);
  document.getElementById('fpEditDialog')?.remove();
  const box = document.createElement('div'); box.id = 'fpEditDialog'; box.className = 'fp-dialog'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'fpEditTitle');
  box.innerHTML = `<div class="fp-panel"><h2 id="fpEditTitle">Indoor Location</h2>${indoorFieldsHtml('fpEdit', v, plans)}<div class="row compact"><button type="button" class="btn" id="fpEditSave">Save Indoor Location</button><button type="button" class="btn secondary" id="fpEditCancel">Cancel</button></div></div>`;
  document.body.appendChild(box); wireIndoorFields('fpEdit', v, plans);
  const close = () => box.remove();
  box.querySelector('#fpEditCancel').onclick = close; box.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('fpDialog')) close(); });
  box.querySelector('#fpEditSave').onclick = async () => { const q = await api(`/api/captures/${captureId}/indoor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(indoorPayload(v)) }), res = await q.json().catch(() => ({})); if (!q.ok) { toast(res.error || 'Indoor location could not be saved'); return; } close(); toast('Indoor location saved'); document.querySelectorAll(`[data-indoor-text="${captureId}"]`).forEach(el => { el.textContent = res.text || 'Not entered'; }); onSaved?.(res); };
  box.querySelector('#fpEditBuilding').focus();
}
// Indoor location line and buttons under a photo's GPS and address (Property Manager Pro).
function indoorLocationHtml(c) {
  if (state.proType !== 'property' || !c || !c.id) return '';
  return `<div class="photo-location-label">Indoor Location</div><div data-indoor-text="${c.id}">${esc(indoorTextClient(c) || 'Not entered')}</div><button type="button" class="btn secondary slim" data-indoor-edit="${c.id}">Indoor Location</button>${c.floor_plan_id ? `<button type="button" class="btn secondary slim" data-indoor-view="${c.id}">View on Floor Plan</button>` : ''}`;
}
document.addEventListener('click', e => {
  const v = e.target.closest('[data-indoor-view]'); if (v) { openIndoorView(Number(v.dataset.indoorView)); return; }
  const ed = e.target.closest('[data-indoor-edit]'); if (ed) openIndoorEditor(Number(ed.dataset.indoorEdit), res => { if (res.floor_plan_id && !ed.parentElement.querySelector(`[data-indoor-view="${ed.dataset.indoorEdit}"]`)) ed.insertAdjacentHTML('afterend', `<button type="button" class="btn secondary slim" data-indoor-view="${ed.dataset.indoorEdit}">View on Floor Plan</button>`); });
});

// ---- Properties and Team: floor plans for one property ----
async function floorPlanManager(community, box) {
  if (!box) return;
  if (!box.hidden && box.dataset.loaded === '1') { box.hidden = true; return; }
  const plans = await floorPlansFor(community, true);
  box.dataset.loaded = '1'; box.hidden = false;
  box.innerHTML = `<p class="status">Add one floor plan per floor. The quickest way is a photo of the fire escape map posted on each floor. A screenshot, an image or a PDF from the building engineer or leasing office also works. It does not need to be to scale.</p>
    <div class="fp-list">${plans.length ? plans.map(p => `<article class="card fp-plan"><img src="${esc(p.photo_path)}" alt="Floor plan ${esc(p.label)}" loading="lazy"><strong>${esc(p.label)}</strong><div class="row compact"><button type="button" class="btn secondary slim" data-fp-open="${p.id}">View</button><button type="button" class="btn secondary slim" data-fp-archive="${p.id}">Remove</button></div></article>`).join('') : '<p class="empty">No floor plans for this property yet.</p>'}</div>
    <div class="formhead">Add a Floor Plan</div>
    <div class="fp-grid"><div><label for="fpNewBuilding${community}">Building (optional)</label><input type="text" id="fpNewBuilding${community}" maxlength="60" placeholder="For example, B"></div><div><label for="fpNewFloor${community}">Floor</label><input type="text" id="fpNewFloor${community}" maxlength="60" placeholder="For example, 1, 2 or Basement"></div></div>
    <label for="fpNewCamera${community}">Take a Photo of the Posted Map</label><input type="file" id="fpNewCamera${community}" accept="image/*" capture="environment">
    <label for="fpNewFile${community}">Or Choose an Image or PDF</label><input type="file" id="fpNewFile${community}" accept="image/*,application/pdf,.pdf">
    <div id="fpNewPageWrap${community}" hidden><label for="fpNewPage${community}">PDF Page Number</label><input type="number" id="fpNewPage${community}" min="1" value="1" inputmode="numeric"></div>
    <button type="button" class="btn" id="fpNewSave${community}">Save Floor Plan</button>`;
  const $ = id => document.getElementById(id + community);
  $('fpNewFile').onchange = () => { const f = $('fpNewFile').files[0]; $('fpNewPageWrap').hidden = !(f && /pdf/i.test(f.type + f.name)); if (f) $('fpNewCamera').value = ''; };
  $('fpNewCamera').onchange = () => { if ($('fpNewCamera').files[0]) { $('fpNewFile').value = ''; $('fpNewPageWrap').hidden = true; } };
  $('fpNewSave').onclick = async () => {
    const cam = $('fpNewCamera').files[0], file = cam || $('fpNewFile').files[0], floor = $('fpNewFloor').value.trim();
    if (!floor) { toast('Enter the floor'); $('fpNewFloor').focus(); return; }
    if (!file) { toast('Take a photo of the posted map, or choose an image or PDF'); return; }
    const fd = new FormData(); fd.append('community_id', community); fd.append('building', $('fpNewBuilding').value.trim()); fd.append('floor', floor); fd.append('pdf_page', $('fpNewPage').value || '1'); fd.append('source', cam ? 'photo' : 'upload'); fd.append('file', file, file.name || 'floor-plan.jpg');
    const b = $('fpNewSave'); b.disabled = true; b.textContent = 'Saving...';
    const r = await api('/api/property/floor-plans', { method: 'POST', body: fd }), d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || 'Floor plan could not be saved'); b.disabled = false; b.textContent = 'Save Floor Plan'; return; }
    toast('Floor plan saved'); box.dataset.loaded = '0'; box.hidden = true; floorPlanManager(community, box);
  };
  box.querySelectorAll('[data-fp-open]').forEach(b => b.onclick = () => { const p = plans.find(x => x.id === Number(b.dataset.fpOpen)); if (p) floorPlanPinDialog({ plan: p, readOnly: true, title: 'Floor Plan' }); });
  box.querySelectorAll('[data-fp-archive]').forEach(b => b.onclick = async () => {
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap Again to Remove'; return; }
    const r = await api('/api/property/floor-plans/' + b.dataset.fpArchive, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) });
    if (!r.ok) { toast('Floor plan could not be removed'); return; }
    toast('Floor plan removed. Photos already pinned on it keep their pin.'); box.dataset.loaded = '0'; box.hidden = true; floorPlanManager(community, box);
  });
}
(function floorPlanStyles() {
  if (document.getElementById('floorPlanStyle')) return;
  const st = document.createElement('style'); st.id = 'floorPlanStyle';
  st.textContent = '.fp-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.fp-grid input{width:100%;box-sizing:border-box}.fp-dialog{position:fixed;inset:0;z-index:2147483000;background:#fff;color:#000;overflow:auto;padding:12px 14px 40px;font:16px Arial,Helvetica,sans-serif;text-align:left}.fp-dialog *{color:#000}.fp-panel{max-width:960px;margin:auto}.fp-dialog h2{font-size:20px;margin:0 0 8px}.fp-dialog input,.fp-dialog select{width:100%;padding:10px;font-size:16px;border:1px solid #000;border-radius:8px;box-sizing:border-box;min-height:44px;background:#fff}.fp-stage{border:2px solid #000;border-radius:8px;overflow:auto;max-height:70vh;margin:8px 0;background:#fff}.fp-inner{position:relative;width:100%;line-height:0}.fp-inner img{width:100%;height:auto;display:block;cursor:crosshair;user-select:none;-webkit-user-select:none}.fp-pin{position:absolute;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;background:#ffd400;border:4px solid #000;box-sizing:border-box;box-shadow:0 0 0 3px #fff;pointer-events:none}.fp-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.fp-plan img{width:100%;height:110px;object-fit:contain;background:#fff;border:1px solid #000;border-radius:6px}';
  document.head.appendChild(st);
})();
