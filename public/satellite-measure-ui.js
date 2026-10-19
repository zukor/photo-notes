// Measure from Satellite: find the address, trace areas, streets and lines with a finger on live satellite imagery,
// square the corners, check one side with a tape, and save. Used by Concrete Pro estimates and Paving Pro takeoff.
(function () {
  'use strict';
  const G = () => window.PhotoNotesGeoMeasure;
  const fmtFt = ft => { if (ft == null || !Number.isFinite(ft)) return ''; let w = Math.floor(ft), i = Math.round((ft - w) * 12); if (i === 12) { w++; i = 0; } return i ? `${w} ft ${i} in` : `${w} ft`; };
  const fmtNum = v => Math.round(v).toLocaleString('en-US');
  function parseFeet(v) {
    const s = String(v || '').trim().toLowerCase(); let m;
    if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*(?:(\d+(?:\.\d+)?)\s*(?:in|"|inches)?)?$/))) return Number(m[1]) + (m[2] ? Number(m[2]) / 12 : 0);
    if ((m = s.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/))) return Number(m[1]) + Number(m[2]) / 12;
    return /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
  }
  const COLORS = ['#ffdf00', '#00e5ff', '#ff4fd8', '#7CFC00', '#ff8c00'];
  function ensureStyle() {
    if (document.getElementById('satMeasureStyle')) return;
    const st = document.createElement('style'); st.id = 'satMeasureStyle';
    st.textContent = '#satMeasure{position:fixed;inset:0;z-index:2147483000;background:#fff;color:#000;overflow:auto;padding:12px 14px 40px;font:16px Arial,Helvetica,sans-serif;text-align:left}#satMeasure *{color:#000}#satMeasure h2{margin:0 0 8px;font-size:20px}#satMeasure input[type=text],#satMeasure input[type=number],#satMeasure select{width:100%;padding:10px;font-size:16px;border:1px solid #000;border-radius:8px;background:#fff;box-sizing:border-box;min-height:44px}#satMeasure .sm-row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}#satMeasure .sm-row>*{flex:1 1 130px}#satMeasure .btn{min-height:44px}#satMeasure #smMap{height:58vh;min-height:320px;border:2px solid #000;border-radius:8px;margin:8px 0}#satMeasure .sm-shape{border:2px solid #000;border-radius:8px;padding:8px;margin:8px 0}#satMeasure .sm-shape.active{background:#fff8c4}#satMeasure .sm-hint{border:2px solid #000;border-radius:8px;padding:8px;background:#fff}.sm-vertex{width:18px;height:18px;border-radius:50%;background:#fff;border:3px solid #000;box-sizing:border-box;margin:-9px 0 0 -9px}.sm-label{display:inline-block;width:max-content;background:#fff;border:1px solid #000;border-radius:4px;padding:1px 4px;font:bold 12px Arial;color:#000;white-space:nowrap;transform:translate(-50%,-50%)}';
    document.head.append(st);
  }

  async function open(opts) {
    const ctx = opts.ctx, types = opts.types || ['area'];
    ensureStyle(); await ctx.loadLeaflet();
    if (!window.L || !G()) { ctx.toast('The satellite map could not load. Check your connection.'); return; }
    let cfg = { sources: [{ id: 'esri', label: 'Esri World Imagery' }] };
    try { const r = await ctx.api('/api/satellite/config'); if (r.ok) cfg = await r.json(); } catch {}
    document.getElementById('satMeasure')?.remove();
    const root = document.createElement('div'); root.id = 'satMeasure'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', opts.title || 'Measure from Satellite');
    root.innerHTML = `<div class="sm-row" style="align-items:center"><h2 style="flex:3 1 200px">${ctx.esc(opts.title || 'Measure from Satellite')}</h2><button type="button" class="btn secondary" id="smClose" style="flex:0 1 120px">Close</button></div>
      <div class="sm-row"><div style="flex:3 1 220px"><label for="smSearch">Address</label><input type="text" id="smSearch" value="${ctx.esc(opts.address || '')}"></div><button type="button" class="btn" id="smFind" style="align-self:flex-end">Find</button><button type="button" class="btn secondary" id="smLocate" style="align-self:flex-end">My Location</button></div>
      <div id="smResults"></div>
      <div class="sm-row"><div><label for="smSource">Imagery</label><select id="smSource">${cfg.sources.map(s => `<option value="${s.id}">${ctx.esc(s.label)}</option>`).join('')}</select></div></div>
      <p>Satellite pictures can be a year or more old, and trees and roofs can hide edges. Zoom in as far as the picture stays sharp.</p>
      <div id="smMap"></div>
      <div class="sm-row">${types.includes('area') ? '<button type="button" class="btn" id="smNewArea">New Area</button>' : ''}${types.includes('street') ? '<button type="button" class="btn" id="smNewStreet">New Street</button>' : ''}${types.includes('line') ? '<button type="button" class="btn" id="smNewLine">New Line</button>' : ''}${types.includes('area') ? '<button type="button" class="btn secondary" id="smCutout">Add Cut-out</button>' : ''}</div>
      <div class="sm-row"><button type="button" class="btn secondary" id="smUndo">Undo Point</button>${types.includes('area') ? '<button type="button" class="btn secondary" id="smSquare">Square Corners</button>' : ''}<button type="button" class="btn secondary" id="smFinish">Finish Shape</button></div>
      <div class="sm-hint" id="smHint" aria-live="polite">Find the address, then tap New ${types.includes('area') ? 'Area' : 'Street'} and tap each corner on the map.</div>
      <div id="smShapes"></div>
      <details id="smTapeBox"><summary><strong>Check with a Tape</strong></summary><p>On site, measure one side with a tape or laser and enter it. Every shape on this imagery is corrected to match, and the measurement is labeled as checked.</p>
        <div class="sm-row"><div><label for="smTapeShape">Shape</label><select id="smTapeShape"></select></div><div><label for="smTapeSide">Side</label><select id="smTapeSide"></select></div><div><label for="smTapeFt">Tape Length (for example 40 ft 6 in)</label><input type="text" id="smTapeFt"></div></div>
        <button type="button" class="btn secondary" id="smTapeApply">Apply Tape Check</button><div id="smTapeStatus" aria-live="polite"></div></details>
      <label style="display:flex;gap:8px;align-items:center;margin:12px 0"><input type="checkbox" id="smPicture" checked style="width:auto;min-height:0"> Save a satellite picture of the traced shapes to the job</label>
      <div class="sm-row"><button type="button" class="btn" id="smSave">Save Measurements</button><button type="button" class="btn secondary" id="smCancel">Cancel</button></div>`;
    document.body.append(root);
    const $ = id => root.querySelector('#' + id);
    const map = L.map($('smMap'), { maxZoom: 21, doubleClickZoom: false }).setView(opts.center ? [opts.center.lat, opts.center.lng] : [29.4241, -98.4936], opts.center ? 19 : 12);
    let imagery = null;
    const setImagery = id => { if (imagery) map.removeLayer(imagery); imagery = ctx.satelliteLayer(id === 'mapbox' ? { mapbox_token: cfg.mapbox_token } : {}, map, () => {}).addTo(map); };
    setImagery($('smSource').value); $('smSource').onchange = () => setImagery($('smSource').value);

    const shapes = [], layers = L.layerGroup().addTo(map);
    let active = -1, cutMode = false, scale = 1, checked = false;
    const hint = t => { $('smHint').textContent = t; };
    const cur = () => shapes[active];
    const measured = s => G().measure({ ...s, scale });
    const metersPerPixel = lat => 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** map.getZoom();
    function draw() {
      layers.clearLayers();
      shapes.forEach((s, si) => {
        const color = COLORS[si % COLORS.length], ll = s.points.map(p => [p.lat, p.lng]);
        if (s.type === 'area' && ll.length >= 3) L.polygon([ll, ...s.cutouts.filter(c => c.length >= 3).map(c => c.map(p => [p.lat, p.lng]))], { color, weight: 3, fillOpacity: 0.25, interactive: false }).addTo(layers);
        else if (ll.length >= 2) {
          const w = s.type === 'street' && s.width_ft ? Math.max(3, s.width_ft / 3.2808 / metersPerPixel(ll[0][0])) : 4;
          L.polyline(ll, { color, weight: w, opacity: s.type === 'street' ? 0.45 : 1, interactive: false }).addTo(layers);
          if (s.type === 'street') L.polyline(ll, { color: '#000', weight: 1, dashArray: '4 4', interactive: false }).addTo(layers);
        } else if (ll.length) L.polyline(ll, { color, weight: 3 }).addTo(layers);
        s.cutouts.forEach(c => { if (c.length >= 2) L.polyline(c.map(p => [p.lat, p.lng]).concat(c.length >= 3 ? [[c[0].lat, c[0].lng]] : []), { color: '#ff3030', weight: 3, dashArray: '6 4', interactive: false }).addTo(layers); });
        if (si === active) {
          const pts = cutMode && s.cutouts.length ? s.cutouts[s.cutouts.length - 1] : s.points;
          pts.forEach((p, pi) => {
            const mk = L.marker([p.lat, p.lng], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="sm-vertex"></div>', iconSize: [0, 0] }), keyboard: false }).addTo(layers);
            mk.on('drag', e => { const q = e.target.getLatLng(); pts[pi] = { lat: q.lat, lng: q.lng }; });
            mk.on('dragend', () => { draw(); list(); });
          });
        }
        // Side lengths in feet and inches at the middle of each side.
        const m = measured(s);
        if (m.sides_ft) m.sides_ft.forEach((len, i) => {
          const a = s.points[i], b = s.points[(i + 1) % s.points.length];
          if (!a || !b || len < 1) return;
          L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { interactive: false, icon: L.divIcon({ className: '', html: `<div class="sm-label">${fmtFt(len)}</div>`, iconSize: [0, 0] }) }).addTo(layers);
        });
      });
    }
    function summary(s) {
      const m = measured(s);
      if (!m.ok) return m.error || 'Keep tapping points.';
      if (s.type === 'area') return `${fmtNum(m.area_sqft)} sq ft (${fmtNum(m.area_sqft / 9)} sq yd), edges ${fmtFt(m.perimeter_ft)}${m.cutout_sqft ? `, less ${fmtNum(m.cutout_sqft)} sq ft of cut-outs` : ''}`;
      if (s.type === 'street') return `${fmtFt(m.length_ft)} long x ${s.width_ft} ft wide = ${fmtNum(m.area_sqft)} sq ft (${fmtNum(m.area_sqft / 9)} sq yd)`;
      return `${fmtFt(m.length_ft)} long`;
    }
    function list() {
      $('smShapes').innerHTML = shapes.map((s, i) => `<div class="sm-shape ${i === active ? 'active' : ''}"><div class="sm-row"><div style="flex:2 1 180px"><label for="smName${i}">${s.type === 'street' ? 'Street' : s.type === 'line' ? 'Line' : 'Area'} Name</label><input type="text" id="smName${i}" data-sm-name="${i}" value="${ctx.esc(s.name)}"></div>${s.type === 'street' ? `<div><label for="smWidth${i}">Street Width (ft)</label><input type="number" inputmode="decimal" id="smWidth${i}" data-sm-width="${i}" value="${s.width_ft || ''}"></div>` : ''}</div>
        <p><strong>${ctx.esc(summary(s))}</strong>${checked ? ' Checked with a tape.' : ' From the satellite picture.'}</p>
        <div class="sm-row"><button type="button" class="btn secondary slim" data-sm-select="${i}">${i === active ? 'Editing' : 'Edit Points'}</button><button type="button" class="btn secondary slim" data-sm-zoom="${i}">Show on Map</button><button type="button" class="btn secondary slim" data-sm-delete="${i}">Delete</button></div></div>`).join('');
      root.querySelectorAll('[data-sm-name]').forEach(el => el.oninput = () => { shapes[Number(el.dataset.smName)].name = el.value; });
      root.querySelectorAll('[data-sm-width]').forEach(el => el.oninput = () => { shapes[Number(el.dataset.smWidth)].width_ft = Number(el.value) || null; draw(); const p = el.closest('.sm-shape').querySelector('p strong'); if (p) p.textContent = summary(shapes[Number(el.dataset.smWidth)]); });
      root.querySelectorAll('[data-sm-select]').forEach(b => b.onclick = () => { active = Number(b.dataset.smSelect); cutMode = false; draw(); list(); hint('Drag the white dots to adjust, or tap the map to add points to this shape.'); });
      root.querySelectorAll('[data-sm-zoom]').forEach(b => b.onclick = () => { const s = shapes[Number(b.dataset.smZoom)]; if (s.points.length) map.fitBounds(s.points.map(p => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 20 }); });
      root.querySelectorAll('[data-sm-delete]').forEach(b => b.onclick = () => { if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; } shapes.splice(Number(b.dataset.smDelete), 1); active = shapes.length - 1; cutMode = false; draw(); list(); });
      $('smTapeShape').innerHTML = shapes.map((s, i) => `<option value="${i}">${ctx.esc(s.name)}</option>`).join('');
      tapeSides();
    }
    function tapeSides() {
      const s = shapes[Number($('smTapeShape').value)];
      const m = s ? G().measure({ ...s, scale: 1 }) : {};
      $('smTapeSide').innerHTML = (m.sides_ft || []).map((l, i) => `<option value="${i}">Side ${i + 1}: ${fmtFt(l * scale)} on the map</option>`).join('');
    }
    $('smTapeShape').onchange = tapeSides;
    const start = type => {
      const width = type === 'street' ? (Number(opts.defaultWidth) || 28) : null;
      shapes.push({ type, name: `${type === 'street' ? 'Street' : type === 'line' ? 'Line' : 'Area'} ${shapes.filter(s => s.type === type).length + 1}`, points: [], cutouts: [], width_ft: width });
      active = shapes.length - 1; cutMode = false; draw(); list();
      // Bring the whole map into view so every corner can be tapped.
      try { $('smMap').scrollIntoView({ block: 'start' }); } catch {}
      hint(type === 'area' ? 'Tap each corner of the area in order. Drag a dot to adjust. Tap Finish Shape when done.' : type === 'street' ? 'Tap along the middle of the street, at each bend and intersection. Set the curb-to-curb width below.' : 'Tap along the line, such as a curb, edge or stripe.');
    };
    if ($('smNewArea')) $('smNewArea').onclick = () => start('area');
    if ($('smNewStreet')) $('smNewStreet').onclick = () => start('street');
    if ($('smNewLine')) $('smNewLine').onclick = () => start('line');
    if ($('smCutout')) $('smCutout').onclick = () => { const s = cur(); if (!s || s.type !== 'area' || s.points.length < 3) { ctx.toast('Trace the area first, then add a cut-out inside it.'); return; } s.cutouts.push([]); cutMode = true; draw(); try { $('smMap').scrollIntoView({ block: 'start' }); } catch {} hint('Tap the corners of the cut-out (for example a planter or column). It is subtracted from the area.'); };
    map.on('click', e => {
      const s = cur(); if (!s) { hint('Tap New Area first, then tap the corners.'); return; }
      const pt = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (cutMode && s.cutouts.length) s.cutouts[s.cutouts.length - 1].push(pt); else s.points.push(pt);
      draw(); list();
    });
    map.on('zoomend', draw);
    $('smUndo').onclick = () => { const s = cur(); if (!s) return; if (cutMode && s.cutouts.length) { const c = s.cutouts[s.cutouts.length - 1]; c.pop(); if (!c.length) { s.cutouts.pop(); cutMode = false; } } else s.points.pop(); draw(); list(); };
    if ($('smSquare')) $('smSquare').onclick = () => { const s = cur(); if (!s || s.type !== 'area' || s.points.length < 3) { ctx.toast('Select an area with at least three corners.'); return; } s.points = G().squareCorners(s.points); draw(); list(); hint('Corners squared. Sides within 15 degrees of square now meet at right angles.'); };
    $('smFinish').onclick = () => { const s = cur(); if (s) { const m = measured(s); if (!m.ok) { hint(m.error); return; } } active = -1; cutMode = false; draw(); list(); hint('Shape finished. Start another, check a side with a tape, or save.'); };
    $('smTapeApply').onclick = () => {
      const s = shapes[Number($('smTapeShape').value)], feet = parseFeet($('smTapeFt').value);
      if (!s) { ctx.toast('Trace a shape first.'); return; }
      const r = G().scaleFromTape(s, Number($('smTapeSide').value), feet);
      if (!r.ok) { $('smTapeStatus').textContent = r.error; return; }
      scale = r.scale; checked = true;
      $('smTapeStatus').textContent = `Checked. The map was ${Math.abs(r.difference_pct)}% ${r.difference_pct >= 0 ? 'short' : 'long'}; every shape is corrected to match the tape.`;
      draw(); list();
    };
    const search = async () => {
      const q = $('smSearch').value.trim(); if (q.length < 3) return;
      $('smResults').textContent = 'Searching...';
      try {
        const c = map.getCenter(), r = await ctx.api(`/api/satellite/search?q=${encodeURIComponent(q)}&lat=${c.lat}&lng=${c.lng}`), d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (!d.results.length) { $('smResults').textContent = 'No match. Try the full address with the city.'; return; }
        $('smResults').innerHTML = d.results.map((x, i) => `<button type="button" class="btn secondary slim" data-sm-result="${i}" style="margin:4px 4px 0 0">${ctx.esc(x.label)}</button>`).join('');
        root.querySelectorAll('[data-sm-result]').forEach(b => b.onclick = () => { const x = d.results[Number(b.dataset.smResult)]; map.setView([x.lat, x.lng], 20); $('smResults').innerHTML = ''; hint('Tap New ' + (types.includes('area') ? 'Area' : 'Street') + ', then tap each corner on the map.'); });
        if (d.results.length === 1) root.querySelector('[data-sm-result]').click();
      } catch (e) { $('smResults').textContent = e.message || 'Address search is unavailable. Move the map by hand.'; }
    };
    $('smFind').onclick = search; $('smSearch').onkeydown = e => { if (e.key === 'Enter') search(); };
    $('smLocate').onclick = async () => { const loc = await ctx.location().catch(() => null); if (loc) map.setView([loc.lat, loc.lng], 20); else ctx.toast('Your location is not available.'); };
    const close = () => { map.remove(); root.remove(); };
    $('smClose').onclick = $('smCancel').onclick = () => { if (shapes.some(s => s.points.length) && $('smCancel').dataset.armed !== '1') { $('smCancel').dataset.armed = '1'; $('smCancel').textContent = 'Tap again to discard'; hint('Your traced shapes are not saved yet. Tap Cancel again to discard them.'); return; } close(); };
    $('smSave').onclick = async () => {
      const done = shapes.filter(s => s.points.length);
      if (!done.length) { ctx.toast('Trace at least one shape.'); return; }
      for (const s of done) { const m = measured(s); if (!m.ok) { ctx.toast(`${s.name}: ${m.error}`); return; } }
      const btn = $('smSave'); btn.disabled = true; btn.textContent = 'Saving...';
      try {
        await opts.onSave({ shapes: done.map(s => ({ type: s.type, name: s.name, points: s.points, cutouts: s.cutouts.filter(c => c.length >= 3), width_ft: s.width_ft, scale, checked })), source: $('smSource').value, picture: $('smPicture').checked });
        close();
      } catch (e) { ctx.toast(e.message || 'The measurements could not be saved.'); btn.disabled = false; btn.textContent = 'Save Measurements'; }
    };
    if (opts.address) search();
    setTimeout(() => map.invalidateSize(), 50);
    return { map, shapes };
  }
  window.PhotoNotesSatelliteMeasure = { open };
})();
