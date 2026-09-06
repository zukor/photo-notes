let concreteFootprintPhotoId=null,concreteFootprintMap=null;
function openConcreteFootprints(id){concreteFootprintPhotoId=id||null;state.view='map';renderApp();}
function concreteAreaText(f){
  const fmt=n=>Number(n).toLocaleString(uiLocale(),{maximumFractionDigits:1});
  return `${f.map_area_sqft!=null?`Map estimate: ${fmt(f.map_area_sqft)} sq ft`:''}${f.map_area_sqft!=null&&f.field_area_sqft!=null?' · ':''}${f.field_area_sqft!=null?`Field dimensions (${f.field_method==='laser'?'laser':'tape'}): ${fmt(f.field_length_ft)} × ${fmt(f.field_width_ft)} ft = ${fmt(f.field_area_sqft)} sq ft (rectangle)`:''}`;
}
async function renderConcreteFootprintMap(){
  if(concreteFootprintMap){concreteFootprintMap.remove();concreteFootprintMap=null;}
  const body=document.getElementById('body');body.className='workflow-organize';
  body.innerHTML=`<section id="concreteAreaScreen"><button class="backlink" id="areaBack">← Organize</button><div class="workflow-intro"><strong>Patio & Foundation Areas</strong><span>Draw an overhead footprint, add field dimensions, and save the measurements with a photo.</span></div><p class="status">Map areas are estimates of the overhead footprint, not sloped surface area. Imagery may be outdated. Check dimensions on site before construction.</p><label for="areaPhoto">Saved photo</label><select id="areaPhoto"><option value="">Loading photos...</option></select><div id="areaPhotoPreview"></div><p id="areaStatus" role="status" aria-live="polite"></p><div id="areaEditor" hidden><label for="areaName">Area name</label><input id="areaName" maxlength="120" placeholder="Backyard patio or proposed foundation"><div class="row" style="flex-wrap:wrap;gap:8px;margin-top:12px"><button class="btn secondary" id="areaPhotoLocation">Photo Location</button><button class="btn secondary" id="areaMyLocation">My Location</button><button class="btn secondary" id="areaTrace">Trace Area</button><button class="btn secondary" id="areaUndo">Undo Corner</button><button class="btn secondary" id="areaClear">Clear Outline</button><button class="btn" id="areaFinish">Finish Outline</button></div><p id="areaMapStatus" class="status" role="status">Loading overhead map...</p><div id="areaMap" style="height:52vh;min-height:300px;border:1px solid #1d4ed8;border-radius:8px"></div><p id="areaReadout" role="status" aria-live="polite"></p><fieldset style="border:1px solid #ccc;border-radius:8px;padding:12px;margin:14px 0"><legend>Field-measured rectangle (optional)</legend><p class="status">Enter tape or laser measurements in decimal feet. This calculates a rectangle; it does not rescale the map outline. For an L-shaped layout, save each rectangle separately.</p><div class="organize-form-grid"><div><label for="areaLength">Length (feet)</label><input id="areaLength" type="number" min="0.01" max="10000" step="any" inputmode="decimal"></div><div><label for="areaWidth">Width (feet)</label><input id="areaWidth" type="number" min="0.01" max="10000" step="any" inputmode="decimal"></div></div><label for="areaMethod">Measured with</label><select id="areaMethod"><option value="tape">Tape measure</option><option value="laser">Laser measure</option></select><p id="areaFieldReadout" role="status"></p></fieldset><label for="areaNotes">Measurement notes (optional)</label><textarea id="areaNotes" maxlength="2000" placeholder="Who measured it, date, or layout details"></textarea><div class="row" style="gap:8px;flex-wrap:wrap;margin:12px 0"><button class="btn" id="areaSave">Save Area with Photo</button><button class="btn secondary" id="areaNew">New Area</button></div><h3>Saved areas for this photo</h3><div id="areaSaved"></div></div></section>`;
  const root=document.getElementById('concreteAreaScreen'),q=id=>root.querySelector('#'+id),status=q('areaStatus');
  let photos=[],areas=[],points=[],markers=[],outline=null,tracing=false,editing=null,map=null,photoMarker=null;
  q('areaBack').onclick=()=>{state.view='organize';renderApp();};
  try{
    const [pr,ar]=await Promise.all([api('/api/captures?has_photo=1'),api('/api/concrete/footprints')]);
    if(!pr.ok||!ar.ok)throw new Error('Photos or saved areas could not be loaded. Return to Organize and try again.');
    photos=(await pr.json()).filter(c=>c.photo_path);areas=await ar.json();
  }catch(e){status.textContent=e.message;return;}
  if(!root.isConnected)return;
  q('areaPhoto').innerHTML=photos.length?photos.map(c=>`<option value="${c.id}">${esc(c.photo_title||c.note?.slice(0,65)||'Photo '+c.id)}</option>`).join(''):'<option value="">No saved photos</option>';
  if(!photos.length){status.textContent='Take and save a photo in Capture first, then open Patio & Foundation Areas.';return;}
  if(photos.some(c=>c.id===concreteFootprintPhotoId))q('areaPhoto').value=String(concreteFootprintPhotoId);
  q('areaEditor').hidden=false;
  const selected=()=>photos.find(c=>c.id===Number(q('areaPhoto').value));
  function draw(){
    if(map){markers.forEach(m=>m.remove());markers=[];if(outline){outline.remove();outline=null;}
      if(points.length>=2)outline=(points.length>=3?L.polygon(points.map(p=>[p.lat,p.lng]),{color:'#1d4ed8'}):L.polyline(points.map(p=>[p.lat,p.lng]),{color:'#1d4ed8'})).addTo(map);
      points.forEach((p,i)=>{const m=L.marker([p.lat,p.lng],{draggable:true,keyboard:true,title:'Area corner '+(i+1)}).addTo(map);m.on('dragend',()=>{const ll=m.getLatLng();points[i]={lat:ll.lat,lng:ll.lng};draw();});markers.push(m);});
    }
    const a=clientPolygonAreaSqft(points);q('areaReadout').textContent=points.length>=3?`Map estimate: ${Number(a).toLocaleString(uiLocale(),{maximumFractionDigits:1})} sq ft · ${points.length} corners`:`${points.length} corners. Tap Trace Area, then place at least three corners on the map.`;
    q('areaFinish').disabled=!tracing||points.length<3;q('areaUndo').disabled=!points.length;q('areaClear').disabled=!points.length;
  }
  function fieldReadout(){const l=Number(q('areaLength').value),w=Number(q('areaWidth').value);q('areaFieldReadout').textContent=l>0&&w>0?`Field-dimension area: ${(l*w).toLocaleString(uiLocale(),{maximumFractionDigits:1})} sq ft (rectangle; user-entered measurements)`:'Enter both dimensions to calculate the field-dimension area.';}
  function locatePhoto(){if(!map)return;const c=selected();if(c.latitude!=null&&c.longitude!=null){map.setView([Number(c.latitude),Number(c.longitude)],20);q('areaMapStatus').textContent='Centered on the photo GPS location. Pan and zoom to the proposed footprint.';}else q('areaMapStatus').textContent='This photo has no GPS. Use My Location while on site, or pan and zoom to the property.';}
  function reset(){editing=null;points=[];tracing=false;q('areaName').value='';q('areaLength').value='';q('areaWidth').value='';q('areaMethod').value='tape';q('areaNotes').value='';q('areaSave').textContent='Save Area with Photo';q('areaTrace').textContent='Trace Area';draw();fieldReadout();}
  function savedList(){const list=areas.filter(f=>f.capture_id===selected().id);q('areaSaved').innerHTML=list.length?list.map(f=>`<article class="card"><strong>${esc(f.name)}</strong><p>${esc(concreteAreaText(f))}</p>${f.notes?`<p>${esc(f.notes)}</p>`:''}<button class="btn secondary" data-area-edit="${f.id}">View / Edit Area</button></article>`).join(''):'<p class="status">No saved areas for this photo.</p>';q('areaSaved').querySelectorAll('[data-area-edit]').forEach(b=>b.onclick=()=>{const f=list.find(x=>x.id===Number(b.dataset.areaEdit));reset();editing=f.id;points=f.points.map(p=>({...p}));q('areaName').value=f.name;q('areaLength').value=f.field_length_ft??'';q('areaWidth').value=f.field_width_ft??'';q('areaMethod').value=f.field_method||'tape';q('areaNotes').value=f.notes||'';q('areaSave').textContent='Save Area Changes';draw();fieldReadout();if(map&&points.length)map.fitBounds(points.map(p=>[p.lat,p.lng]),{padding:[35,35],maxZoom:21});q('areaName').focus();});}
  function photoChanged(){reset();concreteFootprintPhotoId=selected().id;const c=selected();q('areaPhotoPreview').innerHTML=`<img src="${esc(photoSrc(c.photo_path))}" alt="Selected site photo" style="max-width:100%;max-height:180px;object-fit:contain;margin-top:10px"><p class="meta">${esc(c.address||'No address saved')}</p>`;if(photoMarker)photoMarker.remove();if(map&&c.latitude!=null&&c.longitude!=null)photoMarker=L.circleMarker([Number(c.latitude),Number(c.longitude)],{radius:7,color:'#e8231a'}).addTo(map).bindTooltip('Photo location');locatePhoto();savedList();}
  q('areaPhoto').onchange=()=>{status.textContent='';photoChanged();};q('areaNew').onclick=()=>{reset();status.textContent='New area. Your previously saved areas are unchanged.';};
  q('areaLength').oninput=fieldReadout;q('areaWidth').oninput=fieldReadout;
  q('areaTrace').onclick=()=>{tracing=true;q('areaTrace').textContent='Tracing…';q('areaMapStatus').textContent='Tap each corner of the proposed patio or foundation. Drag corners to adjust, then Finish Outline.';draw();};
  q('areaFinish').onclick=()=>{tracing=false;q('areaTrace').textContent='Add More Corners';q('areaMapStatus').textContent='Outline finished. Drag corners to adjust. Enter a name and save the area.';draw();};
  q('areaUndo').onclick=()=>{points.pop();draw();};q('areaClear').onclick=()=>{points=[];tracing=false;q('areaTrace').textContent='Trace Area';draw();};
  q('areaPhotoLocation').onclick=locatePhoto;
  q('areaMyLocation').onclick=()=>{if(!navigator.geolocation){q('areaMapStatus').textContent='Location is unavailable on this device.';return;}q('areaMapStatus').textContent='Finding your location…';navigator.geolocation.getCurrentPosition(p=>{if(!root.isConnected||!map)return;map.setView([p.coords.latitude,p.coords.longitude],20);q('areaMapStatus').textContent=`Centered near you (GPS accuracy approximately ${Math.round(p.coords.accuracy*3.28084)} ft). Draw from visible map features, not the GPS dot.`;},()=>{if(root.isConnected)q('areaMapStatus').textContent='Location could not be obtained. Use Photo Location or pan the map.';},{enableHighAccuracy:true,timeout:15000});};
  q('areaSave').onclick=async()=>{
    const button=q('areaSave');if(button.disabled)return;
    if(points.length&&points.length<3){status.textContent='Add at least three map corners, or clear the outline to save field dimensions only.';return;}
    const payload={capture_id:selected().id,name:q('areaName').value,points,field_length_ft:q('areaLength').value,field_width_ft:q('areaWidth').value,field_method:q('areaMethod').value,notes:q('areaNotes').value};
    button.disabled=true;q('areaPhoto').disabled=true;status.textContent='Saving area…';
    try{const r=await api('/api/concrete/footprints'+(editing?'/'+editing:''),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok)throw new Error(d.error||'Area could not be saved');if(!root.isConnected)return;areas=areas.filter(f=>f.id!==d.id);areas.unshift(d);editing=d.id;button.textContent='Save Area Changes';savedList();status.textContent='Area saved with this photo. It will appear in the Concrete Photo Evidence Report.';}
    catch(e){if(root.isConnected)status.textContent=e.message;}
    finally{button.disabled=false;q('areaPhoto').disabled=false;}
  };
  photoChanged();
  await loadLeaflet();if(!root.isConnected)return;
  if(!window.L){q('areaMapStatus').textContent='Map could not load. You can still save field dimensions; reconnect to use overhead imagery.';q('areaMap').hidden=true;for(const id of ['areaTrace','areaPhotoLocation','areaMyLocation'])q(id).disabled=true;return;}
  let cfg={};try{const r=await api('/api/config');if(r.ok)cfg=await r.json();}catch(e){}
  if(!root.isConnected)return;
  map=concreteFootprintMap=L.map(q('areaMap')).setView([29.5,-98.5],12);
  const tiles=cfg.mapbox_token?L.tileLayer(`https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/512/{z}/{x}/{y}@2x?access_token=${cfg.mapbox_token}`,{tileSize:512,zoomOffset:-1,maxZoom:22,attribution:'© Mapbox © Maxar'}):L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:22,maxNativeZoom:19,attribution:'Tiles © Esri, Maxar, Earthstar Geographics'});
  tiles.on('tileerror',()=>{if(root.isConnected)q('areaMapStatus').textContent='Some imagery could not load. Check your connection or zoom out. Field dimensions remain available.';});tiles.addTo(map);
  map.on('click',e=>{if(!tracing)return;if(points.length>=100){status.textContent='Maximum 100 corners per area.';return;}points.push({lat:e.latlng.lat,lng:e.latlng.lng});draw();});
  // A user may already have entered field dimensions while imagery loaded.
  locatePhoto();const c=selected();if(c.latitude!=null&&c.longitude!=null)photoMarker=L.circleMarker([Number(c.latitude),Number(c.longitude)],{radius:7,color:'#e8231a'}).addTo(map).bindTooltip('Photo location');draw();
}
