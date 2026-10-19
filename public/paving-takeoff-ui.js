// Paving Pro Satellite Takeoff: parking lots, streets and curb lines traced on satellite imagery, with square yards and tons by job.
(function () {
  'use strict';
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const n = v => Math.round(Number(v) || 0).toLocaleString('en-US');
  const box = 'border:2px solid #000;border-radius:8px;padding:10px;margin:10px 0;color:#000;background:#fff';
  function render(mount, ctx) {
    mount.innerHTML = `<div style="color:#000">
      <p>Trace parking lots, streets and curb lines on satellite imagery to get square yards and tons for a bid, from one lot to a whole neighborhood. Check one side with a tape on site to make it bid-ready.</p>
      <label for="ptoJob">Job</label><select id="ptoJob"><option value="">Choose a job</option>${(ctx.jobs || []).map(j => `<option value="${j.id}" ${String(j.id) === String(ctx.jobId || '') ? 'selected' : ''}>${ctx.esc(j.job_number ? j.job_number + ' - ' + j.name : j.name)}</option>`).join('')}</select>
      <div class="row"><button type="button" class="btn" id="ptoMeasure">Measure from Satellite</button><button type="button" class="btn secondary" id="ptoCsv">Download Spreadsheet</button></div>
      <div class="row compact"><div><label for="ptoThick">Asphalt Thickness (in)</label><input type="number" inputmode="decimal" id="ptoThick" value="${store.get('pn_pto_thick_v1') || 2}"></div>
      <div><label for="ptoUw">Mix Weight (lb per sq yd per inch)</label><input type="number" inputmode="decimal" id="ptoUw" value="${store.get('pn_pto_uw_v1') || 110}"></div>
      <div><label for="ptoWaste">Extra to Order (%)</label><input type="number" inputmode="decimal" id="ptoWaste" value="${store.get('pn_pto_waste_v1') || 5}"></div></div>
      <div id="ptoTotals"></div><div id="ptoItems"><p>Choose a job.</p></div></div>`;
    const $ = id => mount.querySelector('#' + id);
    const q = () => `job_id=${encodeURIComponent($('ptoJob').value)}&thickness_in=${encodeURIComponent($('ptoThick').value)}&lb_sy_in=${encodeURIComponent($('ptoUw').value)}&waste_pct=${encodeURIComponent($('ptoWaste').value)}`;
    const show = d => {
      const t = d.totals;
      $('ptoTotals').innerHTML = d.items.length ? `<div style="${box}"><strong>${n(t.area_sy)} sq yd</strong> (${n(t.area_sqft)} sq ft) of paving. With the measurement allowance: ${n(t.adjusted_sy)} sq yd.<br><strong>${n(t.tons)} tons</strong> of asphalt to order at ${t.thickness_in} in (${t.tons_placed} tons placed, plus ${t.waste_pct}%).${t.street_ft ? `<br>${n(t.street_ft)} ft of street.` : ''}${t.line_ft ? `<br>${n(t.line_ft)} ft of curb, edge or striping lines.` : ''}<br>${t.checked ? 'Every item is checked with a tape (3% allowance).' : 'Items not checked with a tape carry a 10% allowance. Check one side on site to reduce it to 3%.'}</div>` : '';
      $('ptoItems').innerHTML = d.items.length ? d.items.map(i => `<div style="${box}"><strong>${ctx.esc(i.name)}</strong> (${i.kind === 'street' ? 'street' : i.kind === 'line' ? 'line' : 'area'}): ${i.area_sqft ? n(i.area_sqft / 9) + ' sq yd' : ''}${i.length_ft ? (i.area_sqft ? ', ' : '') + n(i.length_ft) + ' ft long' : ''}${i.width_ft ? ` x ${Number(i.width_ft)} ft wide` : ''}. ${i.checked ? 'Checked with a tape.' : 'From satellite.'} ${i.capture_id ? '<span>Picture saved to the job.</span>' : ''} <button type="button" class="btn secondary slim" data-pto-remove="${i.id}">Remove</button></div>`).join('') : '<p>No takeoff items for this job yet. Tap Measure from Satellite.</p>';
      mount.querySelectorAll('[data-pto-remove]').forEach(b => b.onclick = async () => {
        if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to remove'; return; }
        const r = await ctx.api('/api/paving/takeoff/' + b.dataset.ptoRemove, { method: 'DELETE' }); if (r.ok) load(); else ctx.toast('The item could not be removed.');
      });
    };
    const load = async () => {
      if (!$('ptoJob').value) { $('ptoItems').innerHTML = '<p>Choose a job.</p>'; $('ptoTotals').innerHTML = ''; return; }
      try { const r = await ctx.api('/api/paving/takeoff?' + q()), d = await r.json(); if (!r.ok) throw Error(d.error); show(d); } catch (e) { $('ptoItems').innerHTML = `<p>${ctx.esc(e.message || 'The takeoff could not be loaded.')}</p>`; }
    };
    for (const [id, key] of [['ptoThick', 'pn_pto_thick_v1'], ['ptoUw', 'pn_pto_uw_v1'], ['ptoWaste', 'pn_pto_waste_v1']]) $(id).onchange = () => { store.set(key, $(id).value); load(); };
    $('ptoJob').onchange = load;
    $('ptoMeasure').onclick = () => {
      const job = $('ptoJob').value; if (!job) { ctx.toast('Choose a job first.'); return; }
      const j = (ctx.jobs || []).find(x => String(x.id) === job);
      ctx.satellite({ title: 'Satellite Takeoff', address: j && j.address, types: ['area', 'street', 'line'], defaultWidth: 28,
        onSave: async payload => { const r = await ctx.api('/api/paving/takeoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, job_id: job, thickness_in: $('ptoThick').value, lb_sy_in: $('ptoUw').value, waste_pct: $('ptoWaste').value }) }), d = await r.json().catch(() => ({})); if (!r.ok) throw Error(d.error || 'The takeoff could not be saved.'); ctx.toast(d.picture_failed ? 'Saved. The satellite picture could not be made.' : 'Takeoff saved'); show(d); } });
    };
    $('ptoCsv').onclick = async () => {
      if (!$('ptoJob').value) { ctx.toast('Choose a job first.'); return; }
      try { const r = await ctx.api('/api/paving/takeoff.csv?' + q()); if (!r.ok) throw Error(); const blob = await r.blob(), name = `paving-takeoff-job-${$('ptoJob').value}.csv`; ctx.downloadBlob(new File([blob], name, { type: blob.type }), name); } catch { ctx.toast('The spreadsheet could not be created.'); }
    };
    load();
  }
  window.PhotoNotesPavingTakeoffUI = { render };
})();
