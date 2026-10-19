// Measure Repair Area: trace damaged concrete on a job photo to get a repair quantity.
// Set the scale with two taps on something of known length, then outline the area to replace or resurface,
// or tap along a crack. The repair is saved as a measured area on the photo's job, ready for an estimate.
(function (root) {
  'use strict';
  const R = () => root.PhotoNotesConcreteEstimate;
  const KINDS = [
    { id: 'replace', label: 'Remove and replace', hint: 'Tap the corners of the area to saw-cut, remove and pour new.' },
    { id: 'resurface', label: 'Resurface', hint: 'Tap the corners of the area to resurface.' },
    { id: 'crack', label: 'Crack repair', hint: 'Tap along the crack from one end to the other.' }
  ];
  const REFS = [
    { label: 'Bank card, long side (3 3/8 in)', ft: 3.375 / 12 },
    { label: 'Brick, long side (8 in)', ft: 8 / 12 },
    { label: 'Tape laid on the slab: 2 ft', ft: 2 },
    { label: 'Joint spacing: 5 ft', ft: 5 }
  ];
  function style() {
    if (document.getElementById('repairOutlineStyle')) return;
    const st = document.createElement('style'); st.id = 'repairOutlineStyle';
    st.textContent = '#repairOutline{position:fixed;inset:0;z-index:2147483000;background:#fff;color:#000;overflow:auto;padding:12px 14px 40px;font:16px Arial,Helvetica,sans-serif;text-align:left}#repairOutline *{color:#000}#repairOutline h2{margin:0 0 8px;font-size:20px}#repairOutline input,#repairOutline select{width:100%;padding:10px;font-size:16px;border:1px solid #000;border-radius:8px;background:#fff;box-sizing:border-box;min-height:44px}#repairOutline .ro-grid{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}#repairOutline .ro-grid>*{flex:1 1 160px}#repairOutline .row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}#repairOutline .btn{min-height:44px}#repairOutline .ro-stage{position:relative;border:2px solid #000;border-radius:8px;overflow:hidden;touch-action:manipulation;cursor:crosshair;line-height:0}#repairOutline .ro-stage img{width:100%;height:auto;display:block;user-select:none;-webkit-user-select:none}#repairOutline .ro-svg{position:absolute;left:0;top:0;pointer-events:none}#repairOutline .ro-hint,#repairOutline .ro-result{border:2px solid #000;border-radius:8px;padding:8px;margin:8px 0;min-height:1.2em}#repairOutline .ro-result:empty{display:none}#repairOutline [hidden]{display:none}';
    document.head.appendChild(st);
  }
  function open(opts = {}) {
    const { capture, api, toast, esc, onSaved, defaultThickness } = opts;
    if (!capture || !capture.photo_path) return;
    close(); style();
    const st = { mode: 'scale', kind: 'replace', ref: [], points: [] };
    const box = document.createElement('div');
    box.id = 'repairOutline'; box.className = 'ro-overlay';
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'roTitle');
    box.innerHTML = `<div class="ro-panel">
      <h2 id="roTitle">Measure Repair Area</h2>
      <p>For the best accuracy, use a photo taken from straight above, with the known length lying on the same surface as the damage.</p>
      <div class="ro-grid">
        <div><label for="roKind">Repair Type</label><select id="roKind">${KINDS.map(k => `<option value="${k.id}">${k.label}</option>`).join('')}</select></div>
        <div><label for="roName">Name</label><input type="text" id="roName" placeholder="For example, cracked driveway panel"></div>
        <div id="roThickWrap"><label for="roThick">Thickness (in)</label><input type="number" inputmode="decimal" id="roThick" value="${defaultThickness || 4}"></div>
      </div>
      <div class="row ro-modes"><button type="button" class="btn" id="roScaleMode" aria-pressed="true">1. Set Scale</button><button type="button" class="btn secondary" id="roTraceMode" aria-pressed="false">2. Trace Repair</button><button type="button" class="btn secondary slim" id="roUndo">Undo</button><button type="button" class="btn secondary slim" id="roClear">Start Over</button></div>
      <div id="roScaleBox" class="ro-grid"><div><label for="roRefFt">Known Length</label><input type="text" id="roRefFt" placeholder="For example, 2 ft or 8 in"></div>
        <div><label for="roRefPick">Or Choose a Common Object</label><select id="roRefPick"><option value="">Choose...</option>${REFS.map((r, i) => `<option value="${i}">${r.label}</option>`).join('')}</select></div></div>
      <p id="roHint" class="ro-hint" aria-live="polite"></p>
      <div class="ro-stage" id="roStage"><img id="roImg" alt="Job photo to trace" src="${esc(capture.photo_path)}"><svg id="roSvg" class="ro-svg" aria-hidden="true"></svg></div>
      <div id="roResult" class="ro-result" aria-live="polite"></div>
      <div class="row"><button type="button" class="btn" id="roSave">Save Repair</button><button type="button" class="btn secondary" id="roCancel">Cancel</button></div>
    </div>`;
    document.body.appendChild(box);
    const $ = id => box.querySelector('#' + id), img = $('roImg'), svg = $('roSvg');
    const refFt = () => { const v = $('roRefFt').value.trim(); if (!v) return null; const f = R().parseFeet(/^\d+(\.\d+)?$/.test(v) ? v + ' ft' : v); return f > 0 ? f : null; };
    const payload = () => ({ kind: st.kind, points: st.points, ref: st.ref, ref_ft: refFt(), image: { w: img.naturalWidth, h: img.naturalHeight } });
    const draw = () => {
      const w = img.clientWidth, h = img.clientHeight; svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const P = p => `${(p.x * w).toFixed(1)},${(p.y * h).toFixed(1)}`;
      let s = '';
      if (st.ref.length) s += `<polyline points="${st.ref.map(P).join(' ')}" fill="none" stroke="#000" stroke-width="6"/><polyline points="${st.ref.map(P).join(' ')}" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="9 6"/>` + st.ref.map(p => `<circle cx="${p.x * w}" cy="${p.y * h}" r="7" fill="#fff" stroke="#000" stroke-width="2"/>`).join('');
      if (st.points.length) {
        const pts = st.points.map(P).join(' '), closed = st.kind !== 'crack' && st.points.length >= 3;
        s += closed ? `<polygon points="${pts}" fill="rgba(255,212,0,0.2)" stroke="#000" stroke-width="6"/><polygon points="${pts}" fill="none" stroke="#ffd400" stroke-width="3"/>` : `<polyline points="${pts}" fill="none" stroke="#000" stroke-width="6"/><polyline points="${pts}" fill="none" stroke="#ffd400" stroke-width="3"/>`;
        s += st.points.map(p => `<circle cx="${p.x * w}" cy="${p.y * h}" r="6" fill="#ffd400" stroke="#000" stroke-width="2"/>`).join('');
      }
      svg.innerHTML = s;
      const k = KINDS.find(x => x.id === st.kind);
      $('roHint').textContent = st.mode === 'scale' ? (st.ref.length < 2 ? `Tap both ends of something with a known length (${2 - st.ref.length} more), then enter that length.` : (refFt() ? 'Scale set. Tap 2. Trace Repair.' : 'Enter the known length.')) : k.hint;
      $('roThickWrap').hidden = st.kind !== 'replace';
      const m = R().photoMeasure(payload());
      $('roResult').innerHTML = m.ok ? (m.kind === 'crack' ? `<strong>${R().formatFeet(m.length_ft)}</strong> of crack (${m.length_ft} ft).` : `<strong>${m.area_sqft} sq ft</strong>, edge ${m.perimeter_ft} ft.`) : (st.points.length ? esc(m.error || '') : '');
      $('roScaleMode').className = 'btn' + (st.mode === 'scale' ? '' : ' secondary'); $('roScaleMode').setAttribute('aria-pressed', String(st.mode === 'scale'));
      $('roTraceMode').className = 'btn' + (st.mode === 'trace' ? '' : ' secondary'); $('roTraceMode').setAttribute('aria-pressed', String(st.mode === 'trace'));
    };
    const tap = e => {
      const r = img.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      const p = { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
      if (st.mode === 'scale') { if (st.ref.length >= 2) st.ref = []; st.ref.push(p); if (st.ref.length === 2 && refFt()) st.mode = 'trace'; }
      else if (st.points.length < 60) st.points.push(p);
      draw();
    };
    $('roStage').addEventListener('click', tap);
    img.onload = draw; if (img.complete) draw();
    root.addEventListener('resize', draw);
    $('roKind').onchange = () => { st.kind = $('roKind').value; draw(); };
    $('roRefFt').oninput = draw;
    $('roRefPick').onchange = () => { const r = REFS[Number($('roRefPick').value)]; if (r) { $('roRefFt').value = R().formatFeet(r.ft); draw(); } };
    $('roScaleMode').onclick = () => { st.mode = 'scale'; draw(); };
    $('roTraceMode').onclick = () => { st.mode = 'trace'; draw(); };
    $('roUndo').onclick = () => { if (st.mode === 'trace' && st.points.length) st.points.pop(); else if (st.ref.length) st.ref.pop(); draw(); };
    $('roClear').onclick = () => { st.ref = []; st.points = []; st.mode = 'scale'; draw(); };
    $('roCancel').onclick = finish;
    box.addEventListener('keydown', e => { if (e.key === 'Escape') finish(); });
    $('roSave').onclick = async () => {
      const m = R().photoMeasure(payload());
      if (!m.ok) { toast(m.error || 'Trace the repair first.'); return; }
      $('roSave').disabled = true;
      try {
        const res = await api('/api/concrete/repairs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capture_id: capture.id, kind: st.kind, name: $('roName').value.trim(), thickness_in: st.kind === 'replace' ? $('roThick').value : null, points: st.points, ref: st.ref, ref_ft: refFt(), ref_label: $('roRefPick').selectedOptions[0] && $('roRefPick').value ? $('roRefPick').selectedOptions[0].textContent : null }) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw Error(d.error || 'The repair could not be saved.');
        finish(); toast('Repair saved to the job\'s measured areas'); if (onSaved) onSaved(d.area);
      } catch (e) { toast(e.message); $('roSave').disabled = false; }
    };
    $('roKind').focus();
    function finish() { close(); root.removeEventListener('resize', draw); }
  }
  function close() { const b = document.getElementById('repairOutline'); if (b) b.remove(); }
  root.PhotoNotesRepairOutline = { open, close, KINDS, REFS };
})(typeof self !== 'undefined' ? self : this);
