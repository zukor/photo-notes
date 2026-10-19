// Concrete Pro estimating screens: estimate list, estimate editor (areas, specification, options, site visit, quantities, prices, proposal) and price list.
(function () {
  'use strict';
  const E = () => window.PhotoNotesConcreteEstimate;
  const black = 'color:#000;background:#fff';
  const box = s => `border:2px solid #000;border-radius:8px;padding:10px;margin:10px 0;color:#000;background:${s === 'bad' ? '#ffe0e0' : s === 'good' ? '#e3f5e3' : '#fff'}`;
  const money = v => v == null ? 'Price needed' : '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const q = v => v == null ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  function ensureStyle() {
    if (document.getElementById('concreteEstimateStyle')) return;
    const st = document.createElement('style'); st.id = 'concreteEstimateStyle';
    st.textContent = '.cest,.cest *{color:#000}.cest input[type=number],.cest input[type=text],.cest select,.cest textarea{width:100%;padding:10px;font-size:16px;color:#000;background:#fff;border:1px solid #000;border-radius:8px;box-sizing:border-box;min-height:44px}.cest details{border:2px solid #000;border-radius:8px;padding:8px 12px;margin:12px 0;background:#fff}.cest summary{font-weight:bold;font-size:17px;cursor:pointer;padding:6px 0}.cest table{width:100%;border-collapse:collapse;font-size:15px}.cest td,.cest th{border-bottom:1px solid #000;padding:6px 4px;text-align:left;vertical-align:top}.cest .cest-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cest .cest-area{border:1px solid #000;border-radius:8px;padding:8px;margin:8px 0}.cest label.inline{display:flex;gap:8px;align-items:center;margin:6px 0}.cest label.inline input{width:auto;min-height:0}.cest .row{flex-wrap:wrap;gap:8px}.cest .row>.btn{flex:1 1 150px;white-space:normal;word-break:normal}.cest .cest-scroll{max-width:100%;overflow-x:auto}.cest td:nth-child(n+3),.cest th:nth-child(n+3){white-space:nowrap}.cest td small{display:block}';
    document.head.append(st);
  }
  const jobOptions = (ctx, value, blank) => `<option value="">${blank}</option>` + (ctx.jobs || []).map(j => `<option value="${j.id}" ${String(j.id) === String(value || '') ? 'selected' : ''}>${ctx.esc(j.job_number ? j.job_number + ' - ' + j.name : j.name)}</option>`).join('');
  async function json(ctx, url, opts) { const r = await ctx.api(url, opts), d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'Something went wrong. Try again.'); return d; }
  const post = (ctx, url, body) => json(ctx, url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------- Estimate list ----------
  function renderList(mount, ctx, kindFirst) {
    ensureStyle(); mount.classList.add('cest');
    mount.innerHTML = `<p>Estimates are built from measured areas on a job. Quantities are calculated for you, priced from your price list, and turned into a photo proposal with options.</p>
      <label for="cestJob">Job</label><select id="cestJob">${jobOptions(ctx, ctx.jobId, 'Choose a job')}</select>
      <div class="row"><button type="button" class="btn" id="cestNewQuick">New Quick Estimate</button><button type="button" class="btn secondary" id="cestNewDetailed">New Detailed Estimate</button><button type="button" class="btn secondary" id="cestNewCommercial">New Commercial Estimate</button></div>
      <p>Quick: a patio, walk or short driveway in about 10 minutes on site. Detailed: several areas with good, better and best options. Commercial: import areas from plan takeoff and export quantities.</p>
      <div id="cestList"><p>Choose a job to see its estimates.</p></div>`;
    const $ = id => mount.querySelector('#' + id);
    const load = async () => {
      const job = $('cestJob').value; if (!job) { $('cestList').innerHTML = '<p>Choose a job to see its estimates.</p>'; return; }
      try {
        const d = await json(ctx, '/api/concrete/estimates?job_id=' + encodeURIComponent(job));
        $('cestList').innerHTML = d.estimates.length ? d.estimates.map(e => { const o = (e.result && e.result.options) || []; return `<div style="${box('')}"><strong>${ctx.esc(e.name)}</strong> (${ctx.esc(e.kind)}, ${ctx.esc(e.status)})<br>${o.map(x => `${ctx.esc(x.name)}: ${x.complete ? money(x.total) : 'prices needed'}`).join('. ') || 'Not priced yet.'} <button type="button" class="btn secondary slim" data-cest-open="${e.id}">Open</button></div>`; }).join('') : '<p>No estimates for this job yet.</p>';
        mount.querySelectorAll('[data-cest-open]').forEach(b => b.onclick = () => ctx.openEstimate(Number(b.dataset.cestOpen)));
      } catch (e) { $('cestList').innerHTML = `<p>${ctx.esc(e.message)}</p>`; }
    };
    const create = kind => async () => {
      const job = $('cestJob').value; if (!job) { ctx.toast('Choose a job first.'); return; }
      try { const d = await post(ctx, '/api/concrete/estimates', { job_id: job, kind }); ctx.openEstimate(d.estimate.id); } catch (e) { ctx.toast(e.message); }
    };
    $('cestNewQuick').onclick = create('quick'); $('cestNewDetailed').onclick = create('detailed'); $('cestNewCommercial').onclick = create('commercial');
    $('cestJob').onchange = load; load();
    if (kindFirst === 'quick' && ctx.jobId) setTimeout(() => $('cestNewQuick').focus(), 0);
  }

  // ---------- Estimate editor ----------
  async function renderEditor(mount, ctx, id) {
    ensureStyle(); mount.classList.add('cest'); mount.innerHTML = '<p>Loading the estimate...</p>';
    let data;
    try { data = await json(ctx, '/api/concrete/estimates/' + id); } catch (e) { mount.innerHTML = `<p>${ctx.esc(e.message)}</p>`; return; }
    let est = data.estimate, jobAreas = [], outlines = [], saveTimer = null;
    const R = E(), $ = s => mount.querySelector('#' + s), quick = est.kind === 'quick', commercial = est.kind === 'commercial';
    const spec = () => est.spec || {}, re = () => spec().reinforcement || {};
    const opt = (list, value) => list.map(x => `<option value="${x.id}" ${x.id === value ? 'selected' : ''}>${x.label}</option>`).join('');
    const yes = v => v ? 'checked' : '';
    mount.innerHTML = `
      <div class="cest-grid"><div><label for="cestName">Estimate Name</label><input type="text" id="cestName" value="${ctx.esc(est.name)}"></div>
      <div><label for="cestStatus">Status</label><select id="cestStatus">${['draft', 'sent', 'won', 'lost'].map(s => `<option value="${s}" ${s === est.status ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div></div>
      <p>Job: <strong>${ctx.esc(est.job_name || '')}</strong>. ${quick ? 'Quick Estimate.' : commercial ? 'Commercial estimate.' : 'Detailed estimate.'}</p>
      <details ${quick ? '' : 'open'}><summary>Customer</summary><div class="cest-grid">${['name', 'phone', 'email', 'address'].map(k => `<div><label for="cestCust_${k}">${k[0].toUpperCase() + k.slice(1)}</label><input type="text" id="cestCust_${k}" value="${ctx.esc((est.customer || {})[k] || '')}"></div>`).join('')}</div></details>
      <details open><summary>Measured Areas</summary><div id="cestAreas"></div>
        <div class="row"><button type="button" class="btn secondary slim" id="cestAddArea">Add Area</button>${ctx.precisionMeasure ? '<button type="button" class="btn secondary slim" id="cestCardArea">Measure with Card</button>' : ''}</div>
        <div id="cestAreaForm"></div><div id="cestOutlines"></div>
        ${commercial || !quick ? `<details><summary>Import Takeoff from Plans</summary><p>Paste rows exported from your plan takeoff (for example the Ramo Optimizer, STACK or PlanSwift): name, square feet, edge length in feet, thickness in inches. One area per line.</p><textarea id="cestImport" rows="5"></textarea><button type="button" class="btn secondary slim" id="cestImportGo">Import Areas</button></details>` : ''}
      </details>
      <details open><summary>Specification</summary>
        <label for="cestCity">City Preset (driveway approach in the right-of-way)</label><select id="cestCity">${opt(R.CITY_PRESETS, spec().city || 'none')}</select><div id="cestCityNotes"></div>
        <div class="cest-grid">
          <div><label for="cestThick">Thickness (in)</label><input type="number" inputmode="decimal" id="cestThick" value="${spec().thickness_in ?? 4}"></div>
          <div><label for="cestPsi">Strength (psi)</label><input type="number" inputmode="numeric" id="cestPsi" value="${spec().psi ?? ''}"></div>
          <div><label for="cestReinf">Reinforcement</label><select id="cestReinf">${opt(R.REINFORCEMENT, re().type || 'none')}</select></div>
          <div><label for="cestBar">Bar Size</label><select id="cestBar">${['#3', '#4', '#5'].map(b => `<option ${b === (re().bar || '#3') ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
          <div><label for="cestSpacing">Bar Spacing (in)</label><input type="number" inputmode="numeric" id="cestSpacing" value="${re().spacing_in ?? 18}"></div>
          <div><label for="cestFiber">Fiber (lb per cubic yard)</label><input type="number" inputmode="decimal" id="cestFiber" value="${re().fiber_lb_cy ?? 1.5}"></div>
          <div><label for="cestFinish">Finish${quick ? '' : ' (when no options)'}</label><select id="cestFinish">${opt(R.FINISHES, spec().finish || 'broom')}</select></div>
          <div><label for="cestBase">Base Depth (in)</label><input type="number" inputmode="decimal" id="cestBase" value="${spec().base_in ?? ''}"></div>
          <div><label for="cestPlacement">Placement</label><select id="cestPlacement">${opt(R.PLACEMENT, spec().placement || 'chute')}</select></div>
          <div><label for="cestPours">Number of Pours</label><input type="number" inputmode="numeric" id="cestPours" value="${spec().pours ?? 1}"></div>
          <div><label for="cestFormless">Edges Against Existing Concrete or Building (ft, no forms)</label><input type="number" inputmode="decimal" id="cestFormless" value="${spec().formless_lf ?? ''}"></div>
          <div><label for="cestIsolation">Isolation Joints (ft)</label><input type="number" inputmode="decimal" id="cestIsolation" value="${spec().isolation_lf ?? ''}"></div>
          <div><label for="cestDemoSf">Remove Existing Concrete (sq ft)</label><input type="number" inputmode="decimal" id="cestDemoSf" value="${(spec().demo || {}).sqft ?? ''}"></div>
          <div><label for="cestDemoTh">Existing Thickness (in)</label><input type="number" inputmode="decimal" id="cestDemoTh" value="${(spec().demo || {}).thickness_in ?? ''}"></div>
          <div><label for="cestMiles">Miles from the Plant</label><input type="number" inputmode="decimal" id="cestMiles" value="${spec().miles ?? ''}"></div>
        </div>
        <label class="inline"><input type="checkbox" id="cestDemoRe" ${yes((spec().demo || {}).reinforced)}> Existing concrete is reinforced</label>
        <label class="inline"><input type="checkbox" id="cestJoints" ${yes(spec().joints !== false)}> Lay out saw-cut control joints</label>
        <label class="inline"><input type="checkbox" id="cestVapor" ${yes(spec().vapor)}> Vapor barrier (interior slabs)</label>
        <label class="inline"><input type="checkbox" id="cestSealer" ${yes(spec().sealer)}> Cure and seal</label>
        <label class="inline"><input type="checkbox" id="cestPermit" ${yes(spec().permit)}> Permit and inspections</label>
        <label class="inline"><input type="checkbox" id="cestWeekend" ${yes(spec().weekend)}> Weekend delivery</label>
      </details>
      ${quick ? '' : `<details open><summary>Options for the Customer</summary><p>Up to three options, for example good, better and best. Each can change the finish, the reinforcement and sealing.</p><div id="cestOptions"></div><button type="button" class="btn secondary slim" id="cestAddOption">Add Option</button></details>`}
      <details ${quick ? '' : 'open'}><summary>Site Visit Checklist</summary><div id="cestChecklist"></div></details>
      <details open><summary>Quantities and Price</summary><div id="cestResults"></div></details>
      <details><summary>Bid Versus Actual</summary><div id="cestActual"></div></details>
      <label for="cestNotes">Notes for the Proposal</label><textarea id="cestNotes" rows="3">${ctx.esc(est.notes || '')}</textarea>
      <div class="row"><button type="button" class="btn" id="cestSave">Save</button><button type="button" class="btn secondary" id="cestPdf">Proposal PDF</button><button type="button" class="btn secondary" id="cestWord">Proposal Word</button><button type="button" class="btn secondary" id="cestCsv">Quantities Spreadsheet</button><button type="button" class="btn secondary" id="cestDelete">Delete Estimate</button></div>
      <div class="status" id="cestStatusLine" aria-live="polite"></div>`;

    // ----- areas -----
    const loadAreas = async () => {
      try { const d = await json(ctx, '/api/concrete/areas?job_id=' + est.job_id); jobAreas = d.areas; outlines = d.saved_outlines; } catch (e) { ctx.toast(e.message); }
      drawAreas();
    };
    const drawAreas = () => {
      const chosen = new Set((est.area_ids || []).map(Number));
      $('cestAreas').innerHTML = jobAreas.length ? jobAreas.map(a => `<div class="cest-area"><label class="inline"><input type="checkbox" data-cest-area="${a.id}" ${chosen.has(a.id) ? 'checked' : ''}> <strong>${ctx.esc(a.name)}</strong></label>${q(a.area_sqft)} sq ft, edge ${q(a.perimeter_ft)} ft${a.thickness_in ? ', ' + q(a.thickness_in) + ' in' : ''}. Measured by ${ctx.esc((R.METHODS.find(m => m.id === a.method) || {}).label || a.method)}. <button type="button" class="btn secondary slim" data-cest-edit="${a.id}">Edit</button> <button type="button" class="btn secondary slim" data-cest-remove="${a.id}">Remove</button></div>`).join('') : '<p>No measured areas on this job yet. Add one below.</p>';
      $('cestOutlines').innerHTML = outlines.length ? '<p><strong>Saved Patio and Foundation Areas on this job:</strong></p>' + outlines.map(f => `<div>${ctx.esc(f.name)}: ${q(f.field_area_sqft || f.map_area_sqft)} sq ft <button type="button" class="btn secondary slim" data-cest-outline="${f.id}">Use This Area</button></div>`).join('') : '';
      mount.querySelectorAll('[data-cest-area]').forEach(b => b.onchange = () => { est.area_ids = [...mount.querySelectorAll('[data-cest-area]')].filter(x => x.checked).map(x => Number(x.dataset.cestArea)); queueSave(); });
      mount.querySelectorAll('[data-cest-edit]').forEach(b => b.onclick = () => areaForm(jobAreas.find(a => a.id === Number(b.dataset.cestEdit))));
      mount.querySelectorAll('[data-cest-remove]').forEach(b => b.onclick = async () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to remove'; return; }
        try { await json(ctx, '/api/concrete/areas/' + b.dataset.cestRemove, { method: 'DELETE' }); est.area_ids = (est.area_ids || []).filter(x => x !== Number(b.dataset.cestRemove)); await loadAreas(); queueSave(); } catch (e) { ctx.toast(e.message); }
      });
      mount.querySelectorAll('[data-cest-outline]').forEach(b => b.onclick = async () => { try { const d = await post(ctx, '/api/concrete/areas/from-outline', { job_id: est.job_id, footprint_id: Number(b.dataset.cestOutline) }); est.area_ids = [...(est.area_ids || []), d.area.id]; await loadAreas(); queueSave(); } catch (e) { ctx.toast(e.message); } });
    };
    const areaForm = (a = {}) => {
      const shape = a.shape || 'rect', d = a.dims || {}, edge = a.edge || {}, cut = (a.cutouts || [])[0] || {};
      const fields = s => (R.SHAPES.find(x => x.id === s).fields.map(([k, l]) => `<div><label for="cestDim_${k}">${l}</label><input type="text" id="cestDim_${k}" value="${ctx.esc(d[k] || '')}"></div>`).join('')) + (s === 'custom' ? `<div><label for="cestDim_area_sqft">Area (sq ft)</label><input type="number" inputmode="decimal" id="cestDim_area_sqft" value="${d.area_sqft || ''}"></div><div><label for="cestDim_perimeter_ft">Edge Length (ft)</label><input type="number" inputmode="decimal" id="cestDim_perimeter_ft" value="${d.perimeter_ft || ''}"></div>` : '');
      $('cestAreaForm').innerHTML = `<div style="${box('')}"><strong>${a.id ? 'Edit Area' : 'New Area'}</strong>
        <label for="cestAName">Area Name</label><input type="text" id="cestAName" value="${ctx.esc(a.name || '')}">
        <label for="cestAShape">Shape</label><select id="cestAShape">${R.SHAPES.map(s => `<option value="${s.id}" ${s.id === shape ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
        <p>Enter feet and inches, for example 18 ft 6 in, 18' 6", or 18.5.</p><div class="cest-grid" id="cestAFields">${fields(shape)}</div>
        <div class="cest-grid"><div><label for="cestAThick">Thickness (in, blank uses the specification)</label><input type="number" inputmode="decimal" id="cestAThick" value="${a.thickness_in ?? ''}"></div>
        <div><label for="cestAMethod">Measured By</label><select id="cestAMethod">${R.METHODS.map(m => `<option value="${m.id}" ${m.id === (a.method || 'tape') ? 'selected' : ''}>${m.label} (${m.confidence})</option>`).join('')}</select></div>
        <div><label for="cestAEdgeDepth">Thickened Edge Depth (in, optional)</label><input type="number" inputmode="decimal" id="cestAEdgeDepth" value="${edge.depth_in ?? ''}"></div>
        <div><label for="cestAEdgeWidth">Thickened Edge Width (in)</label><input type="number" inputmode="decimal" id="cestAEdgeWidth" value="${edge.width_in ?? ''}"></div>
        <div><label for="cestACut">Cut-outs: Planters, Columns (sq ft)</label><input type="number" inputmode="decimal" id="cestACut" value="${cut.area_sqft ?? ''}"></div>
        <div><label for="cestACutEdge">Cut-out Edges (ft)</label><input type="number" inputmode="decimal" id="cestACutEdge" value="${cut.perimeter_ft ?? ''}"></div></div>
        <div id="cestAPreview" aria-live="polite"></div>
        <div class="row"><button type="button" class="btn" id="cestASave">Save Area</button><button type="button" class="btn secondary" id="cestACancel">Cancel</button></div></div>`;
      const read = () => { const s = $('cestAShape').value, dims = {}; mount.querySelectorAll('[id^="cestDim_"]').forEach(i => { dims[i.id.slice(8)] = i.value.trim(); }); return { name: $('cestAName').value.trim(), shape: s, dims, thickness_in: $('cestAThick').value, method: $('cestAMethod').value, edge: { depth_in: $('cestAEdgeDepth').value, width_in: $('cestAEdgeWidth').value }, cutouts: $('cestACut').value ? [{ name: 'Cut-outs', area_sqft: $('cestACut').value, perimeter_ft: $('cestACutEdge').value }] : [] }; };
      const preview = () => { const g = R.geometry(read()); $('cestAPreview').innerHTML = g.ok ? `<strong>${q(g.area_sqft)} sq ft</strong>, edge ${q(g.perimeter_ft)} ft.` : 'Enter the measurements to see the area.'; };
      $('cestAShape').onchange = () => { $('cestAFields').innerHTML = fields($('cestAShape').value); bindPreview(); preview(); };
      const bindPreview = () => mount.querySelectorAll('#cestAreaForm input').forEach(i => i.oninput = preview);
      bindPreview(); preview();
      $('cestACancel').onclick = () => { $('cestAreaForm').innerHTML = ''; };
      $('cestASave').onclick = async () => {
        try {
          const body = { ...read(), job_id: est.job_id };
          const d = a.id ? await post(ctx, '/api/concrete/areas/' + a.id, body) : await post(ctx, '/api/concrete/areas', body);
          if (!a.id) est.area_ids = [...(est.area_ids || []), d.area.id];
          $('cestAreaForm').innerHTML = ''; await loadAreas(); queueSave(); ctx.toast('Area saved');
        } catch (e) { ctx.toast(e.message); }
      };
      $('cestAName').focus();
    };
    $('cestAddArea').onclick = () => areaForm();
    if ($('cestCardArea')) $('cestCardArea').onclick = () => ctx.precisionMeasure(dims => { const L = Number(dims.length_in) / 12, W = Number(dims.width_in) / 12; areaForm({ name: 'Measured area', shape: 'custom', method: 'card', dims: { area_sqft: dims.area_sqft, perimeter_ft: L && W ? Math.round(2 * (L + W) * 10) / 10 : '' } }); });
    if ($('cestImportGo')) $('cestImportGo').onclick = async () => { try { const d = await post(ctx, '/api/concrete/areas/import', { job_id: est.job_id, csv: $('cestImport').value }); est.area_ids = [...(est.area_ids || []), ...d.areas.map(a => a.id)]; $('cestImport').value = ''; await loadAreas(); queueSave(); ctx.toast(`${d.areas.length} areas imported`); } catch (e) { ctx.toast(e.message); } };

    // ----- city preset -----
    const cityNotes = () => { const c = R.CITY_PRESETS.find(x => x.id === $('cestCity').value); $('cestCityNotes').innerHTML = c && c.notes ? `<div style="${box('')}">${c.notes.map(n => ctx.esc(n)).join('<br>')}</div>` : ''; };
    $('cestCity').onchange = () => {
      const c = R.CITY_PRESETS.find(x => x.id === $('cestCity').value);
      if (c && c.spec) { if (c.spec.thickness_in) $('cestThick').value = c.spec.thickness_in; if (c.spec.psi) $('cestPsi').value = c.spec.psi; if (c.spec.base_in) $('cestBase').value = c.spec.base_in; if (c.spec.reinforcement) { $('cestReinf').value = c.spec.reinforcement.type; $('cestBar').value = c.spec.reinforcement.bar; $('cestSpacing').value = c.spec.reinforcement.spacing_in; } }
      if (c && c.permit) $('cestPermit').checked = true;
      cityNotes(); queueSave();
    };
    cityNotes();

    // ----- options -----
    let options = Array.isArray(est.options) ? est.options.slice() : [];
    const drawOptions = () => {
      if (!$('cestOptions')) return;
      $('cestOptions').innerHTML = options.map((o, i) => `<div class="cest-area"><div class="cest-grid"><div><label for="cestOName${i}">Option Name</label><input type="text" id="cestOName${i}" data-cest-opt="${i}" value="${ctx.esc(o.name)}"></div>
        <div><label for="cestOFinish${i}">Finish</label><select id="cestOFinish${i}" data-cest-opt="${i}">${opt(R.FINISHES, o.finish)}</select></div>
        <div><label for="cestOReinf${i}">Reinforcement</label><select id="cestOReinf${i}" data-cest-opt="${i}"><option value="">Same as the specification</option>${opt(R.REINFORCEMENT, o.reinforcement && o.reinforcement.type)}</select></div>
        <div><label for="cestOSeal${i}">Cure and Seal</label><select id="cestOSeal${i}" data-cest-opt="${i}"><option value="">Same as the specification</option><option value="yes" ${o.sealer === true ? 'selected' : ''}>Yes</option><option value="no" ${o.sealer === false ? 'selected' : ''}>No</option></select></div></div>
        <button type="button" class="btn secondary slim" data-cest-optdel="${i}">Remove Option</button></div>`).join('') || '<p>No options. The proposal uses the specification above.</p>';
      mount.querySelectorAll('[data-cest-opt]').forEach(el => el.onchange = el.oninput = () => { const i = Number(el.dataset.cestOpt); const re2 = $('cestOReinf' + i).value; options[i] = { name: $('cestOName' + i).value, finish: $('cestOFinish' + i).value, reinforcement: re2 ? { type: re2, bar: $('cestBar').value, spacing_in: $('cestSpacing').value, fiber_lb_cy: $('cestFiber').value } : null, sealer: $('cestOSeal' + i).value === '' ? null : $('cestOSeal' + i).value === 'yes' }; queueSave(); });
      mount.querySelectorAll('[data-cest-optdel]').forEach(b => b.onclick = () => { options.splice(Number(b.dataset.cestOptdel), 1); drawOptions(); queueSave(); });
    };
    if ($('cestAddOption')) $('cestAddOption').onclick = () => { if (options.length >= 3) { ctx.toast('Up to three options.'); return; } options.push({ name: ['Good', 'Better', 'Best'][options.length], finish: 'broom' }); drawOptions(); queueSave(); };
    drawOptions();

    // ----- checklist -----
    const drawChecklist = () => {
      const c = est.checklist || {};
      $('cestChecklist').innerHTML = R.CHECKLIST.map(i => `<div class="cest-area"><label for="cestCk_${i.key}"><strong>${i.label}</strong></label><p>${i.hint}</p><textarea id="cestCk_${i.key}" data-cest-ck="${i.key}" rows="2">${ctx.esc((c[i.key] || {}).answer || '')}</textarea>
        ${i.photo ? `<div class="row"><button type="button" class="btn secondary slim" data-cest-ckcam="${i.key}">Take Photo</button><button type="button" class="btn secondary slim" data-cest-cklib="${i.key}">Choose Photo</button> <span>${((c[i.key] || {}).photos || []).length} photo${((c[i.key] || {}).photos || []).length === 1 ? '' : 's'}</span></div>` : ''}</div>`).join('') +
        '<input type="file" accept="image/*" capture="environment" id="cestCkCam" style="display:none"><input type="file" accept="image/*" id="cestCkLib" style="display:none">';
      mount.querySelectorAll('[data-cest-ck]').forEach(t => t.oninput = () => { est.checklist = est.checklist || {}; est.checklist[t.dataset.cestCk] = { ...(est.checklist[t.dataset.cestCk] || {}), answer: t.value }; queueSave(); });
      let key = null;
      mount.querySelectorAll('[data-cest-ckcam]').forEach(b => b.onclick = () => { key = b.dataset.cestCkcam; $('cestCkCam').click(); });
      mount.querySelectorAll('[data-cest-cklib]').forEach(b => b.onclick = () => { key = b.dataset.cestCklib; $('cestCkLib').click(); });
      const pick = async e => {
        const file = e.target.files && e.target.files[0], camera = e.target.id === 'cestCkCam'; e.target.value = ''; if (!file || !key) return;
        await saveNow();
        try {
          const fd = new FormData(); fd.append('photo', file); fd.append('key', key);
          const loc = await ctx.photoLocation(file, camera).catch(() => null); if (loc) { fd.append('latitude', loc.lat); fd.append('longitude', loc.lng); }
          const r = await ctx.api(`/api/concrete/estimates/${est.id}/checklist-photo`, { method: 'POST', body: fd }), d = await r.json().catch(() => ({}));
          if (!r.ok) throw Error(d.error || 'The photo could not be saved.');
          est.checklist = d.checklist; drawChecklist(); ctx.toast('Photo saved to the job');
        } catch (err) { ctx.toast(err.message); }
      };
      $('cestCkCam').onchange = pick; $('cestCkLib').onchange = pick;
    };
    drawChecklist();

    // ----- results -----
    const drawResults = d => {
      const status = d.checklist || {};
      $('cestResults').innerHTML = (d.options || []).map(o => {
        const t = o.takeoff, p = o.pricing;
        if (!t.ok) return `<div style="${box('bad')}">${t.warnings.map(w => ctx.esc(w)).join('<br>')}</div>`;
        return `<div style="${box(p.complete ? 'good' : '')}"><strong>${ctx.esc(o.name)}: ${p.complete ? money(p.total) : 'prices needed'}</strong>${p.complete && p.per_sqft ? ` (${money(p.per_sqft)} per sq ft)` : ''}<br>${ctx.esc(o.description)}.<br>${q(t.area_sqft)} sq ft, ${q(t.placed_cy)} cubic yards placed, ${q(t.purchase_cy)} to order.${p.missing.length ? `<br><strong>Add prices for:</strong> ${p.missing.map(m => ctx.esc(m)).join(', ')}. <button type="button" class="btn secondary slim" data-cest-prices>Open Price List</button>` : ''}
          <div class="cest-scroll"><table><thead><tr><th>Item</th><th>Quantity</th><th>Price</th><th>Amount</th></tr></thead><tbody>${p.lines.map(l => `<tr><td>${ctx.esc(l.label)}${l.note ? `<br><small>${ctx.esc(l.note)}</small>` : ''}</td><td>${q(l.purchase)} ${ctx.esc(l.unit)}${l.placed != null && l.placed !== l.purchase && l.placed > 0 ? `<br><small>${q(l.placed)} placed</small>` : ''}</td><td>${l.unit_price == null ? '' : money(l.unit_price)}</td><td>${money(l.amount)}</td></tr>`).join('')}</tbody></table></div>
          ${t.warnings.length ? `<p>${t.warnings.map(w => ctx.esc(w)).join('<br>')}</p>` : ''}</div>`;
      }).join('') + `<p>Site visit: ${status.answered || 0} of ${status.total || 0} items answered.${status.photos_missing && status.photos_missing.length ? ' Photos still needed: ' + status.photos_missing.map(x => ctx.esc(x)).join(', ') + '.' : ''}</p>` + ((d.book && d.book.examples && d.book.examples.length) ? `<p><strong>Your price list still contains example prices.</strong> Replace them with your own before sending a proposal.</p>` : '');
      mount.querySelectorAll('[data-cest-prices]').forEach(b => b.onclick = () => ctx.openPriceBook());
      const a = d.actual || {};
      $('cestActual').innerHTML = `<div style="${box(a.status === 'over' ? 'bad' : a.status === 'within' ? 'good' : '')}">${ctx.esc(a.message || '')}${a.actual_waste_pct != null ? `<br>Actual waste on this job: ${a.actual_waste_pct}%.` : ''}</div><p>Actual yards come from the Batch Ticket Scanner tickets saved for this job.</p>`;
    };
    drawResults(data);

    // ----- save -----
    const collect = () => ({
      name: $('cestName').value, status: $('cestStatus').value, notes: $('cestNotes').value,
      customer: Object.fromEntries(['name', 'phone', 'email', 'address'].map(k => [k, $('cestCust_' + k).value])),
      area_ids: est.area_ids || [], options, checklist: est.checklist || {},
      spec: { city: $('cestCity').value, element: spec().element, thickness_in: $('cestThick').value, psi: $('cestPsi').value, reinforcement: { type: $('cestReinf').value, bar: $('cestBar').value, spacing_in: $('cestSpacing').value, fiber_lb_cy: $('cestFiber').value },
        finish: $('cestFinish').value, base_in: $('cestBase').value, placement: $('cestPlacement').value, pours: $('cestPours').value, formless_lf: $('cestFormless').value, isolation_lf: $('cestIsolation').value,
        demo: { sqft: $('cestDemoSf').value, thickness_in: $('cestDemoTh').value, reinforced: $('cestDemoRe').checked }, miles: $('cestMiles').value, joints: $('cestJoints').checked, vapor: $('cestVapor').checked, sealer: $('cestSealer').checked, permit: $('cestPermit').checked, weekend: $('cestWeekend').checked }
    });
    let saving = Promise.resolve();
    const saveNow = () => { clearTimeout(saveTimer); saving = saving.then(async () => { try { const d = await post(ctx, '/api/concrete/estimates/' + est.id, collect()); est = { ...est, ...d.estimate }; drawResults(d); $('cestStatusLine').textContent = 'Saved.'; } catch (e) { $('cestStatusLine').textContent = e.message; } }); return saving; };
    const queueSave = () => { clearTimeout(saveTimer); $('cestStatusLine').textContent = 'Updating...'; saveTimer = setTimeout(saveNow, 700); };
    mount.querySelectorAll('#cestName,#cestStatus,#cestNotes,[id^="cestCust_"],#cestThick,#cestPsi,#cestReinf,#cestBar,#cestSpacing,#cestFiber,#cestFinish,#cestBase,#cestPlacement,#cestPours,#cestFormless,#cestIsolation,#cestDemoSf,#cestDemoTh,#cestDemoRe,#cestMiles,#cestJoints,#cestVapor,#cestSealer,#cestPermit,#cestWeekend').forEach(el => { el.addEventListener('input', queueSave); el.addEventListener('change', queueSave); });
    $('cestSave').onclick = async () => { await saveNow(); ctx.toast('Estimate saved'); };
    const download = (path, name) => async () => { await saveNow(); try { const r = await ctx.api(path); if (!r.ok) throw Error(); const blob = await r.blob(); ctx.downloadBlob(new File([blob], name, { type: blob.type }), name); } catch { ctx.toast('The file could not be created. Try again.'); } };
    const tz = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago');
    $('cestPdf').onclick = download(`/api/concrete/estimates/${est.id}/proposal?doc=pdf&tz=${tz}`, `concrete-proposal-${est.id}.pdf`);
    $('cestWord').onclick = download(`/api/concrete/estimates/${est.id}/proposal?doc=docx&tz=${tz}`, `concrete-proposal-${est.id}.docx`);
    $('cestCsv').onclick = download(`/api/concrete/estimates/${est.id}/quantities.csv`, `concrete-estimate-${est.id}-quantities.csv`);
    $('cestDelete').onclick = async () => {
      const b = $('cestDelete'); if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
      try { await json(ctx, '/api/concrete/estimates/' + est.id, { method: 'DELETE' }); ctx.toast('Estimate deleted'); ctx.openList(); } catch (e) { ctx.toast(e.message); }
    };
    loadAreas();
  }

  // ---------- Price list ----------
  async function renderPriceBook(mount, ctx) {
    ensureStyle(); mount.classList.add('cest'); mount.innerHTML = '<p>Loading your price list...</p>';
    let d; try { d = await json(ctx, '/api/concrete/price-book'); } catch (e) { mount.innerHTML = `<p>${ctx.esc(e.message)}</p>`; return; }
    let examples = new Set(d.examples || []);
    const s = d.settings || {}, acc = d.accuracy;
    mount.innerHTML = `<p>Enter what you charge for each item, including your overhead and profit. Estimates use these prices; an item without a price shows "Price needed".</p>
      ${acc ? `<div style="${box('')}">From ${acc.jobs} jobs with batch tickets, your real concrete overage averages ${acc.average_waste_pct}%. Suggested waste setting: ${acc.suggested_pct}%.</div>` : ''}
      <button type="button" class="btn secondary slim" id="cpbExamples">Fill Blanks with Example Prices</button>
      <p>Example prices come from public 2026 sources and are marked EXAMPLE until you change them. Only some items have a public source.</p>
      <table><thead><tr><th>Item</th><th>Unit</th><th>Price ($)</th></tr></thead><tbody>${d.items.map(([k, l, u]) => `<tr><td><label for="cpb_${k}">${l}</label> <strong id="cpbEx_${k}">${examples.has(k) ? 'EXAMPLE' : ''}</strong></td><td>${u}</td><td><input type="number" inputmode="decimal" step="0.01" id="cpb_${k}" value="${d.prices[k] ?? ''}"></td></tr>`).join('')}</tbody></table>
      <h3>Settings</h3><div class="cest-grid">
        <div><label for="cpbWaste">Extra Concrete to Order (%)</label><input type="number" inputmode="decimal" id="cpbWaste" value="${s.concrete_waste_pct}"></div>
        <div><label for="cpbRebar">Extra Rebar to Order (%)</label><input type="number" inputmode="decimal" id="cpbRebar" value="${s.rebar_waste_pct}"></div>
        <div><label for="cpbShort">Full Truck (cubic yards)</label><input type="number" inputmode="decimal" id="cpbShort" value="${s.short_load_cy}"></div>
        <div><label for="cpbMiles">Free Delivery Distance (miles)</label><input type="number" inputmode="decimal" id="cpbMiles" value="${s.free_miles}"></div>
        <div><label for="cpbMarkup">Markup on Totals (%)</label><input type="number" inputmode="decimal" id="cpbMarkup" value="${s.markup_pct}"></div>
        <div><label for="cpbChair">Chair Spacing (ft)</label><input type="number" inputmode="decimal" id="cpbChair" value="${s.chair_spacing_ft}"></div></div>
      <label class="inline"><input type="checkbox" id="cpbRound" ${s.round_up !== false ? 'checked' : ''}> Round order quantities up to whole units</label>
      <button type="button" class="btn" id="cpbSave">Save Price List</button>`;
    const $ = id => mount.querySelector('#' + id);
    const mark = k => { const el = $('cpbEx_' + k); if (el) el.textContent = examples.has(k) ? 'EXAMPLE' : ''; };
    d.items.forEach(([k]) => $('cpb_' + k).oninput = () => { if (Number($('cpb_' + k).value) !== d.example_prices[k]) { examples.delete(k); mark(k); } });
    $('cpbExamples').onclick = () => { for (const [k, v] of Object.entries(d.example_prices)) if ($('cpb_' + k) && $('cpb_' + k).value === '') { $('cpb_' + k).value = v; examples.add(k); mark(k); } };
    $('cpbSave').onclick = async () => {
      try {
        const prices = Object.fromEntries(d.items.map(([k]) => [k, $('cpb_' + k).value]).filter(([, v]) => v !== ''));
        await post(ctx, '/api/concrete/price-book', { prices, examples: [...examples], settings: { concrete_waste_pct: $('cpbWaste').value, rebar_waste_pct: $('cpbRebar').value, short_load_cy: $('cpbShort').value, free_miles: $('cpbMiles').value, markup_pct: $('cpbMarkup').value, chair_spacing_ft: $('cpbChair').value, round_up: $('cpbRound').checked } });
        ctx.toast('Price list saved');
      } catch (e) { ctx.toast(e.message); }
    };
  }
  window.PhotoNotesConcreteEstimateUI = { renderList, renderEditor, renderPriceBook };
})();
