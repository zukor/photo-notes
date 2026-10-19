// Concrete Pro: Batch Ticket Scanner, Concrete Temperature Log and Concrete Yield Check screens.
(function () {
  'use strict';
  const R = () => window.PhotoNotesConcreteQuality;
  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago'; } catch { return 'America/Chicago'; } };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const jobOptions = (ctx, value, blank) => `<option value="">${blank}</option>` + (ctx.jobs || []).map(j => `<option value="${j.id}" ${String(j.id) === String(value || '') ? 'selected' : ''}>${ctx.esc(j.job_number ? j.job_number + ' - ' + j.name : j.name)}</option>`).join('');
  const bad = s => ['low', 'high', 'under', 'over', 'flagged'].includes(s), good = s => ['ok', 'on_target'].includes(s);
  const box = s => `border:2px solid #000;border-radius:8px;padding:10px;margin:10px 0;color:#000;background:${bad(s) ? '#ffe0e0' : good(s) ? '#e3f5e3' : '#fff'}`;
  const statusText = s => ({ ok: 'Within limits', low: 'BELOW MINIMUM', high: 'ABOVE MAXIMUM', recorded: 'Recorded', on_target: 'On target', over: 'Over plan', under: 'Under plan', incomplete: 'Not checked yet', flagged: 'FLAGGED' })[s] || s;
  function ensureStyle() {
    if (document.getElementById('concreteQualityStyle')) return;
    const st = document.createElement('style'); st.id = 'concreteQualityStyle';
    st.textContent = '.concrete-quality input[type=number],.concrete-quality input[type=date],.concrete-quality input[type=time]{width:100%;padding:12px;font-size:16px;color:#000;background:#fff;border:1px solid #000;border-radius:8px;font-family:inherit;min-height:48px;box-sizing:border-box}.concrete-quality .row.compact input[type=date]{width:auto}.concrete-quality .cq-areas label{display:block;margin:6px 0}';
    document.head.append(st);
  }
  function photoPicker(prefix, label) {
    return `<div class="row"><button type="button" class="btn cq-take" id="${prefix}Take">Take ${label} Photo</button><button type="button" class="btn secondary cq-choose" id="${prefix}Choose">Choose Existing Photo</button><button type="button" class="btn secondary cq-manual" id="${prefix}Manual">Enter by Hand</button></div>
      <input type="file" accept="image/*" capture="environment" class="cq-cam" id="${prefix}Cam" style="display:none"><input type="file" accept="image/*" class="cq-lib" id="${prefix}Lib" style="display:none">
      <div class="photo-box" id="${prefix}PreviewBox" style="display:none;margin-top:12px"><img id="${prefix}Preview" alt="${label} photo preview"></div><div class="status" id="${prefix}Status" aria-live="polite"></div>`;
  }
  function bindPicker(mount, ctx, prefix, onFile, onManual) {
    const $ = id => mount.querySelector('#' + id);
    $(prefix + 'Take').onclick = () => $(prefix + 'Cam').click();
    $(prefix + 'Choose').onclick = () => $(prefix + 'Lib').click();
    $(prefix + 'Manual').onclick = () => { $(prefix + 'PreviewBox').style.display = 'none'; onManual(); };
    const pick = e => { const file = e.target.files && e.target.files[0]; const camera = e.target.id === prefix + 'Cam'; e.target.value = ''; if (!file) return; $(prefix + 'Preview').src = URL.createObjectURL(file); $(prefix + 'PreviewBox').style.display = 'block'; onFile(file, camera); };
    $(prefix + 'Cam').onchange = pick; $(prefix + 'Lib').onchange = pick;
  }
  const checksHtml = (ctx, c) => !c ? '' : c.flags.length ? `<div style="${box('flagged')}"><strong>FLAGGED</strong><ul>${c.flags.map(f => `<li>${ctx.esc(f.message)}</li>`).join('')}</ul></div>` : c.minutes != null ? `<div style="${box('ok')}"><strong>Within limits.</strong> ${c.minutes} minutes from batching to ${ctx.esc(c.measured_to)}.</div>` : `<div style="${box('')}">Enter the batch time and the discharge or arrival time to check the 90-minute limit.</div>`;

  // ---------- Batch tickets ----------
  const TICKET_FIELDS = [['ticket_number', 'Ticket Number'], ['ticket_date', 'Ticket Date', 'date'], ['plant_name', 'Plant'], ['truck_number', 'Truck'], ['mix_code', 'Mix Code'], ['mix_description', 'Mix Description'], ['strength_psi', 'Strength (psi)', 'number'], ['load_yd3', 'This Load (cubic yards)', 'number'], ['slump_in', 'Slump (in)', 'number'], ['water_allowed_gal', 'Water Allowed on Site (gal)', 'number'], ['water_added_gal', 'Water Added on Site (gal)', 'number'], ['batch_time', 'Batch Time (for example 14:05)'], ['arrival_time', 'Arrival Time'], ['discharge_start', 'Discharge Start'], ['discharge_end', 'Discharge End'], ['concrete_temp_f', 'Concrete Temperature on Ticket (°F)', 'number']];
  let ticketDraft = null;
  function renderTicket(mount, ctx) {
    ensureStyle(); ticketDraft = null; mount.classList.add('concrete-quality');
    mount.innerHTML = `<div class="ticket-scan-panel"><label>Batch Ticket Photo</label><p>Photograph the whole ready-mix ticket, flat and straight on. PhotoNotes reads it, then checks the time from batching to discharge (90-minute limit) and the water added against the water allowed.</p>${photoPicker('ctk', 'Ticket')}</div>
      <div id="ctkReview"></div>
      <div class="formhead" style="margin-top:28px">Saved Batch Tickets</div>
      <div class="row compact"><label for="ctkDay">Date</label><input type="date" id="ctkDay" value="${today()}"><label for="ctkJobFilter">Job</label><select id="ctkJobFilter">${jobOptions(ctx, ctx.jobId, 'All jobs')}</select></div>
      <div id="ctkList"><p class="status">Loading...</p></div>`;
    const $ = id => mount.querySelector('#' + id);
    bindPicker(mount, ctx, 'ctk', async file => {
      $('ctkReview').innerHTML = ''; $('ctkStatus').textContent = 'Reading the ticket. This may take a moment.'; ctx.setBusy(['ctkTake', 'ctkChoose', 'ctkManual'], true);
      try {
        const fd = new FormData(); fd.append('photo', file);
        const r = await ctx.api('/api/concrete/tickets/scan', { method: 'POST', body: fd }), d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ticket) throw Error(d.error || 'The ticket could not be read.');
        ticketDraft = d.ticket; $('ctkStatus').textContent = d.ai_read ? 'Ticket read. Check every value against the photo, correct anything needed, then save.' : (d.ai_message || 'The ticket could not be read automatically. Enter the details, then save.');
        ticketReview(mount, ctx);
      } catch (e) { $('ctkStatus').textContent = e.message + ' Try again or choose another photo.'; }
      finally { ctx.setBusy(['ctkTake', 'ctkChoose', 'ctkManual'], false); }
    }, () => { $('ctkStatus').textContent = 'Take or choose a ticket photo first. The photo is kept as evidence.'; });
    $('ctkDay').onchange = () => loadTickets(mount, ctx); $('ctkJobFilter').onchange = () => loadTickets(mount, ctx);
    loadTickets(mount, ctx);
    if (ctx.ticketDraftId) openDraft(mount, ctx, ctx.ticketDraftId);
  }
  // A ticket photo attached to a placement photo was read into a draft. Show it for review here.
  async function openDraft(mount, ctx, id) {
    const $ = x => mount.querySelector('#' + x);
    $('ctkStatus').textContent = 'Loading the batch ticket read from your placement photo...';
    try {
      const r = await ctx.api('/api/concrete/tickets/' + encodeURIComponent(id)), d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ticket) throw Error(d.error || 'The batch ticket could not be loaded.');
      ticketDraft = d.ticket;
      if (d.ticket.photo_path) { $('ctkPreview').src = d.ticket.photo_path; $('ctkPreviewBox').style.display = 'block'; }
      $('ctkStatus').textContent = d.ticket.status === 'saved' ? 'This ticket is already saved. You can correct it and save again.' : 'Check every value against the ticket photo, correct anything needed, then save.';
      ticketReview(mount, ctx);
    } catch (e) { $('ctkStatus').textContent = e.message; }
  }
  async function placementOptions(ctx, jobId, selected) {
    const none = '<option value="">Not linked to a placement photo</option>';
    if (!jobId) return none;
    try {
      const r = await ctx.api('/api/concrete/placement-photos?job_id=' + encodeURIComponent(jobId)), d = r.ok ? await r.json() : { photos: [] };
      const label = p => [p.photo_title || (window.ConcreteCapture && window.ConcreteCapture.summary(p)) || String(p.concrete_stage || 'Photo').replaceAll('_', ' '), p.concrete_location, new Date(p.created_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean).join(', ');
      return none + d.photos.map(p => `<option value="${p.id}" ${String(p.id) === String(selected || '') ? 'selected' : ''}>${ctx.esc(label(p))}</option>`).join('');
    } catch { return none; }
  }
  function ticketReview(mount, ctx) {
    const t = ticketDraft, $ = id => mount.querySelector('#' + id), Q = R();
    $('ctkReview').innerHTML = `<section class="ticket-review-panel"><div class="formhead">Check and Save the Ticket</div><div class="status">AI confidence: <strong>${ctx.esc(t.confidence || 'low')}</strong>.</div>
      ${TICKET_FIELDS.map(([k, label, type]) => `<label for="ctk_${k}">${label}</label><input id="ctk_${k}" type="${type || 'text'}" ${type === 'number' ? 'inputmode="decimal" step="any"' : ''} value="${ctx.esc(t[k] == null ? '' : t[k])}">`).join('')}
      <label for="ctkJob">Job</label><select id="ctkJob">${jobOptions(ctx, t.job_id || ctx.jobId, 'No job selected')}</select>
      <label for="ctkPlacement">Placement Photo (optional)</label><select id="ctkPlacement"><option value="">Not linked to a placement photo</option></select>
      <p>Link the ticket to the photo of the pour it was used for. Only photos from the selected job are listed.</p>
      <div id="ctkChecks" aria-live="polite"></div>
      ${(t.confidence || 'low') === 'low' ? '<label class="feature-item"><input type="checkbox" id="ctkConfirm"> This ticket was hard to read. I checked every value against the photo.</label>' : ''}
      <button type="button" class="btn" id="ctkSave">Save Ticket</button></section>`;
    const values = () => Object.fromEntries(TICKET_FIELDS.map(([k]) => [k, $('ctk_' + k).value.trim()]));
    const update = () => { $('ctkChecks').innerHTML = checksHtml(ctx, Q.ticketChecks(values())); };
    TICKET_FIELDS.forEach(([k]) => $('ctk_' + k).oninput = update); update();
    const loadPlacement = async () => { $('ctkPlacement').innerHTML = await placementOptions(ctx, $('ctkJob').value, t.placement_capture_id); };
    $('ctkJob').onchange = loadPlacement; loadPlacement();
    $('ctkSave').onclick = async () => {
      const btn = $('ctkSave'); if (btn.disabled) return;
      if ($('ctkConfirm') && !$('ctkConfirm').checked) { ctx.toast('Check every value against the ticket photo, then tick the confirmation box.'); return; }
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        const r = await ctx.api('/api/concrete/tickets/' + t.id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values(), job_id: $('ctkJob').value, placement_capture_id: $('ctkPlacement').value, confirmed: !!$('ctkConfirm')?.checked }) }), d = await r.json().catch(() => ({}));
        if (!r.ok) throw Error(d.error || 'The ticket could not be saved.');
        ctx.toast(d.checks && d.checks.flags.length ? 'Saved. This load is flagged.' : 'Ticket saved');
        ticketDraft = null; $('ctkReview').innerHTML = ''; $('ctkPreviewBox').style.display = 'none'; $('ctkStatus').textContent = ''; loadTickets(mount, ctx);
      } catch (e) { ctx.toast(e.message); btn.disabled = false; btn.textContent = 'Save Ticket'; }
    };
  }
  async function loadTickets(mount, ctx) {
    const out = mount.querySelector('#ctkList'); if (!out) return;
    const job = mount.querySelector('#ctkJobFilter').value, day = mount.querySelector('#ctkDay').value;
    try {
      const r = await ctx.api(`/api/concrete/tickets?date=${encodeURIComponent(day)}&tz=${encodeURIComponent(tz())}${job ? '&job_id=' + encodeURIComponent(job) : ''}`), d = await r.json(); if (!r.ok) throw Error();
      out.innerHTML = d.tickets.length ? `<p><strong>${d.total_yd3} cubic yards on ${d.ticket_count} ticket${d.ticket_count === 1 ? '' : 's'}${d.flagged ? `, ${d.flagged} flagged` : ''}.</strong></p>` + d.tickets.map(t => `<div style="${box(t.checks.flags.length ? 'flagged' : t.checks.minutes != null ? 'ok' : '')}"><strong>Ticket ${ctx.esc(t.ticket_number || t.id)}</strong>${t.truck_number ? ', truck ' + ctx.esc(t.truck_number) : ''}: ${Number(t.load_yd3)} yd³ ${ctx.esc(t.mix_code || t.mix_description || '')}${t.slump_in != null ? ', slump ' + Number(t.slump_in) + ' in' : ''}${t.checks.minutes != null ? `, ${t.checks.minutes} min to ${ctx.esc(t.checks.measured_to)}` : ''}.${t.job_name ? ' ' + ctx.esc(t.job_name) + '.' : ''}${t.checks.flags.map(f => '<br><strong>' + ctx.esc(f.message) + '</strong>').join('')}${t.photo_path ? ` <a data-ctk-photo href="${ctx.esc(t.photo_path)}" target="_blank" rel="noopener">Photo</a>` : ''} <button type="button" class="btn secondary slim" data-ctk-delete="${t.id}">Delete</button></div>`).join('') : '<p>No tickets for this date.</p>';
      out.querySelectorAll('[data-ctk-delete]').forEach(b => b.onclick = async () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
        const r = await ctx.api('/api/concrete/tickets/' + b.dataset.ctkDelete, { method: 'DELETE' }); if (r.ok) { ctx.toast('Ticket deleted'); loadTickets(mount, ctx); } else ctx.toast('The ticket could not be deleted.');
      });
    } catch { out.innerHTML = '<p>Saved tickets could not be loaded.</p>'; }
  }

  // ---------- Temperature log ----------
  const limitsKey = jobId => 'pn_concrete_temp_limits_v2:' + (jobId ? String(jobId) : 'no-job');
  function jobLimits(jobId) {
    let v = null; try { v = JSON.parse(store.get(limitsKey(jobId)) || 'null'); } catch {}
    v = v && typeof v === 'object' ? v : {};
    return { section: String(v.section || ''), minimum: String(v.minimum || ''), maximum: String(v.maximum || '') };
  }
  function saveJobLimits(jobId, v) { store.set(limitsKey(jobId), JSON.stringify(v)); }
  let tempDraft = null;
  function renderTemperature(mount, ctx) {
    ensureStyle(); tempDraft = null; mount.classList.add('concrete-quality');
    mount.innerHTML = `<div class="ticket-scan-panel"><label>Thermometer Photo</label><p>Photograph the thermometer display right after the reading. PhotoNotes reads the number and checks it against the limits for the section.</p>
      <details><summary>How to take an accurate reading</summary><ul><li>Use a probe thermometer pushed at least 3 in into fresh concrete from the chute or in the forms (ASTM C1064), and wait for the reading to settle.</li><li>An infrared thermometer reads only the surface; use it for subgrade and form surfaces.</li><li>Fill the photo with the display, held steady, with no glare.</li></ul></details>
      ${photoPicker('ctp', 'Thermometer')}</div><div id="ctpReview"></div>
      <div class="formhead" style="margin-top:28px">Concrete Temperature Log</div>
      <div class="row compact"><label for="ctpDay">Date</label><input type="date" id="ctpDay" value="${today()}"><label for="ctpJobFilter">Job</label><select id="ctpJobFilter">${jobOptions(ctx, ctx.jobId, 'All jobs')}</select></div><div id="ctpLog"><p class="status">Loading...</p></div>`;
    const $ = id => mount.querySelector('#' + id);
    bindPicker(mount, ctx, 'ctp', async (file, camera) => {
      $('ctpReview').innerHTML = ''; $('ctpStatus').textContent = 'Reading the thermometer display...'; ctx.setBusy(['ctpTake', 'ctpChoose', 'ctpManual'], true);
      try {
        const fd = new FormData(); fd.append('photo', file); fd.append('taken_at', new Date(camera ? Date.now() : (file.lastModified || Date.now())).toISOString());
        const loc = await ctx.photoLocation(file, camera).catch(() => null); if (loc) { fd.append('latitude', loc.lat); fd.append('longitude', loc.lng); }
        const r = await ctx.api('/api/concrete/temperatures/scan', { method: 'POST', body: fd }), d = await r.json().catch(() => ({}));
        if (!r.ok || !d.reading) throw Error(d.error || 'The photo could not be read.');
        tempDraft = d.reading; $('ctpStatus').textContent = d.ai_read ? `Read ${Number(d.reading.reading_f)}°F. Check it against the photo, then save.` : (d.ai_message || 'The display could not be read. Enter the reading, then save.');
        tempReview(mount, ctx);
      } catch (e) { $('ctpStatus').textContent = e.message + ' You can enter the reading by hand.'; tempDraft = {}; tempReview(mount, ctx); }
      finally { ctx.setBusy(['ctpTake', 'ctpChoose', 'ctpManual'], false); }
    }, () => { tempDraft = {}; $('ctpStatus').textContent = 'Enter the reading below.'; tempReview(mount, ctx); });
    $('ctpDay').onchange = () => loadTemps(mount, ctx); $('ctpJobFilter').onchange = () => loadTemps(mount, ctx);
    loadTemps(mount, ctx);
  }
  async function ticketOptions(ctx, jobId, selected) {
    if (!jobId) return '<option value="">No ticket</option>';
    try { const r = await ctx.api(`/api/concrete/tickets?date=${today()}&job_id=${encodeURIComponent(jobId)}&tz=${encodeURIComponent(tz())}`), d = r.ok ? await r.json() : { tickets: [] }; return '<option value="">No ticket</option>' + d.tickets.map(t => `<option value="${t.id}" ${String(t.id) === String(selected || '') ? 'selected' : ''}>${ctx.esc(['Ticket ' + (t.ticket_number || t.id), t.truck_number && 'truck ' + t.truck_number].filter(Boolean).join(', '))}</option>`).join(''); } catch { return '<option value="">No ticket</option>'; }
  }
  function tempReview(mount, ctx) {
    const t = tempDraft || {}, Q = R(), $ = id => mount.querySelector('#' + id);
    const startJob = t.job_id || ctx.jobId || '', saved = jobLimits(startJob);
    const section = t.section || saved.section, kind = t.kind || 'delivery';
    $('ctpReview').innerHTML = `<section class="ticket-review-panel"><div class="formhead">Check and Save the Reading</div>
      <label for="ctpReading">Temperature (°F)</label><input id="ctpReading" type="number" inputmode="decimal" step="0.1" value="${t.reading_f ?? ''}">
      <label for="ctpKind">What Was Measured</label><select id="ctpKind">${Q.KINDS.map(k => `<option value="${k.id}" ${k.id === kind ? 'selected' : ''}>${k.label}</option>`).join('')}</select>
      <label for="ctpSection">Section Thickness</label><select id="ctpSection"><option value="">Choose the thickness</option>${Q.SECTIONS.map(s => `<option value="${s.id}" ${s.id === section ? 'selected' : ''}>${s.label}, ${s.minimum_f}°F minimum</option>`).join('')}</select>
      <label for="ctpMinimum">Project Minimum (°F, optional; leave blank to use the suggested minimum)</label><input id="ctpMinimum" type="number" inputmode="decimal" value="${ctx.esc(saved.minimum)}">
      <label for="ctpMaximum">Project Maximum (°F, optional; leave blank to use ${Q.MAX_TEMP_F}°F)</label><input id="ctpMaximum" type="number" inputmode="decimal" value="${ctx.esc(saved.maximum)}">
      <label for="ctpJob">Job</label><select id="ctpJob">${jobOptions(ctx, startJob, 'No job selected')}</select>
      <label for="ctpTicket">Batch Ticket</label><select id="ctpTicket"><option value="">No ticket</option></select>
      <label for="ctpWhere">Where (pour, grid line or area)</label><input id="ctpWhere" type="text" maxlength="200" value="${ctx.esc(t.location_note || '')}">
      <label for="ctpNote">Note</label><textarea id="ctpNote" maxlength="1000">${ctx.esc(t.note || '')}</textarea>
      <div id="ctpCheck" aria-live="polite"></div>
      <p>Suggested limits: ACI 306 minimum temperature as placed for the section thickness, and the ACI 305.1 maximum of ${Q.MAX_TEMP_F}°F. Your project specification governs; enter its limits above if they differ.</p>
      <div class="row"><button type="button" class="btn" id="ctpSave">Save Reading</button><button type="button" class="btn secondary" id="ctpCancel">Cancel</button></div></section>`;
    const update = () => { const c = Q.temperatureCheck({ reading_f: $('ctpReading').value, kind: $('ctpKind').value, section: $('ctpSection').value, minimum_f: $('ctpMinimum').value, maximum_f: $('ctpMaximum').value }); $('ctpCheck').setAttribute('style', box(c.status)); $('ctpCheck').innerHTML = `<strong>${statusText(c.status)}</strong> ${ctx.esc(c.message)}`; };
    const loadT = async () => { $('ctpTicket').innerHTML = await ticketOptions(ctx, $('ctpJob').value, t.ticket_id); };
    for (const id of ['ctpReading', 'ctpMinimum', 'ctpMaximum']) $(id).oninput = update;
    for (const id of ['ctpKind', 'ctpSection']) $(id).onchange = update;
    // Section thickness and project limits are remembered for each job.
    // Values the user already changed in this reading are kept when the job changes.
    let limitsTouched = false; for (const id of ['ctpSection', 'ctpMinimum', 'ctpMaximum']) $(id).addEventListener(id === 'ctpSection' ? 'change' : 'input', () => { limitsTouched = true; });
    $('ctpJob').onchange = () => { if (!limitsTouched) { const v = jobLimits($('ctpJob').value); $('ctpSection').value = v.section; $('ctpMinimum').value = v.minimum; $('ctpMaximum').value = v.maximum; update(); } loadT(); }; loadT(); update();
    $('ctpCancel').onclick = () => { tempDraft = null; $('ctpReview').innerHTML = ''; $('ctpPreviewBox').style.display = 'none'; $('ctpStatus').textContent = ''; };
    $('ctpSave').onclick = async () => {
      const btn = $('ctpSave'); if (btn.disabled) return;
      const body = { reading_f: $('ctpReading').value, kind: $('ctpKind').value, section: $('ctpSection').value || null, minimum_f: $('ctpMinimum').value, maximum_f: $('ctpMaximum').value, job_id: $('ctpJob').value, ticket_id: $('ctpTicket').value, location_note: $('ctpWhere').value, note: $('ctpNote').value };
      if (!body.reading_f) { ctx.toast('Enter the temperature reading.'); return; }
      if (!t.id) { const loc = await ctx.location().catch(() => null); if (loc) { body.latitude = loc.lat; body.longitude = loc.lng; } }
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        const r = await ctx.api(t.id ? '/api/concrete/temperatures/' + t.id : '/api/concrete/temperatures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), d = await r.json().catch(() => ({}));
        if (!r.ok) throw Error(d.error || 'The reading could not be saved.');
        saveJobLimits(body.job_id, { section: body.section || '', minimum: body.minimum_f || '', maximum: body.maximum_f || '' });
        ctx.toast(['low', 'high'].includes(d.check && d.check.status) ? 'Saved. This reading is outside the limits.' : 'Temperature saved');
        tempDraft = null; $('ctpReview').innerHTML = ''; $('ctpPreviewBox').style.display = 'none'; $('ctpStatus').textContent = ''; loadTemps(mount, ctx);
      } catch (e) { ctx.toast(e.message); btn.disabled = false; btn.textContent = 'Save Reading'; }
    };
  }
  async function loadTemps(mount, ctx) {
    const out = mount.querySelector('#ctpLog'); if (!out) return;
    const job = mount.querySelector('#ctpJobFilter').value, day = mount.querySelector('#ctpDay').value, Q = R();
    try {
      const r = await ctx.api(`/api/concrete/temperatures?date=${encodeURIComponent(day)}&tz=${encodeURIComponent(tz())}${job ? '&job_id=' + encodeURIComponent(job) : ''}`), d = await r.json(); if (!r.ok) throw Error();
      out.innerHTML = d.readings.length ? `<p><strong>${d.readings.length} reading${d.readings.length === 1 ? '' : 's'}${d.summary.out_of_range ? `, ${d.summary.out_of_range} outside the limits` : ''}.</strong></p>` + d.readings.map(t => `<div style="${box(t.check_status)}"><strong>${Number(t.reading_f)}°F</strong> ${ctx.esc((Q.KINDS.find(k => k.id === t.kind) || {}).label || t.kind)}, ${new Date(t.taken_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. ${statusText(t.check_status)}.${t.ticket_number ? ' Ticket ' + ctx.esc(t.ticket_number) + '.' : ''}${t.location_note ? ' ' + ctx.esc(t.location_note) + '.' : ''}${t.photo_path ? ` <a data-ctp-photo href="${ctx.esc(t.photo_path)}" target="_blank" rel="noopener">Photo</a>` : ''} <button type="button" class="btn secondary slim" data-ctp-delete="${t.id}">Delete</button></div>`).join('') : '<p>No readings for this date.</p>';
      out.querySelectorAll('[data-ctp-delete]').forEach(b => b.onclick = async () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
        const r = await ctx.api('/api/concrete/temperatures/' + b.dataset.ctpDelete, { method: 'DELETE' }); if (r.ok) { ctx.toast('Reading deleted'); loadTemps(mount, ctx); } else ctx.toast('The reading could not be deleted.');
      });
    } catch { out.innerHTML = '<p>The temperature log could not be loaded.</p>'; }
  }

  // ---------- Yield ----------
  function renderYield(mount, ctx) {
    ensureStyle(); mount.classList.add('concrete-quality'); const Q = R();
    mount.innerHTML = `<section class="ticket-review-panel"><p>Check the day's pour while the crew is still on site. PhotoNotes adds the cubic yards on the saved batch tickets and compares them with the placed area times the planned thickness.</p>
      <label for="cyJob">Job</label><select id="cyJob">${jobOptions(ctx, ctx.jobId, 'Choose a job')}</select>
      <label for="cyDate">Pour Date</label><input type="date" id="cyDate" value="${today()}">
      <div id="cyYards" style="${box('')}">Choose a job to load the day's tickets.</div>
      <div id="cyAreas" class="cq-areas"></div>
      <label for="cyArea">Placed Area (sq ft)</label><input id="cyArea" type="number" inputmode="decimal" step="0.1" min="0">
      <label for="cyThickness">Planned Thickness (in)</label><input id="cyThickness" type="number" inputmode="decimal" step="0.25" min="0" value="${store.get('pn_concrete_yield_thickness_v1') || ''}">
      <label for="cyWaste">Allowance for Waste and Subgrade (%)</label><input id="cyWaste" type="number" inputmode="decimal" step="0.5" value="${store.get('pn_concrete_yield_waste_v1') || 10}">
      <label for="cyNote">Note</label><textarea id="cyNote" maxlength="1000"></textarea>
      <div id="cyResult" aria-live="polite"></div>
      <button type="button" class="btn" id="cySave">Save Yield Check</button></section>
      <div class="formhead" style="margin-top:28px">Saved Yield Checks</div><div id="cyHistory"><p>Choose a job to see its yield checks.</p></div>`;
    const $ = id => mount.querySelector('#' + id); let inputs = null, areaSource = 'entered';
    const update = () => {
      const r = Q.yieldCheck({ yards: inputs && inputs.yards, area_sqft: $('cyArea').value, thickness_in: $('cyThickness').value, waste_pct: $('cyWaste').value });
      $('cyResult').setAttribute('style', box(r.status));
      $('cyResult').innerHTML = r.status === 'incomplete' ? `<strong>${statusText(r.status)}</strong> ${ctx.esc(r.message)}` : `<strong>${statusText(r.status)}: ${r.difference_pct > 0 ? '+' : ''}${r.difference_pct}%</strong><br>${r.yards} yd³ delivered, ${r.design_yards} yd³ planned. That is about ${r.implied_thickness_in} in average.<br>${ctx.esc(r.message)}`;
      return r;
    };
    const sumAreas = () => { const boxes = [...mount.querySelectorAll('[data-cy-area]')].filter(b => b.checked); if (!boxes.length) return; $('cyArea').value = Math.round(boxes.reduce((s, b) => s + Number(b.dataset.cyArea), 0) * 10) / 10; areaSource = 'areas'; update(); };
    const load = async () => {
      inputs = null; $('cyAreas').innerHTML = '';
      if (!$('cyJob').value) { $('cyYards').textContent = 'Choose a job to load the day\'s tickets.'; update(); return; }
      try {
        const r = await ctx.api(`/api/concrete/yield/inputs?job_id=${encodeURIComponent($('cyJob').value)}&date=${encodeURIComponent($('cyDate').value)}&tz=${encodeURIComponent(tz())}`), d = await r.json(); if (!r.ok) throw Error(); inputs = d;
        $('cyYards').setAttribute('style', box(d.ticket_count ? '' : 'flagged'));
        $('cyYards').innerHTML = d.ticket_count ? `<strong>${d.yards} cubic yards</strong> on ${d.ticket_count} saved batch ticket${d.ticket_count === 1 ? '' : 's'} for this job and date.` : 'No saved batch tickets for this job and date. Scan the day\'s tickets with the Batch Ticket Scanner and link them to this job.';
        $('cyAreas').innerHTML = d.areas.length ? '<p><strong>Saved areas for this job.</strong> Tick the ones poured today:</p>' + d.areas.map(a => `<label><input type="checkbox" data-cy-area="${a.area_sqft}"> ${ctx.esc(a.name)}: ${a.area_sqft} sq ft (${a.source === 'field' ? 'field measured' : 'from map'})</label>`).join('') : '';
        mount.querySelectorAll('[data-cy-area]').forEach(b => b.onchange = sumAreas);
      } catch { $('cyYards').textContent = 'The tickets could not be loaded.'; }
      update(); loadHistory();
    };
    const loadHistory = async () => {
      const job = $('cyJob').value; if (!job) return;
      try {
        const r = await ctx.api('/api/concrete/yield?job_id=' + encodeURIComponent(job)), d = await r.json(); if (!r.ok) throw Error();
        $('cyHistory').innerHTML = d.checks.map(c => { const x = c.result || {}; return `<div style="${box(x.status)}"><strong>${ctx.esc(c.check_day)}: ${statusText(x.status)}, ${x.difference_pct > 0 ? '+' : ''}${x.difference_pct}%</strong><br>${x.yards} yd³ for ${x.area_sqft} sq ft at ${x.thickness_in} in (${x.design_yards} yd³ planned).${c.note ? '<br>' + ctx.esc(c.note) : ''} <button type="button" class="btn secondary slim" data-cy-delete="${c.id}">Delete</button></div>`; }).join('') || '<p>No yield checks saved for this job.</p>';
        $('cyHistory').querySelectorAll('[data-cy-delete]').forEach(b => b.onclick = async () => {
          if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
          const r = await ctx.api('/api/concrete/yield/' + b.dataset.cyDelete, { method: 'DELETE' }); if (r.ok) { ctx.toast('Yield check deleted'); loadHistory(); } else ctx.toast('The yield check could not be deleted.');
        });
      } catch { $('cyHistory').innerHTML = '<p>Saved yield checks could not be loaded.</p>'; }
    };
    $('cyJob').onchange = load; $('cyDate').onchange = load;
    $('cyArea').oninput = () => { areaSource = 'entered'; update(); };
    for (const id of ['cyThickness', 'cyWaste']) $(id).oninput = update;
    $('cySave').onclick = async () => {
      const btn = $('cySave'); if (btn.disabled) return; const r = update(); if (r.status === 'incomplete') { ctx.toast(r.message); return; }
      btn.disabled = true; btn.textContent = 'Saving...';
      try {
        const res = await ctx.api('/api/concrete/yield', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: $('cyJob').value, check_date: $('cyDate').value, tz: tz(), area_sqft: $('cyArea').value, area_source: areaSource, thickness_in: $('cyThickness').value, waste_pct: $('cyWaste').value, note: $('cyNote').value }) }), d = await res.json().catch(() => ({}));
        if (!res.ok) throw Error(d.error || 'The yield check could not be saved.');
        store.set('pn_concrete_yield_thickness_v1', $('cyThickness').value); store.set('pn_concrete_yield_waste_v1', $('cyWaste').value);
        ctx.toast('Yield check saved'); $('cyNote').value = ''; loadHistory();
      } catch (e) { ctx.toast(e.message); } finally { btn.disabled = false; btn.textContent = 'Save Yield Check'; }
    };
    load();
  }
  window.PhotoNotesConcreteQualityUI = { renderTicket, renderTemperature, renderYield, jobLimits, limitsKey, unsaved: () => !!(ticketDraft || tempDraft) };
})();
