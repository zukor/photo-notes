// Admin and testing manager: Precision Measure field test, app measurements against tape measurements.
(()=>{
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct=v=>v==null?'None':`${Number(v).toFixed(1)}%`;
const inch=mm=>mm==null?'':(mm/25.4).toFixed(2)+' in';
window.PhotoNotesAdminPrecisionMeasure={mount(host,api){
 if(!host)return;
 host.innerHTML=`<style>#precisionMeasureHost,#precisionMeasureHost *{color:#000!important;text-align:left}#precisionMeasureHost button{background:#ffe600!important}#precisionMeasureHost table{width:100%;border-collapse:collapse}#precisionMeasureHost td,#precisionMeasureHost th{border-bottom:1px solid #000;padding:4px;vertical-align:top}</style>
 <details class="admin-section" data-admin-tool="precision-measure-validation"><summary id="precisionMeasureHeading">Precision Measure Field Test</summary><div class="admin-section-body" style="background:white">
 <p>Testers measure each pothole with a tape and with Precision Measure. Accuracy is 100% minus the difference as a share of the tape measurement, for length and width. The target is 20 potholes, a mix of clean and ragged edges.</p>
 <button type="button" class="btn" id="precisionMeasureRefresh">Refresh</button><div id="precisionMeasureResults" aria-live="polite">Loading...</div></div></details>`;
 const out=host.querySelector('#precisionMeasureResults');
 const block=(title,s)=>`<h3>${title}: ${s.measurements} measurement${s.measurements===1?'':'s'}</h3>${s.mean==null?'<p>No results yet.</p>':`<p>Average accuracy ${pct(s.mean)}. Worst ${pct(s.worst)}. Within 1%: ${pct(s.within1)} of readings. Within 2%: ${pct(s.within2)}. Within 5%: ${pct(s.within5)}.</p>`}`;
 async function load(){
  out.textContent='Loading...';
  try{
   const r=await api('/api/admin/precision-measure-validation');if(!r.ok)throw Error('Field test results could not be loaded');const d=await r.json();
   out.innerHTML=block('All',d.overall)+block('Clean or saw-cut edges',d.clean)+block('Ragged edges',d.ragged)+
    `<h3>Measurements</h3><table><thead><tr><th>When</th><th>Tester</th><th>Edges</th><th>App L × W</th><th>Tape L × W</th><th>Length</th><th>Width</th><th>Angle</th><th>Depth app / tape</th><th>Notes</th></tr></thead><tbody>${d.items.map(i=>`<tr><td>${escape(new Date(i.created_at).toLocaleString())}</td><td>${escape(i.name||'')}</td><td>${escape(i.edges)}</td><td>${inch(i.app_length_mm)} × ${inch(i.app_width_mm)}</td><td>${inch(i.tape_length_mm)} × ${inch(i.tape_width_mm)}</td><td>${pct(i.length_accuracy)}</td><td>${pct(i.width_accuracy)}</td><td>${i.tilt_deg==null?'':Number(i.tilt_deg).toFixed(1)+'°'}</td><td>${i.app_depth_in??''} / ${i.tape_depth_in??''}</td><td>${escape(i.note||'')}</td></tr>`).join('')||'<tr><td colspan="10">No field tests yet.</td></tr>'}</tbody></table>`;
  }catch(e){out.textContent=e.message;}
 }
 host.querySelector('#precisionMeasureRefresh').onclick=load;
 host.querySelector('details').addEventListener('toggle',e=>{if(e.target.open)load();},{once:true});
 out.textContent='Open this section to load results.';
}};
})();
