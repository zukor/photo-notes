// Paving Pro: Mix Temperature Log and Daily Yield Check screens.
(function () {
  'use strict';
  const R = () => window.PhotoNotesPavingQuality;
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; } catch { return 'America/Chicago'; } };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const jobOptions = (ctx, value, blank) => `<option value="">${blank}</option>` + (ctx.jobs || []).map(j => `<option value="${j.id}" ${String(j.id) === String(value || '') ? 'selected' : ''}>${ctx.esc(j.job_number ? j.job_number + ' - ' + j.name : j.name)}</option>`).join('');
  const statusText = s => ({ ok: 'Meets minimum', low: 'BELOW MINIMUM', recorded: 'Recorded', on_target: 'On target', over: 'Over plan', under: 'Under plan', incomplete: 'Not checked yet' })[s] || s;
  const box = s => `border:2px solid #000;border-radius:8px;padding:10px;margin:10px 0;color:#000;background:${s === 'low' || s === 'under' || s === 'over' ? '#ffe0e0' : s === 'ok' || s === 'on_target' ? '#e3f5e3' : '#fff'}`;

  // Number and date fields match the app's text fields: full width, large and easy to tap.
  function ensureStyle() {
    if (document.getElementById('pavingQualityStyle')) return;
    const st = document.createElement('style'); st.id = 'pavingQualityStyle';
    st.textContent = '.workflow-paving-temperature input[type=number],.workflow-paving-temperature input[type=date],.workflow-paving-yield input[type=number],.workflow-paving-yield input[type=date]{width:100%;padding:12px;font-size:16px;color:#000;background:#fff;border:1px solid #000;border-radius:8px;font-family:inherit;min-height:48px;box-sizing:border-box}.workflow-paving-temperature .row.compact input[type=date]{width:auto}';
    document.head.append(st);
  }
  // ---------- Temperature log ----------
  let tempFile = null, tempDraft = null;
  function temperatureUnsaved() { return !!(tempFile || tempDraft); }
  function renderTemperature(mount, ctx) {
    const Q = R(); tempFile = null; tempDraft = null;
    mount.className = 'workflow-paving-temperature'; ensureStyle();
    mount.innerHTML = `
      <div class="ticket-scan-panel">
        <label>Thermometer Photo</label>
        <p>Photograph the thermometer display right after taking the reading. PhotoNotes reads the number and records the time and place.</p>
        <details><summary>How to take an accurate reading</summary><ul>
          <li>Read the fresh mat right behind the screed, or the load in the truck bed when it arrives.</li>
          <li>Hold an infrared thermometer 1 to 2 feet away and aim straight down. Avoid shiny, wet or smoking spots.</li>
          <li>Set emissivity to 0.95 for asphalt if your thermometer allows it.</li>
          <li>Fill the photo with the display, held steady, with no glare.</li></ul></details>
        <div class="row">
          <button type="button" class="btn" id="tempTake">Take Thermometer Photo</button>
          <button type="button" class="btn secondary" id="tempChoose">Choose Existing Photo</button>
          <button type="button" class="btn secondary" id="tempManual">Enter by Hand</button>
        </div>
        <input type="file" accept="image/*" capture="environment" id="tempCam" style="display:none">
        <input type="file" accept="image/*" id="tempLib" style="display:none">
        <div class="photo-box" id="tempPreviewBox" style="display:none;margin-top:12px"><img id="tempPreview" alt="Thermometer photo preview"></div>
        <div class="status" id="tempStatus" aria-live="polite"></div>
      </div>
      <div id="tempReview"></div>
      <div class="formhead" style="margin-top:28px">Temperature Log</div>
      <div class="row compact"><label for="tempDay">Date</label><input type="date" id="tempDay" value="${today()}"><label for="tempJobFilter">Job</label><select id="tempJobFilter">${jobOptions(ctx, ctx.jobId, 'All jobs')}</select></div>
      <div id="tempLog"><p class="status">Loading...</p></div>`;
    const $ = id => mount.querySelector('#' + id);
    $('tempTake').onclick = () => $('tempCam').click();
    $('tempChoose').onclick = () => $('tempLib').click();
    $('tempManual').onclick = () => { tempFile = null; tempDraft = { manual: true }; $('tempPreviewBox').style.display = 'none'; $('tempStatus').textContent = 'Enter the reading below.'; review(mount, ctx, {}); };
    const pick = async e => {
      const file = e.target.files && e.target.files[0]; e.target.value = ''; if (!file) return;
      tempFile = file; tempDraft = null; $('tempPreview').src = URL.createObjectURL(file); $('tempPreviewBox').style.display = 'block';
      $('tempReview').innerHTML = ''; $('tempStatus').textContent = 'Reading the thermometer display...';
      ctx.setBusy(['tempTake', 'tempChoose', 'tempManual'], true);
      try {
        const fd = new FormData(); fd.append('photo', file); fd.append('taken_at', new Date(e.target.id === 'tempCam' ? Date.now() : (file.lastModified || Date.now())).toISOString());
        // GPS is recorded only for a photo taken now; a saved photo may come from somewhere else.
        const loc = await ctx.photoLocation(file, e.target.id === 'tempCam').catch(() => null); if (loc) { fd.append('latitude', loc.lat); fd.append('longitude', loc.lng); }
        const r = await ctx.api('/api/paving/temperatures/scan', { method: 'POST', body: fd }), d = await r.json().catch(() => ({}));
        if (!r.ok || !d.reading) throw Error(d.error || 'The photo could not be read.');
        tempDraft = d.reading;
        $('tempStatus').textContent = d.ai_read ? `Read ${Number(d.reading.reading_f)}°F${d.display_mode ? ' (' + d.display_mode + ')' : ''}${d.emissivity ? ', emissivity ' + d.emissivity : ''}. Check it against the photo, then save.` : (d.ai_message || 'The display could not be read. Enter the reading below, then save.');
        review(mount, ctx, tempDraft);
      } catch (err) { $('tempStatus').textContent = err.message + ' You can enter the reading by hand.'; tempDraft = { manual: true }; review(mount, ctx, {}); }
      finally { ctx.setBusy(['tempTake', 'tempChoose', 'tempManual'], false); }
    };
    $('tempCam').onchange = pick; $('tempLib').onchange = pick;
    $('tempDay').onchange = () => loadLog(mount, ctx); $('tempJobFilter').onchange = () => loadLog(mount, ctx);
    loadLog(mount, ctx);
  }
  async function ticketOptions(ctx, jobId, selected) {
    if (!jobId) return '<option value="">No ticket</option>';
    try {
      const r = await ctx.api(`/api/asphalt-tickets?date=${today()}&job_id=${encodeURIComponent(jobId)}&tz=${encodeURIComponent(tz())}`), d = r.ok ? await r.json() : { tickets: [] };
      return '<option value="">No ticket</option>' + (d.tickets || []).map(t => `<option value="${t.id}" data-plant-f="${t.dispatch_temperature_f ?? ''}" ${String(t.id) === String(selected || '') ? 'selected' : ''}>${ctx.esc(['Ticket ' + (t.ticket_number || t.id), t.truck_number && 'truck ' + t.truck_number, t.dispatch_time].filter(Boolean).join(', '))}</option>`).join('');
    } catch { return '<option value="">No ticket</option>'; }
  }
  function review(mount, ctx, t) {
    const Q = R(), $ = id => mount.querySelector('#' + id);
    const binder = t.binder || store.get('pn_paving_binder_v1') || '', kind = t.kind || store.get('pn_paving_temp_kind_v1') || 'mat';
    $('tempReview').innerHTML = `<section class="ticket-review-panel">
      <div class="formhead">Check and Save the Reading</div>
      <label for="tempReading">Temperature (°F)</label><input id="tempReading" type="number" inputmode="decimal" step="0.1" value="${t.reading_f ?? ''}">
      <label for="tempKind">What Was Measured</label><select id="tempKind">${Q.KINDS.map(k => `<option value="${k.id}" ${k.id === kind ? 'selected' : ''}>${k.label}</option>`).join('')}</select>
      <label for="tempBinder">Mix Binder</label><select id="tempBinder"><option value="">Choose the binder</option>${Q.BINDERS.map(b => `<option value="${b.id}" ${b.id === binder ? 'selected' : ''}>${b.label}${b.minimum_f ? ', ' + b.minimum_f + '°F minimum' : ''}</option>`).join('')}</select>
      <label for="tempMinimum">Project Minimum (°F, optional; leave blank to use the suggested minimum)</label><input id="tempMinimum" type="number" inputmode="decimal" step="1" value="${store.get('pn_paving_temp_min_v1') || ''}">
      <label for="tempJob">Job</label><select id="tempJob">${jobOptions(ctx, t.job_id || ctx.jobId, 'No job selected')}</select>
      <label for="tempTicket">Delivery Ticket</label><select id="tempTicket"><option value="">No ticket</option></select>
      <label for="tempWhere">Where (station, lane or area)</label><input id="tempWhere" type="text" maxlength="200" value="${ctx.esc(t.location_note || '')}">
      <label for="tempNote">Note</label><textarea id="tempNote" maxlength="1000">${ctx.esc(t.note || '')}</textarea>
      <div id="tempCheck" style="${box('')}" aria-live="polite"></div>
      <p>Suggested minimums are TxDOT suggested placement temperatures for the mix behind the paver. Your project specification governs; enter its minimum above if it differs.</p>
      <div class="row"><button type="button" class="btn" id="tempSave">Save Reading</button><button type="button" class="btn secondary" id="tempCancel">Cancel</button></div>
    </section>`;
    const update = () => {
      const c = Q.temperatureCheck({ reading_f: $('tempReading').value, kind: $('tempKind').value, binder: $('tempBinder').value, minimum_f: $('tempMinimum').value });
      const opt = $('tempTicket').selectedOptions[0], plant = opt && Number(opt.dataset.plantF), reading = Number($('tempReading').value);
      const drop = $('tempKind').value === 'load' && plant > 0 && reading > 0 ? ` The ticket shows ${plant}°F at the plant, a drop of ${Math.round((plant - reading) * 10) / 10}°F.` : '';
      $('tempCheck').setAttribute('style', box(c.status)); $('tempCheck').innerHTML = `<strong>${statusText(c.status)}</strong> ${ctx.esc(c.message + drop)}`;
    };
    const loadTickets = async () => { $('tempTicket').innerHTML = await ticketOptions(ctx, $('tempJob').value, t.ticket_id); update(); };
    for (const id of ['tempReading', 'tempMinimum']) $(id).oninput = update;
    for (const id of ['tempKind', 'tempBinder', 'tempTicket']) $(id).onchange = update;
    $('tempJob').onchange = loadTickets; loadTickets();
    $('tempCancel').onclick = () => { tempFile = null; tempDraft = null; $('tempReview').innerHTML = ''; $('tempPreviewBox').style.display = 'none'; $('tempStatus').textContent = ''; };
    $('tempSave').onclick = async () => {
      const btn = $('tempSave'); if (btn.disabled) return;
      const body = { reading_f: $('tempReading').value, kind: $('tempKind').value, binder: $('tempBinder').value || null, minimum_f: $('tempMinimum').value, job_id: $('tempJob').value, ticket_id: $('tempTicket').value, location_note: $('tempWhere').value, note: $('tempNote').value };
      if (!body.reading_f) { ctx.toast('Enter the temperature reading.'); return; }
      if (!t.id && !tempFile) { const loc = await ctx.location().catch(() => null); if (loc) { body.latitude = loc.lat; body.longitude = loc.lng; } }
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        const r = await ctx.api(t.id ? `/api/paving/temperatures/${t.id}` : '/api/paving/temperatures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), d = await r.json().catch(() => ({}));
        if (!r.ok) throw Error(d.error || 'The reading could not be saved.');
        store.set('pn_paving_binder_v1', body.binder || ''); store.set('pn_paving_temp_kind_v1', body.kind); store.set('pn_paving_temp_min_v1', body.minimum_f || '');
        ctx.toast(d.check && d.check.status === 'low' ? 'Saved. This reading is below the minimum.' : 'Temperature saved');
        tempFile = null; tempDraft = null; $('tempReview').innerHTML = ''; $('tempPreviewBox').style.display = 'none'; $('tempStatus').textContent = ''; loadLog(mount, ctx);
      } catch (err) { ctx.toast(err.message); btn.disabled = false; btn.textContent = 'Save Reading'; }
    };
    update();
  }
  async function loadLog(mount, ctx) {
    const out = mount.querySelector('#tempLog'); if (!out) return;
    const job = mount.querySelector('#tempJobFilter').value, day = mount.querySelector('#tempDay').value;
    try {
      const r = await ctx.api(`/api/paving/temperatures?date=${encodeURIComponent(day)}&tz=${encodeURIComponent(tz())}${job ? '&job_id=' + encodeURIComponent(job) : ''}`), d = await r.json();
      if (!r.ok) throw Error(d.error);
      const Q = R(), rows = d.readings || [];
      out.innerHTML = rows.length ? `<p><strong>${rows.length} reading${rows.length === 1 ? '' : 's'}${d.summary.low ? `, ${d.summary.low} below minimum` : ''}.</strong></p>` + rows.map(t => `<div style="${box(t.check_status)}"><strong>${Number(t.reading_f)}°F</strong> ${ctx.esc((Q.KINDS.find(k => k.id === t.kind) || {}).label || t.kind)}, ${new Date(t.taken_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. ${statusText(t.check_status)}${t.minimum_f != null ? ' (minimum ' + Number(t.minimum_f) + '°F)' : ''}.${t.ticket_number ? ' Ticket ' + ctx.esc(t.ticket_number) + '.' : ''}${t.job_name ? ' ' + ctx.esc(t.job_name) + '.' : ''}${t.location_note ? ' ' + ctx.esc(t.location_note) + '.' : ''}${t.photo_path ? ` <a data-temp-photo href="${ctx.esc(t.photo_path)}" target="_blank" rel="noopener">Photo</a>` : ''} <button type="button" class="btn secondary slim" data-temp-delete="${t.id}">Delete</button></div>`).join('') : '<p>No readings for this date.</p>';
      out.querySelectorAll('[data-temp-delete]').forEach(b => b.onclick = async () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
        const r = await ctx.api('/api/paving/temperatures/' + b.dataset.tempDelete, { method: 'DELETE' }); if (r.ok) { ctx.toast('Reading deleted'); loadLog(mount, ctx); } else ctx.toast('The reading could not be deleted.');
      });
    } catch { out.innerHTML = '<p>The temperature log could not be loaded.</p>'; }
  }

  // ---------- Daily yield ----------
  function renderYield(mount, ctx) {
    const Q = R();
    mount.className = 'workflow-paving-yield'; ensureStyle();
    mount.innerHTML = `
      <section class="ticket-review-panel">
        <p>Check the day's paving while crews are still on site. PhotoNotes adds the tons on the saved delivery tickets and compares them with what the paved area and planned thickness should take.</p>
        <label for="yieldJob">Job</label><select id="yieldJob">${jobOptions(ctx, ctx.jobId, 'Choose a job')}</select>
        <label for="yieldDate">Paving Date</label><input type="date" id="yieldDate" value="${today()}">
        <div id="yieldTons" style="${box('')}">Choose a job to load the day's tickets.</div>
        <label for="yieldArea">Paved Area</label>
        <div class="row compact"><input id="yieldArea" type="number" inputmode="decimal" step="0.1" min="0" style="flex:1"><select id="yieldAreaUnit" aria-label="Area unit"><option value="sqft">sq ft</option><option value="sy">sq yd</option><option value="sqm">m²</option></select></div>
        <button type="button" class="btn secondary slim" id="yieldUseMeasured" hidden>Use Measured Photo Areas</button><button type="button" class="btn secondary slim" id="yieldUseTakeoff" hidden>Use Satellite Takeoff Area</button>
        <label for="yieldThickness">Planned Compacted Thickness (in)</label><input id="yieldThickness" type="number" inputmode="decimal" step="0.25" min="0" value="${store.get('pn_paving_yield_thickness_v1') || ''}">
        <details><summary>Mix weight and tolerance</summary>
          <label for="yieldUnitWeight">Mix Weight (lb per sq yd per inch)</label><input id="yieldUnitWeight" type="number" inputmode="decimal" step="1" value="${store.get('pn_paving_yield_uw_v1') || Q.DEFAULT_UNIT_WEIGHT}">
          <p>110 is typical for dense-graded hot mix. Use the mix design value when you have it.</p>
          <label for="yieldTolerance">Tolerance (%)</label><input id="yieldTolerance" type="number" inputmode="decimal" step="0.5" value="${store.get('pn_paving_yield_tol_v1') || Q.DEFAULT_TOLERANCE_PCT}">
        </details>
        <label for="yieldNote">Note</label><textarea id="yieldNote" maxlength="1000"></textarea>
        <div id="yieldResult" style="${box('')}" aria-live="polite"></div>
        <button type="button" class="btn" id="yieldSave">Save Yield Check</button>
      </section>
      <div class="formhead" style="margin-top:28px">Saved Yield Checks</div>
      <div id="yieldHistory"><p>Choose a job to see its yield checks.</p></div>`;
    const $ = id => mount.querySelector('#' + id);
    let inputs = null, areaSource = 'entered';
    const update = () => {
      const r = Q.yieldCheck({ tons: inputs && inputs.tons, area_sy: Q.areaToSquareYards($('yieldArea').value, $('yieldAreaUnit').value), thickness_in: $('yieldThickness').value, unit_weight: $('yieldUnitWeight').value, tolerance_pct: $('yieldTolerance').value });
      $('yieldResult').setAttribute('style', box(r.status));
      $('yieldResult').innerHTML = r.status === 'incomplete' ? `<strong>${statusText(r.status)}</strong> ${ctx.esc(r.message)}` :
        `<strong>${statusText(r.status)}: ${r.yield_pct}% of plan</strong><br>${r.tons} tons delivered, ${r.design_tons} tons planned.<br>${r.actual_lb_sy} lb per sq yd laid, ${r.design_lb_sy} planned. That is about ${r.implied_thickness_in} in of mat.<br>${ctx.esc(r.message)}`;
      return r;
    };
    const load = async () => {
      inputs = null; $('yieldUseMeasured').hidden = true; $('yieldUseTakeoff').hidden = true;
      if (!$('yieldJob').value) { $('yieldTons').textContent = 'Choose a job to load the day\'s tickets.'; $('yieldHistory').innerHTML = '<p>Choose a job to see its yield checks.</p>'; update(); return; }
      $('yieldTons').textContent = 'Loading tickets...';
      try {
        const r = await ctx.api(`/api/paving/yield/inputs?job_id=${encodeURIComponent($('yieldJob').value)}&date=${encodeURIComponent($('yieldDate').value)}&tz=${encodeURIComponent(tz())}`), d = await r.json();
        if (!r.ok) throw Error(d.error); inputs = d;
        $('yieldTons').setAttribute('style', box(d.missing_tons || !d.ticket_count ? 'low' : ''));
        $('yieldTons').innerHTML = d.ticket_count ? `<strong>${d.tons} tons</strong> on ${d.ticket_count} saved ticket${d.ticket_count === 1 ? '' : 's'} for this job and date.${d.missing_tons ? ` <strong>${d.missing_tons} ticket${d.missing_tons === 1 ? ' has' : 's have'} no tons entered.</strong> Fix ${d.missing_tons === 1 ? 'it' : 'them'} in the Ticket Scanner first.` : ''}` : 'No saved delivery tickets for this job and date. Scan the day\'s tickets with the Ticket Scanner and link them to this job.';
        try { const tr = await ctx.api('/api/paving/takeoff?job_id=' + encodeURIComponent($('yieldJob').value)), td = tr.ok ? await tr.json() : null; if (td && td.totals && td.totals.area_sqft > 0) { $('yieldUseTakeoff').hidden = false; $('yieldUseTakeoff').textContent = `Use Satellite Takeoff Area (${td.totals.area_sqft.toLocaleString('en-US')} sq ft)`; $('yieldUseTakeoff').onclick = () => { $('yieldArea').value = td.totals.area_sqft; $('yieldAreaUnit').value = 'sqft'; areaSource = 'measured'; update(); }; } } catch {}
        if (d.measured_count) { $('yieldUseMeasured').hidden = false; $('yieldUseMeasured').textContent = `Use Measured Photo Areas (${d.measured_count} photo${d.measured_count === 1 ? '' : 's'}, ${d.measured_area_sqft} sq ft)`; }
      } catch (e) { $('yieldTons').textContent = 'The tickets could not be loaded.'; }
      update(); loadHistory();
    };
    const loadHistory = async () => {
      const job = $('yieldJob').value; if (!job) return;
      try {
        const r = await ctx.api('/api/paving/yield?job_id=' + encodeURIComponent(job)), d = await r.json(); if (!r.ok) throw Error();
        $('yieldHistory').innerHTML = (d.checks || []).map(c => { const x = c.result || {}; return `<div style="${box(x.status)}"><strong>${ctx.esc(c.check_day)}: ${statusText(x.status)}, ${x.yield_pct}% of plan</strong><br>${x.tons} tons, ${x.area_sy} sq yd${c.area_source === 'measured' ? ' (measured from photos)' : ''}, ${x.thickness_in} in planned, ${x.actual_lb_sy} lb/sy.${c.note ? '<br>' + ctx.esc(c.note) : ''} <button type="button" class="btn secondary slim" data-yield-delete="${c.id}">Delete</button></div>`; }).join('') || '<p>No yield checks saved for this job.</p>';
        $('yieldHistory').querySelectorAll('[data-yield-delete]').forEach(b => b.onclick = async () => {
          if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
          const r = await ctx.api('/api/paving/yield/' + b.dataset.yieldDelete, { method: 'DELETE' }); if (r.ok) { ctx.toast('Yield check deleted'); loadHistory(); } else ctx.toast('The yield check could not be deleted.');
        });
      } catch { $('yieldHistory').innerHTML = '<p>Saved yield checks could not be loaded.</p>'; }
    };
    $('yieldJob').onchange = load; $('yieldDate').onchange = load;
    $('yieldArea').oninput = () => { areaSource = 'entered'; update(); };
    for (const id of ['yieldThickness', 'yieldUnitWeight', 'yieldTolerance']) $(id).oninput = update;
    $('yieldAreaUnit').onchange = update;
    $('yieldUseMeasured').onclick = () => { if (!inputs) return; $('yieldArea').value = inputs.measured_area_sqft; $('yieldAreaUnit').value = 'sqft'; areaSource = 'measured'; update(); };
    $('yieldSave').onclick = async () => {
      const btn = $('yieldSave'); if (btn.disabled) return;
      const r = update(); if (r.status === 'incomplete') { ctx.toast(r.message); return; }
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        const res = await ctx.api('/api/paving/yield', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: $('yieldJob').value, check_date: $('yieldDate').value, tz: tz(), area: $('yieldArea').value, area_unit: $('yieldAreaUnit').value, area_source: areaSource, thickness_in: $('yieldThickness').value, unit_weight: $('yieldUnitWeight').value, tolerance_pct: $('yieldTolerance').value, note: $('yieldNote').value }) }), d = await res.json().catch(() => ({}));
        if (!res.ok) throw Error(d.error || 'The yield check could not be saved.');
        store.set('pn_paving_yield_thickness_v1', $('yieldThickness').value); store.set('pn_paving_yield_uw_v1', $('yieldUnitWeight').value); store.set('pn_paving_yield_tol_v1', $('yieldTolerance').value);
        ctx.toast('Yield check saved'); $('yieldNote').value = ''; loadHistory();
      } catch (e) { ctx.toast(e.message); } finally { btn.disabled = false; btn.textContent = 'Save Yield Check'; }
    };
    load();
  }
  window.PhotoNotesPavingQualityUI = { renderTemperature, renderYield, temperatureUnsaved, reset() { tempFile = null; tempDraft = null; } };
})();
